import React,{useEffect,useRef,useState} from 'react';
import {historicalWeatherCoverage,prepareHistoricalWeather} from '../services/api';

export default function HistoricalWeatherStatus({state,setState,options,pvConfig,setPvConfig,controls=false}) {
  const controller=useRef(null),[error,setError]=useState(''),[action,setAction]=useState(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const stale=controls && state?.result && (state.result.first!==options.first || state.result.last!==options.last || state.result.location?.latitude!==options.latitude || state.result.location?.longitude!==options.longitude || (state.result.model || 'era5')!==(options.model || 'era5'));
  const report=state?.result,busy=['queued','running'].includes(state?.status);
  const model=controls ? options.model || 'era5' : report?.model || 'era5';
  const modelLabel=model==='ecmwf_ifs' ? 'ECMWF IFS' : 'ERA5';
  const missingDates=report?.missing_dates || [];
  const archivePending=missingDates.filter(date=>report.archive_preparation_cutoff && date>report.archive_preparation_cutoff);
  const otherMissing=missingDates.filter(date=>!report.archive_preparation_cutoff || date<=report.archive_preparation_cutoff);
  const coverageLabel=report ? `${report.complete_days}/${report.required_days} days cached · ${report.missing_days} missing` : `Open-Meteo Archive · ${modelLabel} · prepared automatically before daily jobs`;
  const run=async(load)=>{
    if(controller.current) return;
    const active=new AbortController();controller.current=active;setError('');setAction(load ? 'load' : 'check');
    try {
      setState(previous=>({...previous,status:'running',message:load ? 'Preparing historical weather…' : 'Checking weather coverage…'}));
      const result=load ? await prepareHistoricalWeather(options,{signal:active.signal,onProgress:progress=>setState(previous=>({...previous,...progress}))}) : await historicalWeatherCoverage(options,active.signal);
      setState({status:'completed',result});
    } catch(failure) {if(failure.code==='ERR_CANCELED' || failure.code==='OPTIMIZATION_CANCELLED') setState(previous=>({...previous,status:'cancelled',message:'Stopped waiting for weather preparation.'}));else {setError(failure.response?.data?.detail || failure.message);setState(previous=>({...previous,status:'failed'}));}}
    finally {controller.current=null;}
  };
  return <details className="price-source-panel price-source-disclosure historical-weather-panel">
    <summary className="price-source-summary"><span className="price-source-summary-copy"><strong>Historical weather / PV cache</strong><small>{busy ? state?.message || 'Preparing weather…' : state?.status==='failed' ? 'Weather preparation failed · expand for details' : state?.status==='cancelled' ? 'Stopped waiting · check cache coverage' : stale ? 'Settings changed · check weather coverage' : coverageLabel}</small></span><span className="price-source-summary-badge">{modelLabel} · cache first</span></summary>
    <div className="price-source-body">
      <div role="status" aria-live="polite" className="weather-load-status" aria-busy={busy}>
        {busy ? <><strong>{state?.message || 'Preparing historical weather…'}</strong><progress aria-label="Historical weather preparation" /><span>Loading runs in the background. This panel updates automatically.</span></>
          : error || state?.status==='failed' ? <strong className="text-error">Weather preparation failed. {error || state?.error?.message || 'Please try loading missing weather again.'}</strong>
          : state?.status==='cancelled' ? <span>Stopped waiting. Check coverage to see which data has already been cached.</span>
          : stale ? <span>Settings changed. Check coverage or load weather for the new selection.</span>
          : report ? <><strong className={report.missing_days ? 'text-warning' : 'text-success'}>{action==='load' ? 'Weather loading finished.' : action==='check' ? 'Cache check finished; no download requested.' : 'Weather cache status.'} {report.complete_days} of {report.required_days} supported days are saved locally.</strong>
            {report.missing_days>0 ? <span>{report.missing_days} days are still missing. {controls && otherMissing.length>0 && 'Use “Load missing weather” to fetch available gaps.'}</span> : <span>All required weather is available. No further download is needed.</span>}
            {archivePending.length>0 && <span>{archivePending.length} missing day(s) are after the {modelLabel} preparation cutoff ({report.archive_preparation_cutoff}). These recent dates are not fetched yet; try again after the archive delay or choose an earlier end date. {model==='era5' && 'Alternatively, explicitly select ECMWF IFS and load its weather archive.'}</span>}
            {otherMissing.length>0 && <span>{otherMissing.length} missing day(s) are within the archive period. {report.errors?.length ? 'See weather preparation issues below.' : 'Load missing weather to request them.'}</span>}
            {missingDates.length>0 && <details><summary>Show missing dates ({missingDates.length})</summary><div className="weather-missing-dates">{missingDates.map(date=><div key={date}>{date}{archivePending.includes(date) ? ' · After archive cutoff' : ' · Not cached'}</div>)}</div></details>}
          </> : <span>Weather has not been checked yet. “Check weather coverage” only inspects the local cache; “Load missing weather” downloads available missing data.</span>}
      </div>
      <p className="text-sm text-muted">Historical PV uses a horizontal-irradiance model with a fixed 1000 W/m² reference. Production is modeled, not measured; orientation and shading are not included. No daily or annual peak normalization, bell-curve fallback or repeated missing day is used. The legacy PV profile selector does not apply in Daily Cyclic.</p>
      {controls && <><label className="form-label">Historical weather model</label><select className="form-input" disabled={busy} value={model} onChange={event=>setPvConfig(previous=>({...previous,weather_model:event.target.value}))}><option value="era5">ERA5 · consistent reanalysis · about 5 days delay</option><option value="ecmwf_ifs">ECMWF IFS · recent historical model data · from 2017</option></select><p className="text-xs text-muted mt-2">Each model has its own cache. Changing models requires loading its data; sources are never mixed automatically. IFS covers more recent dates, but the current day can still be incomplete.</p><label className="form-label mt-2">PV performance ratio (0–1)</label><input className="form-input" type="number" min="0.01" max="1" step="0.01" disabled={busy} value={pvConfig.performance_ratio ?? .85} onChange={event=>setPvConfig(previous=>({...previous,performance_ratio:Number(event.target.value)}))} />
        <p className="text-sm mt-2">Location: {options.latitude ?? 'not set'}, {options.longitude ?? 'not set'}. Historical source: {modelLabel}. Recent dates may not yet be available in this archive.</p>
        <div className="flex gap-2 mt-2" style={{flexWrap:'wrap'}}><button type="button" className="btn btn-outline" disabled={busy} onClick={()=>run(false)}>Check weather coverage</button><button type="button" className="btn btn-outline" disabled={busy} onClick={()=>run(true)}>{busy && action==='load' ? 'Loading weather…' : 'Load missing weather'}</button></div></>}
      {report && <><p className="text-sm mt-2">Snapshot: {report.first}–{report.last}, location {report.location?.latitude}, {report.location?.longitude}. {report.external_requests ?? 0} external HTTP requests. {report.model==='ecmwf_ifs' ? 'ECMWF IFS' : 'ERA5'} preparation cutoff: {report.archive_preparation_cutoff || 'not recorded'}. Raw irradiance and temperature are reusable after changing PV capacity. Missing dates remain excluded; a run is not extrapolated.</p><details><summary>Cache storage and provenance</summary><p className="text-xs">{report.persistence?.path}</p>{report.persistence?.warnings?.map(warning=><p key={warning} className="text-warning text-xs">{warning}</p>)}<p className="text-xs">Source/model, original UTC timestamps, units and actual weather grid coordinates are saved with each daily request/result.</p></details>
        {report.errors?.length>0 && <details><summary>Weather preparation issues ({report.errors.length})</summary>{report.errors.map((issue,i)=><p key={i} className="text-warning text-xs">{issue.start}–{issue.end}: {issue.message}</p>)}</details>}</>}
      {busy && controls && <button type="button" className="btn btn-outline mt-2" onClick={()=>controller.current?.abort()}>Stop waiting</button>}
      <p className="text-xs text-muted">Cancelling stops waiting; a shared cache import can finish in the background for later runs.</p>
    </div>
  </details>;
}
