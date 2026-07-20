import httpx
import pandas as pd
import numpy as np
import datetime as dt
from typing import List, Optional
from ..models import BESSConfig

class WeatherService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    async def get_temperature_profile(
        self, 
        latitude: float,
        longitude: float,
        reference_date: Optional[str],
        num_periods: int, 
        time_step_min: int,
        logs: Optional[List[str]] = None
    ) -> List[float]:
        """
        Fetches ambient temperature (2m) from Open-Meteo and maps it to the optimization horizon.
        Returns a flat 25°C profile as fallback if fetch fails.
        """
        def add_log(msg):
            if logs is not None:
                logs.append(f"[WeatherService] {msg}")

        if latitude is None or longitude is None:
            add_log("No location provided. Using fallback temperature (25°C).")
            return [25.0] * num_periods

        ref_date = reference_date or dt.date.today().isoformat()
        ref_date_obj = dt.date.fromisoformat(ref_date)
        duration_days = int(np.ceil((num_periods * time_step_min) / 1440))
        # Ensure we fetch at least enough data for the horizon
        end_date_obj = ref_date_obj + dt.timedelta(days=max(0, duration_days - 1))
        end_date = end_date_obj.isoformat()
        
        add_log(f"Fetching temperature for {latitude}, {longitude} ({ref_date} to {end_date})")
        
        try:
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "hourly": "temperature_2m",
                "start_date": ref_date,
                "end_date": end_date,
                "timezone": "auto"
            }

            async with httpx.AsyncClient() as client:
                response = await client.get(self.BASE_URL, params=params, timeout=10.0)
                response.raise_for_status()
                data = response.json()

            hourly_data = data.get("hourly", {}).get("temperature_2m", [])
            if not hourly_data:
                add_log("Warning: Open-Meteo returned no hourly temperature data. Using fallback 25°C.")
                return [25.0] * num_periods

            add_log(f"Successfully retrieved {len(hourly_data)} hourly temperature data points.")

            # Create a time series for interpolation
            times = pd.date_range(start=ref_date, periods=len(hourly_data), freq='h')
            df = pd.DataFrame({"temp": hourly_data}, index=times)

            # Interpolate to the required time steps
            target_index = pd.date_range(
                start=ref_date, 
                periods=num_periods, 
                freq=f'{time_step_min}min'
            )
            
            add_log(f"Interpolating to {num_periods} periods ({time_step_min} min intervals)...")
            df_interp = df.reindex(df.index.union(target_index)).interpolate(method='linear')
            df_final = df_interp.reindex(target_index)
            
            # Fill NaNs with cyclical/last-value fallback if horizon exceeds data
            if df_final["temp"].isna().any():
                add_log("Forecast horizon exceeds data. Applying day-one pattern fallback...")
                periods_per_day = int(1440 / time_step_min)
                first_day_pattern = df_final["temp"].iloc[:periods_per_day].values
                for i, val in enumerate(df_final["temp"]):
                    if np.isnan(val):
                        df_final.iloc[i, 0] = first_day_pattern[i % len(first_day_pattern)]

            return df_final["temp"].fillna(25.0).tolist()

        except Exception as e:
            add_log(f"Error fetching Open-Meteo temperature data: {e}. Using fallback 25°C.")
            return [25.0] * num_periods

    async def get_historical_temperature_profile(
        self,
        latitude: float,
        longitude: float,
        start_date: str,
        end_date: str,
        time_step_min: int
    ) -> List[float]:
        """
        Fetches historical ambient temperature from Open-Meteo Archive API.
        """
        start_dt = dt.datetime.fromisoformat(start_date)
        end_dt = dt.datetime.fromisoformat(end_date)
        days = (end_dt - start_dt).days + 1
        num_periods = int((days * 24 * 60) / time_step_min)

        archive_url = "https://archive-api.open-meteo.com/v1/archive"
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "temperature_2m",
            "start_date": start_date,
            "end_date": end_date,
            "timezone": "auto"
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(archive_url, params=params, timeout=120.0)
                response.raise_for_status()
                data = response.json()

            hourly_data = data.get("hourly", {}).get("temperature_2m", [])
            if not hourly_data:
                return []

            times = pd.date_range(start=start_date, periods=len(hourly_data), freq='h')
            df = pd.DataFrame({"temp": hourly_data}, index=times)

            target_index = pd.date_range(
                start=start_date, 
                periods=num_periods, 
                freq=f'{time_step_min}min'
            )
            
            df_interp = df.reindex(df.index.union(target_index)).interpolate(method='linear')
            df_final = df_interp.reindex(target_index)
            
            if df_final["temp"].isna().any():
                df_final["temp"] = df_final["temp"].fillna(25.0)

            return df_final["temp"].tolist()

        except Exception as e:
            print(f"Error fetching historical temperature data: {e}")
            return []

WeatherService = WeatherService()
