import CustomSelect from './CustomSelect';
import React from 'react';
import { addSelectedDepotSites } from '../utils/charging';

export default function ChargingSitesEditor({ projectData, setProjectData, nodes = [], descriptions = {}, suggestions = [], selectedDepotNodes = [] }) {
  const config = projectData.charging || { enabled: false, sites: [], energy_site_id: '' };
  const update = patch => setProjectData(prev => ({ ...prev, charging: { ...config, ...patch } }));
  const sites = config.sites || [];
  const edit = (id, patch) => update({ sites: sites.map(site => site.id === id ? { ...site, ...patch } : site) });
  const create = suggestion => ({
    id: suggestion?.id || `site_${Date.now()}`, name: suggestion?.name || 'New charging location', nodes: suggestion?.nodes || [],
    num_chargers: 1, charger_power_kw: 150, charger_capacity_kw: 150, grid_limit_kw: 150,
    no_switch_windows: [], allow_connect_on_arrival: true,
  });
  const numberFields = [['num_chargers', 'Ladepunkte'], ['charger_power_kw', 'kW je Ladepunkt'], ['charger_capacity_kw', 'Ladeleistung gesamt (kW)'], ['grid_limit_kw', 'Netzanschluss (kW)']];
  const selectedAE = selectedDepotNodes.filter(node => suggestions.some(site => site.nodes.includes(node)));
  const addDepotNodes = selected => update({ sites: addSelectedDepotSites(sites, selected, suggestions, create) });
  return <div className="card p-6">
    <h2 className="text-lg font-bold mb-3">Ladeorte und Umstecksperren</h2>
    <label className="flex items-center gap-2 mb-3"><input type="checkbox" checked={Boolean(config.enabled)} onChange={e => update({ enabled: e.target.checked })} /> Ladeorte getrennt berücksichtigen</label>
    <p className="text-sm text-muted mb-4">Ordne Fahrplanknoten einem physischen Ladeort zu. Einfahrt und Ausfahrt desselben Depots gehören zum selben Ort. Mit „Continue to Settings“ werden die aktuellen Knotenzuordnungen automatisch verarbeitet und übernommen.</p>
    {config.enabled && <>
      <p className="text-sm mb-4">Each location uses its own grid connection, charging power and connector limits. The legacy depot limits are not applied when locations are configured. PV and battery storage supply only their selected location.</p>
      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => update({ sites: [...sites, create()] })}>Ladeort hinzufügen</button>
        <button className="btn btn-outline" disabled={!selectedAE.length} title={selectedAE.length ? `${selectedAE.length} ausgewählte A/E-Knoten aus dem Umlaufplan übernehmen` : 'Zuerst A/E-Knoten im Pill-Selector des Umlaufplans auswählen.'} onClick={() => addDepotNodes(selectedAE)}>Ausgewählte A/E-Knoten übernehmen ({selectedAE.length})</button>
        {suggestions.length > 0 && <button className="btn btn-outline" onClick={() => addDepotNodes(suggestions.flatMap(site => site.nodes))}>Standorte aus A/E-Knoten ergänzen</button>}
      </div>
      {sites.map(site => <div key={site.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div className="flex gap-2 mb-3">
          <label style={{ flex: 1 }}>Name<input aria-label={`Name ${site.id}`} className="form-input w-full" value={site.name} onChange={e => edit(site.id, { name: e.target.value })} /></label>
          <button className="btn btn-outline" onClick={() => update({ sites: sites.filter(s => s.id !== site.id), energy_site_id: config.energy_site_id === site.id ? '' : config.energy_site_id })}>Entfernen</button>
        </div>
        <label className="block mb-3">Fahrplanknoten (Mehrfachauswahl mit Strg)
          <CustomSelect aria-label={`Knoten ${site.name}`} multiple className="form-input w-full" style={{ minHeight: 100 }} value={site.nodes} onChange={e => edit(site.id, { nodes: Array.from(e.target.selectedOptions, o => o.value) })}>
            {[...new Set([...nodes, ...site.nodes])].sort().map(node => <option key={node} value={node} disabled={sites.some(s => s.id !== site.id && s.nodes.includes(node))}>{node}{descriptions[node] ? ` — ${descriptions[node]}` : ''}</option>)}
          </CustomSelect>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {numberFields.map(([key, label]) => <label key={key}>{label}<input aria-label={`${label} ${site.name}`} className="form-input w-full" type="number" min="0" step={key === 'num_chargers' ? '1' : '0.1'} value={site[key]} onChange={e => edit(site.id, { [key]: Number(e.target.value) })} /></label>)}
        </div>
        <p className="text-sm text-muted mt-3 mb-2">Während einer Umstecksperre bleiben abgestellte Busse angeschlossen, auch bei 0 kW. Fahrplanmäßige Abfahrten bleiben möglich. Gleiche Start- und Endzeit sperrt den ganzen Tag.</p>
        {(site.no_switch_windows || []).map((window, i) => <div key={i} className="time-window-row mb-2">
          <label>Von <input className="form-input time-window-input" aria-label={`Sperre von ${site.name} ${i+1}`} type="time" value={window.start} onChange={e => edit(site.id, { no_switch_windows: site.no_switch_windows.map((w, j) => j === i ? { ...w, start: e.target.value } : w) })} /></label>
          <label>Bis <input className="form-input time-window-input" aria-label={`Sperre bis ${site.name} ${i+1}`} type="time" value={window.end} onChange={e => edit(site.id, { no_switch_windows: site.no_switch_windows.map((w, j) => j === i ? { ...w, end: e.target.value } : w) })} /></label>
          <button className="btn btn-outline" onClick={() => edit(site.id, { no_switch_windows: site.no_switch_windows.filter((_, j) => j !== i) })}>Löschen</button>
        </div>)}
        <button className="btn btn-outline mb-3" onClick={() => edit(site.id, { no_switch_windows: [...(site.no_switch_windows || []), { start: '22:00', end: '05:00' }] })}>Sperrzeit hinzufügen</button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={site.allow_connect_on_arrival ?? true} onChange={e => edit(site.id, { allow_connect_on_arrival: e.target.checked })} /> Bei Ankunft während der Sperre einmalig an freien Ladepunkt anschließen</label>
      </div>)}
      <label>Standort für PV und stationären Speicher<CustomSelect className="form-input w-full" value={config.energy_site_id || ''} onChange={e => update({ energy_site_id: e.target.value })}>
        <option value="">Bitte für PV/BESS-Szenarien auswählen</option>
        {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
      </CustomSelect></label>
      <p className="text-sm text-muted mt-2">PV und Speicher versorgen ausschließlich den ausgewählten Ort.</p>
    </>}
  </div>;
}
