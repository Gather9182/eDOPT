import {flatRateSettings,flatRateIssues} from './flatRate.js';
export const priceSelection=project=>({source:project.meta?.price_provider || 'smard',allowFallback:project.meta?.price_energy_charts_fallback===true,priceWindowMinutes:Number(project.meta?.price_window_minutes || 15),flatRateEnabled:flatRateSettings(project).enabled,flatRateEurKwh:flatRateSettings(project).enabled ? flatRateSettings(project).eurKwh : null});

export function priceLoadKey(project,date,hours,resolution) {
  return JSON.stringify({date,hours,resolution,...priceSelection(project)});
}

export function withMarketPrices(project,result,date,hours,resolution) {
  return {...project,pricing:result.prices,meta:{...project.meta,price_date:date,price_requested_date:date,price_unit:'EUR/MWh',
    price_source:result.selected_source,price_evidence:result,price_load_key:priceLoadKey({...project,meta:{...project.meta,
      price_window_minutes:result.price_aggregation?.window_minutes ?? result.request_selection?.priceWindowMinutes ?? 15,flat_rate_enabled:result.price_mode==='flat_rate',flat_rate_eur_kwh:result.price_mode==='flat_rate' ? result.flat_rate_base_eur_kwh : project.meta?.flat_rate_eur_kwh,price_provider:result.selected_source==='flat_rate' ? project.meta?.price_provider : result.selected_source,price_energy_charts_fallback:result.request_selection?.allowFallback===true}},date,hours,resolution),
    price_preview:result.prices.map((price,i)=>({price,time:result.price_mode==='flat_rate' ? `${String(Math.floor(i*resolution/60)%24).padStart(2,'0')}:${String(i*resolution%60).padStart(2,'0')}` : new Date(result.timestamps[i]).toLocaleTimeString('en-GB',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'}),timestamp:Date.parse(result.timestamps[i])}))}};
}

export function marketPricesCurrent(project,date,hours,resolution) {
  if (flatRateSettings(project).enabled) return flatRateIssues(project).length===0;
  return project.meta?.price_load_key===priceLoadKey(project,date,hours,resolution) && project.pricing?.length===hours*60/resolution;
}
