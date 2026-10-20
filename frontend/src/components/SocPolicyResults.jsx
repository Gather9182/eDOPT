import React from 'react';

export default function SocPolicyResults({policy}) {
  if (!policy?.min_mode) return null;
  const rows = policy.violations || [];
  const time = minute => `Day ${Math.floor(minute / 1440) + 1} ${String(Math.floor(minute / 60) % 24).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
  return <div className="card p-4 mb-4">
    <h3 className="card-title">Operating SoC limits</h3>
    <p className="text-sm">Minimum: {policy.min_mode === 'off' ? 'Off' : `${policy.min_fraction * 100}% (${policy.min_mode})`}. Maximum: {policy.max_enabled ? `${policy.max_fraction * 100}% (${policy.max_mode || 'soft'})` : 'Off'}. Physical bounds: 0–100%.</p>
    <p className="text-sm text-muted mt-2">Soft-limit deviations are minimised before cost. Initial-state deviations are reported separately from charging decisions. {policy.scope}</p>
    {rows.length ? <details className="mt-3"><summary className="text-warning">{rows.length} boundary states outside the preferred SoC band — show details</summary>
      <div style={{maxHeight:320,overflow:'auto'}}><table className="w-full text-sm"><thead><tr><th>Route</th><th>Time</th><th>Limit</th><th>SoC</th><th>Deviation</th></tr></thead><tbody>
        {rows.map((row,index) => <tr key={index}><td>{row.bus_id}</td><td>{time(row.minute)}{row.initial_state ? ' (initial state)' : ''}</td><td>{row.kind === 'below_min' ? 'Below minimum' : 'Above maximum'}</td><td>{row.soc_percent.toFixed(2)}%</td><td>{row.deviation_kwh.toFixed(3)} kWh</td></tr>)}
      </tbody></table></div></details> : <p className="text-sm text-success mt-2">All preferred operating SoC limits were respected.</p>}
  </div>;
}
