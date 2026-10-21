import unittest
from types import SimpleNamespace
from pydantic import ValidationError
from app.models import OptimizationInputs
from app.services.solver import run_milp_solver,run_extended_milp_solver
from app.services.flat_rate import flat_rate_results
from app.services.market_prices import selected_market_prices
from test_charging import inputs,bus,run_offline


class FlatRateTests(unittest.TestCase):
    def test_constant_tariff_and_existing_physical_limits_in_basic_and_extended_solver(self):
        for extended in (False,True):
            data=inputs([bus('B')],price_mode='flat_rate',flat_rate_base_eur_kwh=.2,flat_rate_effective_eur_mwh=210,
                arrival_flat_rate_eur_mwh=None,electricity_prices=[210]*4,market_prices=[200]*4,
                energy_site_id='D',scenario='pv' if extended else 'baseline',pv_config={'capacity_kw':10,'profile_kwh':[0,2,0,0]} if extended else None)
            result=run_offline(run_extended_milp_solver(data,[]) if extended else run_milp_solver(data))
            self.assertEqual(result.electricity_prices,[210]*4)
            self.assertEqual(result.price_assumption['mode'],'flat_rate')
            self.assertTrue(all(value<=40.001 for value in result.site_load_profiles['D']))
            self.assertEqual(result.flat_rate_comparison,{})
            market_data=data.model_dump()
            market_data.update(price_mode='market',electricity_prices=[100,200,300,400],arrival_flat_rate_eur_mwh=210)
            market=OptimizationInputs(**market_data)
            comparison_result=run_offline(run_extended_milp_solver(market,[]) if extended else run_milp_solver(market))
            comparison=comparison_result.flat_rate_comparison
            self.assertTrue(comparison['comparable'])
            self.assertAlmostEqual(comparison['baseline_cost_eur'],sum(comparison_result.baseline_aggregated_load_profile)*.25*.21,5)
            self.assertAlmostEqual(comparison['savings_eur'],comparison['baseline_cost_eur']-comparison_result.total_cost_eur,5)
            expected_existing=sum(power*price*.25/1000 for power,price in zip(comparison_result.baseline_aggregated_load_profile,market.electricity_prices))
            self.assertAlmostEqual(comparison_result.baseline_cost_eur,expected_existing,5)

    def test_nonconstant_flat_price_is_rejected_and_invalid_reference_has_no_savings(self):
        data=inputs([bus('B')])
        raw=data.model_dump();raw.update(price_mode='flat_rate',flat_rate_base_eur_kwh=.2,flat_rate_effective_eur_mwh=200,market_prices=[200]*4)
        with self.assertRaises(ValidationError):OptimizationInputs(**raw)
        raw.update(electricity_prices=[200]*4,arrival_flat_rate_eur_mwh=200)
        with self.assertRaisesRegex(ValidationError,'only for a market-price'):OptimizationInputs(**raw)
        data.flat_rate_base_eur_kwh=.2
        data.flat_rate_effective_eur_mwh=200
        data.arrival_flat_rate_eur_mwh=200
        comparison=flat_rate_results(data,[40]*4,2,['No feasible arrival schedule'])['flat_rate_comparison']
        self.assertFalse(comparison['comparable']);self.assertIsNone(comparison['baseline_cost_eur']);self.assertIsNone(comparison['savings_eur'])

    def test_flat_prices_bypass_market_cache_and_preserve_default_market_mode(self):
        history=SimpleNamespace(store=SimpleNamespace(read=lambda *_:self.fail('Flat-rate run accessed market cache')))
        quote=run_offline(selected_market_prices('2025-12-10',48,15,history=history,flat_rate_eur_kwh=.2))
        self.assertEqual(quote['prices'],[200]*192);self.assertEqual(quote['source_intervals'],[])
        data=inputs([bus('B')]);result=run_offline(run_milp_solver(data))
        self.assertEqual(result.price_assumption,{});self.assertEqual(result.flat_rate_comparison,{})
