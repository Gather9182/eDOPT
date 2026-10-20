"""Piecewise charging rates, integrated across SoC bands within each time step.

Power is charger-side kW. Battery gain includes bus efficiency. As in the bus
balance, interval trip consumption is applied after charging. Network/site power
constraints remain interval-average constraints of the existing time-grid model.
"""
import pulp

from .opportunity_charging import potential_profiles, possible_availability


def band_rates(inputs, cap_kw, charger_power_kw):
    curve = inputs.charging_curve
    return [min(cap_kw, charger_power_kw * band.power_fraction) for band in curve.bands]


def max_curve_energy(inputs, bus, initial_kwh, cap_kw, hours, charger_power_kw=None):
    """Maximum battery energy added, accounting for every crossed SoC band."""
    base = bus.max_power_kw if charger_power_kw is None else charger_power_kw
    if cap_kw <= 0 or base <= 0 or hours <= 0:
        return 0.0
    start = max(0.0, initial_kwh)
    energy = start
    for band, rate in zip(inputs.charging_curve.bands, band_rates(inputs, cap_kw, base)):
        upper = band.end_soc_fraction * bus.max_battery_capacity_kwh
        room = max(0, upper - energy)
        gain = min(room, hours * rate * bus.efficiency)
        energy += gain
        hours -= gain / (rate * bus.efficiency)
        if hours <= 1e-12:
            break
    return max(0, energy - start)


def _weights(problem, energy, points, prefix):
    """Exact adjacent-point interpolation; supports non-monotone power curves."""
    weights = [pulp.LpVariable(f'{prefix}_w{i}', lowBound=0, upBound=1) for i in range(len(points))]
    segments = [pulp.LpVariable(f'{prefix}_s{i}', cat='Binary') for i in range(len(points)-1)]
    problem += pulp.lpSum(weights) == 1
    problem += pulp.lpSum(segments) == 1
    problem += energy == pulp.lpSum(point * weight for point, weight in zip(points, weights))
    for i, weight in enumerate(weights):
        problem += weight <= pulp.lpSum(segments[max(0,i-1):min(i+1,len(segments))])
    return weights


def add_charging_curve(problem, inputs, powers, states, site_state=None, logs=None):
    if not inputs.charging_curve.enabled:
        return
    dt = inputs.time_step_minutes / 60
    for bi, bus in enumerate(inputs.buses):
        capacity = bus.max_battery_capacity_kwh
        points = [0] + [band.end_soc_fraction * capacity for band in inputs.charging_curve.bands]
        potential = possible_availability(bus, inputs)
        site_potential = potential_profiles(bus, inputs) if inputs.charging_sites else {}
        for t, available in enumerate(potential):
            if not available or bus.max_power_kw <= 0:
                continue
            prefix = f'curve_b{bi}_t{t}'
            start = _weights(problem, states[bus.id,t], points, prefix + '_start')
            # The end of charging precedes the interval's trip consumption.
            end = _weights(problem, states[bus.id,t] + powers[bus.id,t] * dt * bus.efficiency,
                           points, prefix + '_end')
            if inputs.charging_sites:
                limits = [(min(bus.max_power_kw, site.charger_power_kw, site.charger_capacity_kw,
                               site.grid_limit_kw if inputs.scenario == 'baseline' or site.id != inputs.energy_site_id else float('inf')),
                           site.charger_power_kw, site_state[0][bus.id,site.id,t]) for site in inputs.charging_sites
                          if site_potential.get(site.id, [0]*len(potential))[t]]
            else:
                limits = [(min(bus.max_power_kw, inputs.charger_capacity_kw,
                               inputs.grid_limit_kw if inputs.scenario == 'baseline' else float('inf')), bus.max_power_kw, None)]
            for li, (cap, base, connected) in enumerate(limits):
                if cap <= 0:
                    continue  # The infrastructure constraints already force zero power.
                cumulative = [0.0]
                for low, high, rate in zip(points, points[1:], band_rates(inputs, cap, base)):
                    cumulative.append(cumulative[-1] + (high-low)/(rate*bus.efficiency))
                elapsed = pulp.lpSum(value*(after-before) for value,after,before in zip(cumulative,end,start))
                allowance = dt if connected is None else dt + cumulative[-1]*(1-connected)
                problem += elapsed <= allowance, f'{prefix}_time_l{li}'
    if logs is not None:
        logs.append('[Charging curve] SoC-dependent rates enabled; crossings between bands are integrated within each interval.')


def charging_curve_results(inputs):
    return {**inputs.charging_curve.model_dump(mode='json'),
            'power_basis':'site_charger_power',
            'method':'Piecewise constant charger-side power integrated across SoC bands within each interval. Bus efficiency applies to battery energy. Infrastructure limits remain interval-average limits.',
            'scope':'Percentages of the connected location charger_power_kw; without configured locations, percentages of bus.max_power_kw. Bus and location limits remain additional constraints.'}
