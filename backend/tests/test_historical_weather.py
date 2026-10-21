import datetime as dt
from pathlib import Path
import tempfile
import unittest
import httpx
from app.services.historical_weather import HistoricalWeather,WeatherStore
from app.services.historical_price_store import PriceDataError,UTC


class HistoricalWeatherTests(unittest.TestCase):
    def setUp(self):
        root=Path(__file__).resolve().parents[1]/'scratch';root.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.store=WeatherStore(Path(self.temp.name)/'weather.sqlite3')
        self.calls=[]
        def handle(request):
            self.calls.append(dict(request.url.params))
            first=dt.datetime.fromisoformat(request.url.params['start_date']).replace(tzinfo=UTC)
            last=dt.datetime.fromisoformat(request.url.params['end_date']).replace(tzinfo=UTC)+dt.timedelta(days=1)
            stamps=list(range(int(first.timestamp()),int(last.timestamp()),3600))
            return httpx.Response(200,json={'latitude':48.25,'longitude':16.25,'elevation':200,
                'hourly_units':{'shortwave_radiation':'W/m²','temperature_2m':'°C'},
                'hourly':{'time':stamps,'shortwave_radiation':[-1 if t==getattr(self,'bad_stamp',None) else 500 if dt.datetime.fromtimestamp(t,UTC).hour==0 else 0 for t in stamps],
                          'temperature_2m':[10]*len(stamps)}})
        self.client=httpx.Client(transport=httpx.MockTransport(handle));self.service=HistoricalWeather(self.store,self.client,sleep=lambda _:None)
    def tearDown(self):self.client.close();self.temp.cleanup()

    def test_repeat_and_capacity_change_reuse_raw_weather_and_correct_previous_hour_alignment(self):
        report=self.service.prepare('2025-12-10','2025-12-10',48.2,16.3)
        self.assertEqual(report['complete_days'],1);self.assertEqual(report['external_requests'],1)
        day=self.service.day('2025-12-10',48.2,16.3,15,10,.8,True)
        # Vienna midnight is 23 UTC: the mean labelled 00 UTC belongs to that first hour.
        self.assertEqual(day['source_snapshot_hash'],report['day_snapshot_hashes']['2025-12-10'])
        self.assertEqual(day['pv_profile_kw'][:4],[4]*4);self.assertEqual(day['pv_profile_kw'][4:],[0]*92)
        self.assertEqual(day['temperature_profile_c'],[10]*96)
        repeated=HistoricalWeather(WeatherStore(self.store.path),self.client).prepare('2025-12-10','2025-12-10',48.2,16.3)
        self.assertEqual(repeated['external_requests'],0);self.assertEqual(len(self.calls),1)
        doubled=self.service.day('2025-12-10',48.2,16.3,15,20,.8)
        self.assertEqual(doubled['pv_profile_kw'][:4],[8]*4)
        self.assertEqual(doubled['source_intervals'],day['source_intervals'])
        hourly=self.service.day('2025-12-10',48.2,16.3,60,10,.8)
        self.assertAlmostEqual(sum(hourly['pv_profile_kw']),sum(day['pv_profile_kw'])/4)

    def test_longer_fetch_does_not_renormalize_day_gaps_are_not_filled_and_dst_skips(self):
        self.service.prepare('2025-12-10','2025-12-10',48.2,16.3)
        initial=self.service.day('2025-12-10',48.2,16.3,15,10)
        self.service.prepare('2025-12-01','2025-12-31',48.2,16.3)
        self.assertEqual(initial['pv_profile_kw'],self.service.day('2025-12-10',48.2,16.3,15,10)['pv_profile_kw'])
        with self.store.connect() as db:
            stamp=int(dt.datetime(2025,12,10,0,tzinfo=UTC).timestamp())
            db.execute("DELETE FROM weather_selected WHERE variable='shortwave_radiation' AND stamp=?",(stamp,))
        with self.assertRaisesRegex(PriceDataError,'solar irradiance unavailable'):self.service.day('2025-12-10',48.2,16.3,15,10)
        self.assertEqual(self.service.prepare('2025-12-10','2025-12-10',48.2,16.3)['complete_days'],1)
        report=self.service.coverage('2025-10-26','2025-10-26',48.2,16.3)
        self.assertEqual(report['required_days'],0);self.assertEqual(len(report['skipped_dates']),1)
        with self.assertRaises(ValueError):self.service.day('2025-10-26',48.2,16.3)

    def test_weather_preparation_job_uses_generic_factory_without_price_service(self):
        from threading import Event
        from app.services.historical_prices import PricePreparationJobs
        done=Event()
        class Service:
            def prepare(self,notify,**options):
                notify({'message':'fixture weather'});done.set();return {'complete_days':options['days']}
        jobs=PricePreparationJobs(factory=Service,label='weather')
        key=jobs.start({'days':2})
        self.assertTrue(done.wait(2));jobs.pool.shutdown(wait=True)
        self.assertEqual(jobs.get(key)['result']['complete_days'],2)

    def test_invalid_observation_does_not_discard_other_valid_days_in_block(self):
        self.bad_stamp=int(dt.datetime(2025,12,10,0,tzinfo=UTC).timestamp())
        report=self.service.prepare('2025-12-10','2025-12-11',48.2,16.3)
        self.assertEqual(report['complete_dates'],['2025-12-11'])
        self.assertEqual(report['missing_dates'],['2025-12-10'])
        self.assertEqual(report['errors'][0]['code'],'WEATHER_INVALID_OBSERVATION')
        self.assertEqual(self.service.day('2025-12-11',48.2,16.3,15,10)['coverage'],'complete')

    def test_ifs_has_separate_cache_and_explicit_model_provenance(self):
        self.service.prepare('2025-12-10','2025-12-10',48.2,16.3)
        self.assertEqual(self.service.coverage('2025-12-10','2025-12-10',48.2,16.3,model='ecmwf_ifs')['complete_days'],0)
        result=self.service.prepare('2025-12-10','2025-12-10',48.2,16.3,model='ecmwf_ifs')
        self.assertEqual(result['complete_days'],1)
        self.assertEqual(result['archive_delay_days'],0)
        self.assertEqual(self.calls[-1]['models'],'ecmwf_ifs')
        day=self.service.day('2025-12-10',48.2,16.3,capacity_kw=10,model='ecmwf_ifs')
        self.assertEqual(day['weather_model'],'ecmwf_ifs')
        self.assertTrue(all(row['provenance']['model']=='ecmwf_ifs' for row in day['source_intervals']))
        self.assertNotEqual(day['source_snapshot_hash'],self.service.day('2025-12-10',48.2,16.3)['source_snapshot_hash'])
        with self.assertRaisesRegex(PriceDataError,'Choose ERA5 or ECMWF IFS'):
            self.service.prepare('2025-12-10','2025-12-10',48.2,16.3,model='best_match')
