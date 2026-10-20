import React from 'react';

export default function EndConditionResults({condition}) {
  if (!condition?.mode) return null;
  const cyclic = condition.mode === 'cyclic_soc';
  const label = cyclic ? 'Start SoC = End SoC' : condition.mode === 'next_day_readiness' ? 'Next-Day Readiness' : 'Minimum end reserve';
  const rows = condition.buses || [];
  return <div className="card p-4 mb-4">
    <h3 className="card-title">End-of-day battery condition: {label}</h3>
    <p className="text-sm text-muted">{cyclic ? 'Hard equality for each included bus over the identical repeated 24-hour timetable. Next-Day Readiness is off. BESS is not included.' : 'The saved run uses the indicated end condition; operating min/max limits remain independent.'} Numerical tolerance: {condition.tolerance_kwh} kWh.</p>
    <details className="mt-3"><summary>Initial and final battery energy ({rows.length} {rows.length === 1 ? 'route' : 'routes'})</summary>
      <div style={{maxHeight:320,overflow:'auto'}}><table className="data-table w-full"><thead><tr><th>Route</th><th>Start (kWh)</th><th>End (kWh)</th><th>Difference (kWh)</th><th>End target (kWh)</th><th>Check</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.bus_id}><td>{row.bus_id}</td><td>{row.initial_soc_kwh.toFixed(3)}</td><td>{row.final_soc_kwh.toFixed(3)}</td><td>{row.difference_kwh.toFixed(3)}</td><td>{row.target_soc_kwh.toFixed(3)}</td><td>{row.compliant ? 'Passed' : 'Failed'}</td></tr>)}
      </tbody></table></div>
    </details>
  </div>;
}
