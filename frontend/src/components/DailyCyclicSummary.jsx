import React from 'react';
import ResultInfoCard from './ResultInfoCard';

export default function DailyCyclicSummary({results}) {
  if (results.long_term_mode!=='daily_cyclic') return null;
  const partial=results.run_status!=='completed';
  return <>
    {partial && <p className="card p-4 mb-4 text-warning" role="alert">Partial result only: {results.total_days} of {results.requested_days} days completed. The full date range did not succeed. Uncalculated days are not included in totals.</p>}
    <ResultInfoCard title="Daily Cyclic — repeated daily timetable" status={partial ? 'Partial' : 'Completed'} tone={partial ? 'warning' : 'success'} summary={`${results.total_days}/${results.requested_days} days completed · 24-hour solves · Europe/Vienna`}>
      <p className="result-info-note">{results.timetable_scope} Costs and energy include completed days only. Daily battery equality and inherited connector states were checked. Exact daily requests, prices and results are included in the analysis ZIP.</p>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Date</th><th>Status</th><th className="numeric">Cost (EUR)</th><th className="numeric">Grid energy (kWh)</th></tr></thead><tbody>
        {(results.day_records || []).map(day=><tr key={day.date}><td>{day.date}</td><td>{day.status}{day.error && <small className="result-info-subtext">{typeof day.error.detail === 'string' ? day.error.detail : JSON.stringify(day.error.detail)}</small>}</td><td className="numeric">{day.reconciliation?.cost_eur?.toFixed(2) ?? '—'}</td><td className="numeric">{day.reconciliation?.grid_energy_kwh?.toFixed(2) ?? '—'}</td></tr>)}
      </tbody></table></div>
    </ResultInfoCard>
  </>;
}
