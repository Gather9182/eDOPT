import {buildSolverInputs,effectivePrices} from './solverInputs.js';
import {mergeSocPolicies} from './socPolicy.js';

const sum = values => values.reduce((total,value) => total+value,0);
const close = (a,b,tolerance=.001) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=tolerance;

function blocked(site) {
  return (site.no_switch_windows || []).some(window => {
    const minutes=value=>value.split(':').reduce((hours,part)=>hours*60+Number(part),0);
    const start=minutes(window.start),end=minutes(window.end);
    return start===end || start>end || start===0 && end>0;
  });
}

export function dailyConfigurationIssues(project,settings,scenario) {
  const messages=[];
  if (scenario!=='baseline') messages.push('Daily Cyclic currently supports Baseline only. Select it explicitly; your scenario has not been changed.');
  if (!Number.isInteger(settings.time_resolution) || 1440%settings.time_resolution) messages.push('Daily Cyclic requires a resolution dividing 1440 minutes exactly.');
  for (const bus of project.buses || []) for (const visit of bus.opportunity_visits || []) {
    if (visit.pause_start_min<0 || visit.pause_end_min>1440) messages.push(`Route ${bus.id}: optional charging visits crossing midnight are not supported in Daily Cyclic. Use Flexible Long-Term; no options were removed.`);
  }
  return messages.map(message=>({type:'ERROR',category:'data',code:'DAILY_CYCLIC_CONFIGURATION',message}));
}

export function verifyDailyResult(request,result,previous=null,configuredInitial=null) {
  const ids=request.buses.map(bus=>String(bus.id));
  if (!/^(Optimal|Feasible)(?:$| \()/.test(result.status || '')) throw new Error(`Daily solver did not return a usable schedule: ${result.status || 'unknown status'}.`);
  const dt=request.time_step_minutes/60;
  const n=request.electricity_prices.length;
  if (result.grid_import_profile?.length!==n || result.aggregated_load_profile?.length!==n) throw new Error('Incomplete daily fleet profiles.');
  const cost=sum(result.grid_import_profile.map((power,t)=>power*dt*request.electricity_prices[t]/1000));
  const energy=sum(result.aggregated_load_profile)*dt/1000;
  if (!close(cost,result.total_cost_eur,Math.max(.02,Math.abs(cost)*1e-5)) || !close(energy,result.total_energy_mwh,.000002)) throw new Error('Daily cost or energy reconciliation failed.');
  const proofs=[];
  for (const bus of request.buses) {
    const soc=result.soc_profiles?.[bus.id];
    if (soc?.length!==n+1 || result.schedules?.[bus.id]?.length!==n) throw new Error(`Route ${bus.id}: incomplete daily battery or charging profile.`);
    if (!close(soc[0],bus.initial_soc_kwh) || !close(soc.at(-1),soc[0]) || !close(soc.at(-1),configuredInitial?.[bus.id] ?? bus.initial_soc_kwh)
        || previous && !close(soc[0],previous.soc_profiles[bus.id].at(-1))) throw new Error(`Route ${bus.id}: daily cyclic SoC or inter-day continuity check failed.`);
    const connections=result.connection_schedules?.[bus.id];
    if (request.charging_sites?.length && (connections?.length!==n || result.final_connections?.[bus.id]===undefined)) throw new Error(`Route ${bus.id}: missing connection evidence.`);
    const inherited=bus.initial_connection_site;
    if (inherited != null) for (const site of request.charging_sites || []) {
      const presence=bus.site_presence?.[site.id]?.[0];
      const arrival=bus.site_arrivals?.[site.id]?.[0];
      if (presence && !arrival && blocked(site) && (connections[0]===site.id)!==(inherited===site.id)) throw new Error(`Route ${bus.id}: illegal connector change at midnight.`);
    }
    proofs.push({bus_id:bus.id,initial_soc_kwh:soc[0],final_soc_kwh:soc.at(-1),difference_kwh:soc.at(-1)-soc[0],
      previous_final_soc_kwh:previous?.soc_profiles?.[bus.id]?.at(-1) ?? null,initial_connection:connections?.[0] ?? '',
      previous_final_connection:inherited,final_connection:result.final_connections?.[bus.id] ?? '',compliant:true});
  }
  if (Object.keys(result.schedules || {}).sort().join('|')!==[...ids].sort().join('|')) throw new Error('The daily result fleet differs from the requested fleet. No routes may be silently excluded.');
  return {cost_eur:cost,charger_energy_mwh:energy,grid_energy_kwh:sum(result.grid_import_profile)*dt,proofs};
}

export async function runDailyCyclic({project,settings,buses,dates,fetchPrices,optimize,checkpoint,notify=()=>{}}) {
  const records=[];
  let previous=null,initialConnections,initialEnergies={};
  const configured=Object.fromEntries(buildSolverInputs(project,settings,{buses,hours:24,daily:true}).buses.map(bus=>[bus.id,bus.initial_soc_kwh]));
  for (const [index,date] of dates.entries()) {
    let request=null,prices=null,result=null;
    try {
      notify(`Daily Cyclic: day ${index+1}/${dates.length} (${date}) — loading historical prices.`);
      prices=await fetchPrices(date);
      const n=1440/settings.time_resolution;
      if (prices.date!==date || prices.coverage!=='complete' || prices.market_prices?.length!==n || prices.timestamps?.length!==n) throw new Error(`${date}: incomplete or mismatched historical prices.`);
      request=buildSolverInputs(project,settings,{buses,hours:24,scenario:'baseline',daily:true,cyclicConnections:true,
        marketPrices:prices.market_prices,prices:effectivePrices(prices.market_prices,project.meta?.price_assumptions),initialConnections,initialEnergies});
      notify(`Daily Cyclic: day ${index+1}/${dates.length} (${date}) — optimizing.`);
      result=await optimize(request,{date,day_index:index,chunk_number:index+1,global_start_period:index*n,global_start_minute:index*1440});
      const reconciliation=verifyDailyResult(request,result,previous,configured);
      const record={date,day_index:index,status:'completed',request,prices,result,reconciliation};
      await checkpoint(record);
      records.push(record);
      previous=result;
      initialEnergies=Object.fromEntries(buses.map(bus=>[bus.id,result.soc_profiles[bus.id].at(-1)]));
      initialConnections=request.charging_sites?.length ? {...result.final_connections} : undefined;
    } catch (error) {
      const cancelled=error.code==='OPTIMIZATION_CANCELLED';
      const failure={date,day_index:index,status:cancelled ? 'cancelled' : 'failed',request,prices,solver_result:result,error:{detail:error.response?.data?.detail || error.message,diagnostics:error.response?.data?.diagnostics || null}};
      records.push(failure);
      await checkpoint(failure);
      records.push(...dates.slice(index+1).map((later,j)=>({date:later,day_index:index+j+1,status:'not_calculated'})));
      return {status:records.some(row=>row.status==='completed') ? 'partial' : cancelled ? 'cancelled' : 'failed',records,dates,error};
    }
  }
  return {status:'completed',records,dates};
}

export function aggregateDailyRun(run) {
  const good=run.records.filter(row=>row.status==='completed');
  if (!good.length) return null;
  const results=good.map(row=>row.result),first=results[0];
  const payload={scenario:'baseline',is_long_term:true,total_days:good.length,requested_days:run.dates.length,run_status:run.status,
    long_term_mode:'daily_cyclic',timetable_scope:'The same configured daily timetable is repeated on every date. No weekend/holiday timetable or global multi-day optimum.',
    day_records:run.records.map(row=>({date:row.date,day_index:row.day_index,status:row.status,reconciliation:row.reconciliation,error:row.error,
      market_prices:row.prices?.market_prices,effective_prices:row.request?.electricity_prices,timestamps:row.prices?.timestamps})),
    daily_results:good.map(row=>({date:row.date,day_index:row.day_index,request:row.request,prices:row.prices,result:row.result})),
    failed_attempts:run.records.filter(row=>row.status==='failed' || row.status==='cancelled'),
    total_cost_eur:sum(good.map(row=>row.reconciliation.cost_eur)),total_energy_mwh:sum(good.map(row=>row.reconciliation.charger_energy_mwh)),
    peak_load_kw:Math.max(...results.map(result=>Math.max(...result.aggregated_load_profile))),
    schedules_by_day:results.map(result=>result.schedules),soc_profiles_by_day:results.map(result=>result.soc_profiles),diagnostics_by_day:results.map(result=>result.bus_diagnostics),
    final_connections:results.at(-1).final_connections,charging_curve:first.charging_curve,
    baseline_feasible:results.every(result=>result.baseline_feasible===true),baseline_issues:[...new Set(results.flatMap(result=>result.baseline_issues || []))],
    baseline_cost_eur:results.every(result=>result.baseline_feasible===true && Number.isFinite(result.baseline_cost_eur)) ? sum(results.map(result=>result.baseline_cost_eur)) : null,
    basic_optimized_cost_eur:null,soc_policy:mergeSocPolicies(results.map((result,day)=>result.soc_policy?.min_mode ? {...result.soc_policy,
      violations:(result.soc_policy.violations || []).map(row=>({...row,minute:row.minute+day*1440,date:good[day].date,day_index:day}))} : null).filter(Boolean)),
    end_condition:{mode:'cyclic_soc',daily:true,tolerance_kwh:.001,buses:good.flatMap(row=>row.reconciliation.proofs.map(proof=>({...proof,date:row.date,day_index:row.day_index,target_soc_kwh:proof.initial_soc_kwh})))}};
  for (const field of ['aggregated_load_profile','grid_import_profile','baseline_aggregated_load_profile','electricity_prices','market_prices']) payload[field]=results.flatMap(result=>result[field] || []);
  for (const field of ['bess_charge_profile','bess_discharge_profile','bess_soc_profile','pv_yield_profile','pv_used_profile','pv_curtailed_profile','pv_to_bus_profile','grid_to_bus_profile','bess_to_bus_profile','bess_charge_from_pv_profile','bess_charge_from_grid_profile','ambient_temperature_profile_c','bess_cell_temperature_profile_c','bess_capacity_factor_profile','bess_max_usable_capacity_profile_kwh']) payload[field]=results.flatMap(result=>result[field] || []);
  for (const field of ['total_pv_generated_kwh','total_pv_used_kwh','total_pv_curtailed_kwh','total_bess_throughput_kwh']) payload[field]=sum(results.map(result=>result[field] || 0));
  for (const field of ['connection_schedules','site_load_profiles','site_grid_import_profiles','site_occupied_connectors','additional_trip_energy_profiles']) {
    payload[field]={};
    for (const result of results) for (const [id,values] of Object.entries(result[field] || {})) (payload[field][id] ||= []).push(...values);
  }
  payload.additional_trips={};
  payload.opportunity_charging_visits=[];
  for (const [day,result] of results.entries()) {
    for (const [id,trips] of Object.entries(result.additional_trips || {})) (payload.additional_trips[id] ||= []).push(...trips.map(trip=>({...trip,start_min:trip.start_min+day*1440,end_min:trip.end_min+day*1440})));
    payload.opportunity_charging_visits.push(...(result.opportunity_charging_visits || []).map(visit=>({...visit,...Object.fromEntries(['departure_min','charger_arrival_min','return_departure_min','return_arrival_min'].map(key=>[key,visit[key]+day*1440]))})));
  }
  return payload;
}
