# Flat-rate analysis and arrival comparison

Two mutually exclusive saved controls in Market price settings share one user-defined procurement price (EUR/kWh, non-negative):

- Use flat rate for the main analysis: every solver period receives the same base price converted to EUR/MWh, plus configured fees and VAT. A flat-rate run bypasses SMARD/aWATTar loading and price-coverage gating. All other constraints, scenario settings, optional charging trips, SoC limits, and end conditions remain active. A constant tariff removes time-of-day price incentives; it does not request a greedy arrival schedule or prove feasibility outside the configured assumptions. Charging schedules can be non-unique. PV and storage can still affect energy procurement costs.
- Also compare charge-on-arrival at the flat rate: the existing arrival schedule is valued at the effective fixed rate. It is not resimulated, does not replace the existing comparison, and does not change the main optimization prices. If arrival is not a validated feasible reference, its fixed-tariff cost and savings are unavailable.

Enabling the main flat-rate run turns off and disables the additional arrival flat-rate comparison. Previously saved configurations with both flags enabled use the main flat-rate mode without an extra comparison. The API rejects requests combining both modes. Results show the existing arrival reference and the additional fixed-tariff reference separately.

Flat rate always includes the configured fees and VAT, including when the market-price chart is set to spot-only mode. If no price assumptions have been saved, existing default fees are used. Disabled flat-rate controls leave existing solver prices and physical inputs untouched.

`price_mode`, `flat_rate_base_eur_kwh`, `flat_rate_effective_eur_mwh`, and optional `arrival_flat_rate_eur_mwh` are archived in solver requests. The backend validates that all periods of a flat-rate request use the declared prices. Result `price_assumption` records the main tariff; `flat_rate_comparison` records the additional reference, effective price, comparability and signed difference. A positive difference means the main analysis is cheaper. The difference includes tariff choice, charging strategy and selected PV/BESS technologies; it must not be interpreted as the isolated benefit of smart charging.

Results show the saved tariff and comparison in an initially collapsed card. Long-term totals aggregate completed days/chunks only and remain explicitly labelled as full-period totals in day views. Daily Cyclic retains existing DST exclusions. Flexible mode retains its existing horizon restrictions and weather inputs. Flat-rate generated nominal slots are labelled as model data, not observed historical prices. Original market cache data is never overwritten.

The complete analysis ZIP includes `run/flat_rate.json`, `tables/flat_rate_comparison.csv` when enabled, and exact saved requests/results. Changing current settings does not reprice saved results.
