import datetime as dt
from types import SimpleNamespace
import unittest

from app.services.market_prices import selected_market_prices
from app.services.historical_price_store import PriceDataError
from app.services.historical_prices import provenance
from app.services.price_service import historical_day_bounds
from test_charging import run_offline


class MarketPriceSelectionTests(unittest.TestCase):
    def rows(self,hours=48):
        start=historical_day_bounds('2025-12-10')[0]
        return [dict(timestamp_utc=start+dt.timedelta(minutes=i*15),end_timestamp_utc=start+dt.timedelta(minutes=(i+1)*15),price_eur_mwh=i-5,
            provenance=provenance('smard','fixture',900)) for i in range(hours*4)]

    def test_default_smard_short_and_flexible_preserve_real_intervals_and_metadata(self):
        rows=self.rows();calls=[]
        history=SimpleNamespace(store=SimpleNamespace(read=lambda a,b:calls.append((a,b)) or rows))
        short=run_offline(selected_market_prices('2025-12-10',24,15,history=history))
        flexible=run_offline(selected_market_prices('2025-12-10',48,15,history=history))
        self.assertEqual(short['prices'],list(range(-5,91)))
        self.assertEqual(flexible['prices'],list(range(-5,187)))
        self.assertEqual(flexible['source'],'Bundesnetzagentur | SMARD.de')
        self.assertEqual(short['license'],'CC BY 4.0');self.assertEqual(len(short['snapshot_hash']),64)
        averaged=run_offline(selected_market_prices('2025-12-10',24,60,history=history))
        self.assertEqual(averaged['prices'][0],-3.5)

    def test_awattar_is_explicit_and_does_not_switch_to_smard_when_incomplete(self):
        rows=self.rows();calls=[]
        class Provider:
            async def fetch_prices(self,date,hours):calls.append((date,hours));return rows[:96]
        history=SimpleNamespace(store=SimpleNamespace(read=lambda *_:self.fail('Unexpected SMARD switch')))
        result=run_offline(selected_market_prices('2025-12-10',24,15,'awattar',Provider(),history))
        self.assertEqual(result['prices'][:3],[-5,-4,-3]);self.assertEqual(result['selected_source'],'awattar')
        self.assertIn('not verified',result['license'])
        with self.assertRaises(PriceDataError) as error:
            run_offline(selected_market_prices('2025-12-10',48,15,'awattar',Provider(),history))
        self.assertEqual(error.exception.code,'MISSING_INTERVAL');self.assertEqual(len(calls),2)

    def test_real_gap_bad_source_and_dst_are_explicit_errors(self):
        rows=self.rows();rows.pop(5)
        history=SimpleNamespace(store=SimpleNamespace(read=lambda *_:rows))
        with self.assertRaises(PriceDataError) as error:run_offline(selected_market_prices('2025-12-10',24,15,history=history))
        self.assertEqual(error.exception.code,'MISSING_INTERVAL')
        with self.assertRaises(PriceDataError) as error:run_offline(selected_market_prices('2025-12-10',24,15,'invalid',history=history))
        self.assertEqual(error.exception.code,'INVALID_SOURCE')
        with self.assertRaises(PriceDataError) as error:run_offline(selected_market_prices('2026-03-28',48,15,history=history))
        self.assertEqual(error.exception.code,'DST_UNSUPPORTED_HORIZON')

    def test_price_windows_keep_source_evidence_and_solver_grid_and_reject_gaps(self):
        rows=self.rows(24)
        history=SimpleNamespace(store=SimpleNamespace(read=lambda *_:rows))
        original=run_offline(selected_market_prices('2025-12-10',24,15,history=history))
        for window,expected in ((30,[-4.5,-4.5,-2.5,-2.5]),(60,[-3.5]*4)):
            result=run_offline(selected_market_prices('2025-12-10',24,15,history=history,price_window_minutes=window))
            self.assertEqual(len(result['prices']),96)
            self.assertEqual(result['prices'][:4],expected)
            self.assertEqual(sum(result['prices']),sum(original['prices']))
            self.assertEqual(result['source_intervals'],original['source_intervals'])
            self.assertEqual(result['price_aggregation']['window_minutes'],window)
        rows.pop(1)
        with self.assertRaises(PriceDataError):
            run_offline(selected_market_prices('2025-12-10',24,15,history=history,price_window_minutes=60))

    def test_daily_cache_uses_same_aggregation_without_changing_raw_values(self):
        import tempfile
        from pathlib import Path
        from app.services.historical_price_store import PriceStore
        from app.services.historical_prices import HistoricalPrices
        root=Path(__file__).resolve().parents[1]/'scratch';root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            store=PriceStore(Path(folder)/'prices.sqlite3');store.put(self.rows(24))
            history=HistoricalPrices(store=store)
            result=history.day('2025-12-10',15,60)
            self.assertEqual(result['market_prices'][:4],[-3.5]*4)
            self.assertEqual(result['source_intervals'][0]['price_eur_mwh'],-5)
            self.assertEqual(history.day('2025-12-10')['market_prices'][:4],[-5,-4,-3,-2])
