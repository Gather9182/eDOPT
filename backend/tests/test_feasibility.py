import unittest

from app.services.feasibility import energy_feasibility_issues
from app.services.optimization import run_optimization
from test_charging import inputs, bus, site, run_offline


class EnergyFeasibilityTests(unittest.TestCase):
    def test_driving_block_exceeds_battery_despite_later_charge_window(self):
        b = bus('long route', availability=[0,0,1,1], site_availability={'D':[0,0,1,1]},
                initial_soc_kwh=20, trip_energy_profile_kwh=[15,10,0,0])
        data = inputs([b])
        issue = energy_feasibility_issues(data)[0]
        self.assertEqual(issue['bus_id'], 'long route')
        self.assertEqual(issue['code'], 'BUS_ENERGY_INFEASIBLE')
        self.assertIn('00:15', issue['message'])
        self.assertIn('5.000 kWh', issue['message'])
        with self.assertRaisesRegex(RuntimeError, 'long route'):
            run_offline(run_optimization(data))

    def test_daily_energy_may_exceed_battery_when_bus_can_recharge_between_trips(self):
        b = bus('recharges', availability=[0,1,0,1], site_availability={'D':[0,1,0,1]},
                initial_soc_kwh=20, min_final_soc_kwh=0, trip_energy_profile_kwh=[15,0,15,0])
        self.assertEqual(energy_feasibility_issues(inputs([b])), [])

    def test_readiness_and_reserve_must_fit_in_battery_even_with_unlimited_time(self):
        data = inputs([bus('readiness', min_final_soc_kwh=5, next_day_required_energy_kwh=16)], use_next_day_readiness=True)
        self.assertEqual(energy_feasibility_issues(data)[0]['code'], 'BUS_FINAL_TARGET_EXCEEDS_CAPACITY')
        self.assertEqual(energy_feasibility_issues(data.model_copy(update={'use_next_day_readiness':False})), [])

    def test_site_power_and_efficiency_can_prevent_required_final_soc(self):
        data = inputs([bus('slow', efficiency=.5)], [{**site(), 'charger_power_kw':20}])
        self.assertIn('At most 10.0 kWh',energy_feasibility_issues(data)[0]['message'])

    def test_pv_at_own_site_can_supply_bus_even_without_grid_capacity(self):
        data = inputs([bus('pv')], [{**site(), 'grid_limit_kw':0}], scenario='pv',energy_site_id='D')
        self.assertEqual(energy_feasibility_issues(data), [])
        data.energy_site_id = 'elsewhere'
        self.assertTrue(energy_feasibility_issues(data))

    def test_shared_connectors_and_locks_are_not_claimed_feasible_by_energy_bounds(self):
        data = inputs([bus('a'),bus('b')], [site(no_switch_windows=[dict(start='00:00',end='00:00')])])
        self.assertEqual(energy_feasibility_issues(data), [])
        with self.assertRaisesRegex(RuntimeError,'switching restrictions'):
            run_offline(run_optimization(data))

    def test_legacy_simultaneous_consumption_uses_same_capacity_bound_as_solver(self):
        data = inputs([bus('same slot',initial_soc_kwh=20,trip_energy_profile_kwh=[10]*4)])
        self.assertEqual(energy_feasibility_issues(data), [])

    def test_validation_returns_route_codes_and_empty_windows_stay_separate(self):
        from app.main import validate_inputs
        bad = bus('cannot finish',min_final_soc_kwh=20,efficiency=.1)
        unavailable = bus('no windows',availability=[0]*4,site_availability={'D':[0]*4})
        result = run_offline(validate_inputs(inputs([bad,unavailable])))
        self.assertEqual(result['status'],'invalid')
        self.assertEqual({(issue.get('bus_id'),issue.get('code')) for issue in result['issues']},
                         {('no windows','NO_CHARGING_AVAILABILITY'),('cannot finish','BUS_ENERGY_INFEASIBLE')})

    def test_missing_mapping_is_only_a_warning_and_never_an_energy_proof(self):
        from app.main import validate_inputs
        data=inputs([bus('no mapping',availability=[0]*4,site_availability={'D':[0]*4},initial_soc_kwh=20,min_final_soc_kwh=0,trip_energy_profile_kwh=[5,0,0,0])])
        before=data.model_dump()
        result=run_offline(validate_inputs(data))
        self.assertEqual(result['status'],'warning')
        self.assertEqual(len(result['issues']),1)
        self.assertEqual(result['issues'][0]['type'],'WARNING')
        self.assertEqual(result['issues'][0]['details']['proof'],'none')
        self.assertEqual(result['route_energy_checks'][0]['driving_energy'],'not_checked_missing_mapping')
        self.assertEqual(data.model_dump(),before)

    def cyclic_shortfall(self,missing):
        from test_cyclic_soc import cycle_inputs,cycle_bus
        return cycle_inputs([cycle_bus('OGA2011',initial=20,min_final_soc_kwh=0,
            availability=[1]*95+[0],site_availability={'D':[1]*95+[0]},
            trip_energy_profile_kwh=[0]*95+[missing])])

    def test_driving_bound_can_pass_while_cyclic_end_energy_has_real_point_two_kwh_gap(self):
        data=self.cyclic_shortfall(.2);checks=[];before=data.model_dump()
        issues=energy_feasibility_issues(data,checks)
        self.assertEqual(len(issues),1)
        self.assertEqual(issues[0]['details']['reason'],'cyclic_soc_shortfall')
        self.assertAlmostEqual(issues[0]['details']['missing_energy_kwh'],.2)
        self.assertEqual(issues[0]['details']['scope'],'current_model_assumptions')
        self.assertEqual(checks[0]['driving_energy'],'bound_passed_not_proven')
        self.assertEqual(checks[0]['end_reserve_energy'],'bound_passed_not_proven')
        self.assertEqual(checks[0]['configured_end_energy'],'shortfall_proven')
        self.assertEqual(data.model_dump(),before)
        noncyclic=data.model_copy(deep=True);noncyclic.use_cyclic_soc=False
        self.assertEqual(energy_feasibility_issues(noncyclic),[])

    def test_numeric_tolerance_suppresses_roundoff_but_not_genuine_point_two_kwh(self):
        for missing,expected in [(1e-10,False),(.0005,False),(.0010000000001,False),(.0011,True),(.2,True)]:
            with self.subTest(missing=missing):
                issues=energy_feasibility_issues(self.cyclic_shortfall(missing))
                self.assertEqual(bool(issues),expected)
                if expected:self.assertIn(f'{missing:.3f} kWh',issues[0]['message'])

    def test_driving_minimum_shortfall_is_separate_from_end_reserve(self):
        data=inputs([bus('floor',availability=[0,1,1,1],site_availability={'D':[0,1,1,1]},initial_soc_kwh=20,min_final_soc_kwh=0,
            trip_energy_profile_kwh=[18.2,0,0,0])],operating_min_soc_mode='hard',operating_min_soc_fraction=.1)
        checks=[];issue=energy_feasibility_issues(data,checks)[0]
        self.assertEqual(issue['details']['reason'],'trip_energy_shortfall')
        self.assertAlmostEqual(issue['details']['missing_energy_kwh'],.2)
        self.assertEqual(issue['details']['minimum_required_soc_kwh'],2)
        self.assertEqual(checks[0]['driving_energy'],'shortfall_proven')


if __name__ == '__main__':
    unittest.main()
