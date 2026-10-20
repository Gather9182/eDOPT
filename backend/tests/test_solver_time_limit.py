import time
import unittest
from unittest.mock import patch

import pulp
from pydantic import ValidationError

from app.models import OptimizationInputs
from app.services.cancellable_solver import CancellableCBC
from app.services.optimization_progress import Progress,current_progress
from app.services.solver import run_milp_solver
from app.services.solver_diagnostics import solve_with_diagnostics,energy_relaxation,route_solve_deadline,OptimizationFailure
from test_charging import run_offline
from test_cyclic_soc import cycle_inputs,cycle_bus


class SolverTimeLimitTests(unittest.TestCase):
    def inputs(self,limit=17):
        data=cycle_inputs([cycle_bus(initial=10,consumption=6)])
        data.solver_time_limit_seconds=limit
        return data

    def test_default_and_invalid_limits(self):
        payload=self.inputs().model_dump()
        payload.pop('solver_time_limit_seconds')
        self.assertEqual(OptimizationInputs(**payload).solver_time_limit_seconds,180)
        for value in (0,-1,1.5,86401,float('inf'),float('nan')):
            with self.subTest(value=value),self.assertRaises(ValidationError):
                OptimizationInputs(**{**payload,'solver_time_limit_seconds':value})

    def test_both_soft_soc_stages_and_live_telemetry_use_selected_limit(self):
        data=self.inputs()
        data.operating_min_soc_mode='soft'
        progress=Progress();token=current_progress.set(progress)
        try:
            with patch('app.services.solver_diagnostics.CancellableCBC',wraps=CancellableCBC) as solver:
                result=run_offline(run_milp_solver(data,[]))
            self.assertIn('Optimal',result.status)
            self.assertEqual([call.kwargs['timeLimit'] for call in solver.call_args_list],[17,17])
            self.assertEqual(progress.snapshot()['solver_time_limit_seconds'],17)
        finally:
            current_progress.reset(token)

    def test_daily_solves_disable_internal_cbc_worker_threads(self):
        data=self.inputs();data.daily_cyclic=True
        with patch('app.services.solver_diagnostics.CancellableCBC',wraps=CancellableCBC) as solver:
            run_offline(run_milp_solver(data,[]))
        self.assertTrue(solver.call_args_list)
        self.assertTrue(all(call.kwargs['threads']==0 for call in solver.call_args_list))

    def test_short_isolated_check_respects_smaller_user_budget(self):
        data=self.inputs(1)
        problem=pulp.LpProblem('isolated_budget',pulp.LpMinimize)
        x=pulp.LpVariable('x',lowBound=1);problem+=x
        token=route_solve_deadline.set(time.monotonic()+20)
        try:
            with patch('app.services.solver_diagnostics.CancellableCBC',wraps=CancellableCBC) as solver:
                solve_with_diagnostics(problem,data)
            self.assertEqual(solver.call_args.kwargs['timeLimit'],1)
        finally:
            route_solve_deadline.reset(token)

    def test_relaxation_keeps_its_short_cap_and_respects_smaller_budget(self):
        for configured,expected in ((1,1),(37,10)):
            data=self.inputs(configured)
            problem=pulp.LpProblem('relaxation_budget',pulp.LpMinimize)
            state=pulp.LpVariable('state',lowBound=0)
            problem+=state
            problem+=state==-1,'soc_balance_b0_t0'
            with patch('app.services.solver_diagnostics.CancellableCBC',wraps=CancellableCBC) as solver:
                report=energy_relaxation(problem,data)
            self.assertEqual(solver.call_args.kwargs['timeLimit'],expected)
            self.assertEqual(report['time_limit_seconds'],expected)

    def test_failure_evidence_records_selected_budget(self):
        data=self.inputs(23)
        problem=pulp.LpProblem('failed_budget',pulp.LpMinimize)
        x=pulp.LpVariable('x',lowBound=0);problem+=x
        problem+=x>=2;problem+=x<=1
        with self.assertRaises(OptimizationFailure) as caught:
            solve_with_diagnostics(problem,data)
        self.assertEqual(caught.exception.diagnostics['time_limit_seconds'],23)
        self.assertEqual(caught.exception.diagnostics['effective_inputs']['solver_time_limit_seconds'],23)
