# Proposed Daily Cyclic PV/BESS extension

Status: Stage 1 and the non-thermal daily BESS cycle in Stage 2 are implemented. See daily-cyclic-energy.md for the delivered scope, validation and limitations. Thermal continuity and cross-day storage energy shifting remain out of scope. The original design follows for traceability.

## Existing blockers found in the repository

- Frontend dailyConfigurationIssues, daily request construction, aggregateDailyRun and backend OptimizationInputs currently restrict Daily Cyclic to baseline. Removing the selector restriction alone is insufficient.
- The extended MILP already has PV/BESS and site-local energy constraints, but no hard daily equality for stationary battery start/end energy. Bus cyclic equality does not cover BESS.
- verifyDailyResult currently compares charger energy with result.total_energy_mwh. Extended results use grid-import energy, which differs with PV/BESS. Energy accounting must separate bus charger input, grid import, PV use, storage charge/discharge and losses.
- PVService normalizes irradiance by the maximum in the requested date range. A day's production therefore changes when evaluated alone versus within a year. This must not be the new historical PV model.
- Weather/PV services build naive date indexes instead of preserving provider timestamps and silently interpolate/fill/repeat missing values. Strict historical runs must not inherit these fallbacks.
- BESS temperature derating fetches weather directly inside the solver. The frontend Flexible-mode ambient_temperature_profile currently is not declared on BESSConfig and is not read by that solver branch. Passing daily weather requires a declared, validated input and a cache-only solver path.
- The temperature capacity ceiling is estimated before solving without throughput heating; displayed temperatures are recomputed with solved power. Treating that as exact thermally continuous independent-day operation would be misleading.
- PVConfig.profile_kwh is consumed as a kW power profile in the extended MILP. New profile interfaces must state and validate units; any legacy adapter must be explicit.

## Stage 1: shared historical weather cache and PV-only Daily Cyclic

1. Add a persistent SQLite weather store using the established price-cache lifecycle (not its AT price-specific schema). Cache source/model, requested and actual grid-cell coordinates/elevation, variable, UTC observation/interval timestamps, original resolution, value/unit, query parameters, retrieval time, attribution and content hash. Preserve immutable run snapshots; explicit refresh records revisions.
2. Fetch only missing blocks before the day-worker pool starts. Radiation and temperature can share a preparation request when both are required. Use bounded requests, retries/backoff, cross-process import lock, a persistent deployment path and per-variable/date coverage. Cache data is read-only during solves. A second identical run makes no historical weather requests.
3. Preserve the provider's temporal semantics. Open-Meteo radiation means describe the preceding hour, while temperature is a point value. Map radiation intervals conservatively to the solver grid without creating sub-hourly observations. Document interpolation for temperature and require surrounding observations where needed. Store UTC; select supported local Europe/Vienna days. Existing DST day exclusions stay unchanged.
4. Derive a versioned PV power profile from irradiance using a fixed reference/model rather than selected-range normalization. Capacity, losses and any orientation inputs belong in the model fingerprint. An identical date/configuration must produce the same profile for a one-day and an annual request. Raw weather is reusable after changing PV capacity; only the derived profile changes. Clearly label it as modeled generation, not metered PV production.
5. Add scenarios baseline and PV to Daily Cyclic using the existing extended solver, fixed daily bus SoC and necessary verified connector boundaries. Supply complete daily PV inputs from prepared cache; no solver HTTP or hidden bell-curve/zero/day-repeat fallback. Other operating settings remain unchanged.
6. Extend reconciliation, result aggregation, daily progress, reference comparability, ZIP/XLSX and route exports for grid/PV energy and frozen weather/PV evidence. A missing required weather day is marked and excluded; other days continue. Retry follows existing targeted missing-price policy. A night-time radiation value of zero is valid, a null interval is missing.

## Stage 2: BESS and PV+BESS with independent daily storage cycles

- Require hard BESS end energy = configured BESS start energy for each solved day. Keep the same configured boundary across independent jobs; do not optimize a different starting inventory per day. Check the configured state against that day's usable capacity.
- Retain bus cyclic equality, connector proof, charging curves, switching rules, per-site energy supply, storage power limits and efficiency losses.
- This is independent daily cycling, not seasonal/multi-day energy shifting or a globally optimal annual storage schedule. Carrying storage energy from one day to the next belongs to sequential Flexible mode and cannot use independent daily workers.
- Initial release should support temperature derating OFF only. If it is enabled, block with an explicit explanation; do not switch it off silently. A later extension needs a coherent thermal boundary model (cyclic thermal state for repeated-day studies, or sequential inherited temperature for chronological studies), consistent capacity constraints and verified post-solve temperature. Do not reset cell temperature silently each midnight.
- Temperature data can already be cached in Stage 1, but no weather should be required for a BESS-only run without temperature effects.
- Failed/skipped days remain outside totals and comparisons. No storage trajectory across an excluded day is invented.

## Minimal acceptance checks

- Cold-cache fetch, repeat run with zero weather HTTP, capacity change reuses raw weather, a single missing block is fetched once before parallel solves.
- Same date/configuration gives identical PV profiles in short and annual requests, correct hourly interval placement and energy-preserving solver-grid conversion; gaps and DST exclusions are explicit.
- Small PV-only day reconciles bus charging versus grid/PV sourcing with correct site assignment.
- Small BESS day proves hard start/end equality and losses; two parallel days cannot reuse a free starting stock.
- Daily partial-result aggregation and route export source allocation include only successful dates. Existing baseline-only behavior remains unchanged.

Official reference: https://open-meteo.com/en/docs/historical-weather-api (historical reanalysis data; solar radiation averaged over the preceding hour; optional tilted irradiance inputs). Source/model identity and attribution must be preserved rather than describing these data as individual on-site measurements.
