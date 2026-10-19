"""Physical connection constraints shared by both MILP formulations."""
import pulp


def is_switch_blocked(site, minute):
    clock = minute % 1440
    for window in site.no_switch_windows:
        start = sum(int(v) * m for v, m in zip(window.start.split(':'), (60, 1)))
        end = sum(int(v) * m for v, m in zip(window.end.split(':'), (60, 1)))
        if start == end or (start < end and start <= clock < end) or (start > end and (clock >= start or clock < end)):
            return True
    return False


def slot_is_blocked(site, minute, step):
    # A lock boundary inside a slot is treated conservatively: switching is
    # blocked for that slot. Timetable departures are still permitted.
    return any(is_switch_blocked(site, minute + offset) for offset in range(step))


def validate_sites(inputs):
    if any(bus.opportunity_visits for bus in inputs.buses) and not inputs.charging_sites:
        raise ValueError('Zusätzliche Ladefahrten benötigen konfigurierte Ladeorte.')
    if inputs.use_charging_sites and not inputs.charging_sites:
        raise ValueError('Add at least one charging location or disable separate charging locations.')
    if not inputs.charging_sites:
        return
    n = len(inputs.electricity_prices)
    expected = inputs.planning_horizon_hours * 60 / inputs.time_step_minutes
    if n != expected:
        raise ValueError('Price/profile length does not match the planning horizon and resolution.')
    ids = [s.id for s in inputs.charging_sites]
    if len(ids) != len(set(ids)):
        raise ValueError('Charging site IDs must be unique.')
    nodes = [node for s in inputs.charging_sites for node in s.nodes]
    if len(nodes) != len(set(nodes)):
        raise ValueError('A timetable node may belong to only one charging site.')
    if inputs.scenario != 'baseline' and inputs.energy_site_id not in ids:
        raise ValueError('Select the charging site hosting PV and BESS.')
    if not inputs.buses or len({b.id for b in inputs.buses}) != len(inputs.buses):
        raise ValueError('Provide buses with unique Umlauf IDs for location-based charging.')
    for bus in inputs.buses:
        for visit in bus.opportunity_visits:
            if visit.site_id not in ids or visit.origin_site_id not in (None, *ids) or visit.return_site_id not in (None, *ids):
                raise ValueError(f'Bus {bus.id}: unbekannter Ladeort im Mapping.')
            if visit.pause_end_min <= visit.pause_start_min or visit.pause_end_min-visit.pause_start_min > bus.opportunity_period_minutes:
                raise ValueError(f'Bus {bus.id}: ungültige Pause für Zusatzladefahrt.')
        if len(bus.availability) != n or len(bus.trip_energy_profile_kwh) != n:
            raise ValueError(f'Bus {bus.id}: availability and trip energy lengths must match the price profile.')
        if bus.site_nodes and bus.site_nodes != {s.id: s.nodes for s in inputs.charging_sites}:
            raise ValueError(f'Bus {bus.id}: location nodes changed. Process the timetable again.')
        if set(bus.site_availability) - set(ids):
            raise ValueError(f'Bus {bus.id}: charging locations changed; process the timetable again.')
        for mapping in (bus.site_availability, bus.site_presence, bus.site_arrivals):
            for site_id, profile in mapping.items():
                if site_id not in ids or len(profile) != n or any(v not in (0, 1) for v in profile):
                    raise ValueError(f'Bus {bus.id}: invalid location profile for {site_id}. Reprocess the timetable.')
        if not bus.site_availability:
            raise ValueError(f'Bus {bus.id}: no location profiles. Process the timetable with charging sites enabled.')
        if bus.initial_connection_site not in (None, '', *ids):
            raise ValueError(f'Bus {bus.id}: unknown initial connection.')
        for t in range(n):
            eligible = sum(p[t] for p in bus.site_availability.values())
            if eligible > 1 or eligible != bus.availability[t]:
                raise ValueError(f'Bus {bus.id}: inconsistent or overlapping charging locations at period {t}.')
            if any(bus.site_availability.get(site.id, [0]*n)[t] > bus.site_presence.get(site.id, bus.site_availability.get(site.id, [0]*n))[t] for site in inputs.charging_sites):
                raise ValueError(f'Bus {bus.id}: charging availability exceeds physical presence.')


def add_site_constraints(prob, inputs, power, grid_import=None, energy_flows=None, opportunities=None):
    if not inputs.charging_sites:
        return None
    validate_sites(inputs)
    n = len(inputs.electricity_prices)
    sites = inputs.charging_sites
    connected, site_power, grids = {}, {}, {}
    dynamic_buses = {item['bus'].id for item in (opportunities or {}).get('visits', [])}
    for bi, bus in enumerate(inputs.buses):
        for si, site in enumerate(sites):
            available = bus.site_availability.get(site.id, [0] * n)
            present = bus.site_presence.get(site.id, available)
            arrivals = bus.site_arrivals.get(site.id, [int(present[t] and not present[t-1]) for t in range(n)])
            dynamic = bus.id in dynamic_buses
            dynamic_presence, dynamic_arrivals = [], []
            for t in range(n):
                key = (bus.id, site.id, t)
                y = pulp.LpVariable(f'connected_{bi}_{si}_{t}', cat='Binary')
                p = pulp.LpVariable(f'site_power_{bi}_{si}_{t}', lowBound=0)
                connected[key], site_power[key] = y, p
                busy = opportunities['busy'].get((bus.id,t),0) if dynamic else 0
                visit_presence = opportunities['presence'].get(key,0) if dynamic else 0
                actual_presence = present[t]*(1-busy)+visit_presence
                actual_arrival = arrivals[t]*(1-busy)+(opportunities['arrivals'].get(key,0) if dynamic else 0)
                dynamic_presence.append(actual_presence)
                dynamic_arrivals.append(actual_arrival)
                prob += y <= actual_presence
                prob += p <= min(bus.max_power_kw, site.charger_power_kw) * y
                prob += p <= bus.max_power_kw * (available[t]*(1-busy)+visit_presence)
                blocked = slot_is_blocked(site, inputs.horizon_start_minute + t * inputs.time_step_minutes, inputs.time_step_minutes)
                if not blocked:
                    continue
                if dynamic:
                    prev = connected[(bus.id,site.id,t-1)] if t else (int(bus.initial_connection_site == site.id) if bus.initial_connection_site is not None else None)
                    if prev is not None:
                        prob += y >= prev-(1-actual_presence)-actual_arrival
                        prob += y <= prev+(actual_arrival if site.allow_connect_on_arrival else 0)
                    continue
                # Releases for timetable departures are always possible. A positive
                # arrival event permits only initial connection, never disconnection
                # of another vehicle that is still parked.
                if t > 0 and present[t] and present[t-1]:
                    prev = connected[(bus.id, site.id, t-1)]
                    if arrivals[t]:
                        if not site.allow_connect_on_arrival:
                            prob += y == 0
                    else:
                        prob += y == prev
                elif t > 0 and present[t] and not site.allow_connect_on_arrival:
                    prob += y == 0
                elif t == 0 and bus.initial_connection_site is not None and present[t]:
                    if not arrivals[t]:
                        prob += y == int(bus.initial_connection_site == site.id)
                    elif not site.allow_connect_on_arrival:
                        prob += y == 0
            # Preserve overnight occupation across the repeated-day boundary.
            if dynamic and inputs.cyclic_connections and bus.initial_connection_site is None and n*inputs.time_step_minutes % 1440 == 0 and is_switch_blocked(site, inputs.horizon_start_minute):
                y, prev = connected[(bus.id,site.id,0)], connected[(bus.id,site.id,n-1)]
                prob += y >= prev-(1-dynamic_presence[0])-dynamic_arrivals[0]
                prob += y <= prev+(dynamic_arrivals[0] if site.allow_connect_on_arrival else 0)
            elif (inputs.cyclic_connections and bus.initial_connection_site is None and n * inputs.time_step_minutes % 1440 == 0
                    and present[0] and present[-1] and not arrivals[0]
                    and is_switch_blocked(site, inputs.horizon_start_minute)):
                prob += connected[(bus.id, site.id, 0)] == connected[(bus.id, site.id, n-1)]
        for t in range(n):
            prob += pulp.lpSum(connected[(bus.id, s.id, t)] for s in sites) <= 1
            prob += power[(bus.id, t)] == pulp.lpSum(site_power[(bus.id, s.id, t)] for s in sites)
    for si, site in enumerate(sites):
        for t in range(n):
            load = pulp.lpSum(site_power[(b.id, site.id, t)] for b in inputs.buses)
            prob += pulp.lpSum(connected[(b.id, site.id, t)] for b in inputs.buses) <= site.num_chargers
            prob += load <= site.charger_capacity_kw
            g = pulp.LpVariable(f'site_grid_{si}_{t}', lowBound=0, upBound=site.grid_limit_kw)
            grids[(site.id, t)] = g
            if energy_flows is not None and site.id == inputs.energy_site_id:
                pv, charge, discharge = energy_flows
                prob += g + pv[t] + discharge[t] == load + charge[t]
            else:
                prob += g == load
    if grid_import is not None:
        for t in range(n):
            prob += grid_import[t] == pulp.lpSum(grids[(s.id, t)] for s in sites)
    return connected, site_power, grids


def site_results(inputs, state):
    if state is None:
        return {}
    connected, power, grids = state
    n = len(inputs.electricity_prices)
    value = lambda v: float(pulp.value(v) or 0)
    connections = {b.id: [next((s.id for s in inputs.charging_sites if value(connected[(b.id, s.id, t)]) > .5), '')
                           for t in range(n)] for b in inputs.buses}
    return {
        'connection_schedules': connections,
        'final_connections': {b: values[-1] for b, values in connections.items()},
        'site_load_profiles': {s.id: [round(sum(value(power[(b.id, s.id, t)]) for b in inputs.buses), 4) for t in range(n)] for s in inputs.charging_sites},
        'site_grid_import_profiles': {s.id: [round(value(grids[(s.id, t)]), 4) for t in range(n)] for s in inputs.charging_sites},
        'site_occupied_connectors': {s.id: [sum(value(connected[(b.id, s.id, t)]) > .5 for b in inputs.buses) for t in range(n)] for s in inputs.charging_sites},
    }


def simulate_site_baseline(inputs):
    """Arrival charging: a full vehicle still occupies its socket during a lock."""
    import numpy as np
    n = len(inputs.electricity_prices)
    dt = inputs.time_step_minutes / 60
    load = np.zeros(n)
    soc = {b.id: b.initial_soc_kwh for b in inputs.buses}
    connections = {b.id: b.initial_connection_site or '' for b in inputs.buses}
    issues = []
    first_connections = None
    for t in range(n):
        for site in inputs.charging_sites:
            blocked = slot_is_blocked(site, inputs.horizon_start_minute + t * inputs.time_step_minutes, inputs.time_step_minutes)
            for bus in inputs.buses:
                available = bus.site_availability.get(site.id, [0] * n)
                presence = bus.site_presence.get(site.id, available)
                arrivals = bus.site_arrivals.get(site.id, [int(presence[k] and not presence[k-1]) for k in range(n)])
                if connections[bus.id] == site.id and (not presence[t] or arrivals[t] or (not blocked and soc[bus.id] >= bus.max_battery_capacity_kwh - .01)):
                    connections[bus.id] = ''
                can_connect = not blocked or (site.allow_connect_on_arrival and arrivals[t])
                # At the first horizon boundary, initialise the unknown parked fleet.
                can_connect |= t == 0 and bus.initial_connection_site is None and not arrivals[t]
                occupied = sum(s == site.id for s in connections.values())
                if not connections[bus.id] and presence[t] and occupied < site.num_chargers and can_connect and soc[bus.id] < bus.max_battery_capacity_kwh - .01:
                    connections[bus.id] = site.id
            site_kw = 0
            for bus in inputs.buses:
                if connections[bus.id] != site.id or not bus.site_availability.get(site.id, [0] * n)[t]:
                    continue
                kw = max(0, min(bus.max_power_kw, site.charger_power_kw,
                               site.grid_limit_kw - site_kw, site.charger_capacity_kw - site_kw,
                               inputs.grid_limit_kw - load[t], inputs.charger_capacity_kw - load[t],
                               (bus.max_battery_capacity_kwh - soc[bus.id]) / (dt * bus.efficiency)))
                site_kw += kw
                load[t] += kw
                soc[bus.id] += kw * dt * bus.efficiency
        for bus in inputs.buses:
            soc[bus.id] -= bus.trip_energy_profile_kwh[t]
            if soc[bus.id] < -.01:
                issues.append(f'Bus {bus.id}: insufficient energy at period {t}.')
        if t == 0:
            first_connections = dict(connections)
    for bus in inputs.buses:
        target = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if inputs.use_next_day_readiness else 0)
        if soc[bus.id] < target - .01:
            issues.append(f'Bus {bus.id}: final readiness not reached by arrival charging.')
        if inputs.cyclic_connections and bus.initial_connection_site is None and n * inputs.time_step_minutes % 1440 == 0:
            for site in inputs.charging_sites:
                presence = bus.site_presence.get(site.id, bus.site_availability.get(site.id, [0]*n))
                arrivals = bus.site_arrivals.get(site.id, [0]*n)
                if presence[0] and presence[-1] and not arrivals[0] and is_switch_blocked(site, inputs.horizon_start_minute):
                    if (first_connections[bus.id] == site.id) != (connections[bus.id] == site.id):
                        issues.append(f'Bus {bus.id}: arrival baseline does not preserve the overnight connection at the horizon boundary.')
    return load, sorted(set(issues))
