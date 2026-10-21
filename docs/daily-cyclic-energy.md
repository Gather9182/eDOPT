# Daily Cyclic PV and stationary storage

Daily Cyclic supports baseline, PV, BESS and PV+BESS. Bus cyclic SoC, per-site constraints, switching/arrival rules, optional same-day visits and verified necessary midnight connector boundaries remain active. Independent day jobs are not a global annual optimum. Compare All and overnight optional visits are still blocked.

## Historical weather cache

`historical_weather.py` uses SQLite (WAL) at `backend/data/historical_weather.sqlite3`, configurable with `EDOPT_WEATHER_CACHE_PATH` for persistent deployment storage. A shared filesystem import lock prevents duplicate concurrent imports. Preparation runs in a bounded background job before the day-worker pool; individual day reads never fetch weather. A repeated complete range makes zero HTTP requests. Both source radiation and temperature are stored together; coverage requires radiation unless temperature is explicitly requested.

API: POST `/api/weather/prepare`, GET `/api/weather/prepare/{job_id}`, GET `/api/weather/coverage`, GET `/api/weather/day`. Coverage/day calls are cache-only. Preparation fetches missing UTC month blocks with bounded retries, rate-limit backoff and no forecast substitution. The selected source is pinned to Open-Meteo Archive ERA5 (default) or ECMWF IFS (explicit selection). ERA5 preparation is capped at UTC today minus five days; IFS may request through today. Missing hourly observations remain explicitly incomplete. HTTP request counts are not billable API-call estimates.

The raw cache key includes requested coordinates, provider and model. Observations retain original UTC timestamp, variable/unit, actual grid coordinates/elevation, source URL and query, retrieval time, attribution/license and content hash. Selected observations are stable until explicit refresh; changed responses are retained as revisions. Preparation records raw daily snapshot hashes. A day job detects an external refresh after preparation instead of silently mixing revisions; a recorded targeted retry can establish a new expected snapshot. The default path/deployment warning is shown in the collapsible weather panel. Changing PV capacity/performance ratio reuses raw weather.

Radiation labels represent the preceding hour. Radiation is mapped as duration-weighted interval means, preserving energy on the solver raster. Temperature point values can be interpolated only between present adjacent observations; null/missing observations are never synthesized. Zero night-time irradiance is valid data. Local Europe/Vienna DST dates keep the existing skip policy.

## PV model and units

Daily Cyclic uses `ghi-reference-v1`: average kW = installed capacity kWp * horizontal irradiance W/m² / 1000 * performance ratio (default 0.85, configurable). This is an explicitly approximate horizontal-irradiance proxy, not metered output or an orientation/shading/cell-temperature model. There is no selected-date-range peak normalization. A date has the same modeled profile regardless of whether one day or a year is prepared. Raw weather and model/version/capacity/ratio/hash are frozen in each daily request/result. A configured zero PV capacity produces explicit zero power without needing weather.

New `PVConfig.profile_kw` declares the power units explicitly. The existing `profile_kwh` field remains accepted as the old kW adapter outside this new path. Daily jobs supply full `profile_kw` arrays and reject missing/invalid PV profiles instead of invoking bell curves or network fallbacks. The UI displays the historical profile mode for Daily Cyclic; the old selector remains for existing Short-Term/Flexible behavior. Their legacy PV service is not silently replaced by this feature.

## Storage boundaries and accounting

Every independent day enforces BESS final energy = the same configured BESS initial energy. Bounds, efficiency, charge/discharge power and mutual exclusion remain active. This avoids consuming the initial stock anew on every date. It does not transfer surplus energy between dates. Failed/skipped dates do not receive invented storage trajectories.

Temperature-dependent BESS derating is explicitly blocked in Daily Cyclic. No setting is silently disabled. Daily results omit the illustrative cell/ambient temperature trajectory rather than presenting a daily reset as a continuous history; raw cached temperature observations remain available separately. Flexible retains its existing separate behavior; its legacy thermal model/temperature-input path is not redesigned here. Future thermal Daily Cyclic work must specify physically coherent thermal boundaries.

The extended solver now preserves its actual Optimal/Feasible status separately from per-bus healthy/warning flags; the former diagnostic overwrite could otherwise reject valid daily results and lose the optimality flag.

Daily reconciliation separates grid imports from bus charger input, checks source/charge power identities and BESS dynamics/bounds/start-end equality. Dynamics checks account for the exported four-decimal power rounding; hard start/end equality tolerance remains 0.001 kWh. Aggregated total_energy_mwh is grid-import energy, while total_bus_charging_energy_mwh is separate. Storage state arrays retain one shared boundary point per day, rather than duplicating every midnight sample.

Results display daily storage equality proofs and weather coverage. The analysis ZIP includes weather preparation, daily weather evidence and daily_bess_cycles.csv. Existing route CSV allocation consumes the recorded source profiles. Individual invalid observations are left uncached without discarding other valid days in the response. Missing required weather fails only that date; remaining dates continue and eligible pre-solver failures receive the existing one-pass targeted input retry. Cancellation during weather loading is normalized as cancellation and starts no solver; a shared cache preparation may still finish for later runs.

## Focused verification

- Mocked HTTP cache cold/warm reads, restart, PV capacity changes, interval placement, invariant day profiles, strict gaps and DST handling.
- Small CBC PV/BESS/PV+BESS cases: bus cyclic equality, grid energy and stationary-storage equality; no free daily initial storage energy.
- Parallel daily jobs with different PV profiles, separate grid/charger totals, invalid storage proof rejection, weather-gap continuation and baseline daily regression checks.

Official provider references: https://open-meteo.com/en/docs/historical-weather-api and https://open-meteo.com/en/terms .

## Recent archive dates and worker fallback diagnostics

Historical weather now explicitly selects `era5` (default, about five days delay) or `ecmwf_ifs` (IFS archive from 2017, no fixed five-day delay). Both use Open-Meteo Archive; no implicit model mixing/fallback occurs. Model selection is included in the raw cache identity, requests, daily evidence and snapshot hashes. Each model must be prepared separately. IFS can have incomplete recent/current-day hours; strict full-day coverage remains required. ERA5 cache entries are retained and reused when switching back. Missing-irradiance messages use human-readable Vienna timestamps and source/action hints, rather than raw epoch seconds. Before 2017 IFS remains incomplete rather than substituting another model.

The three running disclosure panels share the weather-card layout and white surface. A serial fallback displays the actual seed error (including backend details/status) and explains that a failed midnight-independence proof is a model restriction, distinct from the RAM/CPU/configuration host limit. The run is not forced into unsafe parallel execution.

The parallel seed template now includes only technologies active in the selected scenario, matching the day request. Previously, configurations retained by the UI for an inactive PV/BESS scenario could trigger `Daily physical inputs changed` before the seed solve and unnecessarily force serial execution. Stored user configurations are preserved, and active physical input and midnight-boundary checks remain enforced. A regression covers all four scenarios with both saved configurations and four concurrent jobs after the seed.
