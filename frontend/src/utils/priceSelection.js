export const priceSelection=project=>({source:project.meta?.price_provider || 'smard',allowFallback:project.meta?.price_energy_charts_fallback===true,priceWindowMinutes:Number(project.meta?.price_window_minutes || 15)});

export function priceLoadKey(project,date,hours,resolution) {
  return JSON.stringify({date,hours,resolution,...priceSelection(project)});
}

export function withMarketPrices(project,result,date,hours,resolution) {
  return {...project,pricing:result.prices,meta:{...project.meta,price_date:date,price_requested_date:date,price_unit:'EUR/MWh',
    price_source:result.selected_source,price_evidence:result,price_load_key:priceLoadKey({...project,meta:{...project.meta,
      price_window_minutes:result.price_aggregation?.window_minutes ?? result.request_selection?.priceWindowMinutes ?? 15,price_provider:result.selected_source,price_energy_charts_fallback:result.request_selection?.allowFallback===true}},date,hours,resolution),
    price_preview:result.prices.map((price,i)=>({price,time:new Date(result.timestamps[i]).toLocaleTimeString('en-GB',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'}),timestamp:Date.parse(result.timestamps[i])}))}};
}

export function marketPricesCurrent(project,date,hours,resolution) {
  return project.meta?.price_load_key===priceLoadKey(project,date,hours,resolution) && project.pricing?.length===hours*60/resolution;
}
