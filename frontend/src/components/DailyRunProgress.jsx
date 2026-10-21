import React from 'react';
import {dailyProgressSummary,dailyPhaseLabel,workerCapacityExplanation} from '../utils/dailyProgress';

export default function DailyRunProgress({statuses,telemetry={},execution}) {
  const summary=dailyProgressSummary(statuses);
  if (!summary.total) return null;
  const {requested=2,capacity=1,used_workers=1,mode,fallback_reason}=execution || {};
  const title=mode==='retry' ? 'Retrying failed price days' : mode==='seed' ? 'Preparing reference day' : mode==='fallback' ? 'Serial fallback' : used_workers>1 ? 'Parallel daily optimization' : 'Daily optimization';
  return <details className="daily-run-progress run-status-panel" aria-label="Daily optimization progress">
    <summary className="run-status-summary">
      <span className="run-status-title">{title}</span>
      <span className="run-status-overview">{summary.completed} / {summary.total} days completed · {summary.active} active{summary.failed>0 ? ` · ${summary.failed} failed` : ''}</span>
    </summary>
    <div className="run-status-body">
    <progress className="daily-run-completion" max={summary.total} value={summary.completed+summary.skipped+summary.failed+summary.cancelled} aria-label="Processed days" />
    <div className="daily-run-metrics">
      <div><span>Active jobs</span><strong>{summary.active} / {mode==='seed' ? 1 : used_workers}</strong></div>
      <div><span>Completed days</span><strong>{summary.completed}</strong></div>
      <div><span>Waiting days</span><strong>{summary.pending}</strong></div>
    </div>
    <p className="daily-run-capacity">Selected: <strong>{requested}</strong> · Host limit: <strong>{capacity}</strong> · Run limit: <strong>{used_workers}</strong></p>
    {requested>capacity && <p className="daily-run-notice">The selected {requested} jobs are limited to {capacity} by the backend worker pool. See the measured limits below.</p>}
    <details className="daily-run-note" open={requested>capacity}><summary>Worker capacity and measured limits</summary>
      {workerCapacityExplanation(execution?.capabilityReport).map((message,index)=><p key={index}>{message}</p>)}
      <p>Capacity is refreshed while idle before a new run. Active runs are not resized.</p>
    </details>
    {mode==='seed' && <p className="daily-run-note">One reference day runs first to verify midnight connections. Other dates start afterwards.</p>}
    {mode==='retry' && <p className="daily-run-note">Retry {execution.retry_completed || 0} / {execution.retry_total} processed. Fresh prices are requested sequentially after the first pass; completed days are retained.</p>}
    {fallback_reason && <p className="daily-run-notice">Serial execution: {fallback_reason}</p>}
    {(summary.failed>0 || summary.cancelled>0) && <p className="daily-run-notice">{summary.failed} failed · {summary.cancelled} cancelled. Completed days are retained.</p>}
    {summary.skipped>0 && <p className="daily-run-notice">{summary.skipped} daylight-saving transition day(s) skipped. Excluded from all totals; other dates continue normally.</p>}
    <div className="daily-run-table-scroll"><table className="daily-run-table"><thead><tr><th>Date</th><th>Status</th><th>Current step</th></tr></thead><tbody>
      {summary.rows.map(row=><tr key={row.date} className={['running','cancelling'].includes(row.status) ? 'is-active' : ''}>
        <td>{row.date}</td><td><span className={`daily-run-status is-${row.status}`}>{row.label}</span></td>
        <td>{['running','queued','cancelling'].includes(row.status) ? dailyPhaseLabel(telemetry[row.date]?.phase) : '—'}</td>
      </tr>)}
    </tbody></table></div>
    <p className="daily-run-note">Active jobs appear first. The bar counts processed dates, including skipped and failed dates; it is not the solver gap.</p>
    </div>
  </details>;
}
