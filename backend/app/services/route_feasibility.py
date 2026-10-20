"""Exact isolated route checks after a joint MILP is proven infeasible."""
import time

from .solver_diagnostics import OptimizationFailure, route_solve_deadline


async def classify_routes(inputs, findings=(), budget_seconds=20):
    from .solver import run_scenario_optimization

    candidates = {str(row['bus_id']) for row in findings}
    deadline = time.monotonic() + budget_seconds
    rows = {}
    # The shortfall candidate is the most immediately useful check if the total
    # budget does not permit checking every route.
    ordered = sorted(inputs.buses, key=lambda bus: str(bus.id) not in candidates)
    needs_remote_profiles = ((inputs.scenario in ('pv', 'pv_bess') and inputs.pv_config is not None
                              and inputs.pv_config.profile_mode == 'open_meteo' and not inputs.pv_config.profile_kwh)
                             or (inputs.scenario in ('bess', 'pv_bess') and inputs.bess_config is not None
                                 and inputs.bess_config.capacity_kwh > 0 and inputs.bess_config.enable_temperature_capacity_derating))
    for bus in ordered:
        row = dict(bus_id=bus.id, status='not_determined', diagnostic_candidate=str(bus.id) in candidates,
                   solver_status='Not checked', reason='The individual-check time budget was exhausted.')
        rows[bus.id] = row
        if needs_remote_profiles:
            row['reason'] = 'Exact derived weather profiles are not retained for isolated replay. No additional network fetch or feasibility claim was made.'
            continue
        if time.monotonic() >= deadline:
            continue
        isolated = inputs.model_copy(deep=True)
        isolated.buses = [bus.model_copy(deep=True)]
        token = route_solve_deadline.set(deadline)
        try:
            await run_scenario_optimization(isolated, [])
            row.update(status='feasible_in_isolation', solver_status='Feasible',
                       reason='A feasible MILP schedule was found for this route alone, with the same horizon, battery targets, charging sites, switching rules and optional trips.')
        except OptimizationFailure as error:
            solver_status = error.diagnostics.get('solver_status', 'Error')
            row.update(solver_status=solver_status)
            if solver_status == 'Infeasible':
                row.update(status='individually_infeasible',
                           reason='The exact MILP is infeasible for this route even with every other bus removed. Excluding other routes alone cannot make it feasible.')
            else:
                row['reason'] = 'The isolated solve did not prove feasibility or infeasibility within the time budget.'
        except Exception as error:
            row.update(solver_status='Error', reason=f'The isolated check failed: {error}')
        finally:
            route_solve_deadline.reset(token)
    all_individually_feasible = bool(rows) and all(row['status'] == 'feasible_in_isolation' for row in rows.values())
    if all_individually_feasible:
        for row in rows.values():
            if row['diagnostic_candidate']:
                row.update(status='affected_by_fleet_conflict',
                           reason='Every route is feasible alone, but the joint model is infeasible. This route receives a shortfall in one diagnostic allocation; it is not a unique cause.')
    return dict(routes=[rows[bus.id] for bus in inputs.buses], all_individually_feasible=all_individually_feasible,
        completed=all(row['status'] != 'not_determined' for row in rows.values()), time_budget_seconds=budget_seconds,
        scope='Same failed request and scenario, one route at a time, no competition and no heuristic fallback. Feasibility is conditional on these inputs; no separate 24-hour SoC-cycle or reference-Excel equivalence is claimed.')
