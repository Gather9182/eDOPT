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

## Optional SoC-dependent charging curve

The curve defaults off for existing and new projects. Enable it in Optimization
settings. The common fleet curve has 1–8 contiguous SoC bands (0–100%), each
with a positive percentage of the connected location's `charger_power_kw`.
Defaults: 0–60%: 90%, 60–80%: 65%, 80–90%: 35%, 90–100%: 15%.
A 150 kW charger gives 135, 97.5, 52.5 and 22.5 kW before bus efficiency losses;
a 50 kW charger gives 45, 32.5, 17.5 and 7.5 kW. There is no common absolute
reference power. Without configured locations, the bus maximum power is the
reference. Lower bus and site limits are applied after the charger percentage.
The serialized basis is `site_charger_power`. Historical fixed-reference results
retain their original interpretation and are not relabelled; a new run is required.

Both MILPs enforce an exact piecewise cumulative charging-time function between
the start battery energy and the energy after charging. Crossing a band during
a time step consumes time in each crossed band; the start-of-step power is not
applied to the whole interval. Arbitrary positive band rates, including increases,
are supported. Bus, connector and aggregate location limits remain additional
constraints. The curve uses the lower of charger-band power and bus capacity;
it does not multiply a lower bus limit by the charger percentage again.
Shared site/grid power limits retain the existing interval-average semantics;
this is not a continuous simulation of simultaneous charger power within a slot.
Interval trip energy is deducted after charging, consistent with bus balances.
The battery must not exceed physical capacity before this deduction when enabled.

Arrival reference charging and optimistic energy prechecks integrate the same
curve. Exact route diagnoses inherit it; heuristic fallback cannot bypass it.
PV/BESS and additional charging visits also use this bus curve. Stationary BESS
charging is unchanged. Soft SoC limits cannot relax the charging curve.
Requests, saved results, diagnostics, result ZIP and XLSX include the curve.
Enabling it invalidates the current check and requires a new optimization;
historical results do not change. The extra MILP variables may increase runtime.

The compact formulation uses ordered band fill at the interval start. For
nonincreasing rates, cumulative charge time is convex: exact end-time supporting
lines replace all end-band binaries. Four bands need three internal-threshold
binaries instead of the earlier eight start/end segment binaries per eligible
interval. The fixed initial state needs none. Non-monotone curves retain an exact
ordered-fill end representation; constant effective rates need no band binaries.
No charging limit, time resolution or soft-SoC priority is relaxed.

A synthetic 30-bus/96-period/3-site model-build comparison reduced total variables
from 76,998 to 45,768 and curve binaries from 22,560 to 8,370. This measures model
size, not the solving time of a real user configuration. Existing two-stage soft
SoC optimization and solver budgets are unchanged. The UI shows elapsed time and
request activity; it no longer presents fixed workflow percentages as measured
solver progress or estimates a completion time from those percentages.

### Live progress

The UI submits an optimization job and polls its status once per second.
The job runs in a dedicated worker thread so blocking PuLP/CBC calculations do
not block the status endpoint. The existing `/api/optimize` endpoint remains
available for previous clients. Jobs are process-local: one active worker,
at most four active/queued jobs and bounded retained reports, expiring after
30 minutes when new jobs are submitted. A backend restart loses these jobs;
the client reports this explicitly and never silently resubmits a calculation.

Live evidence includes backend phases, scenario, solver pass, model size,
per-pass solver budget/elapsed time, and CBC-reported incumbent, best bound,
search nodes and relative gap when present. Metrics reset between solver passes.
Sentinel objectives do not count as feasible solutions. LP relaxation objectives
are not reported as integer-feasible solutions. Gap is relative objective
distance to the bound and is not completion progress. CBC file output may be
buffered: a lack of new log lines is not proof that computation stopped. Backend
response freshness and solver-log freshness are shown separately. Failed jobs
preserve the existing full diagnostics/export payload.

## Automatic charging during unattended locks

New/missing location mode defaults to `automatic_balanced`. During a lock,
arriving buses may connect to free charging points. Existing parked buses retain
their connectors, including after charging stops; manual switching is prohibited.
Scheduled timetable departures still release connectors. The initial unknown
parked fleet can be initialized as already connected; cyclic boundary constraints
and explicit initial connections remain enforced. See `charging-lock-arrivals.md`
for the updated arrival rule and legacy setting migration.

Already connected, chargeable buses use capped equal shares of maximum available
site power in each grid interval. A bus constrained by its SoC target, bus power
or integrated charging curve releases its unused share to the others. Hard
complementarity constraints enforce this independently of electricity prices;
there is no extra chronological series of optimization solves. Equality is in
interval-average kW, consistent with existing grid/curve discretization.

The stopping target is the operating maximum SoC, or physical 100% if disabled.
A soft maximum may be relaxed within the existing minimum-deviation-first policy
when required for feasibility. Cyclic equality and final reserves remain hard
requirements and are not silently relaxed to accommodate automatic charging.
At a PV/BESS site, available PV and storage supply buses before storage-charging
arbitrage can defer unattended bus charging. Site, connector, bus, grid and
storage constraints remain enforced. Exact curve saturation adds variables only
in automatic locked periods; the earlier compact formulation applies elsewhere.

The selectable `optimized` mode retains price-dependent power optimization.
Both modes use the same arrival/connector retention rule. UI and frozen solver
requests explicitly record the mode; ZIP and XLSX location settings include it.
Old saved results remain historical. The grid-only arrival reference uses the
same capped equal shares and connection rule for automatic locks.

## Independent location capacities

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
