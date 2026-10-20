"""Operating SoC limits, independent of end reserve and next-day readiness.

Soft limits are lexicographic: minimise summed boundary deviations (kWh-hours),
then electricity cost within a small numerical tolerance of that proven minimum.
The fixed initial state is included. Above-max initial energy is reported, never
removed artificially. Physical bounds remain 0..battery capacity in every mode.
"""
import pulp

from .solver_diagnostics import OptimizationFailure, solve_with_diagnostics

SOFT_TOLERANCE_KWH_H = 1e-6


def policy_active(inputs):
    return inputs.use_cyclic_soc or inputs.operating_min_soc_mode != 'off' or inputs.operating_max_soc_enabled


def minimum_energy(inputs, bus):
    return bus.max_battery_capacity_kwh * inputs.operating_min_soc_fraction


def preferred_maximum(inputs, bus):
    return bus.max_battery_capacity_kwh * (inputs.operating_max_soc_fraction if inputs.operating_max_soc_enabled else 1)


def reference_policy_issues(inputs, profiles, minimum):
    issues = []
    soft_max = inputs.operating_max_soc_enabled and inputs.operating_max_soc_mode == 'soft'
    hard_max = inputs.operating_max_soc_enabled and inputs.operating_max_soc_mode == 'hard'
    deviation = 0.0
    for bus in inputs.buses:
        if hard_max and any(energy > preferred_maximum(inputs, bus) + .001 for energy in profiles[bus.id]):
            issues.append(f'Bus {bus.id}: arrival reference exceeds the hard operating maximum SoC.')
        for energy in profiles[bus.id]:
            if inputs.operating_min_soc_mode == 'soft':
                deviation += max(0, minimum_energy(inputs, bus) - energy)
            if soft_max:
                deviation += max(0, energy - preferred_maximum(inputs, bus))
    deviation *= inputs.time_step_minutes / 60
    if inputs.operating_min_soc_mode != 'soft' and not soft_max:
        return issues
    if minimum is None:
        return issues + ['Arrival reference soft-SoC deviations were not checked against a proven minimum.']
    if deviation > minimum + SOFT_TOLERANCE_KWH_H + 1e-5:
        issues.append(f'Arrival reference does not meet the minimum-deviation SoC policy: {deviation:.6f} kWh-hours versus the proven minimum {minimum:.6f}.')
    return issues


def add_soc_policy(problem, inputs, states):
    deviations = []
    for bi, bus in enumerate(inputs.buses):
        for t in range(len(inputs.electricity_prices) + 1):
            state = states[bus.id, t]
            if inputs.operating_min_soc_mode == 'hard':
                problem += state >= minimum_energy(inputs, bus), f'operating_min_b{bi}_t{t}'
            elif inputs.operating_min_soc_mode == 'soft':
                slack = pulp.LpVariable(f'soft_min_b{bi}_t{t}', lowBound=0)
                problem += state + slack >= minimum_energy(inputs, bus)
                deviations.append(slack)
            if inputs.operating_max_soc_enabled:
                if inputs.operating_max_soc_mode == 'hard':
                    problem += state <= preferred_maximum(inputs, bus), f'operating_max_b{bi}_t{t}'
                else:
                    slack = pulp.LpVariable(f'soft_max_b{bi}_t{t}', lowBound=0)
                    problem += state - slack <= preferred_maximum(inputs, bus)
                    deviations.append(slack)
    return deviations


def solve_soc_policy(problem, inputs, states, logs=None):
    deviations = add_soc_policy(problem, inputs, states)
    if not deviations:
        solve_with_diagnostics(problem, inputs, logs)
        return None
    cost_objective = problem.objective.copy()
    violation_objective = pulp.lpSum(deviations) * (inputs.time_step_minutes / 60)
    problem.setObjective(violation_objective)
    if logs is not None:
        logs.append('[SoC] First minimise soft-limit deviations; only then minimise electricity cost.')
    solve_with_diagnostics(problem, inputs, logs)
    if problem.sol_status != pulp.LpSolutionOptimal:
        raise OptimizationFailure('The minimum soft-SoC deviation was not proven within the solver budget. No cost-only fallback was used.',
            dict(solver_status='Not determined', effective_inputs=inputs.model_dump(mode='json'), solver_logs=list(logs or [])))
    minimum = float(pulp.value(violation_objective) or 0)
    problem += violation_objective <= minimum + SOFT_TOLERANCE_KWH_H, 'minimum_soft_soc_deviation'
    problem.setObjective(cost_objective)
    solve_with_diagnostics(problem, inputs, logs)
    return minimum


def soc_policy_results(inputs, profiles, minimum):
    if inputs.operating_min_soc_mode == 'off' and not inputs.operating_max_soc_enabled:
        return {}
    violations = []
    for bus in inputs.buses:
        for t, energy in enumerate(profiles[bus.id]):
            limits = []
            if inputs.operating_min_soc_mode != 'off':
                limits.append(('below_min', minimum_energy(inputs, bus), minimum_energy(inputs, bus) - energy))
            if inputs.operating_max_soc_enabled:
                limits.append(('above_max', preferred_maximum(inputs, bus), energy - preferred_maximum(inputs, bus)))
            for kind, limit, deviation in limits:
                if deviation > .001:
                    violations.append(dict(bus_id=bus.id, state_index=t,
                        minute=inputs.horizon_start_minute + t * inputs.time_step_minutes,
                        kind=kind, soc_kwh=energy, limit_kwh=limit, deviation_kwh=round(deviation, 6),
                        soc_percent=round(100 * energy / bus.max_battery_capacity_kwh, 4), initial_state=t == 0))
    return dict(min_mode=inputs.operating_min_soc_mode, min_fraction=inputs.operating_min_soc_fraction,
        max_enabled=inputs.operating_max_soc_enabled, max_mode=inputs.operating_max_soc_mode,
        max_fraction=inputs.operating_max_soc_fraction,
        minimum_deviation_kwh_h=minimum, tolerance_kwh_h=SOFT_TOLERANCE_KWH_H,
        criterion='Minimise summed boundary deviations in kWh-hours before electricity cost; min and max have equal weight. Fixed initial-state deviations are included.',
        violations=violations)
