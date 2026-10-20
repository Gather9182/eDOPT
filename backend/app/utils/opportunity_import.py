"""Read editable stop-to-charger mappings and derive optional, not mandatory, visits."""
import math
import re
import unicodedata
import pandas as pd


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())


def mapping_sheet(xl, timetable):
    sheet = next((s for s in xl.sheet_names if normalized(s) == normalized('Mapping Lademöglichkeiten')), None)
    if sheet is None:
        return []
    frame = xl.parse(sheet)
    columns = {normalized(c): c for c in frame.columns}
    def column(*names):
        return next((columns[normalized(name)] for name in names if normalized(name) in columns), None)

    code_col = column('Haltestellen Code', 'Haltestellencode', 'Haltestellen-Code')
    label_col = column('Haltestelle')
    target_col = column('Ladestandort')
    shared_time = column('Hinweg/Rückweg [min]', 'Hinweg/Rückweg (min)')
    out_time = column('Hinweg', 'Hinweg (min)', 'Hinweg [min]') or shared_time
    back_time = column('Rückweg', 'Rückweg (min)', 'Rückweg [min]') or shared_time
    shared_km = column('einfache Strecke [km]', 'einfache Strecke (km)')
    out_km = column('Hinweg (km)', 'Hinweg [km]') or shared_km
    back_km = column('Rückweg (km)', 'Rückweg [km]') or shared_km
    if not (code_col or label_col) or not target_col or not out_time or not back_time:
        raise ValueError('Charging mapping: A stop code or stop name, charging destination and travel times (Hinweg/Rückweg [min] or separate outbound/return columns) are required.')
    nodes = {}
    codes = {}
    for node, desc in [('von', 'von (Beschreibung)'), ('nach', 'nach (Beschreibung)')]:
        for code in timetable[node].dropna():
            codes.setdefault(normalized(code), set()).add(str(code))
        if desc in timetable:
            for code, label in timetable[[node, desc]].dropna().itertuples(index=False, name=None):
                nodes.setdefault(normalized(label), set()).add(str(code))
    result = []
    for index, row in frame.iterrows():
        label = row[label_col] if label_col else None
        code = row[code_col] if code_col else None
        if pd.isna(label) and pd.isna(code):
            continue
        label = str(label).strip() if pd.notna(label) else str(code).strip()
        source_code = str(code).strip() if pd.notna(code) else ''
        mapped_nodes = sorted(codes.get(normalized(source_code), set())) if code_col else sorted(nodes.get(normalized(label), set()))
        node_issue = ''
        if code_col and not mapped_nodes:
            node_issue = f'Stop code {source_code!r} does not occur in the selected timetable.' if source_code else 'Stop code is missing.'
        target = row[target_col]
        if pd.isna(target) or not str(target).strip():
            raise ValueError(f'Mapping row {index+2}: Charging destination is missing.')

        def minutes(col):
            value = row[col]
            match = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(?:min(?:uten)?)?', str(value).strip(), re.I)
            if not match:
                raise ValueError(f'Mapping row {index+2}: Invalid travel time {value!r}. Enter a duration in minutes.')
            return float(match[1].replace(',', '.'))
        out, back = minutes(out_time), minutes(back_time)
        def km(col, duration):
            value = row[col] if col else None
            if value is None or pd.isna(value):
                return 0 if duration == 0 else None
            match = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(?:km)?', str(value).strip(), re.I)
            if not match:
                raise ValueError(f'Mapping row {index+2}: Invalid distance.')
            distance = float(match[1].replace(',', '.'))
            if not math.isfinite(distance):
                raise ValueError(f'Mapping row {index+2}: Invalid distance.')
            return distance
        result.append(dict(id=f'mapping_{index+2}', stop_name=label, source_node_code=source_code, node_issue=node_issue,
                           nodes=mapped_nodes, target_name=str(target).strip(),
                           outbound_minutes=out, return_minutes=back,
                           outbound_km=km(out_km, out), return_km=km(back_km, back), enabled=True, site_id=''))
    return result


def opportunity_visits(df, buses, consumption, sites, config):
    output = {bus: [] for bus in buses}
    warnings = []
    if not config.get('enabled'):
        return output, warnings
    if not sites:
        raise ValueError('Additional charging trips require configured charging locations.')
    known = {site['id'] for site in sites}
    rows = config.get('mappings', [])
    by_node = {}
    for row in rows:
        row = dict(row)
        if not row.get('enabled', True):
            continue
        reason = None
        if not row.get('nodes'):
            reason = row.get('node_issue') or 'no timetable node assigned'
        elif row.get('site_id') not in known:
            reason = 'no valid charging location assigned'
        elif row.get('outbound_minutes') is None or row.get('return_minutes') is None:
            reason = 'outbound or return travel time is missing'
        elif row.get('outbound_km') is None or row.get('return_km') is None:
            reason = 'outbound or return distance is missing'
        if reason:
            warnings.append(dict(type='OPPORTUNITY_MAPPING', message=f"{row.get('stop_name', row['id'])}: {reason}; connection will not be used."))
            continue
        for key in ('outbound_minutes', 'return_minutes', 'outbound_km', 'return_km'):
            if not math.isfinite(float(row[key])) or float(row[key]) < 0:
                raise ValueError(f"{row['id']}: {key} must be a finite, non-negative number.")
            row[key] = float(row[key])
        for node in row['nodes']:
            by_node.setdefault(node, []).append(row)
    node_site = {node: site['id'] for site in sites for node in site.get('nodes', [])}
    for bus_id, group in df.groupby('Umlauf', sort=False):
        bus_id = str(bus_id)
        driving = group[(group.end_min > group.start_min) & ((group.Meter > 0) | (group['von'] != group['nach']))]
        trips = driving.sort_values(['start_min', 'end_min', '_source_order']).to_dict('records')
        if not trips:
            continue
        following = {**trips[0], 'start_min': trips[0]['start_min']+1440}
        for gap, (previous, following) in enumerate(zip(trips, trips[1:]+[following])):
            a, b = float(previous['end_min']), float(following['start_min'])
            if b <= a:
                continue
            for out in by_node.get(previous['nach'], []):
                for back in by_node.get(following['von'], []):
                    if out['site_id'] != back['site_id']:
                        continue
                    target = out['site_id']
                    if node_site.get(previous['nach']) == target == node_site.get(following['von']):
                        continue  # Already available directly; do not duplicate capacity.
                    minimum = float(out.get('min_charge_minutes') if out.get('min_charge_minutes') is not None else config.get('min_charge_minutes', 30))
                    buffer = float(out.get('buffer_minutes') if out.get('buffer_minutes') is not None else config.get('buffer_minutes', 0))
                    min_net = float(config.get('min_net_energy_kwh', 0))
                    min_power = float(config.get('min_charging_power_kw', 1))
                    if any(not math.isfinite(v) for v in [minimum,buffer,min_net,min_power]) or minimum <= 0 or buffer < 0 or min_net < 0 or min_power <= 0:
                        raise ValueError('Minimum charging duration and minimum charging power must be positive; time buffers and minimum net energy gain must be non-negative.')
                    if b-a < out['outbound_minutes']+back['return_minutes']+minimum+2*buffer:
                        continue
                    factor = consumption[bus_id]
                    output[bus_id].append(dict(id=f'{bus_id}_{gap}_{out["id"]}_{back["id"]}', gap_id=f'{bus_id}_{gap}',
                        site_id=target, origin_site_id=node_site.get(previous['nach']), return_site_id=node_site.get(following['von']),
                        from_node=previous['nach'], to_node=following['von'], pause_start_min=a, pause_end_min=b,
                        outbound_minutes=out['outbound_minutes'], return_minutes=back['return_minutes'], buffer_minutes=buffer,
                        outbound_km=out['outbound_km'], return_km=back['return_km'],
                        outbound_energy_kwh=out['outbound_km']*factor, return_energy_kwh=back['return_km']*factor,
                        min_charge_minutes=minimum, min_net_energy_kwh=min_net,
                        min_charging_power_kw=min_power,
                        allowed_windows=config.get('allowed_windows', [])))
    return output, warnings
