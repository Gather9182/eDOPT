import React, { useState } from 'react';

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
  const clock = minute => `Tag ${Math.floor(minute/1440)+1}, ${String(Math.floor(minute/60)%24).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  return <div className="card p-6 mb-6">
    <h2 className="text-lg font-bold mb-3">Ladeorte und Anschlussbelegung</h2>
    {results.baseline_feasible === false && <p role="alert" className="text-warning mb-3">Die Vergleichsstrategie „Laden bei Ankunft“ erfüllt nicht alle Betriebsbedingungen. Kosten- und CO₂-Einsparungen gegenüber dieser Strategie sind kein belastbarer Vergleich. {results.baseline_issues?.slice(0,3).join(' ')}</p>}
    <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>Ladeort</th><th>Geladen (kWh)</th><th>Spitzenleistung (kW)</th><th>Max. belegte Ladepunkte</th></tr></thead><tbody>
      {ids.map(id => { const p = profiles[id].slice(from,to); return <tr key={id}><td>{name(id)}</td><td>{(p.reduce((a,b) => a+b,0)*step/60).toFixed(1)}</td><td>{Math.max(0,...p).toFixed(1)}</td><td>{Math.max(0,...(results.site_occupied_connectors?.[id] || []).slice(from,to))}</td></tr>; })}
    </tbody></table></div>
    {visits.length > 0 && <details className="mt-4" open><summary>Gewählte Zusatzladefahrten ({visits.length})</summary>
      <p className="text-sm text-muted mb-2">Fahrplanfahrten bleiben unverändert. Die Zusatzenergie und Kilometer der Hin- und Rückfahrt werden nur bei gewählten Fahrten berücksichtigt. Die Vergleichsstrategie „Laden bei Ankunft“ nutzt keine optionalen Zusatzfahrten.</p>
      <div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Umlauf</th><th>Ladeort</th><th>Hinfahrt ab</th><th>Am Ladeort</th><th>Rückfahrt ab</th><th>Zurück am Knoten</th><th>Geladen (Batterie-kWh)</th><th>Zusatzverbrauch (kWh)</th><th>Netto-Gewinn (kWh)</th><th>Zusatz-km</th></tr></thead><tbody>
        {visits.map((visit,i) => <tr key={i}><td>{visit.bus_id}</td><td>{name(visit.site_id)}</td><td>{clock(visit.departure_min)}</td><td>{clock(visit.charger_arrival_min)}</td><td>{clock(visit.return_departure_min)}</td><td>{clock(visit.return_arrival_min)}</td><td>{(visit.battery_charged_kwh ?? visit.charged_kwh).toFixed(1)}</td><td>{visit.travel_energy_kwh.toFixed(1)}</td><td>{(visit.net_energy_gain_kwh ?? 0).toFixed(1)}</td><td>{visit.distance_km.toFixed(1)}</td></tr>)}
      </tbody></table></div>
    </details>}
    <details className="mt-4"><summary>Anschlussbelegung eines Busses anzeigen</summary>
      <label>Umlauf <select aria-label="Anschlussbelegung Umlauf" className="form-input" value={bus || ''} onChange={e => setSelectedBus(e.target.value)}>{buses.map(id => <option key={id}>{id}</option>)}</select></label>
      <p className="text-sm text-muted mb-2">Ein Anschluss bleibt auch bei 0 kW belegt. Angezeigt werden bis zu 192 Zeitschritte des ausgewählten Zeitraums; vollständige Daten stehen im Export.</p>
      <div style={{ maxHeight: 320, overflow: 'auto' }}><table className="data-table"><thead><tr><th>Zeit</th><th>Anschluss am Ladeort</th><th>Ladeleistung (kW)</th></tr></thead><tbody>{(results.connection_schedules[bus] || []).slice(from,Math.min(to,from+192)).map((site, i) => { const t=from+i; const minutes=t*step; const schedule=results.is_long_term ? results.schedules_by_day?.[Math.floor(minutes/1440)]?.[bus]?.[t%(1440/step)] : results.schedules?.[bus]?.[t]; return <tr key={t}><td>Tag {Math.floor(minutes/1440)+1}, {String(Math.floor(minutes/60)%24).padStart(2,'0')}:{String(minutes%60).padStart(2,'0')}</td><td>{site ? name(site) : 'Nicht angeschlossen'}</td><td>{(schedule || 0).toFixed(1)}</td></tr>; })}</tbody></table></div>
    </details>
  </div>;
}
