# Arrivals during connector switching locks

A no-switch window prevents manual reassignment of connectors. It does not prohibit buses from arriving at the location.

- Arriving buses may connect if a connector is free, in both automatic balanced and optimized modes. This includes selected optional charging visits.
- Connected parked buses retain their connector until the lock ends, including when full or no longer drawing power. They cannot be unplugged to admit another bus.
- Timetable departures remain allowed and release the connector. Optional charging-trip departures keep their existing allowed-window and switching-lock rules. The arrival reference processes departures before new connections at the same boundary, independently of input bus order.
- A parked bus that was already waiting unconnected cannot swap into a connector during a lock without a new physical arrival event.
- Connector counts, site power/grid bounds, charging curves, SoC targets and automatic balanced power sharing remain active. A newly connected bus participates in the same balanced allocation.

The legacy `allow_connect_on_arrival` field is accepted for saved-project compatibility and normalized to true. Its former exception checkbox has been removed; arrivals are part of the normal rule. Existing no-switch windows and other site settings are preserved. Midnight continuity constraints remain active for buses continuously present without an arrival.
