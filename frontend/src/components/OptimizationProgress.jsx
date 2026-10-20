import React, {useEffect, useState} from 'react';

const value = number => Number.isFinite(number) ? number.toLocaleString('en-GB',{maximumFractionDigits:3}) : 'Not reported yet';

export default function OptimizationProgress({state}) {
  const [now,setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()),1000);
    return () => clearInterval(timer);
  },[]);
  if (!state) return null;
  const metrics = state.metrics || {};
  const solving = ['minimizing_soc','minimizing_cost'].includes(state.phase);
  return <div className="optimization-live-panel">
    <div className="result-info-heading"><strong>Live optimization status</strong><span className={`result-info-status ${state.connection_warning ? 'is-warning' : 'is-success'}`}>{state.connection_warning ? 'Connection interrupted' : state.polled_at ? 'Backend connected' : 'Connecting...'}</span></div>
    <p role="status" className="text-sm">{state.message}</p>
    {state.polled_at && <p className="text-sm text-muted mt-2">Last backend response: {Math.max(0,Math.floor((now-state.polled_at)/1000))} s ago</p>}
    {state.connection_warning && <p className="text-sm text-warning mt-2">{state.connection_warning}</p>}
    <div className="result-info-metrics mt-3">
      <div><span>Current scenario / solver pass</span><strong>{state.scenario || 'Preparing'} / {state.solver_pass || '—'}</strong><small>{value(state.phase_seconds)} seconds in this phase</small></div>
      <div><span>Model size</span><strong>{Number.isFinite(state.variables) ? state.variables.toLocaleString('en-GB') : '—'} variables</strong><small>{Number.isFinite(state.constraints) ? state.constraints.toLocaleString('en-GB') : '—'} constraints</small></div>
      <div><span>Current solver time</span><strong>{Number.isFinite(state.solver_seconds) ? `${Math.floor(state.solver_seconds)} s` : '—'}</strong><small>{state.solver_time_limit_seconds ? `Budget: ${state.solver_time_limit_seconds} s per pass` : 'Waiting for solver'}</small></div>
    </div>
    {solving && <>
      <p className="text-sm mb-3"><strong>{Number.isFinite(metrics.incumbent) ? 'A feasible solution has been found for this solver pass.' : 'No integer-feasible solution has been reported for this solver pass yet.'}</strong></p>
      <div className="result-info-metrics">
        <div><span>Best feasible objective</span><strong>{value(metrics.incumbent)}</strong><small>{state.objective_label}</small></div>
        <div><span>Best objective bound</span><strong>{value(metrics.best_bound)}</strong><small>{Number.isFinite(metrics.nodes) ? `${metrics.nodes.toLocaleString('en-GB')} search nodes processed` : 'Preprocessing or searching'}</small></div>
        <div><span>Optimization gap</span><strong>{Number.isFinite(metrics.relative_gap_percent) ? `${value(metrics.relative_gap_percent)}%` : 'Not available yet'}</strong><small>Distance to the best bound, not completion progress</small></div>
      </div>
      <p className="result-info-note">A solution for the current pass is not the final result. Soft SoC settings may require a second pass. CBC log updates can arrive in batches.</p>
    </>}
    {state.last_solver_message && <div className="optimization-live-log"><span>Latest CBC message{Number.isFinite(state.seconds_since_solver_log) ? ` · received ${Math.floor(state.seconds_since_solver_log)} s ago` : ''}</span><code>{state.last_solver_message}</code></div>}
  </div>;
}
