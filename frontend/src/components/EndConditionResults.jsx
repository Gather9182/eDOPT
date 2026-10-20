import React from 'react';
import ResultInfoCard from './ResultInfoCard';

export default function EndConditionResults({condition}) {
  if (!condition?.mode) return null;
  const cyclic = condition.mode === 'cyclic_soc';
  const label = cyclic ? 'Start SoC = End SoC' : condition.mode === 'next_day_readiness' ? 'Next-Day Readiness' : 'Minimum end reserve';
  const rows = condition.buses || [];
  const failed = rows.filter(row => !row.compliant).length;
  return <ResultInfoCard title="End-of-day battery condition" status={rows.length ? (failed ? `${failed} failed` : 'All routes passed') : 'No route checks'} tone={rows.length ? (failed ? 'warning' : 'success') : undefined}
    summary={`${label} · ${rows.length} routes checked · ${rows.length - failed} passed · ${failed} failed`}>
    <div className="result-info-metrics">
      <div><span>End condition</span><strong>{label}<small>{cyclic ? 'Hard constraint per bus' : 'Minimum required battery energy'}</small></strong></div>
      <div><span>Routes checked</span><strong>{rows.length}<small>{rows.length - failed} passed · {failed} failed</small></strong></div>
      <div><span>Numerical tolerance</span><strong>{condition.tolerance_kwh} kWh</strong></div>
    </div>
    <p className="result-info-note">{cyclic ? 'Each bus ends at its initial battery energy over the identical repeated 24-hour timetable. Next-Day Readiness is off. Stationary battery storage (BESS) is not included.' : 'These values reflect the saved run. Operating minimum and maximum SoC limits remain independent.'}</p>
    <details className="result-info-details"><summary>View initial and final battery energy <span className="result-info-count">{rows.length}</span></summary>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Route</th><th className="numeric">Start (kWh)</th><th className="numeric">End (kWh)</th><th className="numeric">Difference (kWh)</th><th className="numeric">End target (kWh)</th><th>Check</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.bus_id}><td className="result-info-route">{row.bus_id}</td><td className="numeric">{row.initial_soc_kwh.toFixed(3)}</td><td className="numeric">{row.final_soc_kwh.toFixed(3)}</td><td className="numeric">{row.difference_kwh.toFixed(3)}</td><td className="numeric">{row.target_soc_kwh.toFixed(3)}</td><td><span className={`result-info-status ${row.compliant ? 'is-success' : 'is-warning'}`}>{row.compliant ? 'Passed' : 'Failed'}</span></td></tr>)}
      </tbody></table></div>
    </details>
  </ResultInfoCard>;
}
