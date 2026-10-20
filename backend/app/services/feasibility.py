"""Necessary energy bounds; passing these checks does not prove MILP feasibility.

Each bus gets every usable charger to itself and ignores switching restrictions.
Failure even in this optimistic case proves an individual energy shortfall.
"""


from .opportunity_charging import potential_profiles, possible_availability


def energy_feasibility_issues(inputs):
    n = len(inputs.electricity_prices)
    dt = inputs.time_step_minutes / 60
    if not n or dt <= 0:
        return []
    issues = []
    for bus in inputs.buses:
        if len(bus.availability) != n or len(bus.trip_energy_profile_kwh) != n:
            continue
        potential = potential_profiles(bus, inputs)
        availability = possible_availability(bus, inputs)
        if (len(bus.availability) != n or len(bus.trip_energy_profile_kwh) != n
                or not any(availability) or not 0 < bus.efficiency <= 1
                or bus.initial_soc_kwh < 0 or bus.initial_soc_kwh > bus.max_battery_capacity_kwh
                or any(energy < 0 for energy in bus.trip_energy_profile_kwh)):
            continue
        target = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if inputs.use_next_day_readiness else 0)
        if target > bus.max_battery_capacity_kwh + .01:
            issues.append(dict(type='ERROR', code='BUS_FINAL_TARGET_EXCEEDS_CAPACITY', category='energy', bus_id=bus.id,
                details=dict(required_energy_kwh=target, battery_capacity_kwh=bus.max_battery_capacity_kwh,
                             reserve_kwh=bus.min_final_soc_kwh, next_day_required_energy_kwh=bus.next_day_required_energy_kwh if inputs.use_next_day_readiness else 0),
                message=f'Route {bus.id}: The end-of-day reserve and next-day requirement total {target:.1f} kWh, '
                        f'but the battery can hold only {bus.max_battery_capacity_kwh:.1f} kWh. '
                        'Review battery capacity, consumption, next-day readiness or additional charging locations.'))
        soc = bus.initial_soc_kwh
        for t, energy in enumerate(bus.trip_energy_profile_kwh):
            power = 0
            if availability[t]:
                power = min(bus.max_power_kw, inputs.charger_capacity_kw)
                if inputs.scenario == 'baseline':
                    power = min(power, inputs.grid_limit_kw)
                if inputs.charging_sites:
                    site_limits = []
                    for site in inputs.charging_sites:
                        available = potential.get(site.id, [])
                        if site.num_chargers > 0 and len(available) == n and available[t]:
                            limit = min(site.charger_power_kw, site.charger_capacity_kw)
                            if inputs.scenario == 'baseline' or site.id != inputs.energy_site_id:
                                limit = min(limit, site.grid_limit_kw)
                            site_limits.append(limit)
                    power = min(power, max(site_limits, default=0))
                elif inputs.num_chargers <= 0:
                    power = 0
            # Match the solver's interval-end capacity bound, including legacy
            # profiles with charging and consumption during the same interval.
            soc = min(bus.max_battery_capacity_kwh, soc + max(0, power) * dt * bus.efficiency - energy)
            if soc < -.01:
                minute = inputs.horizon_start_minute + t * inputs.time_step_minutes
                issues.append(dict(type='ERROR', code='BUS_ENERGY_INFEASIBLE', category='energy', bus_id=bus.id,
                    details=dict(reason='trip_energy_shortfall', period=t, minute=minute, missing_energy_kwh=-soc,
                                 battery_capacity_kwh=bus.max_battery_capacity_kwh),
                    message=f'Route {bus.id}: At least {-soc:.1f} kWh is missing in the interval starting at '
                            f'{int(minute)//60%24:02d}:{int(minute)%60:02d}, even with the maximum possible charging '
                            f'and no competition (battery: {bus.max_battery_capacity_kwh:.1f} kWh). '
                            'Review battery capacity, consumption and charging opportunities before this trip.'))
                break
        else:
            if soc + .01 < target and target <= bus.max_battery_capacity_kwh + .01:
                issues.append(dict(type='ERROR', code='BUS_ENERGY_INFEASIBLE', category='energy', bus_id=bus.id,
                    details=dict(reason='final_energy_shortfall', maximum_final_energy_kwh=soc, required_energy_kwh=target,
                                 missing_energy_kwh=target-soc),
                    message=f'Route {bus.id}: At most {soc:.1f} kWh can remain at the end, even without competition; '
                            f'{target:.1f} kWh is required. Review charging windows, power limits and the end-of-day reserve.'))
    return issues
