import {arrivalComparison} from '../utils/arrivalComparison';
import React from 'react';
import ResultInfoCard from './ResultInfoCard';

const euros=value=>Number.isFinite(value) ? value.toLocaleString('en-IE',{style:'currency',currency:'EUR'}) : 'Unavailable';

export default function FlatRateResults({results}) {
  const fixed=results.price_assumption?.mode==='flat_rate';
  const comparison=results.flat_rate_comparison;
  if (!fixed && !comparison?.enabled) return null;
  const comparable=comparison?.comparable===true && Number.isFinite(comparison.baseline_cost_eur);
  const existing=arrivalComparison(results);
  const rate=fixed ? results.price_assumption : comparison;
  return <ResultInfoCard title="Flat-rate analysis and comparison" status={fixed ? 'Flat-rate main run' : 'Additional comparison'}
    summary={`${fixed ? 'Main run uses a constant tariff' : 'Main run uses market prices'}${comparison?.enabled ? ` · Charge-on-arrival flat rate: ${comparable ? euros(comparison.baseline_cost_eur) : 'reference unavailable'}` : ''}`}>
    <p className="result-info-note">{results.is_long_term ? 'Scope: all completed days in the saved analysis. Failed and skipped dates are excluded. These totals remain for the full evaluated period when viewing a single day.' : 'Scope: the saved simulation horizon.'}</p>
    <div className="result-info-metrics">
      <div><span>Base flat rate</span><strong>{rate.base_eur_kwh?.toFixed(4)} EUR/kWh</strong></div>
      <div><span>Including configured fees and taxes</span><strong>{(rate.effective_eur_mwh/1000).toFixed(4)} EUR/kWh</strong></div>
      <div><span>Main analysis cost</span><strong>{euros(results.total_cost_eur)}</strong></div>
      {comparison?.enabled && <><div><span>Existing charge-on-arrival (main tariff)</span><strong>{euros(existing.cost)}</strong></div>
      <div><span>Additional charge-on-arrival (flat rate)</span><strong>{comparable ? euros(comparison.baseline_cost_eur) : 'Unavailable'}</strong></div>
        <div><span>Difference versus main analysis</span><strong>{comparable ? euros(comparison.savings_eur) : 'Unavailable'}<small>Positive = main analysis costs less; negative = main analysis costs more.</small></strong></div></>}
    </div>
    {fixed && <p className="result-info-note">There is no time-of-day tariff incentive. All operating constraints and selected PV/BESS settings still apply. Equally valid schedules may charge at different times; this is a feasibility result under the configured model assumptions.</p>}
    {comparison?.enabled && <p className="result-info-note">{comparison.scope} The existing charge-on-arrival comparison remains unchanged. {comparable ? '' : comparison.reason}</p>}
  </ResultInfoCard>;
}
