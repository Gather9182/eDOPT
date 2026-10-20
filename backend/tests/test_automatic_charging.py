import unittest

from app.services.automatic_charging import balanced_allocation
from app.services.charging_sites import simulate_site_baseline
from app.services.solver import run_milp_solver,run_extended_milp_solver
from test_charging import inputs,bus,site,run_offline


def automatic(buses,**changes):
    location = site(num_chargers=2,lock_charging_mode='automatic_balanced',
                    no_switch_windows=[{'start':'00:00','end':'00:00'}])
    return inputs(buses,[location],electricity_prices=[1000,500,10,1],**changes)


class AutomaticChargingTests(unittest.TestCase):
    def solve(self,data,extended=False):
        return run_offline(run_extended_milp_solver(data,[]) if extended else run_milp_solver(data,[]))

    def test_equal_shares_use_capacity_despite_high_early_prices_in_both_models(self):
        for extended in (False,True):
            data = automatic([bus('a',initial_connection_site='D'),bus('b',initial_connection_site='D')])
            if extended:
                data.scenario='pv';data.energy_site_id='D'
            result=self.solve(data,extended)
            for name in ('a','b'):
                self.assertTrue(all(abs(value-20)<.001 for value in result.schedules[name]))
            load,issues=simulate_site_baseline(data)
            self.assertEqual(list(load),[40]*4)
            self.assertEqual(issues,[])

    def test_unused_share_is_redistributed_when_one_bus_reaches_target(self):
        data=automatic([bus('a',initial_soc_kwh=19,min_final_soc_kwh=0,initial_connection_site='D'),
                        bus('b',initial_connection_site='D')])
        result=self.solve(data)
        self.assertAlmostEqual(result.schedules['a'][0],4)
        self.assertAlmostEqual(result.schedules['b'][0],36)
        self.assertEqual(result.schedules['a'][1:],[0]*3)
        self.assertEqual(balanced_allocation([4,40],40),[4,36])

    def test_arrival_cannot_connect_even_if_legacy_exception_is_true(self):
        data=automatic([bus('a',availability=[0,1,1,1],site_availability={'D':[0,1,1,1]},
                             site_presence={'D':[0,1,1,1]},site_arrivals={'D':[0,1,0,0]})])
        self.assertTrue(data.charging_sites[0].allow_connect_on_arrival)
        with self.assertRaisesRegex(RuntimeError,'Infeasible'): self.solve(data)

    def test_integrated_curve_caps_are_respected_and_freed_capacity_is_used(self):
        data=automatic([bus('a',max_battery_capacity_kwh=100,initial_soc_kwh=88,min_final_soc_kwh=0,initial_connection_site='D'),
                        bus('b',max_battery_capacity_kwh=100,initial_soc_kwh=90,min_final_soc_kwh=0,initial_connection_site='D')],
                       charging_curve={'enabled':True})
        data.charging_sites[0].grid_limit_kw=20
        result=self.solve(data)
        self.assertAlmostEqual(result.schedules['a'][0],(2+(.25-2/14)*6)/.25,places=3)
        self.assertAlmostEqual(result.schedules['b'][0],6,places=3)
        for values in result.site_load_profiles.values(): self.assertTrue(all(value<=20.001 for value in values))

    def test_preferred_soc_stops_charging_and_soft_relaxation_still_allows_necessary_energy(self):
        data=automatic([bus('a',initial_soc_kwh=17,min_final_soc_kwh=0,initial_connection_site='D')],
                       operating_max_soc_enabled=True,operating_max_soc_mode='soft',operating_max_soc_fraction=.9)
        result=self.solve(data)
        self.assertAlmostEqual(result.schedules['a'][0],4)
        self.assertEqual(result.schedules['a'][1:],[0]*3)
        data.buses[0].min_final_soc_kwh=20
        result=self.solve(data)
        self.assertAlmostEqual(result.soc_profiles['a'][-1],20)

    def test_pv_is_not_curtailed_to_delay_automatic_bus_charging(self):
        data=automatic([bus('a',initial_connection_site='D')],scenario='pv',energy_site_id='D',
                       pv_config={'capacity_kw':40,'profile_kwh':[40]*4})
        data.charging_sites[0].grid_limit_kw=0
        result=self.solve(data,True)
        self.assertAlmostEqual(result.schedules['a'][0],40)
        self.assertAlmostEqual(result.schedules['a'][1],40)
        self.assertEqual(result.schedules['a'][2:],[0,0])

    def test_available_storage_supplies_buses_when_grid_is_unavailable(self):
        data=automatic([bus('a',initial_connection_site='D')],scenario='bess',energy_site_id='D',
                       bess_config={'capacity_kwh':20,'initial_soc_kwh':20,'min_soc_kwh':0,'max_soc_kwh':20,
                                    'max_charge_power_kw':40,'max_discharge_power_kw':40,'efficiency':1})
        data.charging_sites[0].grid_limit_kw=0
        result=self.solve(data,True)
        self.assertAlmostEqual(result.schedules['a'][0],40)
        self.assertAlmostEqual(result.schedules['a'][1],40)

    def test_departures_remain_possible_and_release_connector(self):
        data=automatic([bus('a',initial_connection_site='D',availability=[1,1,0,0],
                            site_availability={'D':[1,1,0,0]},site_presence={'D':[1,1,0,0]})])
        result=self.solve(data)
        self.assertEqual(result.connection_schedules['a'],['D','D','',''])

    def test_optional_visit_may_enter_before_lock_but_not_during_lock(self):
        from test_opportunity_charging import data as visit_inputs,visiting_bus
        location=site(lock_charging_mode='automatic_balanced',no_switch_windows=[{'start':'00:30','end':'01:00'}])
        data=visit_inputs([visiting_bus()],[location],charging_curve={'enabled':True})
        result=self.solve(data)
        self.assertEqual(len(result.opportunity_charging_visits),1)
        self.assertLess(result.opportunity_charging_visits[0]['charger_arrival_min'],30)
        data.charging_sites[0].no_switch_windows[0].start='00:00'
        with self.assertRaisesRegex(RuntimeError,'Infeasible'): self.solve(data)

