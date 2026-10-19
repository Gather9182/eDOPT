import pandas as pd
import numpy as np
import datetime as dt
import math
import re
from io import BytesIO
from typing import Dict, Any
from .excel_locations import location_profiles
from .opportunity_import import mapping_sheet, opportunity_visits

DEFAULT_SETTINGS = {
    "SHEET_NAME": "Tabelle1",
    "BETRIEBSTAGE": "Alle Mo-Fr",
    "PLANUNGSBEDINGUNG": "OSchule",
    "INCLUDE_BLANK_PLANUNGSBEDINGUNG": True,
    "DEPOT_NODES": {"OWELS_E", "OWELS_A"},
    "TIME_STEP_MIN": 15,
    "HORIZON_START_MIN": 0,
    "HORIZON_END_MIN": 1440,
    "ROUND_TO_30": False,

    "INITIAL_SOC_FRACTION": 1.0,
    "MIN_FINAL_SOC_FRACTION": 0.0,

    "VEHICLE_TYPE_SPECS": {},

    "DEFAULT_CONSUMPTION_WH_PER_M": 1.0,
    "DEFAULT_BATTERY_CAPACITY_KWH": 500.0,
    "DISTANCE_UNIT": "legacy",
    "MIXED_KM_THRESHOLD": 50.0,
    "CHARGING_SITES": [],
    "UMLAUF_VEHICLE_TYPES": {},
    "USE_FIRST_VEHICLE_TYPE": False,
    "OPPORTUNITY_CHARGING": {},
}

def to_minutes(val):
    if pd.isna(val):
        return np.nan
    if isinstance(val, dt.time):
        return val.hour * 60 + val.minute + val.second / 60
    if isinstance(val, pd.Timestamp):
        return val.hour * 60 + val.minute + val.second / 60

    if isinstance(val, (dt.timedelta, pd.Timedelta)):
        return val.total_seconds() / 60
    s = str(val).strip()
    match = re.fullmatch(r'(\d+):(\d{2})(?::(\d{2}))?(?:\[\+(\d+)\])?', s)
    if match:
        hours, minutes, seconds, days = (int(v or 0) for v in match.groups())
        if minutes < 60 and seconds < 60:
            return days * 1440 + hours * 60 + minutes + seconds / 60
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            t = dt.datetime.strptime(s, fmt).time()
            return t.hour * 60 + t.minute + t.second / 60
        except ValueError:
            continue
    return np.nan

def clean_distance(val, unit="legacy", mixed_km_threshold=50.0):
    if pd.isna(val) or val == "":
        return 0

    if unit != 'legacy':
        text = str(val).strip().lower().replace(' ', '')
        explicit = 'km' if text.endswith('km') else 'm' if text.endswith('m') else None
        text = text.removesuffix('km').removesuffix('m').replace(',', '.')
        try:
            number = float(text)
        except ValueError:
            raise ValueError(f'Invalid distance: {val!r}')
        if not math.isfinite(number) or number < 0:
            raise ValueError(f'Invalid distance: {val!r}')
        effective = explicit or unit
        if effective == 'mixed':
            if mixed_km_threshold <= 0:
                raise ValueError('The mixed-distance integer threshold must be positive.')
            effective = 'km' if not number.is_integer() or number < mixed_km_threshold else 'm'
        if effective not in ('km', 'm'):
            raise ValueError('Distance unit must be legacy, km, m, or mixed.')
        return int(round(number * (1000 if effective == 'km' else 1)))
    if isinstance(val, (int, float, np.number)):
        f_val = float(val)
        if f_val.is_integer():
            return int(f_val)
        return int(round(f_val * 1000))

    s = str(val).strip().lower()
    s = s.replace("m", "")
    s = s.replace(",", "")

    try:
        f_val = float(s)
        if f_val.is_integer():
            return int(f_val)
        return int(round(f_val * 1000))
    except (ValueError, TypeError):
        return 0

def normalize_vehicle_type(v):
    if pd.isna(v):
        return ""
    return str(v).strip()

def get_vehicle_type(row):
    vt = normalize_vehicle_type(row.get("Fahrzeugtyp", ""))
    vt_group = normalize_vehicle_type(row.get("Fahrzeugtypgruppe", ""))

    selected = vt if vt else vt_group

    mapping = {
        "GB": "NGB/LB12",
        "LB": "LB12",
    }
    return mapping.get(selected, selected)

def get_vehicle_specs(vehicle_type: str, settings: Dict[str, Any]):
    specs = settings.get("VEHICLE_TYPE_SPECS", {}) or {}

    if vehicle_type in specs:
        return specs[vehicle_type], False

    vt_clean = str(vehicle_type).strip().lower()
    for key, val in specs.items():
        if str(key).strip().lower() == vt_clean:
            return val, False

    return {
        "consumption_wh_per_m": settings["DEFAULT_CONSUMPTION_WH_PER_M"],
        "battery_capacity_kwh": settings["DEFAULT_BATTERY_CAPACITY_KWH"],
    }, True

def minutes_to_hhmm(minutes):
    if pd.isna(minutes):
        return ""
    h = int(minutes // 60) % 24
    m = int(minutes % 60)
    return f"{h:02d}:{m:02d}"

def build_time_grid(settings):
    time_steps = list(range(settings["HORIZON_START_MIN"], settings["HORIZON_END_MIN"], settings["TIME_STEP_MIN"]))
    time_labels = [minutes_to_hhmm(t) for t in time_steps]
    return time_steps, time_labels

def assign_trip_energy_to_bucket(start_min, horizon_start, horizon_end, step_min):
    horizon_len = horizon_end - horizon_start
    if horizon_len <= 0:
        raise ValueError("Invalid horizon length.")
    start_mod = (float(start_min) - horizon_start) % horizon_len
    return int(start_mod // step_min)

def filter_planungsbedingung(df: pd.DataFrame, settings: Dict[str, Any]) -> pd.DataFrame:
    target = settings["PLANUNGSBEDINGUNG"]
    include_blank = settings.get("INCLUDE_BLANK_PLANUNGSBEDINGUNG", True)

    days = settings['BETRIEBSTAGE']
    cond_bt = pd.Series(True, index=df.index) if days in (None, []) else df['Betriebstage'].isin(days if isinstance(days, list) else [days])

    if include_blank:
        cond_pb = (df["Planungsbedingung"] == target) | (df["Planungsbedingung"].isna()) | (df["Planungsbedingung"].astype(str).str.strip() == "")
    else:
        cond_pb = df["Planungsbedingung"] == target

    return df[cond_bt & cond_pb].copy()


def scan_umlauf_excel(content, sheet_name=None):
    xl = pd.ExcelFile(BytesIO(content))
    sheet_name = sheet_name or ('Tabelle1' if 'Tabelle1' in xl.sheet_names else xl.sheet_names[0])
    df = xl.parse(sheet_name)
    required = {'Umlauf', 'Typ', 'von', 'nach', 'Startzeit', 'Endzeit'}
    if not required.issubset(df.columns):
        raise ValueError(f'{sheet_name} is not a timetable. Select a sheet containing Umlauf, Typ, von, nach, Startzeit and Endzeit.')
    nodes = sorted(set(df['von'].dropna().astype(str)) | set(df['nach'].dropna().astype(str)))
    suggested = sorted(set(df.loc[df.Typ.eq('A'), 'nach'].dropna().astype(str)) | set(df.loc[df.Typ.eq('E'), 'von'].dropna().astype(str)))
    groups = {}
    for node in suggested:
        site_id = re.sub(r'_[AE]$', '', node)
        groups.setdefault(site_id, []).append(node)
    descriptions = {}
    for node_col, desc_col in [('von', 'von (Beschreibung)'), ('nach', 'nach (Beschreibung)')]:
        if desc_col in df:
            descriptions.update({str(r[node_col]): str(r[desc_col]) for _, r in df[[node_col, desc_col]].dropna().iterrows()})
    days = sorted(df['Betriebstage'].dropna().astype(str).unique()) if 'Betriebstage' in df else []
    return {
        'sheet_names': xl.sheet_names, 'selected_sheet': sheet_name,
        'operating_days': days,
        'suggested_operating_days': [] if re.search(r'Mo\s*-\s*Do', sheet_name, re.I) else ['Alle Mo-Fr'] if 'Alle Mo-Fr' in days else days,
        'suggested_depot_nodes': suggested, 'all_nodes': nodes,
        'node_descriptions': descriptions,
        'charging_mappings': mapping_sheet(xl, df),
        'suggested_sites': [{'id': key, 'name': re.sub(r'\s+[AE]$', '', descriptions.get(value[0], key)), 'nodes': value} for key, value in groups.items()],
        'vehicle_types': sorted(df.apply(get_vehicle_type, axis=1).unique().tolist()),
        'umlaeufe': [{'id': str(key), 'vehicle_types': [v for v in g.apply(get_vehicle_type, axis=1).unique().tolist() if v]} for key, g in df.groupby('Umlauf')],
    }

def process_umlauf_excel(file_content: bytes, settings: dict = None):
    s = {**DEFAULT_SETTINGS, **(settings or {})}
    if "DEPOT_NODES" in s:
        s["DEPOT_NODES"] = set(s["DEPOT_NODES"])

    xl = pd.ExcelFile(BytesIO(file_content))
    sheet_name = s['SHEET_NAME']
    if not settings or 'SHEET_NAME' not in settings:
        sheet_name = 'Tabelle1' if 'Tabelle1' in xl.sheet_names else xl.sheet_names[0]
    if (not settings or 'BETRIEBSTAGE' not in settings) and re.search(r'Mo\s*-\s*Do', sheet_name, re.I):
        s['BETRIEBSTAGE'] = []
    raw = xl.parse(sheet_name)
    raw = raw.copy()
    required = {'Umlauf', 'Betriebstage', 'Planungsbedingung', 'Typ', 'von', 'nach', 'Startzeit', 'Endzeit', 'Meter'}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f'Missing timetable columns in {sheet_name}: {", ".join(sorted(missing))}')
    if s['CHARGING_SITES']:
        raw['Umlauf'] = raw['Umlauf'].map(lambda value: str(value) if pd.notna(value) else np.nan)
    raw["_source_order"] = np.arange(len(raw))

    cols = [
        "Umlauf", "Dienste", "Linie", "Fahrtnummer",
        "Betriebstage", "Planungsbedingung", "Typ", "Fahrtart",
        "Fahrzeugtypgruppe", "Fahrzeugtyp", "Beschreibung",
        "von", "Startzeit", "von (Beschreibung)",
        "nach", "Endzeit", "nach (Beschreibung)",
        "Dauer", "Meter", "_source_order"
    ]
    for col in cols:
        if col not in raw.columns:
            raw[col] = np.nan

    df = raw[cols].copy()
    df = filter_planungsbedingung(df, s)
    if df.empty:
        raise ValueError('No timetable rows match the selected operating days and planning condition.')

    df["start_min"] = df["Startzeit"].apply(to_minutes)
    df["end_min"] = df["Endzeit"].apply(to_minutes)
    df["dur_min"] = df["Dauer"].apply(to_minutes)
    df["Meter"] = df["Meter"].apply(lambda value: clean_distance(value, s['DISTANCE_UNIT'], s['MIXED_KM_THRESHOLD']))

    mask = df["end_min"].isna() & df["start_min"].notna() & df["dur_min"].notna()
    df.loc[mask, "end_min"] = df.loc[mask, "start_min"] + df.loc[mask, "dur_min"]

    invalid = df[df['start_min'].isna() | df['end_min'].isna() | df['Umlauf'].isna()]
    if not invalid.empty:
        rows = [int(i) + 2 for i in invalid['_source_order']]
        raise ValueError(f'Invalid/missing times or Umlauf in Excel rows {rows[:20]}. No rows were silently removed.')
    overnight = df['end_min'] < df['start_min']
    df.loc[overnight, 'end_min'] += 1440

    df["vehicle_type"] = df.apply(get_vehicle_type, axis=1)
    if s['USE_FIRST_VEHICLE_TYPE']:
        # Resolve slash-separated alternatives per source entry, before looking
        # up consumption/capacity. Explicit per-Umlauf overrides take precedence.
        df['vehicle_type'] = df['vehicle_type'].map(lambda value: value.split('/', 1)[0].strip())
    vehicle_overrides = s['UMLAUF_VEHICLE_TYPES']
    df['vehicle_type'] = df.apply(lambda row: vehicle_overrides.get(str(row['Umlauf']), row['vehicle_type']), axis=1)

    consumptions = []
    capacities = []
    trip_energies = []
    fallback_flags = []

    for _, row in df.iterrows():
        vt = row["vehicle_type"]
        specs, is_fallback = get_vehicle_specs(vt, s)

        cons_wh_per_m = float(specs["consumption_wh_per_m"])
        cap_kwh = float(specs["battery_capacity_kwh"])
        trip_energy_kwh = (float(row["Meter"]) * cons_wh_per_m) / 1000.0

        consumptions.append(cons_wh_per_m)
        capacities.append(cap_kwh)
        trip_energies.append(trip_energy_kwh)
        fallback_flags.append(is_fallback)

    df["consumption_wh_per_m"] = consumptions
    df["battery_capacity_kwh"] = capacities
    df["trip_energy_kwh"] = trip_energies
    df["_vehicle_fallback"] = fallback_flags

    # IMPORTANT:
    # For route extraction, preserve original workbook order within each Umlauf.
    # This is what keeps the route aligned with the PDF.
    df = df.sort_values(["Umlauf", "_source_order"]).reset_index(drop=True)

    cleaned = df.copy()
    cleaned["start_hhmm"] = cleaned["start_min"].apply(minutes_to_hhmm)
    cleaned["end_hhmm"] = cleaned["end_min"].apply(minutes_to_hhmm)
    cleaned["trip_energy_kwh"] = cleaned["trip_energy_kwh"].round(6)

    validation_warnings = []
    if s['DISTANCE_UNIT'] == 'legacy':
        values = pd.to_numeric(raw['Meter'], errors='coerce')
        ambiguous = raw[(values > 0) & (values < 100) & (values % 1 == 0)]
        if len(ambiguous):
            validation_warnings.append({'type': 'DISTANCE_UNIT', 'message': f'{len(ambiguous)} small integer distances are interpreted as metres in legacy mode. Verify the selected distance rule (e.g. 21 means 21 m).'} )
    windows = []

    time_steps, time_labels = build_time_grid(s)
    umlaeufe = sorted(df["Umlauf"].dropna().unique())
    availability = pd.DataFrame(0, index=umlaeufe, columns=time_labels, dtype=int)
    trip_energy_matrix = pd.DataFrame(0.0, index=umlaeufe, columns=time_labels, dtype=float)

    bus_inputs = []
    detected_vehicle_types = []

    for umlauf, g in df.groupby("Umlauf", sort=False):
        # route-preserving order
        g_route = g.sort_values("_source_order").reset_index(drop=True)
        # chronological view for charging-window logic
        g_time = g.sort_values(["start_min", "end_min", "_source_order"]).reset_index(drop=True)

        # route overlap check in time view
        for i in range(len(g_time) - 1):
            if g_time.loc[i, "end_min"] > g_time.loc[i + 1, "start_min"]:
                overlap_min = g_time.loc[i, "end_min"] - g_time.loc[i + 1, "start_min"]
                validation_warnings.append({
                    "type": "OVERLAP",
                    "umlauf": umlauf,
                    "message": (
                        f"Umlauf {umlauf}: row {i} ends at {minutes_to_hhmm(g_time.loc[i, 'end_min'])} "
                        f"but next row starts at {minutes_to_hhmm(g_time.loc[i + 1, 'start_min'])} "
                        f"({overlap_min:.1f} min overlap)"
                    )
                })

        arrivals = g_time[(g_time["Typ"] == "A") & (g_time["nach"].isin(s["DEPOT_NODES"]))].copy()
        departures = g_time[(g_time["Typ"] == "E") & (g_time["von"].isin(s["DEPOT_NODES"]))].copy()

        if not departures.empty:
            first_dep_min = float(departures.iloc[0]["start_min"])
            if first_dep_min > s["HORIZON_START_MIN"]:
                w_start = s["HORIZON_START_MIN"]
                w_end = first_dep_min

                if s.get("ROUND_TO_30"):
                    w_start = math.ceil(w_start / 30) * 30
                    w_end = math.floor(w_end / 30) * 30

                if w_end > w_start:
                    windows.append({
                        "Umlauf": umlauf,
                        "window_start_min": w_start,
                        "window_end_min": w_end,
                        "window_start_hhmm": minutes_to_hhmm(w_start),
                        "window_end_hhmm": minutes_to_hhmm(w_end),
                        "duration_min": w_end - w_start
                    })

        for _, arr in arrivals.iterrows():
            arr_end = float(arr["end_min"])
            next_dep = departures[departures["start_min"] > arr_end].sort_values("start_min")

            if not next_dep.empty:
                dep = next_dep.iloc[0]
                w_start = arr_end
                w_end = float(dep["start_min"])
            else:
                w_start = arr_end
                w_end = s["HORIZON_END_MIN"]

            if s.get("ROUND_TO_30"):
                w_start = math.ceil(w_start / 30) * 30
                w_end = math.floor(w_end / 30) * 30

            if w_end > w_start:
                windows.append({
                    "Umlauf": umlauf,
                    "window_start_min": w_start,
                    "window_end_min": w_end,
                    "window_start_hhmm": minutes_to_hhmm(w_start),
                    "window_end_hhmm": minutes_to_hhmm(w_end),
                    "duration_min": w_end - w_start
                })

        for _, row in g_time.iterrows():
            trip_energy = float(row["trip_energy_kwh"])
            if trip_energy <= 0:
                continue

            idx = assign_trip_energy_to_bucket(
                row["start_min"],
                s["HORIZON_START_MIN"],
                s["HORIZON_END_MIN"],
                s["TIME_STEP_MIN"]
            )
            label = time_labels[idx]
            trip_energy_matrix.loc[umlauf, label] += trip_energy

        vt_counts = g_route["vehicle_type"].fillna("").astype(str).value_counts()
        umlauf_vehicle_type = vt_counts.index[0] if len(vt_counts) > 0 else ""
        umlauf_specs, is_fallback = get_vehicle_specs(umlauf_vehicle_type, s)

        if len(vt_counts) > 1:
            validation_warnings.append({
                "type": "MULTIPLE_VEHICLE_TYPES",
                "umlauf": umlauf,
                "message": f"Umlauf {umlauf} contains multiple vehicle type entries: {list(vt_counts.index)}"
            })

        battery_capacity_kwh = float(umlauf_specs["battery_capacity_kwh"])
        initial_soc_kwh = battery_capacity_kwh * float(s["INITIAL_SOC_FRACTION"])
        min_final_soc_kwh = battery_capacity_kwh * float(s["MIN_FINAL_SOC_FRACTION"])
        total_trip_energy_kwh = float(g_route["trip_energy_kwh"].sum())

        route_rows = []
        for _, trip in g_route.iterrows():
            is_tech = (float(trip["Meter"]) == 0) or (trip["Typ"] == "P") or (trip["start_min"] == trip["end_min"])

            route_rows.append({
                "source_order": int(trip["_source_order"]),
                "fahrtnummer": "" if pd.isna(trip["Fahrtnummer"]) else str(int(trip["Fahrtnummer"])) if float(trip["Fahrtnummer"]).is_integer() else str(trip["Fahrtnummer"]),
                "typ": trip["Typ"],
                "fahrtart": "" if pd.isna(trip["Fahrtart"]) else str(trip["Fahrtart"]),
                "is_technical": is_tech,
                "von": trip["von"],
                "von_desc": "" if pd.isna(trip["von (Beschreibung)"]) else str(trip["von (Beschreibung)"]),
                "start": minutes_to_hhmm(trip["start_min"]),
                "nach": trip["nach"],
                "nach_desc": "" if pd.isna(trip["nach (Beschreibung)"]) else str(trip["nach (Beschreibung)"]),
                "end": minutes_to_hhmm(trip["end_min"]),
                "start_min": float(trip['start_min']),
                "end_min": float(trip['end_min']),
                "dist_m": float(trip["Meter"]),
                "energy_kwh": float(trip["trip_energy_kwh"]),
                "planungsbedingung": "" if pd.isna(trip["Planungsbedingung"]) else str(trip["Planungsbedingung"]),
            })

        next_day_required_energy_kwh = 0.0
        temp_block_sum = 0.0
        depot_nodes = s["DEPOT_NODES"]

        for _, trip in g_route.iterrows():
            if trip["Typ"] == "A" and trip["nach"] in depot_nodes:
                temp_block_sum += float(trip["trip_energy_kwh"])
                next_day_required_energy_kwh = temp_block_sum
                break

            if trip["Typ"] == "E" and trip["von"] in depot_nodes:
                temp_block_sum = 0.0

            temp_block_sum += float(trip["trip_energy_kwh"])

        detected_vehicle_types.append({
            "Umlauf": umlauf,
            "vehicle_type": umlauf_vehicle_type,
            "consumption_wh_per_m": float(umlauf_specs["consumption_wh_per_m"]),
            "battery_capacity_kwh": battery_capacity_kwh
        })

        bus_inputs.append({
            "id": str(umlauf),
            "vehicle_type": umlauf_vehicle_type,
            "availability": [],
            "trip_energy_profile_kwh": [],
            "max_battery_capacity_kwh": battery_capacity_kwh,
            "initial_soc_kwh": initial_soc_kwh,
            "min_final_soc_kwh": min_final_soc_kwh,
            "next_day_required_energy_kwh": next_day_required_energy_kwh,
            "energy_demand_kwh": total_trip_energy_kwh,
            "trips": route_rows,
            "metadata": {
                "is_fallback_vehicle": is_fallback
            }
        })

    windows_df = pd.DataFrame(windows)
    if not windows_df.empty:
        windows_df = (
            windows_df
            .drop_duplicates(subset=["Umlauf", "window_start_min", "window_end_min"])
            .sort_values(["Umlauf", "window_start_min"])
            .reset_index(drop=True)
        )

    if not windows_df.empty:
        merged_rows = []
        for umlauf, g in windows_df.groupby("Umlauf", sort=False):
            current_windows = g.sort_values("window_start_min").to_dict(orient="records")

            if len(current_windows) > 1:
                first = current_windows[0]
                last = current_windows[-1]

                if (
                    last["window_end_min"] == s["HORIZON_END_MIN"]
                    and first["window_start_min"] == s["HORIZON_START_MIN"]
                ):
                    merged = {
                        "Umlauf": umlauf,
                        "window_start_min": last["window_start_min"],
                        "window_end_min": s["HORIZON_END_MIN"] + first["window_end_min"],
                        "window_start_hhmm": last["window_start_hhmm"],
                        "window_end_hhmm": first["window_end_hhmm"],
                        "duration_min": last["duration_min"] + first["duration_min"]
                    }
                    current_windows = current_windows[1:-1] + [merged]

            merged_rows.extend(current_windows)

        windows_df = (
            pd.DataFrame(merged_rows)
            .drop_duplicates(subset=["Umlauf", "window_start_min", "window_end_min"])
            .sort_values(["Umlauf", "window_start_min"])
            .reset_index(drop=True)
        )

    for _, row in windows_df.iterrows():
        umlauf = row["Umlauf"]
        w_start = row["window_start_min"]
        w_end = row["window_end_min"]

        for t, label in zip(time_steps, time_labels):
            midpoint = t + s["TIME_STEP_MIN"] / 2

            is_available = (
                (midpoint >= w_start and midpoint < w_end) or
                (midpoint + s["HORIZON_END_MIN"] >= w_start and midpoint + s["HORIZON_END_MIN"] < w_end) or
                (midpoint - s["HORIZON_END_MIN"] >= w_start and midpoint - s["HORIZON_END_MIN"] < w_end)
            )

            if is_available:
                availability.loc[umlauf, label] = 1

    # Ensure bus is not available during any trip (since it is driving)
    for umlauf, g in df.groupby("Umlauf", sort=False):
        for _, row in g.iterrows():
            t_start = row["start_min"]
            t_end = row["end_min"]
            if t_start < t_end:
                for t, label in zip(time_steps, time_labels):
                    midpoint = t + s["TIME_STEP_MIN"] / 2
                    is_during_trip = (
                        (midpoint >= t_start and midpoint < t_end) or
                        (midpoint + s["HORIZON_END_MIN"] >= t_start and midpoint + s["HORIZON_END_MIN"] < t_end) or
                        (midpoint - s["HORIZON_END_MIN"] >= t_start and midpoint - s["HORIZON_END_MIN"] < t_end)
                    )
                    if is_during_trip and row["Typ"] != "B":
                        availability.loc[umlauf, label] = 0

    bus_input_lookup = {b["id"]: b for b in bus_inputs}
    if s['CHARGING_SITES']:
        profiles, location_windows = location_profiles(df, s['CHARGING_SITES'], s)
        windows_df = pd.DataFrame(location_windows)
        for bus_id, profile in profiles.items():
            bus_input_lookup[bus_id].update(profile)
            bus_input_lookup[bus_id]['site_nodes'] = {site['id']: site['nodes'] for site in s['CHARGING_SITES']}
            availability.loc[bus_id] = [int(any(p[t] for p in profile['site_availability'].values())) for t in range(len(time_steps))]
        for bus_id, bus in bus_input_lookup.items():
            # Readiness ends at the first actual charging opportunity, not an
            # arbitrary depot marker that has no infrastructure.
            next_charge = next((t for t in range(len(time_steps)) if availability.loc[bus_id].iloc[t] and trip_energy_matrix.loc[bus_id].iloc[:t].sum() > 0), len(time_steps))
            bus['next_day_required_energy_kwh'] = float(trip_energy_matrix.loc[bus_id].iloc[:next_charge].sum())
    visit_config = s['OPPORTUNITY_CHARGING']
    visits, visit_warnings = opportunity_visits(df, bus_input_lookup,
        {str(v['Umlauf']): v['consumption_wh_per_m'] for v in detected_vehicle_types}, s['CHARGING_SITES'], visit_config)
    validation_warnings.extend(visit_warnings)
    for bus_id, options in visits.items():
        if options:
            bus_input_lookup[bus_id]['opportunity_visits'] = options
            # Reach a first optional charger with enough energy for its outbound leg.
            existing = bus_input_lookup[bus_id]['next_day_required_energy_kwh']
            requirements = [existing] if any(availability.loc[bus_id]) else []
            for option in options:
                first = option['pause_start_min']+option['buffer_minutes']+option['outbound_minutes']
                if first < s['HORIZON_END_MIN']:
                    stop = math.ceil(first/s['TIME_STEP_MIN'])
                    requirements.append(float(trip_energy_matrix.loc[bus_id].iloc[:stop].sum())+option['outbound_energy_kwh'])
            if requirements:
                bus_input_lookup[bus_id]['next_day_required_energy_kwh'] = min(requirements)
    for umlauf in availability.index:
        bus_id = str(umlauf)
        if bus_id in bus_input_lookup:
            bus_input_lookup[bus_id]["availability"] = availability.loc[umlauf].astype(int).tolist()
            bus_input_lookup[bus_id]["trip_energy_profile_kwh"] = trip_energy_matrix.loc[umlauf].astype(float).round(6).tolist()

    if bus_inputs:
        all_fallback = all(b.get("metadata", {}).get("is_fallback_vehicle") for b in bus_inputs)
        if all_fallback:
            validation_warnings.append({
                "type": "ALL_FALLBACK_CONFIG",
                "message": "All buses are using fallback values for battery capacity and consumption. Check vehicle type mapping."
            })

    return {
        "import_summary": {'sheet_name': sheet_name, 'source_rows': len(raw), 'imported_rows': len(df), 'excluded_rows': len(raw)-len(df), 'distance_unit': s['DISTANCE_UNIT']},
        "charging_sites": s['CHARGING_SITES'],
        "cleaned_trips": cleaned.fillna("").to_dict(orient="records"),
        "charging_windows": windows_df.fillna("").to_dict(orient="records") if not windows_df.empty else [],
        "availability_matrix": {
            "index": availability.index.tolist(),
            "columns": availability.columns.tolist(),
            "data": availability.values.tolist()
        },
        "trip_energy_matrix": {
            "index": trip_energy_matrix.index.tolist(),
            "columns": trip_energy_matrix.columns.tolist(),
            "data": trip_energy_matrix.round(6).values.tolist()
        },
        "detected_vehicle_types": detected_vehicle_types,
        "bus_inputs": list(bus_input_lookup.values()),
        "validation_results": {
            "status": "warning" if validation_warnings else "success",
            "warnings": validation_warnings
        }
    }
