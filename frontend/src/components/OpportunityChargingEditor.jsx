import React from 'react';
import { opportunityConfig, resolvedOpportunityConfig } from '../utils/opportunity';

export default function OpportunityChargingEditor({ projectData, setProjectData, nodes = [] }) {
  const config = opportunityConfig(projectData);
  const resolved = resolvedOpportunityConfig(projectData);
  const sites = projectData.charging?.sites || [];
  const update = patch => setProjectData(prev => ({...prev, charging:{...prev.charging, opportunity:{...opportunityConfig(prev),...patch}}}));
  const edit = (id,patch) => update({mappings:config.mappings.map(row => row.id === id ? {...row,...patch} : row)});
  const number = value => value === '' ? null : Number(value);
  const ready = resolved.mappings.filter(row => row.enabled && sites.some(site => site.id === row.site_id) && row.nodes.length &&
    ['outbound_minutes','return_minutes','outbound_km','return_km'].every(key => row[key] !== null && Number.isFinite(row[key]) && row[key] >= 0)).length;
  return <div className="card p-6 mt-6">
    <h2 className="text-lg font-bold mb-3">Zusätzliche Lademöglichkeiten mit Hin- und Rückfahrt</h2>
    <label className="flex gap-2 mb-3"><input type="checkbox" checked={config.enabled} disabled={!projectData.charging?.enabled} onChange={e => update({enabled:e.target.checked})} />Optionale Ladefahrten nutzen</label>
    <p className="text-sm text-muted mb-3">Das Excel-Blatt „Mapping Lademöglichkeiten“ wird automatisch eingelesen. Verbinde die Ziele mit deinen Ladeorten. Änderungen werden mit „Continue to Settings“ verarbeitet. Bestehende Depot-Ladefenster bleiben erhalten.</p>
    {!projectData.charging?.enabled && <p className="text-sm mb-3">Zuerst „Ladeorte getrennt berücksichtigen“ aktivieren und die Zielstandorte konfigurieren.</p>}
    <p role="status" className="text-sm mb-4">{config.mappings.length} Zuordnungen, davon {ready} mit Ziel und Distanzen vorbereitet. Unvollständige Verbindungen werden nicht zur Optimierung verwendet; fehlende Kilometer zählen nicht als 0.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
      {[
        ['min_charge_minutes','Mindestladezeit (min)',1], ['buffer_minutes','Zeitpuffer je Richtung (min)',0],
        ['min_net_energy_kwh','Mindest-Energiegewinn nach Zusatzfahrten (kWh)',0], ['min_charging_power_kw','Mindestleistung während Mindestladezeit (kW)',.1],
      ].map(([key,label,min]) => <label key={key}>{label}<input aria-label={label} className="form-input w-full" type="number" min={min} step="any" value={config[key]} onChange={e => update({[key]:Number(e.target.value)})} /></label>)}
    </div>
    <p className="text-sm text-muted mt-3 mb-3">Die Mindestladezeit zählt nur Zeitschritte mit mindestens der eingestellten Mindestleistung. Hin- und Rückfahrt verbrauchen Energie gemäß Fahrzeugtyp. Fahr- und Ladezeiten werden konservativ auf das Zeitraster angepasst. Eine Zusatzfahrt wird nur gewählt, wenn ihre gesamte Hin- und Rückfahrt innerhalb der Pause liegt. In Langzeitsimulationen muss sie innerhalb eines Rechenabschnitts abgeschlossen sein; für Fahrten über Mitternacht entsprechend längere Abschnitte wählen.</p>
    <details className="mb-4"><summary>Erlaubte Zeitfenster für Zusatzfahrten ({config.allowed_windows.length ? config.allowed_windows.length : 'ganztägig'})</summary>
      <p className="text-sm text-muted mb-2">Hin- und Rückfahrt müssen in diesen Zeitfenstern liegen. Ohne Eintrag sind Zusatzfahrten ganztägig erlaubt. Umstecksperren des Ladeorts gelten zusätzlich.</p>
      {config.allowed_windows.map((window,i) => <div className="flex gap-2 mb-2" key={i}>
        <label>Von<input aria-label={`Zusatzfahrten von ${i+1}`} type="time" value={window.start} onChange={e => update({allowed_windows:config.allowed_windows.map((w,j) => i === j ? {...w,start:e.target.value} : w)})} /></label>
        <label>Bis<input aria-label={`Zusatzfahrten bis ${i+1}`} type="time" value={window.end} onChange={e => update({allowed_windows:config.allowed_windows.map((w,j) => i === j ? {...w,end:e.target.value} : w)})} /></label>
        <button className="btn btn-outline" onClick={() => update({allowed_windows:config.allowed_windows.filter((_,j) => j !== i)})}>Entfernen</button>
      </div>)}
      <button className="btn btn-outline" onClick={() => update({allowed_windows:[...config.allowed_windows,{start:'05:00',end:'22:00'}]})}>Zeitfenster hinzufügen</button>
    </details>
    <button className="btn btn-outline mb-3" onClick={() => update({mappings:[...config.mappings,{id:`manual_${crypto.randomUUID()}`,manual:true,stop_name:'Manuelle Verbindung',target_name:'',site_id:'',nodes:[],outbound_minutes:0,return_minutes:0,outbound_km:null,return_km:null,enabled:true}]})}>Verbindung hinzufügen</button>
    <div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Aktiv / Haltestelle</th><th>Ziel-Ladeort</th><th>Hin (min)</th><th>Zurück (min)</th><th>Hin (km)</th><th>Zurück (km)</th><th>Mindestladezeit / Puffer (min)</th><th></th></tr></thead><tbody>
      {config.mappings.map(row => { const effective=resolved.mappings.find(r => r.id === row.id); return <tr key={row.id}>
        <td style={{minWidth:250}}><label className="flex gap-2"><input type="checkbox" aria-label={`Mapping aktiv ${row.id}`} checked={row.enabled} onChange={e => edit(row.id,{enabled:e.target.checked})} />{row.stop_name}</label>
          <details><summary>{row.nodes.length ? row.nodes.join(', ') : 'Knoten auswählen'}</summary><select aria-label={`Ausgangsknoten ${row.id}`} multiple className="form-input" value={row.nodes} onChange={e => edit(row.id,{nodes:Array.from(e.target.selectedOptions,o => o.value),nodes_overridden:true})}>{[...new Set([...nodes,...row.nodes])].sort().map(node => <option key={node}>{node}</option>)}</select></details>
        </td>
        <td><select aria-label={`Ziel-Ladeort ${row.id}`} className="form-input" value={effective.site_id} onChange={e => edit(row.id,{site_id:e.target.value})}><option value="">{row.target_name || 'Ladeort wählen'}</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name || site.id}</option>)}</select></td>
        {['outbound_minutes','return_minutes','outbound_km','return_km'].map(key => <td key={key}><input style={{minWidth:85}} aria-label={`${key} ${row.id}`} className="form-input" type="number" min="0" step="any" placeholder={key.endsWith('_km') ? 'fehlt' : ''} value={row[key] ?? ''} onChange={e => edit(row.id,{[key]:number(e.target.value)})} /></td>)}
        <td><div className="flex gap-2">{['min_charge_minutes','buffer_minutes'].map(key => <input key={key} style={{width:85}} aria-label={`${key} ${row.id}`} className="form-input" type="number" min={key === 'min_charge_minutes' ? 1 : 0} placeholder={String(config[key])} value={row[key] ?? ''} onChange={e => edit(row.id,{[key]:number(e.target.value)})} />)}</div></td>
        <td><button className="btn btn-outline" onClick={() => update({mappings:config.mappings.filter(r => r.id !== row.id)})}>Entfernen</button></td>
      </tr>; })}
    </tbody></table></div>
  </div>;
}
