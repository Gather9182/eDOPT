"""Derive charging stays from fixed trips, including opportunity stops and next-day times."""
import math


def location_profiles(df, sites, settings):
    node_site = {}
    ids = [site['id'] for site in sites]
    if len(ids) != len(set(ids)):
        raise ValueError('Charging site IDs must be unique.')
    for site in sites:
        for node in site.get('nodes', []):
            if node in node_site:
                raise ValueError(f'Node {node} belongs to more than one charging location.')
            node_site[node] = site['id']
    start = settings['HORIZON_START_MIN']
    end = settings['HORIZON_END_MIN']
    step = settings['TIME_STEP_MIN']
    slots = list(range(start, end, step))
    output, windows = {}, []
    for umlauf, group in df.groupby('Umlauf', sort=False):
        # Every positive-duration movement blocks charging, including type B.
        driving = group[(group.end_min > group.start_min) & ((group.Meter > 0) | (group['von'] != group['nach']))]
        driving = driving.sort_values(['start_min', 'end_min', '_source_order'])
        trips = driving.to_dict('records')
        intervals = []
        if trips:
            pairs = list(zip(trips, trips[1:]))
            # A repeating operating day includes the actual late arrival, even
            # if it occurs after midnight. Never assume availability from 00:00.
            following = dict(trips[0])
            following['start_min'] += 1440
            pairs.append((trips[-1], following))
            for previous, following in pairs:
                site = node_site.get(previous['nach'])
                a, b = float(previous['end_min']), float(following['start_min'])
                if site and site == node_site.get(following['von']) and b > a:
                    intervals.append((site, a, b))
        available = {site_id: [0] * len(slots) for site_id in ids}
        presence = {site_id: [0] * len(slots) for site_id in ids}
        arrivals = {site_id: [0] * len(slots) for site_id in ids}
        for site, a, b in intervals:
            charge_a, charge_b = (math.ceil(a / 30) * 30, math.floor(b / 30) * 30) if settings.get('ROUND_TO_30') else (a, b)
            if charge_b > charge_a:
                windows.append({'Umlauf': umlauf, 'site_id': site,
                                'window_start_min': charge_a, 'window_end_min': charge_b,
                                'window_start_hhmm': f'{int(charge_a)//60%24:02d}:{int(charge_a)%60:02d}',
                                'window_end_hhmm': f'{int(charge_b)//60%24:02d}:{int(charge_b)%60:02d}',
                                'duration_min': charge_b-charge_a})
            for i, t in enumerate(slots):
                k0 = math.floor((t-b) / 1440)
                k1 = math.ceil((t+step-a) / 1440)
                for day in range(k0, k1+1):
                    x, y = a+day*1440, b+day*1440
                    if x < t+step and y > t:
                        presence[site][i] = 1
                    if charge_a+day*1440 <= t and t+step <= charge_b+day*1440:
                        available[site][i] = 1
                    if t <= x < t+step:
                        arrivals[site][i] = 1
        # Guard all periods against any overlapping movement. Presence may
        # remain in a boundary slot; power must be zero for the whole slot.
        for i, t in enumerate(slots):
            conflict = any(any(r['start_min']+day*1440 < t+step and r['end_min']+day*1440 > t
                               for day in range(math.floor((t-r['end_min'])/1440), math.ceil((t+step-r['start_min'])/1440)+1))
                           for r in trips)
            if conflict:
                for profile in available.values():
                    profile[i] = 0
        output[str(umlauf)] = {'site_availability': available, 'site_presence': presence, 'site_arrivals': arrivals}
    return output, windows
