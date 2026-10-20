import React from 'react';
import ResultInfoCard from './ResultInfoCard';

export default function DailyCyclicSummary({results}) {
  if (results.long_term_mode!=='daily_cyclic') return null;
  const partial=results.run_status!=='completed';
  return <>
    {partial && <p className="card p-4 mb-4 text-warning" role="alert">Partial result only: {results.total_days} of {results.requested_days} days completed. The full date range did not succeed. Uncalculated days are not included in totals.</p>}
    <ResultInfoCard title="Daily Cyclic — repeated daily timetable" status={partial ? 'Partial' : 'Completed'} tone={partial ? 'warning' : 'success'} summary={`${results.total_days}/${results.requested_days} days completed · 24-hour solves · Europe/Vienna`}>
      <p className="result-info-note">{results.timetable_scope} Costs and energy include completed days only. Daily battery equality and inherited connector states were checked. Exact daily requests, prices and results are included in the analysis ZIP.</p>
      {results.daily_execution && <p className="result-info-note">Day workers: {results.daily_execution.used_workers}. {results.daily_execution.scope || ''} {results.daily_execution.fallback_reason ? `Serial fallback: ${results.daily_execution.fallback_reason}` : ''} {results.daily_execution.seed_date ? `Seed date: ${results.daily_execution.seed_date}. Necessary midnight connector states are fixed at both ends; other states remain free.` : ''}</p>}
      {partial && <p className="result-info-note">Charts concatenate completed dates without filling missing days. The date table and analysis ZIP identify the actual calendar dates.</p>}
      {(results.day_records || []).some(day=>day.continuity_scope==='independent_segment_after_failed_day') && <p className="result-info-note">After a failed date, coupled serial execution restarts as a separate segment from configured initial conditions. No physical connection transition across the missing date is proven.</p>}
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Date</th><th>Status</th><th className="numeric">Cost (EUR)</th><th className="numeric">Grid energy (kWh)</th></tr></thead><tbody>
        {(results.day_records || []).map(day=><tr key={day.date}><td>{day.date}</td><td>{day.status}{day.solver_status && <small className="result-info-subtext">{day.optimality_proven ? 'Cost optimum proven' : 'Feasible schedule; cost optimum not proven'}</small>}{day.error && <small className="result-info-subtext">{typeof day.error.detail === 'string' ? day.error.detail : JSON.stringify(day.error.detail)}</small>}</td><td className="numeric">{day.reconciliation?.cost_eur?.toFixed(2) ?? '—'}</td><td className="numeric">{day.reconciliation?.grid_energy_kwh?.toFixed(2) ?? '—'}</td></tr>)}
      </tbody></table></div>
    </ResultInfoCard>
  </>;
}
