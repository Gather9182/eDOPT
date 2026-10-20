"""Only midnight states required to make repeated-day connection models independent."""

def required_boundary_pairs(inputs):
    from .charging_sites import is_switch_blocked, slot_is_blocked
    pairs = []
    step = inputs.time_step_minutes
    for bus in inputs.buses:
        if any(visit.pause_start_min < step or visit.pause_end_min > 1440-step for visit in bus.opportunity_visits):
            raise ValueError(f'Route {bus.id}: optional visits affect midnight intervals; use serial Daily Cyclic.')
        for site in inputs.charging_sites:
            if slot_is_blocked(site,0,step) and not is_switch_blocked(site,0):
                raise ValueError(f'Location {site.id}: a switching boundary intersects the first interval; use serial Daily Cyclic.')
            present = bus.site_presence.get(site.id,bus.site_availability.get(site.id,[]))
            arrivals = bus.site_arrivals.get(site.id)
            arrival = arrivals[0] if arrivals else bool(present and present[0] and not present[-1])
            if not present or not present[0] or arrival or not is_switch_blocked(site,0):
                continue
            if not present[-1]:
                raise ValueError(f'Route {bus.id}: ambiguous midnight presence at {site.id}; use serial Daily Cyclic.')
            pairs.append((bus.id,site.id))
    return pairs


def validate_daily_boundary(inputs):
    if not inputs.daily_boundary_seed and not inputs.daily_connection_boundary:
        return set()
    pairs = set(required_boundary_pairs(inputs))
    if inputs.daily_connection_boundary:
        supplied = {(bus,site) for bus,sites in inputs.daily_connection_boundary.items() for site in sites}
        if supplied != pairs:
            raise ValueError('Fixed daily connection boundaries must cover exactly the necessary midnight states.')
    return pairs
