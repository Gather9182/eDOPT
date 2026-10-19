import httpx
import pandas as pd
import numpy as np
import datetime as dt
from typing import List, Optional
from ..models import PVConfig

class PVService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"
    ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

    async def get_profile(
        self, 
        config: PVConfig, 
        num_periods: int, 
        time_step_min: int,
        logs: Optional[List[str]] = None
    ) -> List[float]:
        """
        Fetches PV radiation data from Open-Meteo and maps it to the optimization horizon.
        Scales the radiation profile such that the daily peak corresponds to capacity_kw.
        Automatically selects between Archive API and Forecast API based on date range.
        """
        if config.profile_mode != "open_meteo" or config.latitude is None or config.longitude is None:
            return []

        def add_log(msg):
            if logs is not None:
                logs.append(f"[PVService] {msg}")

        ref_date = config.reference_date or dt.date.today().isoformat()
        ref_date_obj = dt.date.fromisoformat(ref_date)
        duration_days = int(np.ceil((num_periods * time_step_min) / 1440))
        end_date_obj = ref_date_obj + dt.timedelta(days=max(0, duration_days - 1))
        end_date = end_date_obj.isoformat()
        
        add_log(f"Fetching PV radiation for {config.latitude}, {config.longitude} ({ref_date} to {end_date})")
        
        # Decide endpoints order based on target date
        is_historical = end_date_obj < dt.date.today()
        endpoints = [self.ARCHIVE_URL, self.BASE_URL] if is_historical else [self.BASE_URL, self.ARCHIVE_URL]

        params = {
            "latitude": config.latitude,
            "longitude": config.longitude,
            "hourly": "shortwave_radiation",
            "start_date": ref_date,
            "end_date": end_date,
            "timezone": "auto"
        }

        hourly_data = []
        async with httpx.AsyncClient() as client:
            for url in endpoints:
                url_type = "Archive" if "archive" in url else "Forecast"
                try:
                    response = await client.get(url, params=params, timeout=15.0)
                    if response.status_code == 200:
                        data = response.json()
                        raw_data = data.get("hourly", {}).get("shortwave_radiation", [])
                        valid_points = [v for v in raw_data if v is not None]
                        if valid_points:
                            hourly_data = raw_data
                            add_log(f"Successfully retrieved {len(hourly_data)} hourly radiation data points via {url_type} API.")
                            break
                        else:
                            add_log(f"{url_type} API returned all-null values, attempting fallback...")
                    else:
                        add_log(f"{url_type} API returned status {response.status_code}, attempting fallback...")
                except Exception as e:
                    add_log(f"Error querying {url_type} API: {e}")

        if not hourly_data or all(v is None for v in hourly_data):
            add_log("Warning: Open-Meteo returned no valid hourly data. Falling back to default profile.")
            return []

        try:
            # Create a time series for interpolation
            times = pd.date_range(start=ref_date, periods=len(hourly_data), freq='h')
            df = pd.DataFrame({"radiation": hourly_data}, index=times)

            # Interpolate to the required time steps
            target_index = pd.date_range(
                start=ref_date, 
                periods=num_periods, 
                freq=f'{time_step_min}min'
            )
            
            add_log(f"Interpolating to {num_periods} periods ({time_step_min} min intervals)...")
            df_interp = df.reindex(df.index.union(target_index)).interpolate(method='linear')
            df_final = df_interp.reindex(target_index)
            
            if df_final["radiation"].isna().any():
                add_log("Forecast horizon exceeds data or has gaps. Applying cyclical day-one pattern fallback...")
                periods_per_day = int(1440 / time_step_min)
                first_day_pattern = df_final["radiation"].iloc[:periods_per_day].values
                for i, val in enumerate(df_final["radiation"]):
                    if np.isnan(val):
                        fallback_val = first_day_pattern[i % len(first_day_pattern)]
                        df_final.iloc[i, 0] = fallback_val if not np.isnan(fallback_val) else 0.0

            # Normalize: Global max radiation across all requested days mapped to capacity_kw
            max_rad = df_final["radiation"].max()
            if max_rad > 0:
                add_log(f"Normalization: Mapping peak radiation ({max_rad:.1f} W/m²) to PV capacity ({config.capacity_kw:.1f} kWp).")
                result_profile = (df_final["radiation"] / max_rad) * config.capacity_kw
            else:
                add_log("Note: Total radiation is zero. PV output set to zero.")
                result_profile = df_final["radiation"] * 0.0
            
            return result_profile.fillna(0.0).tolist()

        except Exception as e:
            add_log(f"Error processing Open-Meteo PV data: {e}")
            return []

    async def get_historical_profile(
        self,
        latitude: float,
        longitude: float,
        capacity_kw: float,
        start_date: str,
        end_date: str,
        time_step_min: int
    ) -> List[float]:
        """
        Fetches historical PV radiation data from Open-Meteo Archive API and maps it to the optimization horizon.
        """
        # Calculate total periods
        start_dt = dt.datetime.fromisoformat(start_date)
        end_dt = dt.datetime.fromisoformat(end_date)
        days = (end_dt - start_dt).days + 1
        num_periods = int((days * 24 * 60) / time_step_min)

        archive_url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "shortwave_radiation",
            "start_date": start_date,
            "end_date": end_date,
            "timezone": "auto"
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(archive_url, params=params, timeout=120.0)
                response.raise_for_status()
                data = response.json()

            hourly_data = data.get("hourly", {}).get("shortwave_radiation", [])
            if not hourly_data:
                return []

            # Create a time series for interpolation
            times = pd.date_range(start=start_date, periods=len(hourly_data), freq='h')
            df = pd.DataFrame({"radiation": hourly_data}, index=times)

            # Interpolate to the required time steps
            target_index = pd.date_range(
                start=start_date, 
                periods=num_periods, 
                freq=f'{time_step_min}min'
            )
            
            df_interp = df.reindex(df.index.union(target_index)).interpolate(method='linear')
            df_final = df_interp.reindex(target_index)
            
            if df_final["radiation"].isna().any():
                df_final["radiation"] = df_final["radiation"].fillna(0)

            # Normalize
            max_rad = df_final["radiation"].max()
            if max_rad > 0:
                result_profile = (df_final["radiation"] / max_rad) * capacity_kw
            else:
                result_profile = df_final["radiation"] * 0.0
            
            return result_profile.fillna(0.0).tolist()

        except Exception as e:
            print(f"Error fetching historical PV data: {e}")
            return []

PVService = PVService() # Singleton pattern similar to price_service potentially
