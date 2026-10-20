# Critical corrections and operating SoC limits

Implemented scope: distance import safeguards, reference comparison correctness,
export metadata, optional operating SoC limits, and optional cyclic bus SoC.
Default projects retain disabled operating limits and cyclic SoC. Dynamic
time-resolution displays, charging curves and preheating remain separate work packages.

## Start SoC = End SoC

`use_cyclic_soc` defaults to false. When true, each included bus has the hard
equality `SoC(T) = initial_soc_kwh`; its independent minimum end reserve still
holds. The UI switches Next-Day Readiness off and saves the setting. Direct API
requests enabling both modes are rejected. Disabling cyclic mode does not
silently re-enable readiness; the user can select the existing alternative.

Supported scope is one complete 24-hour Short-Term horizon with cyclic physical
connection boundaries. Price-period duration must total 1440 minutes. Multi-day
and rolling-horizon chunks are explicitly unsupported: the toggle is disabled
there, and while active it prevents switching to Long-Term or editing the horizon.
API requests with other horizons or noncyclic connection boundaries are rejected.
It assumes an identical daily timetable; it is not proof for a different next day.

Both MILPs, the necessary energy check, exact isolated route diagnoses, reference
strategy, and failure handling use the same mode. No heuristic may substitute for
an infeasible cycle. A failed grid-only comparison does not block a potentially
feasible cyclic PV/BESS scenario. BESS receives no new cyclic energy condition.

The reference strategy must satisfy equality too; otherwise savings remain n.a.
Results include `end_condition` with settings, each bus's start/end/target/delta,
compliance and a 0.001-kWh reporting tolerance (MILP equality itself is exact).
The result screen, analysis ZIP, Excel and print report identify the mode. ZIP
adds `run/end_condition.json` and `tables/bus_end_conditions.csv`; Excel adds
`End Condition Settings` and `Bus End Conditions`.

## Operating limits

API settings on `OptimizationInputs`:

- `operating_min_soc_mode`: `off` (default), `hard`, or `soft`.
- `operating_min_soc_fraction`: default 0.10, editable 0..1.
- `operating_max_soc_enabled`: false by default.
- `operating_max_soc_mode`: `soft` (default, including older requests) or `hard`.
- `operating_max_soc_fraction`: default 0.90, editable 0..1.

These are fleet-wide fractions of each individual bus battery capacity. They do
not replace the end reserve or Next-Day Readiness. A configured active minimum
above the preferred maximum is rejected. The UI saves changed operating limits
automatically. A settings change invalidates the previous Run Check; explicit
route exclusions remain visible and can be restored for reassessment.

Hard minimum is enforced at every modelled SoC boundary, including the initial
state. Hard maximum is enforced at the same boundaries, including the initial
state. An initial SoC or end target above a hard maximum is reported as invalid;
the model never silently raises the limit or deletes battery energy.
Soft minimum/maximum use nonnegative deviation variables at the same
boundaries. The first MILP minimises the sum of deviations in kWh multiplied by
the step duration in hours. Minimum and maximum deviations have equal energy
weight. Only after this minimum is proven does a second MILP minimise monetary
cost, constrained to the first optimum plus 1e-6 kWh-hours. Negative prices cannot
buy extra violation. Failure to prove the first objective returns an unresolved
failure; there is no cost-only or heuristic fallback with active limits.

The physical 0..capacity bounds never relax. Initial states outside a soft band
are permitted and reported; energy is never artificially deleted. Existing trip
energy timing remains unchanged, so these are discrete model-boundary guarantees,
not a new continuous vehicle simulation. Optional round-trip energy is included.

Results contain `soc_policy` with the criterion, minimum objective, tolerance,
active settings, and every boundary deviation with route, time and kWh. The ZIP
contains a dedicated JSON and CSV; XLSX adds settings and deviation sheets.
Long-term runs carry battery states forward and apply policy separately per
chunk. Their merged report explicitly does not claim a full-horizon optimum.
Two stages can increase solve time (up to the existing solver budget per stage).

## Reference strategy

No invented 115% reference or daily cost fallback remains. Missing or unvalidated
arrival references produce n.a. savings; a recorded zero cost remains zero, and
percentage savings are undefined for zero or negative reference cost. CO2
comparisons additionally require matching baseline profiles and recorded time
resolution. Raw baseline data remains available for diagnosis.

Arrival charging respects the preferred maximum. If it cannot meet the end
target without exceeding this cap, violates a hard minimum, or has greater soft
deviations than the proven minimum, it is an invalid comparison; this does not
invalidate the separately optimised charging plan. Unavoidable soft deviations
shared with the proven optimum do not automatically invalidate the reference.
The no-site arrival heuristic now checks un-clamped energy and final readiness.
Historical heuristic fallback results are not validated reference comparisons.

## Independent charging location limits

When `charging_sites` contains configured locations, each location's grid
connection, aggregate charger capacity, connector power and connector count
are enforced independently. Legacy `grid_limit_kw`, `charger_capacity_kw`
and `num_chargers` do not impose additional fleet-wide caps. This also applies
to a single explicitly configured location. Without configured locations,
the original single-depot limits remain active.

Both MILP formulations, energy prechecks, isolated route diagnostics and
arrival reference charging use this scope. PV and BESS remain tied to the
selected energy location; its net grid import (including storage charging)
is limited by that location's connection. They cannot supply other locations.
Inactive legacy controls are disabled in Input and Optimization settings.
Previous results are historical; rerun checks and optimization to apply this
change, and restore previously excluded routes to reassess them.

## Distance import

All existing unit modes remain selectable. Explicit unit suffixes are honoured;
unreadable, missing, negative or nonfinite distances are rejected with sheet,
row and route instead of becoming zero. Genuine zero-distance entries require
an explicit 0. Legacy decimal-comma text is interpreted consistently with the
displayed rule. Source values, row, sheet, rule and threshold survive in trips.

Small positive integer distances in legacy mode produce examples and require
explicit UI confirmation before Continue to Settings. The program does not infer
that every such number is wrong. A changed import is processed from the cached
original workbook and replaces profiles; previous exclusions are cleared.

Verification includes synthetic isolated solver cases, optional visits, negative
prices, invalid bands, hard/soft initial states, API validation, reference failure,
XLSX contents, and distance row provenance. Importing the provided updated IDU
workbook with mixed/50 retains 49 routes and 1,196 trips. This is an import check,
not a full fleet re-optimisation or a reproduction of the Postbus reference.
