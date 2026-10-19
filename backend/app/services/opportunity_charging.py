"""Optional round trips with chosen departure/return, power and travel energy."""
import math
import pulp


def visit_grids(bus, inputs):
    n, step = len(inputs.electricity_prices), inputs.time_step_minutes
    start, end = inputs.horizon_start_minute, inputs.horizon_start_minute+n*step
    for visit in bus.opportunity_visits:
        if visit.pause_end_min <= visit.pause_start_min:
            raise ValueError(f'{visit.id}: Ende der Pause muss nach ihrem Beginn liegen.')
        period = bus.opportunity_period_minutes
        for day in range(math.floor((start-visit.pause_end_min)/period), math.ceil((end-visit.pause_start_min)/period)):
            a = math.ceil((visit.pause_start_min+day*period+visit.buffer_minutes-start)/step)
            b = math.floor((visit.pause_end_min+day*period-visit.buffer_minutes-start)/step)
            # Boundary visits must be complete in this horizon. In a cyclic day,
            # the last visit may wrap into the next day (and back to period 0).
            cyclic = inputs.cyclic_connections and n*step % period == 0
            if a < 0 or a >= n or (b > n and not cyclic) or b-a > n:
                continue
            out, back = math.ceil(visit.outbound_minutes/step), math.ceil(visit.return_minutes/step)
            minimum = math.ceil(visit.min_charge_minutes/step)
            if b-a < out+back+minimum:
                continue
            # Never offer a visit over a scheduled movement, including fractional
            # boundary slots already conservatively excluded by the importer.
            conflict = False
            for trip in bus.trips:
                if trip.get('end_min', 0) <= trip.get('start_min', 0):
                    continue
                if not (trip.get('dist_m', 0) > 0 or trip.get('von') != trip.get('nach')):
                    continue
                for shift in range(math.floor((start+a*step-trip['end_min'])/period), math.ceil((start+b*step-trip['start_min'])/period)+1):
                    if trip['start_min']+shift*period < start+b*step and trip['end_min']+shift*period > start+a*step:
                        conflict = True
            if not conflict:
                yield visit, day, a, b, out, back, minimum


def potential_profiles(bus, inputs):
    n = len(inputs.electricity_prices)
    profiles = {key: list(values) for key, values in bus.site_availability.items()}
    for visit, _, a, b, out, back, _ in visit_grids(bus, inputs):
        profile = profiles.setdefault(visit.site_id, [0]*n)
        for t in range(a+out, b-back):
            profile[t % n] = 1
    return profiles


def possible_availability(bus, inputs):
    profiles = potential_profiles(bus, inputs)
    return [int(bool(bus.availability[t]) or any(p[t] for p in profiles.values())) for t in range(len(inputs.electricity_prices))]


def add_opportunity_variables(prob, inputs):
    from .charging_sites import slot_is_blocked
    n, step = len(inputs.electricity_prices), inputs.time_step_minutes
    state = dict(presence={}, arrivals={}, busy={}, energy={}, visits=[])
    sites = {s.id: s for s in inputs.charging_sites}
    for bi, bus in enumerate(inputs.buses):
        groups = {}
        for vi, (visit, day, a, b, out, back, minimum) in enumerate(visit_grids(bus, inputs)):
            if visit.site_id not in sites:
                raise ValueError(f'{visit.id}: unbekannter Ladestandort.')
            x = pulp.LpVariable(f'visit_{bi}_{vi}', cat='Binary')
            groups.setdefault((visit.gap_id, day), []).append(x)
            def travel_allowed(t, duration):
                if not visit.allowed_windows:
                    return True
                for offset in range(max(1, duration*step)):
                    minute = (inputs.horizon_start_minute+t*step+offset) % 1440
                    permitted = False
                    for window in visit.allowed_windows:
                        left = sum(int(v)*m for v,m in zip(window.start.split(':'),(60,1)))
                        right = sum(int(v)*m for v,m in zip(window.end.split(':'),(60,1)))
                        permitted |= left == right or (left < right and left <= minute < right) or (left > right and (minute >= left or minute < right))
                    if not permitted:
                        return False
                return True
            departures, returns = {}, {}
            for t in range(a, b-out-back-minimum+1):
                source = sites.get(visit.origin_site_id)
                if travel_allowed(t, out) and (not source or not slot_is_blocked(source, inputs.horizon_start_minute+t*step, step)):
                    departures[t] = pulp.LpVariable(f'visit_out_{bi}_{vi}_{t}', cat='Binary')
            for t in range(a+out+minimum, b-back+1):
                # Optional relocation cannot masquerade as a fixed timetable
                # departure to bypass an unplugging restriction.
                if travel_allowed(t, back) and not slot_is_blocked(sites[visit.site_id], inputs.horizon_start_minute+t*step, step):
                    returns[t] = pulp.LpVariable(f'visit_back_{bi}_{vi}_{t}', cat='Binary')
            prob += pulp.lpSum(departures.values()) == x
            prob += pulp.lpSum(returns.values()) == x
            activities, onsite = [], {}
            for t in range(a, b):
                at = pulp.lpSum(v for s,v in departures.items() if s+out <= t)-pulp.lpSum(v for s,v in returns.items() if s <= t)
                busy = pulp.lpSum(v for s,v in departures.items() if s <= t)-pulp.lpSum(v for s,v in returns.items() if s+back <= t)
                prob += at >= 0
                prob += at <= x
                prob += busy >= 0
                prob += busy <= x
                key = (bus.id, visit.site_id, t % n)
                state['presence'][key] = state['presence'].get(key, 0)+at
                state['busy'][(bus.id,t % n)] = state['busy'].get((bus.id,t % n),0)+busy
                if a+out <= t < b-back:
                    active = pulp.LpVariable(f'visit_charge_{bi}_{vi}_{t}', cat='Binary')
                    prob += active <= at
                    activities.append((t % n, active))
                    onsite[t % n] = at
                for source, duration, energy, destination in [(departures,out,visit.outbound_energy_kwh,visit.site_id), (returns,back,visit.return_energy_kwh,visit.return_site_id)]:
                    if t in source:
                        k = (bus.id, t % n)
                        state['energy'][k] = state['energy'].get(k,0)+energy*source[t]
                    arrivals = [v for s,v in source.items() if s+duration == t]
                    if destination:
                        arrival_key = (bus.id,destination,t % n)
                        state['arrivals'][arrival_key] = state['arrivals'].get(arrival_key,0)+pulp.lpSum(arrivals)
            # A return ending exactly at b may re-enter an original charging stay.
            if visit.return_site_id and (b < n or inputs.cyclic_connections):
                key = (bus.id,visit.return_site_id,b % n)
                state['arrivals'][key] = state['arrivals'].get(key,0)+pulp.lpSum(v for s,v in returns.items() if s+back == b)
            prob += pulp.lpSum(active for _,active in activities) >= minimum*x
            state['visits'].append(dict(bus=bus, visit=visit, day=day, selected=x, departures=departures, returns=returns, activities=activities, onsite=onsite))
        for choices in groups.values():
            prob += pulp.lpSum(choices) <= 1
        for t in range(n):
            if (bus.id,t) in state['busy']:
                prob += state['busy'][(bus.id,t)] <= 1
    return state


def link_visit_charging(prob, inputs, state, connected, power, soc):
    n = len(inputs.electricity_prices)
    for item in state['visits']:
        bus, visit, x = item['bus'],item['visit'],item['selected']
        minimum_power = visit.min_charging_power_kw
        charging = []
        for t, active in item['activities']:
            key = (bus.id,visit.site_id,t)
            prob += active <= connected[key]
            prob += power[key] >= minimum_power*active
            # Charge counted for this visit only, even if another alternative
            # targets the same site at another time.
            p = pulp.LpVariable(f'visit_kW_{len(charging)}_{x.name}',lowBound=0)
            prob += p <= bus.max_power_kw*x
            prob += p <= bus.max_power_kw*item['onsite'][t]
            prob += p <= power[key]
            charging.append(p)
        needed = visit.outbound_energy_kwh+visit.return_energy_kwh+visit.min_net_energy_kwh+.001
        prob += pulp.lpSum(charging)*inputs.time_step_minutes/60*bus.efficiency >= needed*x
        for events, energy in [(item['departures'],visit.outbound_energy_kwh),(item['returns'],visit.return_energy_kwh)]:
            for t, event in events.items():
                prob += soc[(bus.id,t % n)] >= energy*event


def opportunity_results(inputs, state, site_power):
    n, step = len(inputs.electricity_prices), inputs.time_step_minutes
    result = dict(opportunity_charging_visits=[],additional_trip_energy_profiles={},additional_trips={})
    value = lambda v: float(pulp.value(v) or 0)
    for item in state['visits']:
        if value(item['selected']) < .5:
            continue
        bus, visit = item['bus'],item['visit']
        departure = next(t for t,v in item['departures'].items() if value(v) > .5)
        back = next(t for t,v in item['returns'].items() if value(v) > .5)
        out_slots, back_slots = math.ceil(visit.outbound_minutes/step),math.ceil(visit.return_minutes/step)
        start = inputs.horizon_start_minute
        energy = result['additional_trip_energy_profiles'].setdefault(bus.id,[0.0]*n)
        trips = result['additional_trips'].setdefault(bus.id,[])
        for a,b,kwh,km,origin,dest in [(departure,departure+out_slots,visit.outbound_energy_kwh,visit.outbound_km,visit.from_node,visit.site_id),
                                       (back,back+back_slots,visit.return_energy_kwh,visit.return_km,visit.site_id,visit.to_node)]:
            energy[a % n] += kwh
            trips.append(dict(typ='Ladefahrt',von=origin,nach=dest,start_min=start+a*step,end_min=start+b*step,
                              energy_kwh=kwh,dist_m=km*1000,is_technical=False,opportunity_id=visit.id))
        power = sum(value(site_power[(bus.id,visit.site_id,t % n)]) for t in range(departure+out_slots,back))*step/60
        result['opportunity_charging_visits'].append(dict(bus_id=bus.id,site_id=visit.site_id,from_node=visit.from_node,to_node=visit.to_node,
            departure_min=start+departure*step,charger_arrival_min=start+(departure+out_slots)*step,
            return_departure_min=start+back*step,return_arrival_min=start+(back+back_slots)*step,
            charged_kwh=round(power,4),travel_energy_kwh=visit.outbound_energy_kwh+visit.return_energy_kwh,
            battery_charged_kwh=round(power*bus.efficiency,4),
            net_energy_gain_kwh=round(power*bus.efficiency-visit.outbound_energy_kwh-visit.return_energy_kwh,4),
            distance_km=visit.outbound_km+visit.return_km))
    return result
