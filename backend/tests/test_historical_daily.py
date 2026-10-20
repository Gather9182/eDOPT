import datetime as dt
import unittest

from app.models import OptimizationInputs,OpportunityVisit
from app.services.price_service import historical_day_grid,historical_calendar,historical_calendar_exclusions,map_strict_historical_day,PriceService
from app.services.solver import run_milp_solver
from test_charging import run_offline,site
from test_cyclic_soc import cycle_inputs,cycle_bus


def source_prices(date='2026-02-02'):
    start,end=historical_day_grid(date)
    return [dict(timestamp_utc=start+dt.timedelta(hours=i),end_timestamp_utc=start+dt.timedelta(hours=i+1),price_eur_mwh=-10 if i==0 else i)
            for i in range(int((end-start).total_seconds()/3600))]


class HistoricalDailyTests(unittest.TestCase):
    def test_real_source_intervals_cover_resampling_with_negative_and_zero_prices(self):
        prices=source_prices()
        prices[1]['price_eur_mwh']=0
        result=map_strict_historical_day('2026-02-02',15,prices)
        self.assertEqual(len(result['market_prices']),96)
        self.assertEqual(result['market_prices'][:8],[-10]*4+[0]*4)
        self.assertTrue(result['timestamps'][0].endswith('+01:00'))
        averaged=map_strict_historical_day('2026-02-02',120,prices)
        self.assertEqual(averaged['market_prices'][0],-5)

    def test_missing_duplicate_overlap_and_nonfinite_prices_are_rejected(self):
        for kind in ('gap','duplicate','overlap','nan','missing_end'):
            with self.subTest(kind=kind):
                rows=source_prices()
                if kind=='gap': rows.pop(4)
                if kind=='duplicate': rows.insert(4,dict(rows[4]))
                if kind=='overlap': rows[4]['timestamp_utc']-=dt.timedelta(minutes=1)
                if kind=='nan': rows[4]['price_eur_mwh']=float('nan')
                if kind=='missing_end': rows[4].pop('end_timestamp_utc')
                with self.assertRaises(ValueError): map_strict_historical_day('2026-02-02',15,rows)
        with self.assertRaises(ValueError): map_strict_historical_day('2026-02-02',15,[])

    def test_calendar_rejects_both_dst_transitions_and_invalid_ranges(self):
        for date in ('2026-03-29','2026-10-25'):
            with self.assertRaisesRegex(ValueError,'daylight-saving'): historical_day_grid(date)
        with self.assertRaises(ValueError): historical_calendar('2026-02-03','2026-02-02')
        with self.assertRaises(ValueError): historical_day_grid('2026-02-02',7)
        self.assertEqual(historical_calendar('2026-02-02','2026-02-03'),['2026-02-02','2026-02-03'])

    def test_annual_calendar_includes_dst_dates_without_blocking_the_run(self):
        dates=historical_calendar('2025-10-20','2026-10-20')
        self.assertEqual(len(dates),366)  # Both endpoints are included.
        self.assertIn('2025-10-26',dates)
        self.assertIn('2026-03-29',dates)
        exclusions=historical_calendar_exclusions(dates)
        self.assertEqual([(row['date'],row['local_day_hours']) for row in exclusions],[('2025-10-26',25),('2026-03-29',23)])
        self.assertTrue(all(row['code']=='DST_DAY_SKIPPED' for row in exclusions))
        with self.assertRaises(ValueError): historical_calendar('2026-01-01','2026-12-31',7)

    def test_strict_service_does_not_reuse_legacy_fallback_mapper(self):
        class Provider:
            async def fetch_prices(self,*_): return source_prices()
        result=run_offline(PriceService(Provider()).get_strict_historical_day('2026-02-02',15))
        self.assertEqual(result['coverage'],'complete')

    def test_daily_request_reuses_shortterm_solver_with_identical_cost_and_soc(self):
        short=cycle_inputs([cycle_bus(initial=10,consumption=6)])
        daily=OptimizationInputs(**{**short.model_dump(),'daily_cyclic':True})
        a=run_offline(run_milp_solver(short,[]));b=run_offline(run_milp_solver(daily,[]))
        self.assertAlmostEqual(a.total_cost_eur,b.total_cost_eur,places=2)
        self.assertEqual(a.end_condition,b.end_condition)

    def test_daily_midnight_inherits_connection_and_actual_energy(self):
        first=cycle_inputs([cycle_bus(initial=10,consumption=6)],
                           sites=[site(no_switch_windows=[dict(start='22:00',end='05:00')])])
        first.daily_cyclic=True
        a=run_offline(run_milp_solver(first,[]))
        second=first.model_copy(deep=True)
        second.buses[0].initial_connection_site=a.final_connections['a']
        second.buses[0].initial_soc_kwh=a.soc_profiles['a'][-1]
        second.electricity_prices=[200]*96
        b=run_offline(run_milp_solver(second,[]))
        self.assertEqual(b.connection_schedules['a'][0],a.final_connections['a'])
        self.assertAlmostEqual(b.soc_profiles['a'][-1],b.soc_profiles['a'][0],places=3)
        self.assertAlmostEqual(b.total_cost_eur,2*a.total_cost_eur,places=2)

    def test_daily_rejects_overnight_options_instead_of_dropping_them(self):
        inputs=cycle_inputs([cycle_bus(initial=10,consumption=6)],sites=[site()])
        inputs.daily_cyclic=True
        inputs.buses[0].opportunity_visits=[OpportunityVisit(
            id='overnight',gap_id='gap',site_id=inputs.charging_sites[0].id,
            pause_start_min=1380,pause_end_min=1500,outbound_minutes=15,return_minutes=15,
            outbound_km=2,return_km=2,outbound_energy_kwh=1,return_energy_kwh=1)]
        with self.assertRaisesRegex(ValueError,'crossing midnight'):
            run_offline(run_milp_solver(inputs,[]))

