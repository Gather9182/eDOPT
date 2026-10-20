import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSolverInputs,effectivePrices} from '../src/utils/solverInputs.js';
import {runDailyCyclic,aggregateDailyRun,verifyDailyResult,dailyConfigurationIssues} from '../src/utils/dailyCyclic.js';
import {optimizationFleet} from '../src/utils/optimizationFleet.js';
import {endConditionIssues} from '../src/utils/socPolicy.js';
import {resultAnalysisFiles} from '../src/utils/resultAnalysisExport.js';
import {cancellationError} from '../src/utils/optimizationProgress.js';

test('cancellation retains completed days and does not start a later day',async()=>{
  const input=fixture();let calls=0;
  const run=await runDailyCyclic({...input,dates:['2026-02-02','2026-02-03','2026-02-04'],
    fetchPrices:async date=>priceDay(date),optimize:async request=>{
      if (++calls===2) throw cancellationError();return solved(request);
    },checkpoint:async()=>{}});
  assert.equal(calls,2);
  assert.equal(run.status,'partial');
  assert.deepEqual(run.records.map(row=>row.status),['completed','cancelled','not_calculated']);
  const result=aggregateDailyRun(run);
  assert.equal(result.total_days,1);
  assert.equal(result.failed_attempts[0].status,'cancelled');
});

function fixture() {
  const bus={id:'B',max_battery_capacity_kwh:20,max_power_kw:40,efficiency:1,initial_soc_kwh:10,min_final_soc_kwh:0,
    initial_connection_site:'D',availability:[0,1],site_availability:{D:[0,1]},site_presence:{D:[1,1]},site_arrivals:{D:[0,0]},trip_energy_profile_kwh:[5,0]};
  const project={buses:[bus,{...bus,id:'EXCLUDED'}],pricing:[100,200],meta:{excluded_bus_ids:['EXCLUDED'],initial_soc_fraction:.5,min_final_soc_fraction:0,time_resolution:720,
    price_assumptions:{pricing_mode:'effective',supplier_markup:7,variable_network_charge:3,electricity_tax:0,other_variable_levies:0,use_vat:false}},
    constraints:{},charging:{enabled:true,sites:[{id:'D',nodes:['D'],num_chargers:1,charger_power_kw:40,charger_capacity_kw:40,grid_limit_kw:40,
      lock_charging_mode:'automatic_balanced',no_switch_windows:[{start:'00:00',end:'00:00'}],allow_connect_on_arrival:true}]}};
  const settings={planning_horizon:24,time_resolution:720,charger_capacity_kw:0,grid_limit_kw:0,num_chargers:0,use_cyclic_soc:true,use_next_day_readiness:false,
    operating_min_soc_mode:'hard',operating_min_soc_fraction:.1,operating_max_soc_enabled:true,operating_max_soc_mode:'soft',operating_max_soc_fraction:.9};
  return {project,settings,buses:optimizationFleet(project).included};
}
function solved(request) {
  const p=5/12,price=request.electricity_prices[1];
  return {status:'Optimal (Baseline Optimized)',scenario:'baseline',schedules:{B:[0,p]},soc_profiles:{B:[10,5,10]},grid_import_profile:[0,p],aggregated_load_profile:[0,p],
    total_cost_eur:5*price/1000,total_energy_mwh:.005,peak_load_kw:p,electricity_prices:request.electricity_prices,market_prices:request.market_prices,
    connection_schedules:{B:['D','D']},final_connections:{B:'D'},site_load_profiles:{D:[0,p]},site_grid_import_profiles:{D:[0,p]},site_occupied_connectors:{D:[1,1]},baseline_feasible:false,
    baseline_cost_eur:null,baseline_issues:['No valid reference'],bus_diagnostics:[{id:'B'}]};
}
const priceDay=(date,market=[100,200])=>({date,coverage:'complete',market_prices:market,timestamps:[`${date}T00:00:00+01:00`,`${date}T12:00:00+01:00`]});

test('shared request keeps selected fleet, SoC settings, zero reserve and technical rules unchanged',()=>{
  const {project,settings,buses}=fixture();
  const before=JSON.stringify({project,settings});
  const short=buildSolverInputs(project,settings,{buses});
  const daily=buildSolverInputs(project,settings,{buses,daily:true,hours:24});
  const {daily_cyclic,...rest}=daily;
  assert.equal(daily_cyclic,true);
  assert.deepEqual(rest,short);
  assert.equal(short.buses.length,1);
  assert.equal(short.buses[0].min_final_soc_kwh,0);
  assert.equal(short.charging_sites[0].allow_connect_on_arrival,false);
  assert.equal(short.operating_min_soc_mode,'hard');
  assert.equal(JSON.stringify({project,settings}),before);
  assert.deepEqual(effectivePrices([-20,0],{pricing_mode:'effective',supplier_markup:10,use_vat:true}),[-12,12]);
});

test('two days use actual daily prices, inherit states and produce verified aggregate evidence',async()=>{
  const input=fixture(),requests=[],checkpoints=[];
  const run=await runDailyCyclic({...input,dates:['2026-02-02','2026-02-03'],fetchPrices:async date=>priceDay(date,date.endsWith('03')?[200,300]:[100,200]),
    optimize:async request=>{requests.push(request);return solved(request);},checkpoint:async record=>checkpoints.push(record)});
  assert.equal(run.status,'completed');
  assert.equal(requests[1].buses[0].initial_connection_site,'D');
  assert.equal(requests[1].buses[0].initial_soc_kwh,10);
  assert.deepEqual(requests.map(request=>request.electricity_prices),[[110,210],[210,310]]);
  assert.deepEqual(requests[0].buses,requests[1].buses);
  const result=aggregateDailyRun(run);
  assert.equal(result.total_cost_eur,2.6);
  assert.equal(result.total_energy_mwh,.01);
  assert.equal(result.end_condition.buses.length,2);
  assert.equal(result.baseline_cost_eur,null);
  assert.equal(checkpoints.length,2);
  result.run_metadata={inputs:requests[0]};
  const {files,manifest}=await resultAnalysisFiles(result,input.project,async()=>null);
  assert.equal(manifest.long_term_mode,'daily_cyclic');
  assert.ok(files.find(file=>file.name==='run/days/day_00002/request.json'));
  assert.match(files.find(file=>file.name==='tables/daily_prices.csv').data,/310/);
});

test('failure at day 2 retains day 1 and marks remaining days uncalculated without exclusions',async()=>{
  const input=fixture(),saved=[];
  const run=await runDailyCyclic({...input,dates:['2026-02-02','2026-02-03','2026-02-04'],fetchPrices:async date=>{
    if(date.endsWith('03')) throw new Error('Missing source prices');return priceDay(date);
  },optimize:async request=>solved(request),checkpoint:async record=>saved.push(record)});
  assert.equal(run.status,'partial');
  assert.deepEqual(run.records.map(row=>row.status),['completed','failed','not_calculated']);
  const result=aggregateDailyRun(run);
  assert.equal(result.total_days,1);assert.equal(result.requested_days,3);
  assert.equal(result.daily_results.length,1);
  assert.deepEqual(input.project.meta.excluded_bus_ids,['EXCLUDED']);
  assert.equal(saved.length,2);
});

test('invalid daily result is not retained as successful and has no silent SoC reset',async()=>{
  const input=fixture();
  const run=await runDailyCyclic({...input,dates:['2026-02-02'],fetchPrices:async date=>priceDay(date),
    optimize:async request=>({...solved(request),soc_profiles:{B:[10,5,9]}}),checkpoint:async()=>{}});
  assert.equal(run.status,'failed');assert.equal(aggregateDailyRun(run),null);
  assert.match(run.records[0].error.detail,/cyclic/);
});

test('midnight switching and inconsistent cost evidence are rejected',()=>{
  const {project,settings,buses}=fixture();
  const request=buildSolverInputs(project,settings,{buses,daily:true});
  const result=solved(request);
  assert.throws(()=>verifyDailyResult(request,{...result,connection_schedules:{B:['','D']}}),/connector/);
  assert.throws(()=>verifyDailyResult(request,{...result,total_cost_eur:500}),/reconciliation/);
});

test('daily mode overrides only its own end condition and refuses unsupported scenarios/overnight visits',()=>{
  const {project,settings,buses}=fixture();
  const request=buildSolverInputs(project,{...settings,use_cyclic_soc:false,use_next_day_readiness:true},{buses,daily:true});
  assert.equal(request.use_next_day_readiness,false);assert.equal(request.use_cyclic_soc,true);
  assert.equal(dailyConfigurationIssues({...project,buses},settings,'pv').length,1);
  assert.deepEqual(endConditionIssues({...settings,use_next_day_readiness:true},'daily_cyclic'),[]);
  assert.ok(dailyConfigurationIssues({...project,buses:[{...buses[0],opportunity_visits:[{pause_start_min:1300,pause_end_min:1500}]}]},settings,'baseline').length);
  for (const hours of [24,48,72]) {
    const flexible=buildSolverInputs(project,{...settings,use_cyclic_soc:false},{buses,hours,cyclicConnections:false,initialEnergies:{B:7},initialConnections:{B:''}});
    assert.equal(flexible.use_cyclic_soc,false);assert.equal(flexible.planning_horizon_hours,hours);assert.equal(flexible.buses[0].initial_soc_kwh,7);
    assert.equal(flexible.buses[0].initial_connection_site,'');
  }
});
