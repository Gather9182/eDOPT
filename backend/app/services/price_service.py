import httpx
import pandas as pd
import numpy as np
import datetime as dt
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import pytz
import math


def historical_day_bounds(date_str):
    day = dt.date.fromisoformat(date_str)
    zone = pytz.timezone('Europe/Vienna')
    start = zone.localize(dt.datetime.combine(day,dt.time())).astimezone(dt.timezone.utc)
    end = zone.localize(dt.datetime.combine(day+dt.timedelta(days=1),dt.time())).astimezone(dt.timezone.utc)
    return start,end


def historical_day_grid(date_str, resolution_min=15):
    if resolution_min < 1 or 1440 % resolution_min:
        raise ValueError('Historical comparison resolution must divide 1440 minutes exactly.')
    start,end = historical_day_bounds(date_str)
    if end-start != dt.timedelta(hours=24):
        raise ValueError(f'{date_str}: daylight-saving transition days (23/25 hours) are not supported by Daily Cyclic. No artificial 24-hour prices were generated.')
    return start,end


def historical_calendar(start_date,end_date,resolution_min=15):
    first,last = dt.date.fromisoformat(start_date),dt.date.fromisoformat(end_date)
    if last < first or (last-first).days > 3660:
        raise ValueError('Choose an ordered date range of at most 3661 days.')
    dates = [(first+dt.timedelta(days=i)).isoformat() for i in range((last-first).days+1)]
    # A calendar range is valid even if an individual date cannot be modelled.
    # Day-specific price errors belong to that day's record, not to Run Check.
    if resolution_min < 1 or 1440 % resolution_min:
        raise ValueError('Historical comparison resolution must divide 1440 minutes exactly.')
    return dates


def historical_calendar_exclusions(dates):
    exclusions=[]
    for date in dates:
        start,end=historical_day_bounds(date)
        hours=int((end-start).total_seconds()/3600)
        if hours != 24:
            exclusions.append(dict(date=date,code='DST_DAY_SKIPPED',local_day_hours=hours,
                reason=f'Daylight-saving transition ({hours}-hour local day in Europe/Vienna). Excluded from the 24-hour Daily Cyclic model and all totals; no replacement prices or results are generated.'))
    return exclusions


def map_strict_historical_day(date_str,resolution_min,raw_prices):
    start,end = historical_day_grid(date_str,resolution_min)
    intervals = []
    for entry in raw_prices:
        left,right = entry['timestamp_utc'],entry.get('end_timestamp_utc')
        price = float(entry['price_eur_mwh'])
        if not right or not left.tzinfo or not right.tzinfo or right <= left or not math.isfinite(price):
            raise ValueError(f'{date_str}: invalid historical source interval or price.')
        left,right = left.astimezone(dt.timezone.utc),right.astimezone(dt.timezone.utc)
        if right > start and left < end:
            intervals.append((max(left,start),min(right,end),price))
    intervals.sort(key=lambda item:item[0])
    cursor = start
    for left,right,_ in intervals:
        if left != cursor:
            raise ValueError(f'{date_str}: historical price gap, duplicate or overlapping interval at {cursor.isoformat()}. No fallback prices were used.')
        cursor = right
    if cursor != end:
        raise ValueError(f'{date_str}: historical prices do not cover the complete local day. No fallback prices were used.')
    prices,timestamps = [],[]
    step = dt.timedelta(minutes=resolution_min)
    zone = pytz.timezone('Europe/Vienna')
    for i in range(1440//resolution_min):
        left = start+i*step
        right = left+step
        price = sum(value*(min(right,b)-max(left,a)).total_seconds() for a,b,value in intervals if a < right and b > left)/step.total_seconds()
        prices.append(price)
        timestamps.append(left.astimezone(zone).isoformat())
    return dict(date=date_str,timezone='Europe/Vienna',resolution_min=resolution_min,
                timestamps=timestamps,market_prices=prices,source='aWATTar Austria',coverage='complete',
                source_intervals=[dict(start_utc=a.isoformat(),end_utc=b.isoformat(),price_eur_mwh=p) for a,b,p in intervals])

class PriceProvider(ABC):
    @abstractmethod
    async def fetch_prices(self, date_str: str, horizon_hours: int = 24) -> List[Dict[str, Any]]:
        """
        Fetches prices for a given date and horizon.
        Returns a list of dicts with 'timestamp_utc' and 'price_eur_mwh'.
        """
        pass

class AWattarProvider(PriceProvider):
    # Austrian market endpoint
    BASE_URL = "https://api.awattar.at/v1/marketdata"

    async def fetch_prices(self, date_str: str, horizon_hours: int = 24) -> List[Dict[str, Any]]:
        # date_str expected as YYYY-MM-DD
        vienna_tz = pytz.timezone("Europe/Vienna")
        naive_date = dt.datetime.strptime(date_str, "%Y-%m-%d")
        local_start = vienna_tz.localize(naive_date.replace(hour=0, minute=0, second=0))
        
        results = []
        # Fetch in 30-day chunks to avoid server limits and large payloads
        chunk_size_hours = 30 * 24
        processed_hours = 0
        
        async with httpx.AsyncClient() as client:
            while processed_hours < horizon_hours:
                current_chunk_hours = min(chunk_size_hours, horizon_hours - processed_hours)
                chunk_start = local_start + dt.timedelta(hours=processed_hours)
                chunk_end = chunk_start + dt.timedelta(hours=current_chunk_hours)
                
                start_ts = int(chunk_start.timestamp() * 1000)
                end_ts = int(chunk_end.timestamp() * 1000)
                
                params = {"start": start_ts, "end": end_ts}
                print(f"Fetching Price Chunk: {chunk_start.date()} to {chunk_end.date()} ({current_chunk_hours}h)")
                
                try:
                    response = await client.get(self.BASE_URL, params=params, timeout=60.0)
                    if response.status_code == 200:
                        data = response.json()
                        for item in data.get("data", []):
                            results.append({
                                "timestamp_utc": dt.datetime.fromtimestamp(item["start_timestamp"] / 1000, tz=dt.timezone.utc),
                                "end_timestamp_utc": dt.datetime.fromtimestamp(item["end_timestamp"] / 1000, tz=dt.timezone.utc),
                                "price_eur_mwh": float(item["marketprice"])
                            })
                    else:
                        print(f"aWATTar Error: Status {response.status_code} for chunk starting {chunk_start}")
                except Exception as e:
                    print(f"Chunk fetch error for {chunk_start}: {e}")
                    
                processed_hours += current_chunk_hours
        
        return results

class CSVPriceProvider(PriceProvider):
    async def fetch_prices_from_content(self, content: bytes) -> List[Dict[str, Any]]:
        # Simple CSV parsing: assumes columns 'timestamp' and 'price'
        df = pd.read_csv(pd.compat.StringIO(content.decode('utf-8')))
        # ... logic to parse CSV content ...
        # For now, let's keep it simple
        return []

    async def fetch_prices(self, date_str: str, horizon_hours: int = 24) -> List[Dict[str, Any]]:
        # This implementation requires a file, so it might be handled differently
        return []

class PriceService:
    def __init__(self, provider: PriceProvider = AWattarProvider()):
        self.provider = provider
        self.local_tz = pytz.timezone("Europe/Vienna")

    async def get_strict_historical_day(self,date_str,resolution_min=15):
        historical_day_grid(date_str,resolution_min)
        raw = await self.provider.fetch_prices(date_str,24)
        return map_strict_historical_day(date_str,resolution_min,raw)

    async def get_prices_for_optimization(
        self, 
        date_str: str, 
        horizon_hours: int = 24, 
        resolution_min: int = 15
    ) -> List[float]:
        """
        Fetches prices and maps them to the optimization resolution.
        """
        raw_prices = await self.provider.fetch_prices(date_str, horizon_hours)
        if not raw_prices:
            return []

        # Convert to local time and create a series
        # aWATTar usually gives 24 entries (hourly)
        df = pd.DataFrame(raw_prices)
        df['time_local'] = df['timestamp_utc'].dt.tz_convert(self.local_tz)
        
        # Sort by local time
        df = df.sort_values('time_local')

        # We need to map this to the planning horizon starting from 00:00 local time
        # Create the target time steps
        start_time = dt.datetime.strptime(date_str, "%Y-%m-%d")
        start_time = self.local_tz.localize(start_time.replace(hour=0, minute=0, second=0))
        
        target_steps = [start_time + dt.timedelta(minutes=i * resolution_min) 
                        for i in range(int(horizon_hours * 60 / resolution_min))]
        
        # Forward fill interpolation with Cyclical Fallback
        # If the API doesn't return enough days, we repeat the Day 1 pattern
        prices_mapped = []
        periods_per_day = int(1440 / resolution_min)
        
        for i, step in enumerate(target_steps):
            # Find the hourly price entry that covers this step
            match = df[df['time_local'] <= step].iloc[-1:]
            
            if not match.empty:
                entry_time = match['time_local'].iloc[0]
                # Check if the match is too old (e.g. from the previous day)
                # which indicates missing data for the current step's day
                if (step - entry_time).total_seconds() > 3600:
                    # Cyclical Fallback: Repeat price from same time on Day 1
                    if i >= periods_per_day:
                        prices_mapped.append(prices_mapped[i % periods_per_day])
                    else:
                        prices_mapped.append(float(match['price_eur_mwh'].values[0]))
                else:
                    prices_mapped.append(float(match['price_eur_mwh'].values[0]))
            else:
                # Fallback to the first available price or 0
                prices_mapped.append(float(df['price_eur_mwh'].iloc[0]) if not df.empty else 0.0)
                
        return prices_mapped

    async def get_raw_series(self, date_str: str, horizon_hours: int = 24) -> List[Dict[str, Any]]:
        raw_prices = await self.provider.fetch_prices(date_str, horizon_hours)
        # Format for UI display (chart)
        formatted = []
        for p in raw_prices:
            local_time = p['timestamp_utc'].astimezone(self.local_tz)
            formatted.append({
                "time": local_time.strftime("%H:%M"),
                "timestamp": int(local_time.timestamp() * 1000),
                "price": p['price_eur_mwh']
            })
        return formatted
