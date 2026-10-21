"""Strict, persistent historical weather and versioned PV derivation for daily models."""
import calendar
import bisect
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import time
import pytz
import httpx
from .historical_price_store import PriceStore,PriceDataError,UTC
from .historical_prices import PricePreparationJobs
from .price_service import historical_calendar,historical_calendar_exclusions,historical_day_grid

URL='https://archive-api.open-meteo.com/v1/archive'
VARIABLES={'shortwave_radiation':'W/m²','temperature_2m':'°C'}
MODELS={'era5':('ERA5',5),'ecmwf_ifs':('ECMWF IFS',0)}


def model_info(model):
    if model not in MODELS:raise PriceDataError('WEATHER_MODEL','Choose ERA5 or ECMWF IFS explicitly.')
    return MODELS[model]


def preparation_cutoff(model):
    return (dt.datetime.now(UTC).date()-dt.timedelta(days=model_info(model)[1])).isoformat()


def location_key(latitude,longitude,model='era5'):
    model_info(model)
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90<=latitude<=90 or not -180<=longitude<=180:
        raise PriceDataError('WEATHER_LOCATION','Select valid coordinates for the PV/BESS location.')
    return json.dumps(dict(provider='open_meteo_archive',model=model,latitude=float(latitude),longitude=float(longitude)),sort_keys=True)


class WeatherStore:
    # Only the generic connection lifetime and cross-process file lock are reused, not the AT price schema.
    connect=PriceStore.connect
    import_lock=PriceStore.import_lock

    def __init__(self,path=None):
        self.path=Path(path or os.environ.get('EDOPT_WEATHER_CACHE_PATH') or Path(__file__).resolve().parents[2]/'data'/'historical_weather.sqlite3').resolve()
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS weather_observations(hash TEXT PRIMARY KEY,location TEXT,variable TEXT,stamp INTEGER,value REAL,unit TEXT,meta TEXT);
            CREATE TABLE IF NOT EXISTS weather_selected(location TEXT,variable TEXT,stamp INTEGER,hash TEXT,PRIMARY KEY(location,variable,stamp));
            CREATE INDEX IF NOT EXISTS weather_stamp ON weather_selected(location,stamp);
            CREATE TABLE IF NOT EXISTS weather_revisions(old_hash TEXT,new_hash TEXT,observed_at TEXT,UNIQUE(old_hash,new_hash));
            """)

    def put(self,key,rows,refresh=False):
        with self.connect() as db:
            for row in rows:
                raw=json.dumps(row,sort_keys=True);fingerprint=hashlib.sha256(raw.encode()).hexdigest()
                variable,stamp=row['variable'],row['timestamp_utc']
                db.execute('INSERT OR IGNORE INTO weather_observations VALUES(?,?,?,?,?,?,?)',(fingerprint,key,variable,stamp,row['value'],row['unit'],json.dumps(row['provenance'],sort_keys=True)))
                prior=db.execute('SELECT hash FROM weather_selected WHERE location=? AND variable=? AND stamp=?',(key,variable,stamp)).fetchone()
                if prior and prior[0]!=fingerprint:
                    db.execute('INSERT OR IGNORE INTO weather_revisions VALUES(?,?,?)',(prior[0],fingerprint,dt.datetime.now(UTC).isoformat()))
                if not prior or refresh:db.execute('INSERT OR REPLACE INTO weather_selected VALUES(?,?,?,?)',(key,variable,stamp,fingerprint))

    def rows(self,key,start,end,full=True):
        with self.connect() as db:
            if not full:
                return db.execute('SELECT variable,stamp,hash FROM weather_selected WHERE location=? AND stamp>=? AND stamp<=? ORDER BY stamp,variable',(key,int(start.timestamp()),int(end.timestamp()))).fetchall()
            values=db.execute('SELECT o.variable,o.stamp,o.value,o.unit,o.meta,o.hash FROM weather_selected s JOIN weather_observations o ON s.hash=o.hash WHERE s.location=? AND s.stamp>=? AND s.stamp<=? ORDER BY o.stamp,o.variable',(key,int(start.timestamp()),int(end.timestamp()))).fetchall()
        return [dict(variable=v,timestamp_utc=t,value=value,unit=unit,provenance=json.loads(meta),interval_hash=h) for v,t,value,unit,meta,h in values]

    def persistence(self):
        return dict(path=str(self.path),configured_path=bool(os.environ.get('EDOPT_WEATHER_CACHE_PATH')),
            warnings=[] if os.environ.get('EDOPT_WEATHER_CACHE_PATH') else ['Default local cache path. Set EDOPT_WEATHER_CACHE_PATH to a persistent mounted volume for deployment.'])


class HistoricalWeather:
    def __init__(self,store=None,client=None,sleep=time.sleep):
        self.store=store or WeatherStore();self.client=client;self.sleep=sleep;self.requests=0

    def coverage(self,first,last,latitude,longitude,resolution=15,need_temperature=False,model='era5'):
        key=location_key(latitude,longitude,model)
        dates=historical_calendar(first,last,resolution);skipped=historical_calendar_exclusions(dates)
        valid=[date for date in dates if date not in {row['date'] for row in skipped}]
        complete=[];missing=[];snapshots={}
        if valid:
            start=historical_day_grid(valid[0],resolution)[0];end=historical_day_grid(valid[-1],resolution)[1]
            selected=self.store.rows(key,start,end,False)
            selected_times=[row[1] for row in selected]
            present={(variable,stamp) for variable,stamp,_ in selected}
            for date in valid:
                a,b=historical_day_grid(date,resolution);stamps=range(int(a.timestamp()),int(b.timestamp()),3600)
                required={('shortwave_radiation',stamp+3600) for stamp in stamps}
                if need_temperature:required|={('temperature_2m',stamp) for stamp in range(int(a.timestamp()),int(b.timestamp())+1,3600)}
                (complete if required<=present else missing).append(date)
                if required<=present:
                    segment=selected[bisect.bisect_left(selected_times,int(a.timestamp())):bisect.bisect_right(selected_times,int(b.timestamp()))]
                    snapshots[date]=hashlib.sha256(''.join(row[2] for row in segment).encode()).hexdigest()
        return dict(first=first,last=last,resolution=resolution,source=f'Open-Meteo Archive / {model_info(model)[0]}',license='CC BY 4.0',required_days=len(valid),complete_days=len(complete),missing_days=len(missing),
            day_snapshot_hashes=snapshots,complete_dates=complete,missing_dates=missing,skipped_dates=skipped,persistence=self.store.persistence(),location=dict(latitude=latitude,longitude=longitude),model=model,archive_preparation_cutoff=preparation_cutoff(model),archive_delay_days=model_info(model)[1])

    def _fetch(self,params):
        for attempt in range(3):
            self.requests+=1
            try:
                response=self.client.get(URL,params=params,timeout=60)
                if response.status_code in (429,500,502,503,504):
                    if attempt<2:
                        retry=response.headers.get('Retry-After','')
                        self.sleep(min(60,float(retry)) if retry.replace('.','',1).isdigit() else 2**attempt);continue
                response.raise_for_status()
                return response.json()
            except (httpx.TimeoutException,httpx.NetworkError) as error:
                if attempt<2:self.sleep(2**attempt);continue
                raise PriceDataError('WEATHER_UNAVAILABLE',str(error)) from error
            except (httpx.HTTPStatusError,ValueError) as error:raise PriceDataError('WEATHER_RESPONSE',str(error)) from error

    def prepare(self,first,last,latitude,longitude,resolution=15,need_temperature=False,refresh=False,notify=lambda state:None,model='era5'):
        key=location_key(latitude,longitude,model);initial_requests=self.requests;errors=[]
        with self.store.import_lock(lambda:notify(dict(message='Waiting for another historical weather import.'))):
            report=self.coverage(first,last,latitude,longitude,resolution,need_temperature,model)
            dates=report['complete_dates']+report['missing_dates'] if refresh else report['missing_dates']
            months={}
            for date in dates:
                a,b=historical_day_grid(date,resolution)
                for stamp in range(int(a.timestamp()),int(b.timestamp())+1,3600):
                    day=dt.datetime.fromtimestamp(stamp,UTC).date()
                    months.setdefault((day.year,day.month),[]).append(day)
            if not dates:return {**report,'external_requests':0,'errors':[]}
            own=self.client is None
            if own:self.client=httpx.Client()
            try:
                for index,((year,month),needed) in enumerate(sorted(months.items())):
                    # Respect the explicitly selected historical archive; no implicit substitution.
                    latest=dt.date.fromisoformat(preparation_cutoff(model))
                    end=min(max(needed),dt.date(year,month,calendar.monthrange(year,month)[1]),latest)
                    start=max(min(needed),dt.date(2017,1,1) if model=='ecmwf_ifs' else dt.date(1940,1,1))
                    if end<start:continue
                    params=dict(latitude=latitude,longitude=longitude,models=model,hourly=','.join(VARIABLES),
                        timezone='GMT',timeformat='unixtime',start_date=start.isoformat(),end_date=end.isoformat())
                    notify(dict(phase='weather',message=f'Loading weather block {index+1}/{len(months)}.',completed=index,total=len(months)))
                    try:
                        payload=self._fetch(params);hourly=payload.get('hourly',{});stamps=hourly.get('time',[])
                        if not stamps or len(set(stamps))!=len(stamps):raise PriceDataError('WEATHER_RESPONSE','Missing or duplicate weather timestamps.')
                        meta=dict(provider='open_meteo_archive',model=model,source_url=URL,params=params,
                            requested_latitude=latitude,requested_longitude=longitude,grid_latitude=payload.get('latitude'),grid_longitude=payload.get('longitude'),elevation=payload.get('elevation'),
                            attribution=f'Open-Meteo / {model_info(model)[0]} / ECMWF',license='CC BY 4.0',license_reference='https://open-meteo.com/en/terms',retrieved_at=dt.datetime.now(UTC).isoformat(),original_resolution_seconds=3600)
                        rows=[]
                        for variable,unit in VARIABLES.items():
                            values=hourly.get(variable,[])
                            if len(values)!=len(stamps) or payload.get('hourly_units',{}).get(variable)!=unit:raise PriceDataError('WEATHER_RESPONSE',f'Invalid weather variable/unit: {variable}.')
                            for stamp,value in zip(stamps,values):
                                if not isinstance(stamp,(int,float)) or stamp%3600:raise PriceDataError('WEATHER_RESPONSE','Weather timestamps must be UTC hour boundaries.')
                                if value is None:continue
                                if not isinstance(value,(int,float)) or not math.isfinite(value) or variable=='shortwave_radiation' and value<0:
                                    errors.append(dict(code='WEATHER_INVALID_OBSERVATION',message=f'Invalid {variable} observation at UTC {stamp}; that observation was not cached.',start=start.isoformat(),end=end.isoformat()))
                                    continue
                                rows.append(dict(variable=variable,timestamp_utc=int(stamp),value=value,unit=unit,provenance=meta))
                        self.store.put(key,rows,refresh)
                    except PriceDataError as error:errors.append(dict(code=error.code,message=str(error),start=start.isoformat(),end=end.isoformat()))
            finally:
                if own:self.client.close();self.client=None
            return {**self.coverage(first,last,latitude,longitude,resolution,need_temperature,model),'external_requests':self.requests-initial_requests,'errors':errors}

    def day(self,date,latitude,longitude,resolution=15,capacity_kw=0,performance_ratio=.85,need_temperature=False,model='era5'):
        if not math.isfinite(capacity_kw) or capacity_kw<0 or not math.isfinite(performance_ratio) or not 0<performance_ratio<=1:
            raise PriceDataError('PV_MODEL','PV capacity must be non-negative and performance ratio in (0,1].')
        a,b=historical_day_grid(date,resolution);key=location_key(latitude,longitude,model)
        rows=self.store.rows(key,a,b);values={(row['variable'],row['timestamp_utc']):row['value'] for row in rows}
        def observation(variable,stamp):
            if (variable,stamp) not in values:
                local=dt.datetime.fromtimestamp(stamp,UTC).astimezone(pytz.timezone('Europe/Vienna')).isoformat()
                label='solar irradiance' if variable=='shortwave_radiation' else 'temperature'
                pending=date>preparation_cutoff(model)
                hint=f'After the {model_info(model)[0]} preparation cutoff ({preparation_cutoff(model)}).' if pending else 'The selected archive has not supplied all required hourly observations; retry loading missing weather or explicitly select another model.'
                raise PriceDataError('WEATHER_MISSING',f'{date}: {label} unavailable at {local} (Europe/Vienna), source {model_info(model)[0]}. {hint} No replacement weather was used.')
            return values[variable,stamp]
        pv=[];temperature=[]
        # Radiation labels describe the preceding hour, temperatures are point values.
        for left in range(int(a.timestamp()),int(b.timestamp()),resolution*60):
            right=left+resolution*60;cursor=left;weighted=0
            while cursor<right:
                hour=cursor//3600*3600;end=min(right,hour+3600)
                weighted+=observation('shortwave_radiation',hour+3600)*(end-cursor);cursor=end
            pv.append(capacity_kw*performance_ratio*weighted/(resolution*60)/1000)
            if need_temperature:
                hour=left//3600*3600;alpha=(left-hour)/3600
                temperature.append(observation('temperature_2m',hour)*(1-alpha)+observation('temperature_2m',hour+3600)*alpha)
        fingerprint=hashlib.sha256(json.dumps(dict(rows=rows,capacity_kw=capacity_kw,performance_ratio=performance_ratio,resolution=resolution,model='ghi-reference-v1'),sort_keys=True).encode()).hexdigest()
        return dict(date=date,timezone='Europe/Vienna',time_step_minutes=resolution,unit='kW',timestamps=[(a+dt.timedelta(minutes=i*resolution)).isoformat() for i in range(len(pv))],coverage='complete',pv_profile_kw=pv,temperature_profile_c=temperature,source=f'Open-Meteo Archive / {model_info(model)[0]}',license='CC BY 4.0',
            pv_model=dict(version='ghi-reference-v1',capacity_kw=capacity_kw,performance_ratio=performance_ratio,reference_irradiance_w_m2=1000,
                description='Horizontal-irradiance proxy, not metered generation; no orientation, shading or cell-temperature correction. No selected-range peak normalization.'),
            timestamp_semantics='Radiation: mean over preceding hour. Temperature: point value, linearly interpolated without gap filling.',
            weather_model=model,source_intervals=rows,source_snapshot_hash=hashlib.sha256(''.join(row['interval_hash'] for row in rows).encode()).hexdigest(),snapshot_hash=fingerprint,persistence=self.store.persistence())


class WeatherPreparationJobs(PricePreparationJobs):
    def __init__(self):super().__init__(factory=HistoricalWeather,label='weather')
