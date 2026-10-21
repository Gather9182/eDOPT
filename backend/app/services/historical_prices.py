"""Block import, provenance and cache-only daily reads for historical AT prices."""
import csv
import datetime as dt
import hashlib
import io
import json
import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime

import httpx
import pytz

from .historical_price_store import PriceStore,PriceDataError,ATTRIBUTION,UTC
from .price_service import historical_calendar,historical_calendar_exclusions,historical_day_bounds,historical_day_grid,map_strict_historical_day

SMARD='https://www.smard.de/app/chart_data/4170/AT/'
SWITCH=dt.datetime(2025,9,30,22,tzinfo=UTC)  # 01 October 2025, Vienna midnight.
AT_START=dt.datetime(2018,9,30,22,tzinfo=UTC)


def provenance(provider,url,resolution,**extra):
    return dict(provider=provider,source_url=url,attribution=ATTRIBUTION if provider!='energy_charts' else 'Energy-Charts.info; '+ATTRIBUTION,
        license='CC BY 4.0',license_url='https://www.smard.de/home/datennutzung',market_area='AT',market='day_ahead',unit='EUR/MWh',
        source_resolution_seconds=resolution,fetched_at=dt.datetime.now(UTC).isoformat(),**extra)


class HistoricalPrices:
    def __init__(self,store=None,client=None,sleep=time.sleep):
        self.store=store or PriceStore();self.client=client;self.sleep=sleep;self.requests=0

    def _json(self,url,params=None,energy=False):
        for attempt in range(3):
            if energy:
                # Imports already hold the cross-process lock. Persist the quota
                # between processes/restarts, at most one request every 31 seconds.
                with self.store.connect() as db:
                    db.execute('CREATE TABLE IF NOT EXISTS provider_quota (provider TEXT PRIMARY KEY, next_request REAL)')
                    row=db.execute('SELECT next_request FROM provider_quota WHERE provider=?',('energy_charts',)).fetchone()
                    wait=max(0,(row[0] if row else 0)-time.time())
                if wait: self.sleep(wait)
                with self.store.connect() as db:
                    db.execute('INSERT OR REPLACE INTO provider_quota VALUES(?,?)',('energy_charts',time.time()+31))
            self.requests+=1
            try:
                response=self.client.get(url,params=params,timeout=45)
            except httpx.TimeoutException as error:
                if attempt==2: raise PriceDataError('UPSTREAM_TIMEOUT',str(error)) from error
                self.sleep(2**attempt);continue
            except httpx.RequestError as error:
                if attempt==2: raise PriceDataError('UPSTREAM_UNAVAILABLE',str(error)) from error
                self.sleep(2**attempt);continue
            if response.status_code in (429,503):
                delay=2**attempt;header=response.headers.get('Retry-After')
                if header:
                    try: delay=max(delay,float(header))
                    except ValueError:
                        try: delay=max(delay,(parsedate_to_datetime(header)-dt.datetime.now(UTC)).total_seconds())
                        except (ValueError,TypeError): pass
                if energy:
                    with self.store.connect() as db:
                        db.execute('INSERT OR REPLACE INTO provider_quota VALUES(?,?)',('energy_charts',time.time()+max(31,delay)))
                if attempt==2: raise PriceDataError('HTTP_429' if response.status_code==429 else 'UPSTREAM_UNAVAILABLE',f'HTTP {response.status_code} from {url}; Retry-After: {header}.')
                self.sleep(delay);continue
            if not response.is_success:
                raise PriceDataError(f'HTTP_{response.status_code}',f'HTTP {response.status_code} from {url}.')
            try: return response.json()
            except ValueError as error: raise PriceDataError('INVALID_RESPONSE',f'Invalid JSON from {url}.') from error

    def coverage(self,first,last,resolution=15):
        dates=historical_calendar(first,last,resolution)
        skipped=historical_calendar_exclusions(dates);skip={row['date'] for row in skipped}
        gaps=self.store.gaps(historical_day_bounds(first)[0],historical_day_bounds(last)[1])
        complete=[];missing=[]
        for date in dates:
            if date in skip: continue
            start,end=historical_day_bounds(date)
            (missing if any(a<end and b>start for a,b in gaps) else complete).append(date)
        return dict(complete_dates=complete,missing_dates=missing,excluded_dates=skipped,complete_days=len(complete),
            required_days=len(dates)-len(skip),missing_days=len(missing),source=ATTRIBUTION,license='CC BY 4.0',persistence=self.store.persistence())

    def day(self,date,resolution=15,price_window_minutes=15):
        start,end=historical_day_grid(date,resolution)
        rows=self.store.read(start,end)
        if self.store.gaps(start,end):
            raise PriceDataError('MISSING_INTERVAL',f'{date}: local AT price cache does not cover the full day. Prepare the date range or import SMARD CSV; no replacement prices were used.')
        result=map_strict_historical_day(date,resolution,rows)
        result['source']='; '.join(sorted({row['provenance']['attribution'] for row in rows}))
        result['providers']=sorted({row['provenance']['provider'] for row in rows})
        result['license']='CC BY 4.0'
        result['snapshot_hash']=hashlib.sha256(''.join(row['interval_hash'] for row in rows).encode()).hexdigest()
        result['source_intervals']=[dict(start_utc=row['timestamp_utc'].isoformat(),end_utc=row['end_timestamp_utc'].isoformat(),
            price_eur_mwh=row['price_eur_mwh'],interval_hash=row['interval_hash'],provenance=row['provenance']) for row in rows]
        from .market_prices import strict_range_prices
        mapped=strict_range_prices(start,end,resolution,rows,price_window_minutes)
        result.update({key:mapped[key] for key in ('prices','market_prices','timestamps','price_aggregation')})
        result['cache_only']=True
        return result

    def prepare(self,first,last,resolution=15,allow_fallback=False,refresh=False,notify=lambda value:None):
        errors=[];start_requests=self.requests
        with self.store.import_lock(lambda:notify(dict(phase='waiting',message='Waiting for another price import.'))):
            report=self.coverage(first,last,resolution)
            notify(dict(phase='coverage',message='Checking persistent local AT prices.',result=report))
            missing=report['missing_dates']
            if refresh: missing=report['complete_dates']+missing
            if not missing: return {**report,'external_requests':0,'errors':[],'conflicts':self.store.conflicts()}
            if self.client is None:
                with httpx.Client(follow_redirects=True) as client:
                    self.client=client
                    try: return self._prepare_blocks(first,last,resolution,missing,allow_fallback,refresh,notify,errors,start_requests)
                    finally:self.client=None
            return self._prepare_blocks(first,last,resolution,missing,allow_fallback,refresh,notify,errors,start_requests)

    def _prepare_blocks(self,first,last,resolution,missing,allow_fallback,refresh,notify,errors,start_requests):
        if first<'2018-10-01':errors.append(dict(code='UNSUPPORTED_MARKET_AREA_PERIOD',message='Separate AT bidding-zone prices start on 1 October 2018. DE-AT-LU is not substituted.'))
        gaps=[gap for date in missing for gap in ([historical_day_bounds(date)] if refresh else self.store.gaps(*historical_day_bounds(date)))]
        for name,seconds,left_bound,right_bound in [('hour',3600,dt.datetime(2018,9,30,22,tzinfo=UTC),SWITCH),('quarterhour',900,SWITCH,dt.datetime.max.replace(tzinfo=UTC))]:
            relevant=[(max(a,left_bound),min(b,right_bound)) for a,b in gaps if a<right_bound and b>left_bound]
            if not relevant: continue
            try:
                data=self._json(SMARD+f'index_{name}.json')
                stamps=data['timestamps']
                if not isinstance(stamps,list) or not stamps or any(type(t)!=int for t in stamps) or stamps!=sorted(set(stamps)):
                    raise PriceDataError('INVALID_RESPONSE','SMARD index schema changed or timestamps are not strictly ordered.')
                blocks=[]
                for i,stamp in enumerate(stamps):
                    a=dt.datetime.fromtimestamp(stamp/1000,UTC)
                    b=dt.datetime.fromtimestamp(stamps[i+1]/1000,UTC) if i+1<len(stamps) else a+dt.timedelta(days=8)
                    if any(x<b and y>a for x,y in relevant):blocks.append((stamp,a,b))
                for index,(stamp,a,b) in enumerate(blocks):
                    notify(dict(phase='smard',message=f'Loading SMARD {name} block {index+1}/{len(blocks)}.',completed_blocks=index,total_blocks=len(blocks)))
                    url=SMARD+f'4170_AT_{name}_{stamp}.json'
                    try:
                        payload=self._json(url);series=payload['series']
                        if not isinstance(series,list) or not series: raise PriceDataError('INVALID_RESPONSE','Empty SMARD block or changed response schema.')
                        rows=[];previous=None
                        meta=provenance('smard',url,seconds,source_version=payload.get('meta_data'))
                        for item in series:
                            if not isinstance(item,list) or len(item)!=2 or type(item[0])!=int or previous is not None and item[0]<=previous:
                                raise PriceDataError('INVALID_RESPONSE','Invalid or unordered SMARD series.')
                            previous=item[0];t=dt.datetime.fromtimestamp(item[0]/1000,UTC)
                            if t<a or t>=b or item[0]%(seconds*1000): raise PriceDataError('INVALID_RESPONSE','SMARD timestamps do not match source interval boundaries.')
                            if item[1] is None or t<left_bound or t>=right_bound:continue
                            if type(item[1]) not in (int,float) or not math.isfinite(item[1]): raise PriceDataError('INVALID_RESPONSE','Non-numeric SMARD price.')
                            rows.append(dict(timestamp_utc=t,end_timestamp_utc=t+dt.timedelta(seconds=seconds),price_eur_mwh=item[1],provenance=meta))
                        self.store.put(rows,refresh)
                    except (PriceDataError,KeyError,TypeError,OverflowError) as error:
                        errors.append(dict(code=getattr(error,'code','INVALID_RESPONSE'),message=str(error),source_url=url))
                    self.sleep(.05)
                    if index%4==3 or index+1==len(blocks):
                        notify(dict(phase='smard',message='Validated and stored SMARD source blocks.',completed_blocks=index+1,total_blocks=len(blocks),result=self.coverage(first,last,resolution)))
            except (PriceDataError,KeyError,TypeError,OverflowError) as error:
                errors.append(dict(code=getattr(error,'code','INVALID_RESPONSE'),message=str(error),source_url=SMARD+f'index_{name}.json'))
        report=self.coverage(first,last,resolution)
        if allow_fallback and report['missing_dates']:
            # Merge missing intervals before bounded access to the second technical path.
            gaps=sorted(gap for date in report['missing_dates'] for gap in self.store.gaps(*historical_day_bounds(date)))
            merged=[]
            for a,b in gaps:
                if merged and merged[-1][1]==a:merged[-1]=(merged[-1][0],b)
                else:merged.append((a,b))
            for a,b in merged:
                # Limit individual responses to 31 days, never one request per solver day.
                while a<b:
                    end=min(b,a+dt.timedelta(days=31))
                    notify(dict(phase='fallback',message=f'Loading missing intervals via Energy-Charts ({a.date()}–{end.date()}).'))
                    try:self._energy_charts(a,end)
                    except (PriceDataError,KeyError,TypeError) as error:errors.append(dict(code=getattr(error,'code','INVALID_RESPONSE'),message=str(error),source='Energy-Charts.info'))
                    a=end
        report=self.coverage(first,last,resolution)
        if report['missing_days']:errors.append(dict(code='MISSING_INTERVAL',message=f'{report["missing_days"]} supported local days remain incomplete. No synthetic prices generated.'))
        return {**report,'errors':errors,'conflicts':self.store.conflicts(),'external_requests':self.requests-start_requests}

    def _energy_charts(self,start,end):
        if start<AT_START:raise PriceDataError('UNSUPPORTED_MARKET_AREA_PERIOD','No substitution of historical DE-AT-LU prices for AT before 1 October 2018.')
        url='https://api.energy-charts.info/price'
        data=self._json(url,{'bzn':'AT','start':str(int(start.timestamp())),'end':str(int(end.timestamp()))},energy=True)
        if data.get('unit','').replace(' ','')!='EUR/MWh' or 'CC BY 4.0' not in data.get('license_info','') or ATTRIBUTION not in data.get('license_info','') or data.get('deprecated'):
            raise PriceDataError('INVALID_RESPONSE','Energy-Charts AT license, unit or endpoint version could not be verified.')
        timestamps,values=data['unix_seconds'],data['price']
        if len(timestamps)!=len(values) or not timestamps or timestamps!=sorted(set(timestamps)):
            raise PriceDataError('INVALID_RESPONSE','Invalid Energy-Charts series.')
        rows=[]
        for stamp,value in zip(timestamps,values):
            if type(stamp) not in (int,float) or value is not None and type(value) not in (int,float):
                raise PriceDataError('INVALID_RESPONSE','Non-numeric Energy-Charts timestamp or price.')
            t=dt.datetime.fromtimestamp(stamp,UTC);seconds=3600 if t<SWITCH else 900
            if t<start or t>=end or value is None:continue
            rows.append(dict(timestamp_utc=t,end_timestamp_utc=t+dt.timedelta(seconds=seconds),price_eur_mwh=value,
                provenance=provenance('energy_charts',str(httpx.URL(url,params={'bzn':'AT','start':int(start.timestamp()),'end':int(end.timestamp())})),seconds,license_info=data['license_info'])))
        self.store.put(rows)

    def import_csv(self,content,filename,timezone,refresh=False):
        # Timezone is an explicit form choice, never inferred from the filename.
        if timezone not in ('UTC','Europe/Vienna'):raise PriceDataError('INVALID_RESPONSE','Choose UTC or Europe/Vienna explicitly for CSV timestamps.')
        try:text=content.decode('utf-8-sig')
        except UnicodeDecodeError: text=content.decode('cp1252')
        reader=csv.DictReader(io.StringIO(text),delimiter=';');fields=reader.fieldnames or []
        starts=[x for x in fields if x.lower() in ('datum von','datum_anfang','start_utc')]
        ends=[x for x in fields if x.lower() in ('datum bis','datum_ende','end_utc')]
        prices=[x for x in fields if ('österreich' in x.lower() or x.lower().startswith('at ') or x=='market_price_eur_mwh') and ('€/mwh' in x.lower() or 'eur/mwh' in x.lower() or x=='market_price_eur_mwh')]
        if len(starts)!=1 or len(ends)!=1 or len(prices)!=1 or ('Original' not in prices[0] and prices[0]!='market_price_eur_mwh'):
            raise PriceDataError('INVALID_RESPONSE','Expected SMARD original-resolution CSV: Datum von;Datum bis;Österreich [€/MWh] Originalauflösungen. No averaged/other-zone columns accepted.')
        zone=pytz.timezone(timezone)
        def timestamp(value):
            try:parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
            except ValueError:
                parsed=None
                for fmt in ('%d.%m.%Y %H:%M','%d.%m.%Y %H:%M:%S'):
                    try:parsed=dt.datetime.strptime(value,fmt);break
                    except ValueError:pass
                if parsed is None:raise PriceDataError('INVALID_RESPONSE','Unrecognized CSV timestamp.')
            if parsed.tzinfo is None:
                try:parsed=zone.localize(parsed,is_dst=None)
                except (pytz.AmbiguousTimeError,pytz.NonExistentTimeError) as error:
                    raise PriceDataError('INVALID_RESPONSE','Ambiguous/nonexistent local CSV time. Use UTC or explicit ISO offsets for DST intervals.') from error
            return parsed.astimezone(UTC)
        rows=[];meta=provenance('smard_csv','file:'+filename,None,file_sha256=hashlib.sha256(content).hexdigest(),timestamp_interpretation=timezone)
        for row in reader:
            try:
                value=row[prices[0]].strip()
                if value in ('','-','–'):continue
                price=float(value.replace('.','').replace(',','.')) if ',' in value else float(value)
                a,b=timestamp(row[starts[0]].strip()),timestamp(row[ends[0]].strip())
                seconds=int((b-a).total_seconds())
                expected=3600 if a<SWITCH else 900
                if a<dt.datetime(2018,9,30,22,tzinfo=UTC) or seconds!=expected:
                    raise PriceDataError('INVALID_RESPONSE','CSV must contain AT original hourly/quarter-hourly market intervals, from 1 October 2018 onwards.')
                rows.append(dict(timestamp_utc=a,end_timestamp_utc=b,price_eur_mwh=price,provenance={**meta,'source_resolution_seconds':seconds}))
            except (ValueError,KeyError,TypeError) as error:
                if isinstance(error,PriceDataError):raise
                raise PriceDataError('INVALID_RESPONSE',f'Invalid CSV row {reader.line_num}.') from error
        if not rows: raise PriceDataError('INVALID_RESPONSE','CSV contains no usable AT prices.')
        with self.store.import_lock():report=self.store.put(rows,refresh)
        return {**report,'source':ATTRIBUTION,'license':'CC BY 4.0','rows':len(rows),'file_sha256':meta['file_sha256']}


class PricePreparationJobs:
    def __init__(self):
        self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='edopt-prices');self.lock=threading.Lock();self.jobs={}

    def start(self,options):
        with self.lock:
            if sum(job['status'] in ('queued','running') for job in self.jobs.values())>=4:raise PriceDataError('IMPORT_QUEUE_FULL','Price preparation queue is full.')
            for key in list(self.jobs):
                if len(self.jobs)<8:break
                if self.jobs[key]['status'] not in ('queued','running'):del self.jobs[key]
            key=uuid.uuid4().hex;self.jobs[key]=dict(status='queued',message='Waiting for price preparation.');self.pool.submit(self._run,key,options)
            return key

    def _run(self,key,options):
        def update(value):
            with self.lock:self.jobs[key].update(value)
        update(dict(status='running'))
        try:
            result=HistoricalPrices().prepare(**options,notify=update)
            update(dict(status='completed',result=result))
        except Exception as error:update(dict(status='failed',error=dict(code=getattr(error,'code','IMPORT_FAILED'),message=str(error))))

    def get(self,key):
        with self.lock:
            if key not in self.jobs:raise KeyError(key)
            return dict(self.jobs[key])
