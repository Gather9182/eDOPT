import React from 'react';
import { Download, Loader2 } from 'lucide-react';

export default function OptimizationFailurePanel({ diagnostic, message, onExport, isExporting, exportError, onExclude, excludableIds = [], isExcluding, activeBusCount = 0 }) {
  const backend = diagnostic?.result.diagnostics;
  const relaxation = backend?.energy_relaxation;
  const findings = relaxation?.findings || [];
  const step = diagnostic?.request?.time_step_minutes || 15;
  const clock = minute => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
  const classification = backend?.route_feasibility;
  const labels = {individually_infeasible:'Infeasible under current model',affected_by_fleet_conflict:'Affected by fleet conflict',
    feasible_in_isolation:'Feasible in isolation',not_determined:'Not determined'};
  const individualIds = (classification?.routes || []).filter(row => row.status === 'individually_infeasible' && excludableIds.includes(String(row.bus_id))).map(row => String(row.bus_id));
  return <section className="card mb-6" role="alert" style={{borderColor:'var(--warning)'}}>
    <div className="validation-panel-header">
      <div><h3 className="font-bold mb-2">{backend?.solver_status === 'Infeasible' || /infeasible/i.test(message) ? 'Optimization could not find a feasible charging schedule' : 'Optimization failed'}</h3>
        <p className="text-sm" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message}</p></div>
      <button className="btn btn-outline" onClick={onExport} disabled={!diagnostic || isExporting}>
        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {isExporting ? 'Preparing diagnostics…' : 'Export failed run (.zip)'}
      </button>
    </div>
    {diagnostic && <p className="text-sm text-muted mt-3">Failed attempt: {diagnostic.optimization_attempt.scenario || diagnostic.runtime_settings.scenario} · {diagnostic.checked_bus_ids.length} included routes · {diagnostic.project.meta?.excluded_bus_ids?.length || 0} excluded · {new Date(diagnostic.checked_at).toLocaleString()}{diagnostic.optimization_attempt.chunk_number ? ` · Chunk ${diagnostic.optimization_attempt.chunk_number}` : ''}.
      {' '}The export uses this attempt’s frozen configuration, exact request, route profiles and solver evidence, even after settings change.</p>}
    {classification && <details className="mt-4" open><summary>Individual route checks and fleet conflicts</summary>
      <p className="text-xs text-muted mt-2 mb-3">Each route is checked alone with the failed run’s settings, including switching restrictions and energy targets. A timeout stays “Not determined”. These checks do not adopt the assumptions or daily-cycle proof of an external workbook.</p>
      {individualIds.length > 0 && <button className="btn btn-outline mb-3" disabled={isExcluding || individualIds.length >= activeBusCount} onClick={() => onExclude?.(individualIds)}>Exclude individually infeasible routes and recheck ({individualIds.length})</button>}
      <div style={{maxHeight:360,overflow:'auto'}}><table className="data-table"><thead><tr><th>Route</th><th>Classification</th><th>Evidence</th><th></th></tr></thead><tbody>
        {[...(classification.routes || [])].sort((a,b) => Number(b.diagnostic_candidate || b.status === 'individually_infeasible')-Number(a.diagnostic_candidate || a.status === 'individually_infeasible')).map(row => <tr key={row.bus_id}>
          <td>{row.bus_id}{row.diagnostic_candidate && <div className="text-xs text-muted">Diagnostic shortfall candidate</div>}</td>
          <td><span className={`badge ${row.status === 'individually_infeasible' ? 'badge-error' : row.status === 'affected_by_fleet_conflict' ? 'badge-warning' : row.status === 'feasible_in_isolation' ? 'badge-success' : ''}`}>{labels[row.status] || row.status}</span></td>
          <td className="text-xs">{row.reason}</td>
          <td>{excludableIds.includes(String(row.bus_id)) && <button className="btn btn-outline" disabled={isExcluding} onClick={() => onExclude?.([String(row.bus_id)])}>Exclude route and recheck</button>}</td>
        </tr>)}
      </tbody></table></div>
      <p className="text-xs text-muted mt-2">Exclusion changes the included fleet only. Run optimization again after the new check; removing a route does not guarantee that every remaining conflict is resolved.</p>
    </details>}
    {relaxation && <div className="mt-3">
      <p className="text-sm">Diagnostic energy relaxation: {relaxation.status}{relaxation.total_artificial_energy_kwh != null ? ` · ${relaxation.total_artificial_energy_kwh.toFixed(2)} kWh artificial battery energy${relaxation.minimum_proven ? ' (minimum proven)' : ' (minimum not proven)'}` : ''}.</p>
      <p className="text-xs text-muted mt-2">This is an analysis model, not a usable charging schedule. The allocation of shortfalls can change; it does not identify a unique cause or a required charger size.</p>
      {findings.length > 0 && <details className="mt-3"><summary>Routes and periods with diagnostic energy shortfalls ({findings.length})</summary>
        <div style={{maxHeight:320,overflow:'auto'}}><table className="data-table"><thead><tr><th>Route</th><th>Period</th><th>Time in failed chunk ({step} min grid)</th><th>Artificial battery energy (kWh)</th></tr></thead><tbody>
          {findings.map((row,i) => <tr key={i}><td>{row.bus_id}</td><td>{row.period}</td><td>{clock(row.start_min)}–{clock(row.end_min)}</td><td>{row.missing_battery_energy_kwh.toFixed(2)}</td></tr>)}
        </tbody></table></div>
      </details>}
    </div>}
    <p className="text-sm mt-3">Run Check tests energy bounds. The solver additionally enforces shared connectors, power limits and switching restrictions together. Passing Run Check does not guarantee a feasible fleet schedule.</p>
    {!backend && <p className="text-xs text-muted mt-2">Detailed backend evidence is unavailable for this attempt. Restart the updated backend and repeat the run to include solver evidence.</p>}
    {exportError && <p role="alert" className="text-sm text-error mt-2">{exportError}</p>}
  </section>;
}
