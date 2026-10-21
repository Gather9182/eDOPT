import {flatRateSettings} from '../utils/flatRate';
import React,{useState} from 'react';
import CustomSelect from './CustomSelect';
import {getPricesForOptimization} from '../services/api';
import {priceSelection,withMarketPrices,marketPricesCurrent} from '../utils/priceSelection';
export default function PriceSourceSettings({project,setProject,loadPrices=false,hours=24,resolution=15,disabled=false}) {
  const {source,allowFallback,priceWindowMinutes}=priceSelection(project);
  const flat=flatRateSettings(project);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const date=project.meta.price_requested_date || project.meta.price_date || new Date().toISOString().slice(0,10);
  const update=patch=>{setMessage('');setProject(previous=>({...previous,meta:{...previous.meta,price_requested_date:previous.meta.price_requested_date || previous.meta.price_date || date,...patch}}));};
  const rateLabel=Number.isFinite(flat.eurKwh) ? `${flat.eurKwh.toFixed(3)} EUR/kWh` : 'Set a valid price';
  const summary=flat.enabled ? `Flat-rate main analysis · ${rateLabel}` : `${source==='smard' ? 'SMARD' : 'aWATTar'} · ${priceWindowMinutes}-minute prices${flat.compareArrival ? ` · Additional arrival flat rate: ${rateLabel}` : ''}`;
  return <details className="price-source-panel price-source-disclosure">
    <summary className="price-source-summary">
      <span className="price-source-summary-copy"><strong>Price assumptions</strong><small>{summary}{busy ? ' · Loading prices…' : ''}</small></span>
      <span className="price-source-summary-badge">{flat.enabled ? 'Flat rate' : source==='smard' ? 'SMARD · cache first' : 'aWATTar'}</span>
    </summary>
    <div className="price-source-body">
    <fieldset className="price-flat-rate-controls" disabled={busy || disabled}>
      <legend className="form-label">Flat-rate analysis and comparison</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flat.enabled} onChange={event=>update({flat_rate_enabled:event.target.checked,flat_rate_compare_arrival:false})} />Use flat rate for the main analysis</label>
      <p className="text-muted text-xs mt-2">A constant price in every time slot, including configured fees and taxes. No market-price download is required. All operating constraints remain active; charging times may be non-unique.</p>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={flat.compareArrival} disabled={flat.enabled} onChange={event=>update({flat_rate_compare_arrival:event.target.checked})} />Add an extra charge-on-arrival comparison with flat rate</label>
      <p className="text-muted text-xs mt-2">Keeps the existing charge-on-arrival comparison at the main tariff and adds a separate flat-rate cost comparison to Results. Available only when the main analysis uses market prices.</p>
      {(flat.enabled || flat.compareArrival) && <><label className="form-label mt-2">Flat rate (EUR/kWh, before fees and taxes)</label><input type="number" className="form-input" min="0" step="0.001" required value={project.meta?.flat_rate_eur_kwh ?? .2} onChange={event=>update({flat_rate_eur_kwh:event.target.value==='' ? '' : Number(event.target.value)})} /></>}
    </fieldset>
    {flat.enabled && <p className="text-sm">Flat-rate-only run: market source and averaging below are not used.</p>}
    <label className="form-label">Market price source (all simulation modes)</label>
    <CustomSelect value={source} disabled={busy || disabled || flat.enabled} onChange={event=>update({price_provider:event.target.value})}>
      <option value="smard">SMARD · persistent cache · historical default</option>
      <option value="awattar">aWATTar · explicit alternative</option>
    </CustomSelect>
    <label className="form-label mt-2">Price averaging window (all simulation modes)</label>
    <CustomSelect value={priceWindowMinutes} disabled={busy || disabled || flat.enabled} onChange={event=>update({price_window_minutes:Number(event.target.value)})}>
      <option value={15}>15 minutes · original quarter-hour profile</option>
      <option value={30}>30 minutes · half-hour average</option>
      <option value={60}>60 minutes · hourly average</option>
    </CustomSelect>
    <p className="text-muted text-xs mt-2">Duration-weighted spot-price averages, aligned to local midnight. Each average applies throughout its window. Solver time step and cached original prices remain unchanged. Reload prices after changing this setting.</p>
    {!flat.enabled && source==='smard' && <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" disabled={busy || disabled} checked={allowFallback} onChange={event=>update({price_energy_charts_fallback:event.target.checked})} />Allow Energy-Charts only for remaining historical gaps (rate-limited SMARD access path)</label>}
    {!flat.enabled && project.meta.price_source && <p className={`price-source-state ${(project.meta.price_source!==source || (project.meta.price_evidence?.price_aggregation?.window_minutes ?? 15)!==priceWindowMinutes) ? 'is-stale' : ''}`}>Loaded: <strong>{project.meta.price_source} · {project.meta.price_evidence?.price_aggregation?.window_minutes ?? 15} min</strong> · Selected: <strong>{source} · {priceWindowMinutes} min</strong>{(project.meta.price_source!==source || (project.meta.price_evidence?.price_aggregation?.window_minutes ?? 15)!==priceWindowMinutes) ? ' · Reload prices to apply this selection.' : ''}</p>}
    <details className="price-source-help"><summary>Availability and source rules</summary><p>The selection is saved for all modes. Future day-ahead prices may not yet be published. Incomplete coverage blocks the affected calculation; sources never switch silently and missing prices are not replaced with repeated days.</p></details>
    {loadPrices && !flat.enabled && <>
      <label className="form-label">Market price date</label><input type="date" className="form-input" value={date} disabled={busy} onChange={event=>update({price_requested_date:event.target.value})} />
      <button type="button" className="btn btn-outline mt-2" disabled={busy} onClick={async()=>{
        setBusy(true);setMessage('Loading selected source...');
        try {
          const result=await getPricesForOptimization(date,hours,resolution,{...priceSelection(project),onProgress:value=>setMessage(value.message || 'Preparing prices...')});
          setProject(previous=>withMarketPrices(previous,result,date,hours,resolution));setMessage('Complete market prices loaded.');
        } catch(error) {setMessage(error.response?.data?.detail || error.message);}
        finally {setBusy(false);}
      }}>{busy ? 'Loading prices...' : 'Load selected market prices'}</button>
      {!marketPricesCurrent(project,date,hours,resolution) && <p className="text-warning">Load this source/date/horizon before running Short-Term. Previously loaded prices will not be silently relabelled.</p>}
    </>}
    {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
