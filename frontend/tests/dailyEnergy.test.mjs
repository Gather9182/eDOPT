import test from 'node:test';
import assert from 'node:assert/strict';
import {runDailyCyclic,aggregateDailyRun,verifyDailyResult} from '../src/utils/dailyCyclic.js';

const bus={id:'B',max_battery_capacity_kwh:20,max_power_kw:40,efficiency:1,initial_soc_kwh:10,min_final_soc_kwh:0,
 availability:[0,1],site_availability:{D:[0,1]},site_presence:{D:[1,1]},site_arrivals:{D:[0,0]},trip_energy_profile_kwh:[5,0],initial_connection_site:'D'};
const project={buses:[bus],constraints:{},pricing:[100,200],meta:{time_resolution:720,initial_soc_fraction:.5,min_final_soc_fraction:0,
 price_assumptions:{pricing_mode:'effective',supplier_markup:0}},charging:{enabled:true,energy_site_id:'D',sites:[{id:'D',nodes:['D'],num_chargers:1,charger_power_kw:40,charger_capacity_kw:40,grid_limit_kw:40,lock_charging_mode:'optimized',no_switch_windows:[{start:'00:00',end:'00:00'}]}]}};
const settings={planning_horizon:24,time_resolution:720,charger_capacity_kw:40,grid_limit_kw:40};
const storage={capacity_kwh:20,initial_soc_kwh:10,min_soc_kwh:0,max_soc_kwh:20,max_charge_power_kw:5,max_discharge_power_kw:5,efficiency:1};
function solved(request) {
 const power=5/12,pv=request.pv_config?.profile_kw || [0,0],used=Math.min(power,pv[1]),grid=power-used;
 return {scenario:request.scenario,status:'Optimal',schedules:{B:[0,power]},soc_profiles:{B:[10,5,10]},connection_schedules:{B:['D','D']},final_connections:{B:'D'},
  aggregated_load_profile:[0,power],grid_import_profile:[0,grid],electricity_prices:request.electricity_prices,market_prices:request.market_prices,
  total_cost_eur:grid*12*request.electricity_prices[1]/1000,total_energy_mwh:grid*12/1000,
  grid_to_bus_profile:[0,grid],pv_to_bus_profile:[0,used],bess_to_bus_profile:[0,0],pv_yield_profile:pv,pv_used_profile:[0,used],pv_curtailed_profile:[0,pv[1]-used],
  bess_charge_profile:[0,0],bess_discharge_profile:[0,0],bess_charge_from_grid_profile:[0,0],bess_charge_from_pv_profile:[0,0],bess_soc_profile:[10,10,10],
  site_load_profiles:{D:[0,power]},site_grid_import_profiles:{D:[0,grid]},site_occupied_connectors:{D:[1,1]},baseline_feasible:false};
}

test('parallel daily PV+BESS varies weather, retains physical boundaries and separates grid from bus energy',async()=>{
 const requests=[];
 const run=await runDailyCyclic({project,settings,buses:[bus],scenario:'pv_bess',pvConfig:{capacity_kw:1},bessConfig:storage,concurrency:4,
  dates:['2025-12-10','2025-12-11'],fetchPrices:async date=>({date,coverage:'complete',market_prices:[100,200],timestamps:['a','b']}),
  fetchWeather:async date=>({date,coverage:'complete',pv_profile_kw:[0,date==='2025-12-10' ? .5 : 0],snapshot_hash:date}),
  optimize:async request=>{requests.push(request);return solved(request);},checkpoint:async()=>{}});
 assert.equal(run.status,'completed');assert.equal(requests.length,2);
 assert.equal(requests[0].weather_evidence.snapshot_hash,'2025-12-10');
 assert.equal(requests[1].pv_config.profile_kw[1],0);
 const result=aggregateDailyRun(run);
 assert.equal(result.scenario,'pv_bess');assert.equal(result.total_energy_mwh,.005);
 assert.equal(result.total_bus_charging_energy_mwh,.01);assert.equal(result.bess_cycles.length,2);
 assert.equal(result.bess_soc_profile.length,5);
 const invalid=solved(requests[0]);invalid.bess_soc_profile[2]=9;
 assert.throws(()=>verifyDailyResult(requests[0],invalid),/Start SoC = End SoC/);
});

test('missing required historical PV excludes that date without dropping remaining dates',async()=>{
 const run=await runDailyCyclic({project,settings,buses:[bus],scenario:'pv',pvConfig:{capacity_kw:1},concurrency:1,retryPriceFailures:false,
  dates:['2025-12-10','2025-12-11'],fetchPrices:async date=>({date,coverage:'complete',market_prices:[100,200],timestamps:['a','b']}),
  fetchWeather:async date=>{if(date==='2025-12-10') throw new Error('WEATHER_MISSING');return {date,coverage:'complete',pv_profile_kw:[0,.5]};},
  optimize:async request=>solved(request),checkpoint:async()=>{}});
 assert.deepEqual(run.records.map(row=>row.status),['failed','completed']);
 assert.equal(aggregateDailyRun(run).total_days,1);assert.match(run.records[0].error.detail,/WEATHER_MISSING/);
});

test('cancelling during weather loading starts no solver and preserves cancellation status',async()=>{
 const controller=new AbortController();let calls=0;
 const run=await runDailyCyclic({project,settings,buses:[bus],scenario:'pv',pvConfig:{capacity_kw:1},concurrency:1,
  signal:controller.signal,dates:['2025-12-10','2025-12-11'],
  fetchPrices:async date=>({date,coverage:'complete',market_prices:[100,200],timestamps:['a','b']}),
  fetchWeather:async()=>{controller.abort();const error=new Error('cancelled');error.code='ERR_CANCELED';throw error;},
  optimize:async()=>{calls++;},checkpoint:async()=>{}});
 assert.equal(calls,0);assert.equal(run.status,'cancelled');
 assert.deepEqual(run.records.map(row=>row.status),['cancelled','not_calculated']);
});

test('serial fallback exposes the actual seed failure instead of blaming host memory',async()=>{
 let first=true;const phases=[];
 const run=await runDailyCyclic({project,settings,buses:[bus],scenario:'pv',pvConfig:{capacity_kw:1},concurrency:4,retryPriceFailures:false,
  dates:['2025-12-10','2025-12-11'],fetchPrices:async date=>({date,coverage:'complete',market_prices:[100,200],timestamps:['a','b']}),
  fetchWeather:async date=>({date,coverage:'complete',pv_profile_kw:[0,.5]}),
  optimize:async request=>{if(first){first=false;const error=new Error('Request failed with status code 400');error.response={status:400,data:{detail:'Reference solve exceeded time limit without a feasible solution'}};throw error;}return solved(request);},
  checkpoint:async()=>{},onExecution:phase=>phases.push(phase)});
 assert.equal(run.status,'completed');assert.equal(run.execution.used_workers,1);
 const fallback=phases.find(phase=>phase.mode==='fallback');
 assert.equal(fallback.seed_failure.http_status,400);
 assert.match(fallback.seed_failure.detail,/exceeded time limit/);
 assert.match(fallback.fallback_reason,/2025-12-10/);
});

test('stored inactive PV/BESS settings do not prevent four parallel jobs in any scenario',async()=>{
 for(const scenario of ['baseline','pv','bess','pv_bess']) {
  let active=0,maximum=0;const requests=[];
  const dates=['2025-12-10','2025-12-11','2025-12-12','2025-12-13','2025-12-14'];
  const pvConfig={capacity_kw:1,profile_mode:'open_meteo',weather_model:'era5',reference_date:'2025-01-01'};
  const snapshot=JSON.stringify({pvConfig,storage});
  const run=await runDailyCyclic({project,settings,buses:[bus],scenario,pvConfig,bessConfig:storage,concurrency:4,dates,
   fetchPrices:async date=>({date,coverage:'complete',market_prices:[100,200],timestamps:['a','b']}),
   fetchWeather:async date=>({date,coverage:'complete',pv_profile_kw:[0,.5]}),
   optimize:async request=>{requests.push(request);active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return solved(request);},checkpoint:async()=>{}});
  assert.equal(run.status,'completed',scenario);
  assert.equal(run.execution.used_workers,4,scenario);assert.equal(maximum,4,scenario);
  assert.ok(requests.every(request=>Boolean(request.pv_config)===['pv','pv_bess'].includes(scenario)));
  assert.ok(requests.every(request=>Boolean(request.bess_config)===['bess','pv_bess'].includes(scenario)));
  assert.equal(JSON.stringify({pvConfig,storage}),snapshot);
 }
});
