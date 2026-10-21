"""Explicit price selection with strict coverage for nominal 24-hour models."""
import datetime as dt
import hashlib
import json
import math

from .price_service import AWattarProvider,historical_day_bounds,historical_day_grid,historical_calendar
from .historical_prices import HistoricalPrices
from .historical_price_store import PriceDataError,UTC


def strict_range_prices(start,end,resolution,raw,price_window_minutes=None):
    if price_window_minutes is not None and price_window_minutes not in (15,30,60):
        raise PriceDataError("INVALID_REQUEST","Price window must be 15, 30 or 60 minutes.")
    rows=[]
    for row in raw:
        a,b=row['timestamp_utc'],row.get('end_timestamp_utc')
        p=float(row['price_eur_mwh'])
        if not b or not a.tzinfo or not b.tzinfo or b<=a or not math.isfinite(p):
            raise PriceDataError('INVALID_RESPONSE','Invalid source price interval.')
        if a<end and b>start:rows.append({**row,'timestamp_utc':a.astimezone(UTC),'end_timestamp_utc':b.astimezone(UTC),'price_eur_mwh':p})
    rows.sort(key=lambda row:row['timestamp_utc']);cursor=start
    for row in rows:
        a,b=max(start,row['timestamp_utc']),min(end,row['end_timestamp_utc'])
        if a!=cursor:raise PriceDataError('MISSING_INTERVAL',f'Incomplete or overlapping market prices at {cursor.isoformat()}. No synthetic or repeated values were used.')
        cursor=b
    if cursor!=end:raise PriceDataError('MISSING_INTERVAL',f'Market prices do not cover the full requested horizon through {end.isoformat()}. Future day-ahead prices may not yet be published.')
    source_rows=rows
    if price_window_minutes is not None:
        averaged=strict_range_prices(start,end,price_window_minutes,rows)
        window=dt.timedelta(minutes=price_window_minutes)
        rows=[dict(timestamp_utc=dt.datetime.fromisoformat(timestamp),
                   end_timestamp_utc=min(end,dt.datetime.fromisoformat(timestamp)+window),price_eur_mwh=price)
              for timestamp,price in zip(averaged['timestamps'],averaged['prices'])]
    step=dt.timedelta(minutes=resolution);prices=[];timestamps=[];index=0;left=start
    while left<end:
        right=min(end,left+step)
        while rows[index]['end_timestamp_utc']<=left:index+=1
        k=index;weighted=0
        while k<len(rows) and rows[k]['timestamp_utc']<right:
            row=rows[k];seconds=(min(right,row['end_timestamp_utc'])-max(left,row['timestamp_utc'])).total_seconds()
            weighted+=row['price_eur_mwh']*seconds;k+=1
        prices.append(weighted/(right-left).total_seconds());timestamps.append(left.isoformat());left=right
    evidence=[dict(start_utc=row['timestamp_utc'].isoformat(),end_utc=row['end_timestamp_utc'].isoformat(),price_eur_mwh=row['price_eur_mwh'],
        provenance=row.get('provenance'),interval_hash=row.get('interval_hash')) for row in source_rows]
    fingerprint=hashlib.sha256(json.dumps(evidence,sort_keys=True).encode()).hexdigest()
    return dict(prices=prices,market_prices=prices,timestamps=timestamps,coverage='complete',unit='EUR/MWh',
        snapshot_hash=fingerprint,source_intervals=evidence,price_aggregation=dict(window_minutes=price_window_minutes,method='duration_weighted_mean',alignment='Europe/Vienna local midnight',solver_resolution_minutes=resolution))


async def selected_market_prices(date,hours=24,resolution=15,source='smard',provider=None,history=None,price_window_minutes=15):
    if source not in ('smard','awattar'):raise PriceDataError('INVALID_SOURCE','Choose smard or awattar explicitly.')
    if hours<1 or hours>3661*24 or resolution<1 or 1440%resolution or hours*60%resolution:
        raise PriceDataError('INVALID_REQUEST','Price horizon must fit the selected resolution and be at most 3661 days.')
    first=dt.date.fromisoformat(date);last=first+dt.timedelta(days=math.ceil(hours/24)-1)
    for day in historical_calendar(first.isoformat(),last.isoformat(),resolution):
        try:historical_day_grid(day,resolution)
        except ValueError as error:raise PriceDataError('DST_UNSUPPORTED_HORIZON',f'{day}: this Short-Term/Flexible horizon includes a 23/25-hour date. Use Daily Cyclic to skip DST dates explicitly; no artificial 24-hour profile is generated.') from error
    start=historical_day_bounds(date)[0];end=start+dt.timedelta(hours=hours)
    if source=='smard':
        raw=(history or HistoricalPrices()).store.read(start,end)
    else:
        raw=await (provider or AWattarProvider()).fetch_prices(date,hours)
        raw=[{**row,'provenance':dict(provider='awattar',source_url='https://api.awattar.at/v1/marketdata',market_area='AT',market='day_ahead',unit='EUR/MWh',
            license='aWATTar terms; not verified as CC BY 4.0',attribution='aWATTar Austria')} for row in raw]
    result=strict_range_prices(start,end,resolution,raw,price_window_minutes)
    result.update(date=date,selected_source=source,source='; '.join(sorted({row.get('provenance',{}).get('attribution','Unknown source') for row in raw if row['timestamp_utc']<end and row['end_timestamp_utc']>start})),
        providers=sorted({row.get('provenance',{}).get('provider','unknown') for row in raw}),
        license='CC BY 4.0' if source=='smard' else 'aWATTar terms; not verified as CC BY 4.0',cache_only=source=='smard')
    return result
