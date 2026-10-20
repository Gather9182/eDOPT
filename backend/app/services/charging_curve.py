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


def _band_fill(problem, energy, points, prefix):
    """Exact ordered band fill using one binary per internal boundary."""
    widths = [high-low for low,high in zip(points,points[1:])]
    filled = [pulp.LpVariable(f'{prefix}_e{i}',lowBound=0,upBound=width) for i,width in enumerate(widths)]
    problem += pulp.lpSum(filled) == energy
    for i in range(len(widths)-1):
        reached = pulp.LpVariable(f'{prefix}_reached{i}',cat='Binary')
        problem += filled[i] >= widths[i]*reached
        problem += filled[i+1] <= widths[i+1]*reached
    return filled


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
            # The end of charging precedes the interval's trip consumption.
            start_energy = states[bus.id,t]
            end_energy = start_energy + powers[bus.id,t] * dt * bus.efficiency
            problem += end_energy <= capacity, f'{prefix}_physical_capacity'
            start_fill = None
            end_fill = None
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
                rates = band_rates(inputs, cap, base)
                if max(rates)-min(rates) <= 1e-10:
                    # Infrastructure caps can make all curve bands identical.
                    problem += powers[bus.id,t] <= rates[0] + (bus.max_power_kw*(1-connected) if connected is not None else 0)
                    continue
                slopes = [1/(rate*bus.efficiency) for rate in rates]
                cumulative = [0.0]
                for low, high, slope in zip(points, points[1:], slopes):
                    cumulative.append(cumulative[-1] + (high-low)*slope)
                if t == 0:
                    initial = bus.initial_soc_kwh
                    start_time = sum(max(0,min(initial,high)-low)*slope for low,high,slope in zip(points,points[1:],slopes))
                else:
                    if start_fill is None:
                        start_fill = _band_fill(problem,start_energy,points,prefix+'_start')
                    start_time = pulp.lpSum(fill*slope for fill,slope in zip(start_fill,slopes))
                allowance = dt if connected is None else dt + cumulative[-1]*(1-connected)
                if all(right >= left-1e-12 for left,right in zip(slopes,slopes[1:])):
                    # For tapering rates, cumulative charging time is convex.
                    # Its epigraph is exact: no end-state band binaries needed.
                    for i,slope in enumerate(slopes):
                        problem += cumulative[i] + slope*(end_energy-points[i]) <= start_time+allowance, f'{prefix}_time_l{li}_band{i}'
                else:
                    # Arbitrary increasing/decreasing user curves remain exact.
                    if end_fill is None:
                        end_fill = _band_fill(problem,end_energy,points,prefix+'_end')
                    elapsed = pulp.lpSum(fill*slope for fill,slope in zip(end_fill,slopes))-start_time
                    problem += elapsed <= allowance, f'{prefix}_time_l{li}'
    if logs is not None:
        logs.append('[Charging curve] Exact compact band model; tapering curves use a convex end-time envelope without end-state band binaries.')


def charging_curve_results(inputs):
    return {**inputs.charging_curve.model_dump(mode='json'),
            'power_basis':'site_charger_power',
            'method':'Piecewise constant charger-side power integrated across SoC bands within each interval. Bus efficiency applies to battery energy. Infrastructure limits remain interval-average limits.',
            'scope':'Percentages of the connected location charger_power_kw; without configured locations, percentages of bus.max_power_kw. Bus and location limits remain additional constraints.'}
