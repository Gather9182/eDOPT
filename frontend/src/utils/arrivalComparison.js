// Zero cost is valid data. Missing/invalid data must never become a reference.
export function arrivalComparison(result) {
  const value = result?.baseline_cost_eur;
  const optimized = result?.total_cost_eur;
  const recorded = typeof value === 'number' && Number.isFinite(value);
  const optimizedRecorded = typeof optimized === 'number' && Number.isFinite(optimized);
  const heuristic = result?.status?.startsWith('Heuristic') === true;
  const comparable = result?.baseline_feasible === true && recorded && optimizedRecorded && !heuristic;
  const reason = result?.baseline_feasible === false ? 'Charge-on-arrival does not meet the operating conditions.'
    : result?.baseline_feasible !== true ? 'Charge-on-arrival feasibility was not recorded.'
    : !recorded ? 'Reference cost was not recorded.' : !optimizedRecorded ? 'Optimized cost was not recorded.'
    : heuristic ? 'A heuristic fallback is not a validated reference comparison.' : '';
  const savings = comparable && typeof optimized === 'number' && Number.isFinite(optimized) ? value - optimized : null;
  const step = result?.run_metadata?.request_inputs?.time_step_minutes ?? result?.run_metadata?.inputs?.time_step_minutes;
  const profile = result?.baseline_aggregated_load_profile;
  const energyComparable = comparable && Number.isFinite(step) && step > 0 && Array.isArray(profile)
    && profile.length > 0 && profile.every(v => typeof v === 'number' && Number.isFinite(v))
    && profile.length === result?.electricity_prices?.length;
  return {comparable, reason, cost:comparable ? value : null, diagnosticCost:recorded ? value : null, savings,
    percent:savings !== null && value > 0 ? savings / value * 100 : null,
    energyComparable, energyMwh:energyComparable ? profile.reduce((a,b) => a+b,0) * step / 60 / 1000 : null};
}
