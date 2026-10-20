import React from 'react';
import {dailyProgressSummary,dailyPhaseLabel} from '../utils/dailyProgress';

export default function DailyRunProgress({statuses,telemetry={},execution}) {
  const summary=dailyProgressSummary(statuses);
  if (!summary.total) return null;
  const {requested=2,capacity=1,used_workers=1,mode,fallback_reason}=execution || {};
  const title=mode==='seed' ? 'Preparing reference day' : mode==='fallback' ? 'Serial fallback' : used_workers>1 ? 'Parallel daily optimization' : 'Daily optimization';
  return <section className="daily-run-progress" aria-label="Daily optimization progress">
    <div className="daily-run-heading"><h3>{title}</h3><span>{summary.completed} / {summary.total} days completed</span></div>
    <progress className="daily-run-completion" max={summary.total} value={summary.completed} aria-label="Completed days" />
    <div className="daily-run-metrics">
      <div><span>Active jobs</span><strong>{summary.active} / {mode==='seed' ? 1 : used_workers}</strong></div>
      <div><span>Completed days</span><strong>{summary.completed}</strong></div>
      <div><span>Waiting days</span><strong>{summary.pending}</strong></div>
    </div>
    <p className="daily-run-capacity">Selected: <strong>{requested}</strong> · Host limit: <strong>{capacity}</strong> · Run limit: <strong>{used_workers}</strong></p>
    {requested>capacity && <p className="daily-run-notice">The selected {requested} jobs are limited to {capacity} by backend capacity. CPU, available RAM or EDOPT_DAILY_WORKERS can lower this limit.</p>}
    {mode==='seed' && <p className="daily-run-note">One reference day runs first to verify midnight connections. Other dates start afterwards.</p>}
    {fallback_reason && <p className="daily-run-notice">Serial execution: {fallback_reason}</p>}
    {(summary.failed>0 || summary.cancelled>0) && <p className="daily-run-notice">{summary.failed} failed · {summary.cancelled} cancelled. Completed days are retained.</p>}
    <div className="daily-run-table-scroll"><table className="daily-run-table"><thead><tr><th>Date</th><th>Status</th><th>Current step</th></tr></thead><tbody>
      {summary.rows.map(row=><tr key={row.date} className={['running','cancelling'].includes(row.status) ? 'is-active' : ''}>
        <td>{row.date}</td><td><span className={`daily-run-status is-${row.status}`}>{row.label}</span></td>
        <td>{['running','queued','cancelling'].includes(row.status) ? dailyPhaseLabel(telemetry[row.date]?.phase) : '—'}</td>
      </tr>)}
    </tbody></table></div>
    <p className="daily-run-note">Active jobs appear first. Progress counts completed days, not the solver gap.</p>
  </section>;
}
