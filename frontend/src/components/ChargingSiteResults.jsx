import CustomSelect from './CustomSelect';
import React, { useState } from 'react';
import { chargingOriginAt } from '../utils/chargingOrigin';
import ResultInfoCard from './ResultInfoCard';

export default function ChargingSiteResults({ results, day = null }) {
  const [selectedBus, setSelectedBus] = useState('');
  const profiles = results.site_load_profiles || {};
  const ids = Object.keys(profiles);
  if (!ids.length) return null;
  const step = results.run_metadata?.inputs?.time_step_minutes || 15;
  const from = day === null ? 0 : day * 1440 / step;
  const to = day === null ? results.aggregated_load_profile.length : from + 1440 / step;
  const sites = results.run_metadata?.inputs?.charging_sites || [];
  const name = id => sites.find(site => site.id === id)?.name || id;
  const buses = Object.keys(results.connection_schedules || {});
  const bus = buses.includes(selectedBus) ? selectedBus : buses[0];
  const visits = (results.opportunity_charging_visits || []).filter(visit => day === null || Math.floor(visit.departure_min/1440) === day);
  const clock = minute => `Day ${Math.floor(minute/1440)+1}, ${String(Math.floor(minute/60)%24).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const energy = ids.reduce((sum,id) => sum + profiles[id].slice(from,to).reduce((a,b) => a+b,0)*step/60,0);
  return <ResultInfoCard title="Charging locations & connector use" status={day === null ? 'Full run' : `Day ${day + 1}`}
    summary={`${ids.length} locations · ${energy.toFixed(1)} kWh delivered to chargers · ${visits.length} selected charging detours`}>
    <div className="result-info-metrics">
      <div><span>Charging locations</span><strong>{ids.length}</strong></div>
      <div><span>Energy delivered to chargers</span><strong>{energy.toFixed(1)} kWh</strong></div>
      <div><span>Selected charging detours</span><strong>{visits.length}<small>{visits.reduce((sum,visit) => sum + visit.distance_km,0).toFixed(1)} additional km</small></strong></div>
    </div>
    <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Location</th><th className="numeric">Charger energy (kWh)</th><th className="numeric">Peak charging power (kW)</th><th className="numeric">Peak occupied connectors</th></tr></thead><tbody>
      {ids.map(id => { const p = profiles[id].slice(from,to); return <tr key={id}><td className="result-info-route">{name(id)}</td><td className="numeric">{(p.reduce((a,b) => a+b,0)*step/60).toFixed(1)}</td><td className="numeric">{Math.max(0,...p).toFixed(1)}</td><td className="numeric">{Math.max(0,...(results.site_occupied_connectors?.[id] || []).slice(from,to))}</td></tr>; })}
    </tbody></table></div>
    {visits.length > 0 && <details className="result-info-details"><summary>View selected charging detours <span className="result-info-count">{visits.length}</span></summary>
      <p className="result-info-note">Scheduled trips remain unchanged. Only selected detours add travel energy and distance. The charge-on-arrival reference does not use optional detours. Outbound and return times include both ends of each journey.</p>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Route / location</th><th>Outbound journey</th><th>Return journey</th><th className="numeric">Battery energy<br />(kWh)</th><th className="numeric">Travel energy<br />(kWh)</th><th className="numeric">Net gain<br />(kWh)</th><th className="numeric">Extra distance<br />(km)</th></tr></thead><tbody>
        {visits.map((visit,i) => <tr key={i}><td className="result-info-route">{visit.bus_id}<small className="result-info-subtext">{name(visit.site_id)}</small></td><td className="result-info-nowrap">{clock(visit.departure_min)}<small className="result-info-subtext">→ {clock(visit.charger_arrival_min)}</small></td><td className="result-info-nowrap">{clock(visit.return_departure_min)}<small className="result-info-subtext">→ {clock(visit.return_arrival_min)}</small></td><td className="numeric">{(visit.battery_charged_kwh ?? visit.charged_kwh).toFixed(1)}</td><td className="numeric">{visit.travel_energy_kwh.toFixed(1)}</td><td className="numeric">{(visit.net_energy_gain_kwh ?? 0).toFixed(1)}</td><td className="numeric">{visit.distance_km.toFixed(1)}</td></tr>)}
      </tbody></table></div>
    </details>}
    <details className="result-info-details"><summary>View connector use by route</summary>
      <label className="result-info-selector">Route <CustomSelect aria-label="Connector use route" className="form-input" value={bus || ''} onChange={e => setSelectedBus(e.target.value)}>{buses.map(id => <option key={id}>{id}</option>)}</CustomSelect></label>
      <p className="result-info-note">A connector remains occupied even at 0 kW. Up to 192 time steps of the selected period are shown. The export contains all time steps.</p>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>Time</th><th>Connected at</th><th className="numeric">Charging power (kW)</th><th>Charging origin</th></tr></thead><tbody>{(results.connection_schedules?.[bus] || []).slice(from,Math.min(to,from+192)).map((site, i) => {
        const t=from+i;
        const minutes=t*step;
        const schedule=results.is_long_term ? results.schedules_by_day?.[Math.floor(minutes/1440)]?.[bus]?.[t%(1440/step)] : results.schedules?.[bus]?.[t];
        const origin = schedule > 0.001 ? chargingOriginAt(results,bus,minutes) : null;
        return <tr key={t}><td className="result-info-nowrap">{clock(minutes)}</td><td>{site ? name(site) : 'Not connected'}</td><td className="numeric">{(schedule || 0).toFixed(1)}</td><td>{origin ? <span title={origin.explanation} className={`charging-origin-badge charging-origin-${origin.origin}`}>{origin.badge}</span> : site ? 'Connected, not charging' : '—'}</td></tr>;
      })}</tbody></table></div>
    </details>
  </ResultInfoCard>;
}
