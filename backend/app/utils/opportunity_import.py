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
    required = ['haltestelle', 'ladestandort', 'hinweg', 'rückweg']
    if any(c not in columns for c in required):
        raise ValueError('Mapping Lademöglichkeiten: Haltestelle, Ladestandort, Hinweg und Rückweg sind erforderlich.')
    nodes = {}
    for node, desc in [('von', 'von (Beschreibung)'), ('nach', 'nach (Beschreibung)')]:
        if desc in timetable:
            for code, label in timetable[[node, desc]].dropna().itertuples(index=False, name=None):
                nodes.setdefault(normalized(label), set()).add(str(code))
    result = []
    for index, row in frame.iterrows():
        label = row[columns['haltestelle']]
        if pd.isna(label):
            continue
        def minutes(key):
            value = row[columns[key]]
            match = re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(?:min(?:uten)?)?', str(value).strip(), re.I)
            if not match:
                raise ValueError(f'Mapping Zeile {index+2}: ungültige Fahrzeit {value!r}. Minuten angeben.')
            return float(match[1].replace(',', '.'))
        out, back = minutes('hinweg'), minutes('rückweg')
        def km(key, duration):
            col = columns.get(key)
            value = row[col] if col else None
            if value is None or pd.isna(value):
                return 0 if duration == 0 else None
            value = float(str(value).replace(',', '.'))
            if not math.isfinite(value) or value < 0:
                raise ValueError(f'Mapping Zeile {index+2}: ungültige Distanz.')
            return value
        result.append(dict(id=f'mapping_{index+2}', stop_name=str(label).strip(),
                           nodes=sorted(nodes.get(normalized(label), set())), target_name=str(row[columns['ladestandort']]).strip(),
                           outbound_minutes=out, return_minutes=back,
                           outbound_km=km('hinweg (km)', out), return_km=km('rückweg (km)', back), enabled=True, site_id=''))
    return result


def opportunity_visits(df, buses, consumption, sites, config):
    output = {bus: [] for bus in buses}
    warnings = []
    if not config.get('enabled'):
        return output, warnings
    if not sites:
        raise ValueError('Zusätzliche Ladefahrten benötigen konfigurierte Ladeorte.')
    known = {site['id'] for site in sites}
    rows = config.get('mappings', [])
    by_node = {}
    for row in rows:
        row = dict(row)
        if not row.get('enabled', True):
            continue
        reason = None
        if not row.get('nodes'):
            reason = 'kein Fahrplanknoten zugeordnet'
        elif row.get('site_id') not in known:
            reason = 'kein gültiger Ladeort zugeordnet'
        elif row.get('outbound_minutes') is None or row.get('return_minutes') is None:
            reason = 'Fahrzeit für Hin- oder Rückfahrt fehlt'
        elif row.get('outbound_km') is None or row.get('return_km') is None:
            reason = 'Distanz für Hin- oder Rückfahrt fehlt'
        if reason:
            warnings.append(dict(type='OPPORTUNITY_MAPPING', message=f"{row.get('stop_name', row['id'])}: {reason}; Verbindung wird nicht verwendet."))
            continue
        for key in ('outbound_minutes', 'return_minutes', 'outbound_km', 'return_km'):
            if not math.isfinite(float(row[key])) or float(row[key]) < 0:
                raise ValueError(f"{row['id']}: {key} muss eine endliche, nichtnegative Zahl sein.")
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
                        raise ValueError('Mindestladezeit muss positiv, Zeitpuffer nichtnegativ sein.')
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
