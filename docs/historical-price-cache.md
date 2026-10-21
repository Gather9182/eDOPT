# Historical AT day-ahead prices

All modes now offer a shared source selector, saved as `meta.price_provider`:
SMARD/cache (default) or explicit aWATTar. Energy-Charts is an optional remaining-
gap path for SMARD, saved as `meta.price_energy_charts_fallback`. No solver model,
fleet selection, SoC rule, connector rule or user price markup was changed.
The selected price paths strictly reject incomplete horizons. Flexible no longer
pads/repeats missing market quotes; only its weather/PV padding remains unchanged.
The old low-level compatibility mapper remains available internally, but is no
longer used by the selected-source API paths. aWATTar transport failures now raise
explicit provider errors instead of returning an unexplained partial list.

Under Input Data / Electricity Pricing or Optimization Engine / Market price
source, select SMARD or aWATTar. Short-Term must load the selected source/date/
horizon/resolution before Run Check. Old data are not relabelled on a source
change. Continue to Settings also synchronizes a changed selection when a price
date was requested. Long-term modes fetch the selected source for their dates.
Source evidence is retained in `run/market_price_data.json` for Short-Term and
Flexible and per-day price files for Daily Cyclic.

Short-Term and Flexible still use a nominal 24-hours-per-day timetable. A horizon
touching a 23/25-hour DST date is explicitly rejected for either source; use
Daily Cyclic to omit those dates and produce marked partial totals. No synthetic
24-hour mapping is introduced. This is a remaining model/time limitation,
not a restriction on which provider can be selected. Future prices beyond the
publisher's available horizon are rejected as incomplete; neither provider is
guaranteed to cover arbitrary future dates. Explicit aWATTar does not inherit
SMARD's CC BY 4.0 attribution/license; its own terms are identified in evidence.

## Use

Select the Daily Cyclic dates. **Check price coverage** is local only.
**Load missing price data** imports needed SMARD blocks. Starting a simulation
also automatically performs this preparation before submitting solver jobs.
Partial coverage is explicitly shown as a partial evaluation; only complete
supported dates may reach a solver. A targeted retry re-prepares remaining gaps,
never downloads already complete intervals. DST exclusions remain exclusions.

Energy-Charts can optionally fill remaining gaps; it is disabled by default.
It is a second technical access path to SMARD, not independent raw data.
An explicit **Refresh source blocks** action refetches blocks and records new
versions/conflicts. No scheduled refresh silently changes validated history.
Frozen prices and interval hashes in old results do not change retrospectively.

## Persistence

Default: `backend/data/historical_prices.sqlite3`, excluded from Git. Set
`EDOPT_PRICE_CACHE_PATH` to an absolute persistent path for deployments. Startup
logs and coverage UI show the path and warn when no persistent-volume setting
was provided or a temporary directory was selected. A successful SQLite write
cannot prove deployment-volume persistence; deployment must configure it.

Example Docker mount: `-v edopt-prices:/data` and
`-e EDOPT_PRICE_CACHE_PATH=/data/historical_prices.sqlite3`.
Retain that volume across container replacement. Back up SQLite using its
backup API or while the backend is stopped; do not copy only the database file
while writes are active (WAL/SHM may contain committed data).
There is no in-memory fallback if the persistent database cannot be opened.

UTC interval bounds, raw EUR/MWh, original resolution, provider/source URL,
license, attribution, fetch time and available source version are stored.
Observations are immutable; a separate interval selection prevents overlaps.
Conflicting incoming observations are retained and diagnosed without averaging.
Selection priority is existing validated cache, then SMARD during import, then
Energy-Charts only for gaps. Explicit refresh may change selected observations.
Refresh will not implicitly split an existing differently sized source interval;
such conflicts remain recorded for review. Price markups/taxes are never cached.
Cross-process OS locks serialize imports into one configured database; WAL and
short transactions allow concurrent reads. The lock releases on process exit.

## Sources and verified formats

Live probes on 21 October 2026 confirmed both SMARD indexes and block schemas:
`https://www.smard.de/app/chart_data/4170/AT/index_hour.json` and
`index_quarterhour.json`, with `timestamps`; blocks contain `meta_data` and
`series: [[unix_milliseconds, price_or_null], ...]`.
Block boundaries are selected from the index; no arbitrary monthly URL is used.

Use original hourly intervals before 1 October 2025, quarter-hour intervals from
that Vienna delivery date onwards. Hourly SMARD data after that date are already
averaged and must not replace quarter-hour market prices. Individual nulls or
missing timestamps remain gaps. The final value of an interval is never carried
across a missing interval. The AT region begins on 1 October 2018; no DE-AT-LU
substitution is made for earlier dates (they remain unavailable).

Energy-Charts `/price?bzn=AT&start=<unix_seconds>&end=<unix_seconds>` was probed:
`unix_seconds`, `price`, `unit`, `license_info`, `deprecated`. AT license/unit
are checked explicitly. Requests are sequential, quota is persisted under the
import lock at one request per 31 seconds, and Retry-After extends the wait.
No public service is described as unlimited. Network attempts are bounded to
three with backoff. HTTP errors, timeouts, malformed data, genuine gaps and
price conflicts are separate diagnostics. Availability depends on the provider.

## CSV offline import

Upload a semicolon-delimited SMARD **AT original-resolution** download using:
`Datum von;Datum bis;Österreich [€/MWh] Originalauflösungen`.
`Datum_Anfang`/`Datum_Ende` are also accepted, as are canonical
`start_utc;end_utc;market_price_eur_mwh` columns. UTF-8/BOM and Windows-1252,
German decimal commas, negative values, ISO timestamps and German date/time
strings are supported. No price unit conversion is performed.

Choose **Europe/Vienna** for naive local CET/CEST timestamps, or **UTC** for
UTC timestamps. ISO offsets are respected. Ambiguous autumn local times and
nonexistent spring times are rejected rather than guessed: for such files,
provide explicit ISO UTC offsets/UTC interval bounds. Wrong region, averaged
columns, wrong units and non-original interval durations are rejected. The UI
does not automatically convert an official ambiguous-local-time CSV to UTC.
CSV rows undergo the same interval/provenance/overlap transaction as API rows;
the original file SHA-256 and timestamp interpretation are retained. Limit 30 MB.

## API and reproducibility

- GET `/api/prices/historical-coverage?first=...&last=...&resolution=15`
- POST `/api/prices/historical-prepare`: first/last/resolution,
  optional allow_fallback/refresh. Returns job_id; poll GET with `/job_id`.
- GET `/api/prices/historical-day?date=...&resolution_min=15`: **cache only**.
- POST `/api/prices/historical-smard-csv`: file and explicit timezone form fields.

Complete historical-day responses retain timestamps, market_prices, source and
coverage, plus provider/CC BY attribution, original UTC intervals/provenance,
interval hashes and a stable daily snapshot hash. Daily results/ZIP retain those
exact responses and preparation diagnostics. Existing markup calculation stays
in the shared solver-input builder. Cancelling simulation waiting does not
cancel a shared cache import needed by another run.

## Targeted verification

Fixed HTTP fixtures cover yearly block import, zero network on a repeated year
after store recreation, three separated holes, parallel reads/imports, hourly
and quarter-hour mapping, negative prices, DST, a real gap, rate limiting,
timeouts, CSV parity, conflicts and explicit refresh. Measured fixture counts:
first 2026 calendar year **54** requests; repeated year **0**; three non-adjacent
missing days **4** requests (index plus three relevant blocks).

Real SMARD check for 10 December 2025: **2** requests (index+block), followed by
**0** after service recreation. Cache-only daily read returned 96 prices,
starting 98.49, 103.01, 103.48, 99.17 EUR/MWh. This verifies the actual provider
adapter, not availability for every historical date. Only targeted cache and
Daily-Cyclic/export checks were run, not the entire optimization test suite.

Sources:
- https://www.smard.de/home/datennutzung — CC BY 4.0, attribution **Bundesnetzagentur | SMARD.de**.
- https://www.smard.de/home/downloadcenter/download-marktdaten
- https://www.smard.de/en/15-minute-wholesale-prices-available-218078 — original resolution transition.
- https://api.energy-charts.info/openapi.json — AT-specific CC BY 4.0/SMARD license,
  price semantics and dynamic rate limits (price 2/min, burst 2).

Limits: external schema changes or unavailable historical intervals remain
explicit errors; public endpoint availability is not guaranteed. CSV imports
with ambiguous local timestamps need unambiguous bounds as described above.
An HTTP response cannot prove that the upstream publisher never revises data;
frozen run snapshots and recorded hashes provide the local reproducibility proof.


### Selectable price averaging windows
Market price settings offer 15 (default), 30 and 60 minutes for all sources and simulation modes. Prices are duration-weighted spot-price means aligned to Europe/Vienna local midnight, then mapped to the existing solver grid. Markups apply afterward. For example, four quarter-hour quotes of 80, 100, 120 and 140 EUR/MWh become 110 EUR/MWh throughout that hour with the 60-minute option. This changes modeled costs and charging incentives; it is not decimal rounding or a solver time-step change. Missing intervals still fail strict coverage checks before averaging. Cached original intervals and their evidence/hash remain unchanged; exported price evidence records `price_aggregation` separately. Reload preview prices after changing the selection. Original hourly sources cannot acquire genuine quarter-hour variation by selecting 15 minutes.
