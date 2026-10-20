import React from 'react';
import ResultInfoCard from './ResultInfoCard';
import {excludedDailyDates,dailyStatusLabel} from '../utils/dailyProgress';

export default function DailyCyclicSummary({results}) {
  if (results.long_term_mode!=='daily_cyclic') return null;
  const partial=results.run_status!=='completed';
  const excluded=excludedDailyDates(results);
  return <>
    {partial && <div className="card p-4 mb-4 text-warning" role="alert">
      <strong>Results for {results.total_days} of {results.requested_days} days</strong>
      <p>Excluded dates do not contribute to costs, energy, peaks or comparisons. No zero values replace missing results.</p>
      <div className="excluded-daily-dates">{excluded.map(day=><span key={day.date} className={`excluded-daily-date is-${day.status}`} title={typeof day.error?.detail==='string' ? day.error.detail : dailyStatusLabel(day.status)}>{day.date} · {dailyStatusLabel(day.status)}</span>)}</div>
    </div>}
    <ResultInfoCard title="Daily Cyclic — repeated daily timetable" status={partial ? 'Partial' : 'Completed'} tone={partial ? 'warning' : 'success'} summary={`${results.total_days}/${results.requested_days} days completed · 24-hour solves · Europe/Vienna`}>
      <p className="result-info-note">{results.timetable_scope} Costs and energy include completed days only. Daily battery equality and inherited connector states were checked. Exact daily requests, prices and results are included in the analysis ZIP.</p>
      {results.daily_execution && <p className="result-info-note">Day workers: {results.daily_execution.used_workers}. {results.daily_execution.scope || ''} {results.daily_execution.fallback_reason ? `Serial fallback: ${results.daily_execution.fallback_reason}` : ''} {results.daily_execution.seed_date ? `Seed date: ${results.daily_execution.seed_date}. Necessary midnight connector states are fixed at both ends; other states remain free.` : ''}</p>}
      {partial && <p className="result-info-note">Charts concatenate completed dates without filling missing days. The date table and analysis ZIP identify the actual calendar dates.</p>}
      {(results.day_records || []).some(day=>day.continuity_scope==='independent_segment_after_failed_day') && <p className="result-info-note">After a failed date, coupled serial execution restarts as a separate segment from configured initial conditions. No physical connection transition across the missing date is proven.</p>}
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Date</th><th>Status</th><th className="numeric">Cost (EUR)</th><th className="numeric">Grid energy (kWh)</th></tr></thead><tbody>
        {(results.day_records || []).map(day=><tr key={day.date} className={day.status==='completed' ? undefined : `excluded-daily-row is-${day.status}`}><td>{day.date}</td><td><span className={`daily-run-status is-${day.status}`}>{dailyStatusLabel(day.status)}</span>{day.solver_status && <small className="result-info-subtext">{day.optimality_proven ? 'Cost optimum proven' : 'Feasible schedule; cost optimum not proven'}</small>}{day.error && <small className="result-info-subtext">{typeof day.error.detail === 'string' ? day.error.detail : JSON.stringify(day.error.detail)}</small>}</td><td className="numeric">{day.status==='completed' ? day.reconciliation?.cost_eur?.toFixed(2) ?? '—' : 'Excluded'}</td><td className="numeric">{day.status==='completed' ? day.reconciliation?.grid_energy_kwh?.toFixed(2) ?? '—' : 'Excluded'}</td></tr>)}
      </tbody></table></div>
    </ResultInfoCard>
  </>;
}
