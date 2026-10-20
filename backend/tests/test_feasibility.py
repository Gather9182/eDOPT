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
        self.assertIn('5.0 kWh', issue['message'])
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


if __name__ == '__main__':
    unittest.main()
