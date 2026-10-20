"""Failure evidence and a bounded diagnostic model; never a usable schedule."""
import copy
import os
import platform
import tempfile
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path

import pulp
from .cancellable_solver import CancellableCBC
from .optimization_progress import current_progress, report_progress

route_solve_deadline = ContextVar('route_solve_deadline', default=None)


class OptimizationFailure(RuntimeError):
    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


@contextmanager
def diagnostic_paths():
    # Individual temporary files also work under Windows restricted accounts,
    # where Python's owner-only TemporaryDirectory ACL can prevent access.
    paths = []
    try:
        for suffix in ('.log', '.lp'):
            descriptor, name = tempfile.mkstemp(prefix='edopt-solver-', suffix=suffix)
            os.close(descriptor)
            paths.append(Path(name))
        yield paths
    finally:
        for path in paths:
            path.unlink(missing_ok=True)


def energy_relaxation(problem, inputs):
    """Keep all connection/power rules; permit artificial battery energy only.

    This is one minimum-shortfall explanation, not an IIS or an infrastructure
    sizing recommendation. A positive deficit cannot be used as a real charge.
    """
    report_progress('energy_diagnostics','Analyzing energy shortfalls in the failed model.',metrics={})
    diagnostic = copy.deepcopy(problem)
    injections = []
    for bi, bus in enumerate(inputs.buses):
        for t in range(len(inputs.electricity_prices)):
            constraint = diagnostic.constraints.get(f'soc_balance_b{bi}_t{t}')
            if constraint is None:
                continue
            shortfall = pulp.LpVariable(f'diagnostic_missing_energy_b{bi}_t{t}', lowBound=0)
            constraint.addInPlace(-shortfall)
            injections.append((bus.id, t, shortfall))
    note = ('Diagnostic only: artificial battery energy is allowed while all original connector, switching, '
            'power, route and capacity constraints remain enforced. Findings are one minimum-shortfall '
            'explanation, not a unique root cause, IIS, valid schedule or required charger size.')
    if not injections:
        return dict(status='Unavailable', findings=[], note=note)
    diagnostic.setObjective(pulp.lpSum(variable for _, _, variable in injections))
    diagnostic.solve(CancellableCBC(msg=0, timeLimit=10))
    status = pulp.LpStatus[diagnostic.status]
    certified = diagnostic.sol_status == pulp.LpSolutionOptimal
    feasible = diagnostic.sol_status in (pulp.LpSolutionOptimal, pulp.LpSolutionIntegerFeasible)
    findings = []
    if feasible:
        for bus_id, t, variable in injections:
            kwh = float(pulp.value(variable) or 0)
            if kwh > .001:
                minute = inputs.horizon_start_minute + t * inputs.time_step_minutes
                findings.append(dict(bus_id=bus_id, period=t, start_min=minute,
                    end_min=minute + inputs.time_step_minutes, missing_battery_energy_kwh=round(kwh, 6)))
    return dict(status=status, minimum_proven=certified, time_limit_seconds=10, findings=findings,
                total_artificial_energy_kwh=round(sum(row['missing_battery_energy_kwh'] for row in findings), 6) if feasible else None,
                note=note)


def solve_with_diagnostics(problem, inputs, solver_logs=None):
    deadline = route_solve_deadline.get()
    if deadline is not None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OptimizationFailure('Individual check time budget exhausted.', dict(solver_status='Not Solved'))
        # An exact isolated check uses the original MILP rules, with no heuristic
        # fallback, artificial energy, or recursive failure diagnostics.
        problem.solve(CancellableCBC(msg=0, timeLimit=min(5, remaining)))
        status = pulp.LpStatus[problem.status]
        if problem.sol_status in (pulp.LpSolutionOptimal, pulp.LpSolutionIntegerFeasible):
            return
        raise OptimizationFailure(f'Individual check ended with status: {status}', dict(solver_status=status))
    with diagnostic_paths() as (log_path, model_path):
        execution_error = None
        progress = current_progress.get()
        if progress:
            progress.start_solver(log_path,problem,180)
        try:
            problem.solve(CancellableCBC(msg=0, timeLimit=180, logPath=str(log_path)))
        except Exception as error:
            execution_error = str(error)
        status = 'Solver error' if execution_error is not None else pulp.LpStatus[problem.status]
        if progress:
            progress.finish_solver(status)
        if status in {'Optimal', 'Feasible'}:
            return
        logs = list(solver_logs or []) + [f'[Solver] CBC ended with status: {status}.']
        diagnostics = dict(
            failed_at=datetime.now(timezone.utc).isoformat(), solver_status=status,
            solver='CBC', time_limit_seconds=180, python_version=platform.python_version(), pulp_version=pulp.__version__,
            effective_inputs=inputs.model_dump(mode='json'), solver_logs=logs,
            cbc_log=log_path.read_text(encoding='utf-8', errors='replace') if log_path.exists() else '',
            model_statistics=dict(variables=problem.numVariables(), constraints=problem.numConstraints()),
            variable_index=dict(buses=[dict(index=i, id=bus.id) for i, bus in enumerate(inputs.buses)],
                                sites=[dict(index=i, id=site.id, name=site.name) for i, site in enumerate(inputs.charging_sites)]),
            scope='Exact failed model and request. No valid optimized schedule exists for this attempt; no IIS is claimed.',
        )
        if execution_error is not None:
            diagnostics['execution_error'] = execution_error
        try:
            problem.writeLP(str(model_path), max_length=512)
            diagnostics['model_lp'] = model_path.read_text(encoding='utf-8')
        except Exception as error:
            diagnostics['model_export_error'] = str(error)
        if status == 'Infeasible':
            try:
                diagnostics['energy_relaxation'] = energy_relaxation(problem, inputs)
            except Exception as error:
                diagnostics['energy_relaxation'] = dict(status='Failed', findings=[], error=str(error))
        raise OptimizationFailure(f'Solver execution failed: {execution_error}' if execution_error is not None else f'Optimization ended with status: {status}', diagnostics)
