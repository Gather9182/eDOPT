import json
import unittest
from unittest.mock import patch

from app.main import optimize_depot, validate_inputs
from app.services.optimization import run_optimization
from app.services.solver import run_extended_milp_solver
from app.services.solver_diagnostics import OptimizationFailure
from app.services.solver_diagnostics import route_solve_deadline
from app.services.route_feasibility import classify_routes
from test_charging import bus, site, inputs, run_offline


def conflicting_fleet(locked=True, **changes):
    return inputs([bus('a'), bus('b')], [site(no_switch_windows=[dict(start='00:00', end='00:00')] if locked else [])], **changes)


class SolverFailureDiagnosticsTests(unittest.TestCase):
    def test_individual_diagnostic_error_preserves_original_solver_evidence(self):
        with patch('app.services.optimization.classify_routes', side_effect=ValueError('Diagnostic unavailable')):
            response = run_offline(optimize_depot(conflicting_fleet()))
        report = json.loads(response.body)['diagnostics']
        self.assertEqual(report['solver_status'],'Infeasible')
        self.assertIn('model_lp',report)
        self.assertFalse(report['route_feasibility']['completed'])
        self.assertTrue(all(row['status']=='not_determined' for row in report['route_feasibility']['routes']))

    def test_solver_execution_error_retains_model_without_claiming_infeasibility(self):
        with patch('pulp.LpProblem.solve', side_effect=OSError('CBC unavailable')):
            response = run_offline(optimize_depot(conflicting_fleet()))
        report = json.loads(response.body)['diagnostics']
        self.assertEqual(report['solver_status'], 'Solver error')
        self.assertEqual(report['execution_error'], 'CBC unavailable')
        self.assertIn('soc_balance_b0_t0', report['model_lp'])
        self.assertNotIn('energy_relaxation', report)

    def test_individual_checks_pass_but_locked_shared_connector_is_infeasible(self):
        data = conflicting_fleet()
        original = data.model_dump()
        self.assertEqual(run_offline(validate_inputs(data))['status'], 'valid')
        with self.assertRaises(OptimizationFailure) as caught:
            run_offline(run_optimization(data))
        report = caught.exception.diagnostics
        self.assertEqual(report['solver_status'], 'Infeasible')
        self.assertIn('CBC', report['cbc_log'])
        self.assertIn('soc_balance_b0_t0', report['model_lp'])
        self.assertIn('initial_soc_b0', report['model_lp'])
        self.assertEqual(report['effective_inputs'], data.model_dump(mode='json'))
        self.assertEqual(report['variable_index']['buses'], [dict(index=0, id='a'), dict(index=1, id='b')])
        relaxed = report['energy_relaxation']
        self.assertEqual(relaxed['status'], 'Optimal')
        self.assertTrue(relaxed['minimum_proven'])
        self.assertAlmostEqual(relaxed['total_artificial_energy_kwh'], 20)
        self.assertTrue(all(f['bus_id'] in {'a', 'b'} and 0 <= f['period'] < 4 for f in relaxed['findings']))
        self.assertEqual(data.model_dump(), original, 'Diagnostics must never mutate the real inputs')
        classified = report['route_feasibility']
        self.assertTrue(classified['all_individually_feasible'])
        self.assertTrue(any(row['status'] == 'affected_by_fleet_conflict' for row in classified['routes']))
        self.assertTrue(all(row['status'] in ('feasible_in_isolation', 'affected_by_fleet_conflict') for row in classified['routes']))
        # The exact same fleet/power is feasible when switching is allowed.
        self.assertTrue(run_offline(run_optimization(conflicting_fleet(False))).status.startswith('Optimal'))

    def test_extended_model_also_retains_exact_model_and_energy_diagnosis(self):
        data = conflicting_fleet(scenario='pv', energy_site_id='D', pv_config=dict(capacity_kw=0, profile_kwh=[0]*4))
        with self.assertRaises(OptimizationFailure) as caught:
            run_offline(run_extended_milp_solver(data, []))
        report = caught.exception.diagnostics
        self.assertEqual(report['effective_inputs']['scenario'], 'pv')
        self.assertIn('soc_balance_b1_t3', report['model_lp'])
        self.assertAlmostEqual(report['energy_relaxation']['total_artificial_energy_kwh'], 20)

    def test_api_failure_returns_evidence_instead_of_discarding_it(self):
        response = run_offline(optimize_depot(conflicting_fleet()))
        self.assertEqual(response.status_code, 500)
        report = json.loads(response.body)
        self.assertIn('switching restrictions', report['detail'])
        self.assertIn('model_lp', report['diagnostics'])
        self.assertEqual(report['diagnostics']['solver_status'], 'Infeasible')

    def test_precheck_failures_have_real_issues_without_claiming_a_solver_model(self):
        data = inputs([bus('bad', min_final_soc_kwh=20, efficiency=.01)])
        response = run_offline(optimize_depot(data))
        report = json.loads(response.body)['diagnostics']
        self.assertEqual(report['solver_status'], 'Precheck failed')
        self.assertEqual(report['issues'][0]['bus_id'], 'bad')
        self.assertNotIn('model_lp', report)

    def test_exact_individual_check_detects_lock_infeasibility_missed_by_energy_bound(self):
        never_connected = bus('blocked arrival', availability=[0,1,1,0], site_availability={'D':[0,1,1,0]},
            site_presence={'D':[0,1,1,0]}, site_arrivals={'D':[0,1,0,0]})
        data = inputs([never_connected,bus('other')], [site(no_switch_windows=[dict(start='00:00',end='00:00')],allow_connect_on_arrival=False)])
        self.assertEqual(run_offline(validate_inputs(data))['status'], 'valid')
        with self.assertRaises(OptimizationFailure) as caught:
            run_offline(run_optimization(data))
        rows = {row['bus_id']:row for row in caught.exception.diagnostics['route_feasibility']['routes']}
        self.assertEqual(rows['blocked arrival']['status'],'individually_infeasible')
        self.assertEqual(rows['other']['status'],'feasible_in_isolation')
        self.assertIsNone(route_solve_deadline.get())

    def test_time_budget_never_turns_unknown_routes_into_infeasible(self):
        report = run_offline(classify_routes(conflicting_fleet(),budget_seconds=0))
        self.assertFalse(report['completed'])
        self.assertTrue(all(row['status'] == 'not_determined' for row in report['routes']))
        with patch('app.services.solver.run_scenario_optimization', side_effect=OptimizationFailure('Timeout',dict(solver_status='Not Solved'))):
            report = run_offline(classify_routes(conflicting_fleet()))
        self.assertTrue(all(row['status'] == 'not_determined' for row in report['routes']))
        self.assertIsNone(route_solve_deadline.get())


if __name__ == '__main__':
    unittest.main()
