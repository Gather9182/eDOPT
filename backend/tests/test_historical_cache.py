import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.services.historical_price_store import PriceStore,PriceDataError,UTC,ATTRIBUTION
from app.services.historical_prices import HistoricalPrices,provenance
from app.services.price_service import historical_day_bounds


class HistoricalCacheTests(unittest.TestCase):
    def setUp(self):
        root=Path(__file__).resolve().parents[1]/'scratch';root.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.path=Path(self.temp.name)/'prices.sqlite3';self.store=PriceStore(self.path)

    def tearDown(self):self.temp.cleanup()

    def source(self,date='2025-12-10',missing=None,value=-12):
        a,b=historical_day_bounds(date)
        seconds=3600 if date<'2025-10-01' else 900
        return [dict(timestamp_utc=a+dt.timedelta(seconds=i*seconds),end_timestamp_utc=a+dt.timedelta(seconds=(i+1)*seconds),price_eur_mwh=value+i,
            provenance=provenance('smard','fixture',seconds)) for i in range(int((b-a).total_seconds()/seconds)) if i!=missing]

    def mock_smard(self,first='2026-01-01',last='2026-12-31',gap=None):
        a=historical_day_bounds(first)[0]-dt.timedelta(days=7);end=historical_day_bounds(last)[1]+dt.timedelta(days=7)
        stamps=[]
        while a<end:stamps.append(int(a.timestamp()*1000));a+=dt.timedelta(days=7)
        calls=[]
        def handler(request):
            calls.append(str(request.url))
            if 'index_' in request.url.path:return httpx.Response(200,json={'timestamps':stamps})
            stamp=int(request.url.path.rsplit('_',1)[1][:-5]);rows=[]
            for i in range(672):
                t=stamp+i*900000
                rows.append([t,None if t==gap else (i%96)-10])
            return httpx.Response(200,json={'meta_data':{'version':1},'series':rows})
        return httpx.Client(transport=httpx.MockTransport(handler)),calls

    def test_year_blocks_zero_requests_after_restart_and_targeted_holes(self):
        client,calls=self.mock_smard()
        with client:
            service=HistoricalPrices(self.store,client,sleep=lambda _:None)
            report=service.prepare('2026-01-01','2026-12-31')
            self.assertEqual(report['missing_days'],0)
            self.assertLess(len(calls),60)
            initial=len(calls)
            report=HistoricalPrices(PriceStore(self.path),client,sleep=lambda _:None).prepare('2026-01-01','2026-12-31')
            self.assertEqual(report['external_requests'],0);self.assertEqual(len(calls),initial)
            dates=['2026-02-02','2026-05-05','2026-09-09']
            with self.store.connect() as db:
                for date in dates:
                    a,b=historical_day_bounds(date);db.execute('DELETE FROM prices WHERE start>=? AND start<?',(a.timestamp(),b.timestamp()))
            report=service.prepare('2026-01-01','2026-12-31')
            self.assertEqual(report['missing_days'],0);self.assertEqual(len(calls)-initial,4) # index + only three relevant blocks
            snapshots=list(ThreadPoolExecutor(4).map(lambda _:service.day('2026-05-05')['snapshot_hash'],range(4)))
            self.assertEqual(len(set(snapshots)),1)
            print(f'Historical cache fixture: first year {initial} HTTP requests; repeated year 0; three separated holes 4.')

    def test_strict_mapping_provenance_dst_and_real_gaps(self):
        self.store.put(self.source())
        service=HistoricalPrices(self.store)
        day=service.day('2025-12-10')
        self.assertEqual(day['market_prices'][:3],[-12,-11,-10]);self.assertEqual(day['license'],'CC BY 4.0')
        self.assertEqual(day['source'],ATTRIBUTION);self.assertEqual(len(day['snapshot_hash']),64)
        self.assertEqual(day['source_intervals'][0]['provenance']['market_area'],'AT')
        self.store.put(self.source('2024-02-02'))
        self.assertEqual(service.day('2024-02-02')['market_prices'][:8],[-12]*4+[-11]*4)
        self.store.put(self.source('2025-12-11',missing=4))
        with self.assertRaises(PriceDataError) as error:service.day('2025-12-11')
        self.assertEqual(error.exception.code,'MISSING_INTERVAL')
        self.assertEqual(service.coverage('2026-03-29','2026-03-29')['required_days'],0)
        self.assertEqual(service.prepare('2026-03-29','2026-03-29')['external_requests'],0)
        with self.assertRaisesRegex(ValueError,'daylight-saving'):service.day('2026-03-29')

    def test_conflicting_prices_do_not_change_selected_snapshots_without_refresh(self):
        rows=self.source();self.store.put(rows);service=HistoricalPrices(self.store);before=service.day('2025-12-10')
        other=[{**row,'price_eur_mwh':77,'provenance':provenance('energy_charts','fixture-ec',900)} for row in rows]
        self.assertEqual(self.store.put(other)['conflicts'],95) # One original interval already equals 77.
        self.assertEqual(service.day('2025-12-10')['snapshot_hash'],before['snapshot_hash'])
        self.assertEqual(self.store.conflicts()[0]['incoming']['price_eur_mwh'],77)
        self.store.put(other,refresh=True)
        self.assertNotEqual(service.day('2025-12-10')['snapshot_hash'],before['snapshot_hash'])
        self.assertEqual(before['market_prices'][0],-12)

    def test_rate_limit_timeout_schema_errors_are_not_missing_market_data(self):
        waits=[];responses=[httpx.Response(429,headers={'Retry-After':'7'}),httpx.Response(200,json={'ok':True})]
        with httpx.Client(transport=httpx.MockTransport(lambda _:responses.pop(0))) as client:
            self.assertTrue(HistoricalPrices(self.store,client,sleep=waits.append)._json('https://test.local')['ok'])
        self.assertEqual(waits,[7])
        for status,code in [(429,'HTTP_429'),(503,'UPSTREAM_UNAVAILABLE'),(403,'HTTP_403'),(404,'HTTP_404')]:
            with httpx.Client(transport=httpx.MockTransport(lambda _,s=status:httpx.Response(s))) as client:
                with self.assertRaises(PriceDataError) as error:HistoricalPrices(self.store,client,sleep=lambda _:None)._json('https://test.local')
                self.assertEqual(error.exception.code,code)
        def timeout(request):raise httpx.ReadTimeout('fixture timeout',request=request)
        with httpx.Client(transport=httpx.MockTransport(timeout)) as client:
            with self.assertRaises(PriceDataError) as error:HistoricalPrices(self.store,client,sleep=lambda _:None)._json('https://test.local')
            self.assertEqual(error.exception.code,'UPSTREAM_TIMEOUT')

    def test_csv_original_resolution_and_explicit_timezone(self):
        rows=self.source();lines=['Datum von;Datum bis;Österreich [€/MWh] Originalauflösungen']
        for row in rows:lines.append(f'{row["timestamp_utc"].isoformat()};{row["end_timestamp_utc"].isoformat()};{str(row["price_eur_mwh"]).replace(".",",")}')
        data=('\n'.join(lines)).encode()
        service=HistoricalPrices(self.store);service.import_csv(data,'smard.csv','UTC')
        self.assertEqual(service.day('2025-12-10')['market_prices'],[row['price_eur_mwh'] for row in rows])
        self.assertEqual(service.day('2025-12-10')['providers'],['smard_csv'])
        with self.assertRaises(PriceDataError):service.import_csv(data,'smard.csv','')
        with self.assertRaises(PriceDataError):service.import_csv(data.replace('Österreich'.encode(),'Deutschland'.encode()),'wrong.csv','UTC')
        ambiguous='Datum von;Datum bis;Österreich [€/MWh] Originalauflösungen\n25.10.2026 02:00;25.10.2026 02:15;10'.encode()
        with self.assertRaisesRegex(PriceDataError,'Ambiguous'):service.import_csv(ambiguous,'dst.csv','Europe/Vienna')

    def test_optional_energy_charts_only_fills_gaps_and_validates_license(self):
        rows=self.source(missing=4);self.store.put(rows)
        a,b=historical_day_bounds('2025-12-10');calls=[]
        def handler(request):
            calls.append(str(request.url))
            if 'smard.de' in request.url.host:return httpx.Response(503)
            return httpx.Response(200,json={'unix_seconds':[int((a+dt.timedelta(minutes=15*i)).timestamp()) for i in range(96)],'price':list(range(96)),'unit':'EUR / MWh','license_info':'CC BY 4.0 from '+ATTRIBUTION,'deprecated':False})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            service=HistoricalPrices(self.store,client,sleep=lambda _:None)
            result=service.prepare('2025-12-10','2025-12-10',allow_fallback=True)
            self.assertEqual(result['missing_days'],0)
            self.assertEqual(sum('energy-charts' in url for url in calls),1)
            self.assertEqual(service.day('2025-12-10')['market_prices'][0],-12)
            self.assertEqual(service.day('2025-12-10')['market_prices'][4],4)
            count=len(calls);service.prepare('2025-12-10','2025-12-10',allow_fallback=True)
            self.assertEqual(len(calls),count)

    def test_concurrent_preparations_share_one_import(self):
        client,calls=self.mock_smard('2026-02-02','2026-02-03')
        with client:
            def prepare(_):return HistoricalPrices(PriceStore(self.path),client,sleep=lambda _:None).prepare('2026-02-02','2026-02-03')
            with ThreadPoolExecutor(2) as pool:reports=list(pool.map(prepare,range(2)))
        self.assertEqual(sorted(row['external_requests'] for row in reports),[0,len(calls)])
        self.assertTrue(all(row['missing_days']==0 for row in reports))
