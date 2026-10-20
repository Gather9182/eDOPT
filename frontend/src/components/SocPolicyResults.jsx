import React from 'react';
import ResultInfoCard from './ResultInfoCard';

export default function SocPolicyResults({policy}) {
  if (!policy?.min_mode) return null;
  const rows = policy.violations || [];
  const time = minute => `Day ${Math.floor(minute / 1440) + 1} ${String(Math.floor(minute / 60) % 24).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
  const minLabel = policy.min_mode === 'off' ? 'off' : `${policy.min_fraction * 100}% (${policy.min_mode})`;
  const maxLabel = policy.max_enabled ? `${policy.max_fraction * 100}% (${policy.max_mode || 'soft'})` : 'off';
  return <ResultInfoCard title="Operating SoC limits" status={rows.length ? 'Deviations recorded' : 'Within limits'} tone={rows.length ? 'warning' : 'success'}
    summary={`Minimum: ${minLabel} · Maximum: ${maxLabel} · ${rows.length} battery states outside limits across ${new Set(rows.map(row => row.bus_id)).size} routes`}>
    <div className="result-info-metrics">
      <div><span>Minimum SoC</span><strong>{policy.min_mode === 'off' ? 'Off' : `${policy.min_fraction * 100}%`}<small>{policy.min_mode !== 'off' ? policy.min_mode : 'Disabled'}</small></strong></div>
      <div><span>Maximum SoC</span><strong>{policy.max_enabled ? `${policy.max_fraction * 100}%` : 'Off'}<small>{policy.max_enabled ? policy.max_mode || 'soft' : 'Disabled'}</small></strong></div>
      <div><span>Affected routes</span><strong>{new Set(rows.map(row => row.bus_id)).size}<small>{rows.length} battery states outside limits</small></strong></div>
    </div>
    <p className="result-info-note">Physical battery bounds remain 0–100%. Soft-limit deviations are minimised before electricity cost. Repeated states may belong to the same route; they are not separate charging events. {policy.scope}</p>
    {rows.length ? <details className="result-info-details"><summary>View SoC deviations <span className="result-info-count">{rows.length}</span></summary>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Route</th><th>Time</th><th>Limit</th><th className="numeric">SoC</th><th className="numeric">Deviation (kWh)</th></tr></thead><tbody>
        {rows.map((row,index) => <tr key={index}><td className="result-info-route">{row.bus_id}</td><td className="result-info-nowrap">{time(row.minute)}{row.initial_state && <small className="result-info-subtext">Initial state — before charging decisions</small>}</td><td><span className="result-info-status is-warning">{row.kind === 'below_min' ? 'Below minimum' : 'Above maximum'}</span></td><td className="numeric">{row.soc_percent.toFixed(2)}%</td><td className="numeric">{row.deviation_kwh.toFixed(3)}</td></tr>)}
      </tbody></table></div></details> : <p className="text-sm text-success mt-2">All configured operating SoC limits were respected.</p>}
  </ResultInfoCard>;
}
