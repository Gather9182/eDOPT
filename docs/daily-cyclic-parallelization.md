# Daily Cyclic: feasibility, implementation and measurement

Implemented 20 October 2026, based on
`CODEX_eDOPT_Daily_Cyclic_Parallelisierung.md`.

## Feasibility and physical boundaries

Parallel days are valid only when price changes are the only external changes
and the midnight connection state is repeatable. Daily battery equality alone
does not establish that independence.

The first date is solved as a seed with the current fleet and settings. For
each bus continuously present at a site through midnight, without an arrival
event and with switching prohibited at midnight, the seed additionally requires
equal first/last connector occupation. Its proven 0/1 occupation is fixed at
both ends of each subsequent independent day. Unlocked sites and other buses
are not arbitrarily fixed. Explicit initial connections remain authoritative.

This selects a physically feasible common boundary pattern, not a globally
optimal boundary across dates. Its selection can depend on the seed's prices.
Serial execution may choose different patterns and therefore different costs.
Cost comparisons must use identical boundary conditions.

Before each solve, technical inputs are compared with the frozen request;
only market/effective prices and the declared seed/fixed-boundary fields may
differ. Every result retains its own SoC, fleet, cost and energy checks. Results
are then checked in calendar order, including adjacent-day connections.

If a seed cannot prove the pattern, execution explicitly retries the original
serial mode and reports the reason and seed failure. Optional visits affecting
the first/last interval, ambiguous midnight presence or a switching boundary
inside the first interval also select serial mode. Visits crossing midnight
remain unsupported by Daily Cyclic as before. No configuration is silently
relaxed and no route is automatically removed.

## Worker and resource limits

The Daily Cyclic UI provides **Concurrent day jobs**, default 2, selectable 1–4.
One means the original serial orchestration. The server reports its capacity;
the UI uses the smaller of the selected and supported limits.

The dedicated daily thread executor starts independent CBC subprocesses. The
normal Short-Term/Flexible queue retains its single worker. A shared execution
semaphore also limits combined active model/solver jobs to the host capacity.
The daily queue holds at most eight queued/running/cancelling jobs; the normal
queue retains four. Active jobs are not overwritten or evicted.

The server ceiling defaults to 4; the UI still requests 2 by default.
`EDOPT_DAILY_WORKERS` can explicitly lower the ceiling to 1–4 **before starting
the backend**. Selecting four now uses four when host resources permit it. The detected CPU count and available RAM
can reduce the cap further; unavailable resource detection falls back to one.
The RAM estimate allows 2 GiB per slot. It is a conservative admission rule,
not a guarantee that arbitrarily large models fit into memory.

CBC internal worker threads are disabled with `threads=0`: each subprocess
solves serially; concurrency comes from the separate processes. ContextVars,
temporary files, solver logs and cancellation are isolated per job. Under
Windows, log cleanup uses the same lock as polling readers, preventing a file
sharing error from replacing a cancellation with a false solver failure.

## Results, cancellation and UI

The frontend runs a bounded pool only after the seed passes. Each date has its
own request capture, telemetry and error report. Checkpoint/manifest writes are
serialized and keyed by date; completion order does not determine result order.
UI progress uses one compact overview: completed days, active jobs, remaining
days, selected/host/run limits and dated phases. Active dates are listed first;
individual technical solver panels are omitted for Daily Cyclic.
No completion percentage is inferred from the CBC gap.

An individual day failure is recorded with its date, exact request, prices and
diagnostics; healthy siblings and later dates continue. Missing prices on the
first date allow the next valid date to become the seed. Only explicit user
cancellation stops scheduling and cancels active siblings. Completion is not
reported until all workers settle. Completed days are retained; failed,
cancelled and not-started dates remain distinct. The final summary lists every
failed date and its cause, and any error keeps the overall result partial.

In coupled serial fallback, a failed day has no proven end state. The next date
starts a new independent segment using the configured initial conditions,
explicitly marked in its record and the results. No connection transition
across a missing date is asserted. Settings and route exclusions are unchanged. The analysis ZIP includes the seed, fixed boundary,
execution mode, fallback evidence, every day request and result.

Partial results may contain gaps. Detailed chart profiles concatenate only
completed days in date order, with `completed_dates` and
`completed_day_indices` mapping those slots back to the calendar. The calendar
picker, Excel daily table and analysis CSVs retain actual dates/offsets. No
missing day is filled with invented zero loads or costs.

An additional correctness fix distinguishes a CBC integer-feasible incumbent
from a proven cost optimum: PuLP can label its main status `Optimal` even when
its solution status is only `IntegerFeasible`. Such results now say `Feasible`
and retain an unknown gap instead of fabricating 0%. A feasible seed remains a
valid independence proof; it is not advertised as a cost-optimality proof.
Soft-SoC stage 1 still requires a proven minimum before stage 2.

## Measurements and acceptance

Real HTTP job API, real CBC, controlled historical source intervals, three dates,
four buses, 15-minute resolution, charging curve enabled, hard 10–90% operating
SoC, optimized switching locks 22:00–05:00, four 150 kW connectors and a 600 kW
site/grid limit. Seed plus two independent dates, then the **same exact daily
requests** replayed serially on the same host. Checkpoints used an in-memory
no-op in this timing test; browser/IndexedDB and external network latency were
not measured.

| Measurement | Value |
|---|---:|
| Two-worker execution including seed | 0.8281603 s |
| Serial execution of identical requests | 1.0132594 s |
| Cost per date, both executions | EUR 5.70 / 6.20 / 6.70 |
| Peak concurrently alive CBC processes | 2 |
| Active CBC processes after completion | 0 |

This small-case measurement is about 18% faster, not a prediction for weeks or
months. A larger six-bus case reached its configured solve budget and produced
different feasible incumbent costs on replay; it is not used as evidence of
equal proven optima. Parallelization does not repair a single day's timeout.

A separate real API cancellation test observed both CBC processes alive before
cancellation, then two `cancelled` backend states and zero remaining processes.

Automated tests cover fixed occupied/unoccupied boundaries, preserved initial
connections, seed fallback, serial regression, physical-input invariance,
out-of-order completion, serialized checkpoints, failure/partial calendar gaps,
cancellation of both jobs, bounded worker/queue capacity, per-job context and
unproven optimality. Existing price/DST, SoC, charging curve, automatic charging,
Short-Term and Flexible tests remain part of the full regression suite.

Main code areas: `dailyCyclic.js`, `dailyBoundary.js`, `OptimizationRun.jsx`,
`optimization_progress.py`, `daily_boundary.py`, `charging_sites.py`,
`solver_diagnostics.py`, `solver.py`, result/export views and their tests.
