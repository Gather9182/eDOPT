import unittest
from pydantic import ValidationError
from app.models import OptimizationInputs
from app.services.solver import run_extended_milp_solver
from test_charging import inputs,bus,run_offline


class DailyEnergyTests(unittest.TestCase):
    def data(self,scenario):
        vehicle=bus('B',availability=[0,0,0,1],site_availability={'D':[0,0,0,1]},site_presence={'D':[0,0,0,1]},
                    site_arrivals={'D':[0,0,0,1]},initial_soc_kwh=10,min_final_soc_kwh=0,trip_energy_profile_kwh=[5,0,0,0])
        return inputs([vehicle],planning_horizon_hours=24,time_step_minutes=360,cyclic_connections=True,daily_cyclic=True,use_cyclic_soc=True,
            scenario=scenario,energy_site_id='D',electricity_prices=[100,1000,1000,1000],
            pv_config={'capacity_kw':2,'profile_kw':[0,2,0,0]},
            bess_config={'capacity_kwh':20,'initial_soc_kwh':10,'min_soc_kwh':0,'max_soc_kwh':20,'max_charge_power_kw':5,'max_discharge_power_kw':5,'efficiency':.95})

    def test_pv_and_storage_use_real_grid_energy_and_hard_daily_storage_equality(self):
        for scenario in ('pv','bess','pv_bess'):
            data=self.data(scenario)
            result=run_offline(run_extended_milp_solver(data,[]))
            self.assertTrue(result.status.startswith('Optimal'))
            self.assertEqual(result.optimization_gap,0)
            self.assertAlmostEqual(result.soc_profiles['B'][0],result.soc_profiles['B'][-1],3)
            self.assertAlmostEqual(result.total_energy_mwh,sum(result.grid_import_profile)*6/1000,5)
            if scenario in ('bess','pv_bess'):
                self.assertAlmostEqual(result.bess_soc_profile[0],10,3);self.assertAlmostEqual(result.bess_soc_profile[-1],10,3)
                self.assertTrue(result.bess_cycle['compliant'])
            if scenario=='bess':
                # Initial inventory cannot be spent once per independent day.
                self.assertGreaterEqual(sum(result.grid_import_profile)*6,5-.001)
            if scenario=='pv_bess':self.assertLess(result.total_cost_eur,1)

    def test_daily_derating_and_missing_pv_profile_are_rejected_without_fallback(self):
        raw=self.data('bess').model_dump();raw['bess_config']['enable_temperature_capacity_derating']=True
        with self.assertRaisesRegex(ValidationError,'thermal midnight'):OptimizationInputs(**raw)
        data=self.data('pv');data.pv_config.profile_kw=None
        with self.assertRaisesRegex(ValueError,'complete finite PV'):run_offline(run_extended_milp_solver(data,[]))
