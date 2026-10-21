import {effectivePrices} from './priceAssumptions.js';

export function flatRateSettings(project) {
  return {enabled:project.meta?.flat_rate_enabled===true,compareArrival:project.meta?.flat_rate_enabled!==true && project.meta?.flat_rate_compare_arrival===true,
    eurKwh:project.meta?.flat_rate_eur_kwh==='' ? NaN : Number(project.meta?.flat_rate_eur_kwh ?? .2)};
}

export function flatRateIssues(project) {
  const config=flatRateSettings(project);
  return (config.enabled || config.compareArrival) && (!Number.isFinite(config.eurKwh) || config.eurKwh<0)
    ? [{type:'ERROR',category:'data',code:'INVALID_FLAT_RATE',message:'Flat rate must be a finite, non-negative price in EUR/kWh.'}] : [];
}

export function applyFlatRateInputs(project,inputs) {
  const config=flatRateSettings(project);
  if (!config.enabled && !config.compareArrival) return inputs;
  const issues=flatRateIssues(project);
  if (issues.length) throw new Error(issues[0].message);
  // Flat rate is a procurement price; configured fees and VAT apply even if the chart shows spot prices only.
  const effective=effectivePrices([config.eurKwh*1000],project.meta?.price_assumptions ? {...project.meta.price_assumptions,pricing_mode:'effective'} : undefined)[0];
  const periods=inputs.planning_horizon_hours*60/inputs.time_step_minutes;
  return {...inputs,price_mode:config.enabled ? 'flat_rate' : 'market',
    flat_rate_base_eur_kwh:config.eurKwh,flat_rate_effective_eur_mwh:effective,
    arrival_flat_rate_eur_mwh:config.compareArrival ? effective : null,
    ...(config.enabled ? {electricity_prices:Array(periods).fill(effective),market_prices:Array(periods).fill(config.eurKwh*1000)} : {})};
}

export function flatRateQuotes(date,hours,resolution,eurKwh) {
  if (!Number.isFinite(eurKwh) || eurKwh<0 || !Number.isInteger(hours*60/resolution)) throw new Error('Invalid flat-rate price or time grid.');
  // These are nominal model slots, not observed market timestamps or a historical price claim.
  const start=Date.parse(`${date}T00:00:00Z`);
  return {date,prices:Array(hours*60/resolution).fill(eurKwh*1000),market_prices:Array(hours*60/resolution).fill(eurKwh*1000),
    timestamps:Array.from({length:hours*60/resolution},(_,i)=>new Date(start+i*resolution*60000).toISOString()),
    selected_source:'flat_rate',source:'User-defined flat rate',coverage:'complete',unit:'EUR/MWh',
    price_mode:'flat_rate',flat_rate_base_eur_kwh:eurKwh,timestamp_scope:'Nominal model slots; not observed market timestamps',source_intervals:[]};
}

export function mergeFlatRateResults(results) {
  const priced=results.filter(result=>result.price_assumption?.mode==='flat_rate');
  const compared=results.filter(result=>result.flat_rate_comparison?.enabled);
  const first=compared[0]?.flat_rate_comparison;
  const comparable=compared.length===results.length && compared.every(result=>result.flat_rate_comparison.comparable===true && Number.isFinite(result.flat_rate_comparison.baseline_cost_eur));
  const cost=comparable ? compared.reduce((sum,result)=>sum+result.flat_rate_comparison.baseline_cost_eur,0) : null;
  return {...(priced.length===results.length && results.length ? {price_assumption:priced[0].price_assumption} : {}),
    ...(compared.length ? {flat_rate_comparison:{...first,comparable,baseline_cost_eur:cost,
      savings_eur:comparable ? cost-results.reduce((sum,result)=>sum+result.total_cost_eur,0) : null,
      reason:comparable ? '' : 'Charge-on-arrival is not a validated feasible reference for every included period.'}} : {})};
}

export function priceEvidenceForRun(project) {
 const config=flatRateSettings(project);
 return config.enabled ? {price_mode:'flat_rate',source:'User-defined flat rate',flat_rate_base_eur_kwh:config.eurKwh,market_source_used:false} : project.meta?.price_evidence;
}
