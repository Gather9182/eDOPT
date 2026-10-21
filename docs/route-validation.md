# Route validation scope and exclusion evidence

Validation does not change the fleet, battery, SoC, site or solver settings.
`BUS_ENERGY_INFEASIBLE` proves failure of a necessary optimistic energy bound
under the **recorded current model assumptions**, not general real-world
undrivability. These bounds give a bus unconstrained competition-free charging
opportunities and relax switching restrictions/optional-trip energy costs.
Passing a bound is not a proof of a feasible isolated or joint MILP schedule.

Run Check now returns `route_energy_checks`, separating the driving/operating
minimum from the configured end condition (reserve, readiness or cyclic SoC).
Reasons distinguish `trip_energy_shortfall`, `final_energy_shortfall` and
`cyclic_soc_shortfall`; evidence retains the period, energy target and raw deficit.
With cyclic SoC enabled, a route can pass the driving-energy bound and still
fail to restore its initial battery energy. That is explicitly identified as
an end-condition issue. Reserve/initial-energy conflicts remain distinct.

`NO_CHARGING_AVAILABILITY` is a **warning**, with no feasibility proof.
Check assigned charging nodes, locations and layovers. The energy bound remains
unassessed for missing-mapping cases, preserving the previous conservative
behavior rather than automatically treating an absent mapping as a physical
route failure. The exact solver can still expose an infeasible configured model.

The energy-check tolerance is 0.001 kWh, shared with the existing cyclic result
diagnostic tolerance. Floating noise around that boundary is suppressed; an
actual 0.2 kWh gap remains an error. Deficits are displayed to three decimals.
No solver constraint or battery/SoC setting is relaxed. A tolerance-passed bound
is still not a solver feasibility certificate.

Exclusions require user action and store `meta.excluded_bus_reasons` alongside
the existing IDs. Cause groups distinguish proven optimistic energy shortfalls,
missing charging availability, exact current-model infeasibility, fleet conflict,
and manual/previously unrecorded reasons. An isolated MILP infeasibility alone is
not relabelled a purely energetic cause. Old exclusions without evidence stay
unspecified. Restore/recheck after changing assumptions. Results, route CSV and
analysis manifest retain the saved reasons, independently of current settings.

Targeted cases include the representative OGA2011-style **0.2 kWh** cyclic
shortfall, a driving-minimum shortfall, boundary floating noise and unchanged
inputs. This fixture does not claim to reproduce the user's exact OGA2011 run
without its saved request and original settings.
