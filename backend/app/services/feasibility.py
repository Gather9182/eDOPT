"""Necessary energy bounds; passing these checks does not prove MILP feasibility.

Each bus gets every usable charger to itself and ignores switching restrictions.
Failure even in this optimistic case proves an individual energy shortfall.
"""


from .opportunity_charging import potential_profiles, possible_availability
from .soc_policy import minimum_energy, preferred_maximum
from .end_conditions import end_target, CYCLIC_SOC_TOLERANCE_KWH
from .charging_curve import max_curve_energy

ENERGY_CHECK_TOLERANCE_KWH = CYCLIC_SOC_TOLERANCE_KWH


def exceeds_tolerance(shortfall):
    return shortfall > ENERGY_CHECK_TOLERANCE_KWH + 1e-9


def energy_feasibility_issues(inputs, assessments=None):
    n = len(inputs.electricity_prices)
    dt = inputs.time_step_minutes / 60
    if not n or dt <= 0:
        return []
    issues = []
    for bus in inputs.buses:
        assessment=dict(bus_id=bus.id,scope='Current model assumptions only; not a general statement about the route.',
            method='Optimistic energy upper bound: no competition; switching restrictions and optional-trip costs relaxed.',
            tolerance_kwh=ENERGY_CHECK_TOLERANCE_KWH,driving_energy='not_checked',configured_end_energy='not_checked',
            end_condition='cyclic_soc' if inputs.use_cyclic_soc else 'next_day_readiness' if inputs.use_next_day_readiness else 'end_reserve')
        if assessments is not None:assessments.append(assessment)
        start_issue=len(issues)
        if inputs.use_cyclic_soc and exceeds_tolerance(bus.min_final_soc_kwh-bus.initial_soc_kwh):
            issues.append(dict(type='ERROR', code='BUS_CYCLIC_RESERVE_CONFLICT', category='energy', bus_id=bus.id,
                details=dict(reason='cyclic_reserve_conflict',scope='current_model_assumptions',proof='configured_constraint_conflict',tolerance_kwh=ENERGY_CHECK_TOLERANCE_KWH),
                message=f'Route {bus.id}: End reserve ({bus.min_final_soc_kwh:.1f} kWh) exceeds initial SoC '
                        f'({bus.initial_soc_kwh:.1f} kWh), conflicting with Start SoC = End SoC.'))
        hard_max = inputs.operating_max_soc_enabled and inputs.operating_max_soc_mode == 'hard'
        upper = preferred_maximum(inputs, bus) if hard_max else bus.max_battery_capacity_kwh
        if hard_max and exceeds_tolerance(bus.initial_soc_kwh-upper):
            issues.append(dict(type='ERROR', code='BUS_OPERATING_MAX_INITIAL', category='energy', bus_id=bus.id,
                details=dict(reason='initial_soc_above_hard_maximum',scope='current_model_assumptions',proof='configured_constraint_conflict',tolerance_kwh=ENERGY_CHECK_TOLERANCE_KWH),
                message=f'Route {bus.id}: Initial SoC ({bus.initial_soc_kwh:.1f} kWh) exceeds the hard operating maximum ({upper:.1f} kWh).'))
        floor = minimum_energy(inputs, bus) if inputs.operating_min_soc_mode == 'hard' else 0
        if exceeds_tolerance(floor-bus.initial_soc_kwh):
            issues.append(dict(type='ERROR', code='BUS_OPERATING_MIN_INITIAL', category='energy', bus_id=bus.id,
                details=dict(reason='initial_soc_below_hard_minimum',scope='current_model_assumptions',proof='configured_constraint_conflict',tolerance_kwh=ENERGY_CHECK_TOLERANCE_KWH),
                message=f'Route {bus.id}: Initial SoC ({bus.initial_soc_kwh:.1f} kWh) is below the hard operating minimum ({floor:.1f} kWh).'))
        if len(bus.availability) != n or len(bus.trip_energy_profile_kwh) != n:
            continue
        potential = potential_profiles(bus, inputs)
        availability = possible_availability(bus, inputs)
        if (len(bus.availability) != n or len(bus.trip_energy_profile_kwh) != n
                or not 0 < bus.efficiency <= 1
                or bus.initial_soc_kwh < 0 or bus.initial_soc_kwh > bus.max_battery_capacity_kwh
                or any(energy < 0 for energy in bus.trip_energy_profile_kwh)):
            continue
        if not any(availability):
            assessment.update(driving_energy='not_checked_missing_mapping',configured_end_energy='not_checked_missing_mapping',
                note='No mapped charging availability. Review charging-node assignments; the warning alone does not prove that this route is infeasible.')
            continue
        if any(issue['code'] in ('BUS_OPERATING_MAX_INITIAL','BUS_OPERATING_MIN_INITIAL') for issue in issues[start_issue:]):
            assessment['note']='Initial energy conflicts with a hard operating limit. Correct the configuration before interpreting route energy bounds.'
            continue
        target = end_target(inputs, bus)
        assessment.update(initial_soc_kwh=bus.initial_soc_kwh,operating_floor_kwh=floor,
            configured_end_target_kwh=max(target,bus.min_final_soc_kwh),reserve_target_kwh=bus.min_final_soc_kwh)
        if hard_max and exceeds_tolerance(target-upper) and target<=bus.max_battery_capacity_kwh+ENERGY_CHECK_TOLERANCE_KWH:
            issues.append(dict(type='ERROR', code='BUS_FINAL_TARGET_EXCEEDS_OPERATING_MAX', category='energy', bus_id=bus.id,
                details=dict(reason='final_target_above_hard_maximum',required_energy_kwh=target,maximum_final_energy_kwh=upper),
                message=f'Route {bus.id}: The final energy target ({target:.1f} kWh) exceeds the hard operating maximum ({upper:.1f} kWh). Review the maximum, end reserve or Next-Day Readiness.'))
        if exceeds_tolerance(target-bus.max_battery_capacity_kwh):
            issues.append(dict(type='ERROR', code='BUS_FINAL_TARGET_EXCEEDS_CAPACITY', category='energy', bus_id=bus.id,
                details=dict(reason='final_target_above_battery_capacity',required_energy_kwh=target, battery_capacity_kwh=bus.max_battery_capacity_kwh,
                             reserve_kwh=bus.min_final_soc_kwh, next_day_required_energy_kwh=bus.next_day_required_energy_kwh if inputs.use_next_day_readiness else 0),
                message=f'Route {bus.id}: The end-of-day reserve and next-day requirement total {target:.1f} kWh, '
                        f'but the battery can hold only {bus.max_battery_capacity_kwh:.1f} kWh. '
                        'Review battery capacity, consumption, next-day readiness or additional charging locations.'))
        soc = bus.initial_soc_kwh
        for t, energy in enumerate(bus.trip_energy_profile_kwh):
            power = 0
            curve_gain = None
            if availability[t]:
                power = bus.max_power_kw
                if inputs.charging_sites:
                    site_limits = []
                    curve_gains = []
                    for site in inputs.charging_sites:
                        available = potential.get(site.id, [])
                        if site.num_chargers > 0 and len(available) == n and available[t]:
                            limit = min(site.charger_power_kw, site.charger_capacity_kw)
                            if inputs.scenario == 'baseline' or site.id != inputs.energy_site_id:
                                limit = min(limit, site.grid_limit_kw)
                            site_limits.append(limit)
                            if inputs.charging_curve.enabled:
                                curve_gains.append(max_curve_energy(inputs, bus, soc, min(bus.max_power_kw,limit), dt, site.charger_power_kw))
                    power = min(power, max(site_limits, default=0))
                    if inputs.charging_curve.enabled:
                        curve_gain = max(curve_gains, default=0)
                else:
                    power = min(power, inputs.charger_capacity_kw)
                    if inputs.scenario == 'baseline':
                        power = min(power, inputs.grid_limit_kw)
                    if inputs.num_chargers <= 0:
                        power = 0
            # Match the solver's interval-end capacity bound, including legacy
            # profiles with charging and consumption during the same interval.
            gain = ((curve_gain if curve_gain is not None else max_curve_energy(inputs, bus, soc, max(0,power), dt))
                    if inputs.charging_curve.enabled else max(0, power) * dt * bus.efficiency)
            soc = min(upper, soc + gain - energy)
            if exceeds_tolerance(floor-soc):
                minute = inputs.horizon_start_minute + t * inputs.time_step_minutes
                issues.append(dict(type='ERROR', code='BUS_ENERGY_INFEASIBLE', category='energy', bus_id=bus.id,
                    details=dict(reason='trip_energy_shortfall', period=t, minute=minute, missing_energy_kwh=floor-soc,
                                 battery_capacity_kwh=bus.max_battery_capacity_kwh,minimum_required_soc_kwh=floor,optimistic_soc_kwh=soc),
                    message=f'Route {bus.id}: Under the current model assumptions, at least {floor-soc:.3f} kWh is missing to meet the battery/operating minimum in the interval starting at '
                            f'{int(minute)//60%24:02d}:{int(minute)%60:02d}, even with the maximum possible charging '
                            f'and no competition (battery: {bus.max_battery_capacity_kwh:.1f} kWh). '
                            'Review battery capacity, consumption and charging opportunities before this trip.'))
                assessment.update(driving_energy='shortfall_proven',configured_end_energy='not_reachable_due_to_trip_shortfall',
                    reason='trip_energy_shortfall',missing_energy_kwh=floor-soc,period=t,minute=minute)
                break
        else:
            assessment.update(driving_energy='bound_passed_not_proven',maximum_final_energy_kwh=soc,
                configured_end_energy='shortfall_proven' if exceeds_tolerance(max(target,bus.min_final_soc_kwh)-soc) else 'bound_passed_not_proven',
                end_reserve_energy='shortfall_proven' if exceeds_tolerance(bus.min_final_soc_kwh-soc) else 'bound_passed_not_proven',
                cyclic_soc_energy='shortfall_proven' if exceeds_tolerance(bus.initial_soc_kwh-soc) else 'bound_passed_not_proven')
            if exceeds_tolerance(target-soc) and target<=upper+ENERGY_CHECK_TOLERANCE_KWH:
                reason='cyclic_soc_shortfall' if inputs.use_cyclic_soc else 'final_energy_shortfall'
                assessment.update(reason=reason,missing_energy_kwh=target-soc)
                issues.append(dict(type='ERROR', code='BUS_ENERGY_INFEASIBLE', category='energy', bus_id=bus.id,
                    details=dict(reason=reason,driving_energy='bound_passed_not_proven',maximum_final_energy_kwh=soc, required_energy_kwh=target,
                                 missing_energy_kwh=target-soc),
                    message=f'Route {bus.id}: At most {soc:.1f} kWh can remain at the end, even without competition; '
                            f'{target:.1f} kWh is required ({"Start SoC = End SoC" if inputs.use_cyclic_soc else "configured end reserve / next-day readiness"}). '
                            f'Shortfall: {target-soc:.3f} kWh under the current model assumptions. '
                            'The driving-energy bound passed; this is an end-condition failure, not proof that the timetable alone cannot be driven.'))
        for issue in issues[start_issue:]:
            issue['details']={**issue.get('details',{}),'scope':'current_model_assumptions','proof':issue.get('details',{}).get('proof','optimistic_energy_bound'),
                'tolerance_kwh':ENERGY_CHECK_TOLERANCE_KWH,'end_condition':assessment['end_condition']}
            if 'current model assumptions' not in issue['message']:
                issue['message']+=' This finding applies only to the current model assumptions.'
    return issues
