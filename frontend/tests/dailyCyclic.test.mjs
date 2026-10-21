import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSolverInputs,effectivePrices,solverTimeLimitIssues} from '../src/utils/solverInputs.js';
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
  return {project,settings,buses:optimizationFleet(project).included,concurrency:1};
}
function solved(request) {
  const p=5/12,price=request.electricity_prices[1];
  return {status:'Optimal (Baseline Optimized)',scenario:'baseline',schedules:{B:[0,p]},soc_profiles:{B:[10,5,10]},grid_import_profile:[0,p],aggregated_load_profile:[0,p],
    total_cost_eur:5*price/1000,total_energy_mwh:.005,peak_load_kw:p,electricity_prices:request.electricity_prices,market_prices:request.market_prices,
    connection_schedules:{B:['D','D']},final_connections:{B:'D'},site_load_profiles:{D:[0,p]},site_grid_import_profiles:{D:[0,p]},site_occupied_connectors:{D:[1,1]},baseline_feasible:false,
    baseline_cost_eur:null,baseline_issues:['No valid reference'],bus_diagnostics:[{id:'B'}]};
}
const priceDay=(date,market=[100,200])=>({date,coverage:'complete',market_prices:market,timestamps:[`${date}T00:00:00+01:00`,`${date}T12:00:00+01:00`]});

test('a full annual run skips only declared DST dates in serial and parallel execution and exports their reasons',async()=>{
  const dates=Array.from({length:365},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
  const excludedDates=[{date:'2025-03-30',local_day_hours:23,code:'DST_DAY_SKIPPED',reason:'23-hour daylight-saving day'},
    {date:'2025-10-26',local_day_hours:25,code:'DST_DAY_SKIPPED',reason:'25-hour daylight-saving day'}];
  for (const concurrency of [1,4]) {
    const input=fixture(),fetched=[],saved=[],statuses=[];
    const run=await runDailyCyclic({...input,dates,excludedDates,concurrency,
      fetchPrices:async date=>{fetched.push(date);return priceDay(date);},optimize:async request=>solved(request),
      checkpoint:async row=>saved.push(row),onDayProgress:row=>statuses.push(row)});
    assert.equal(run.finished,true);assert.equal(run.status,'partial');
    assert.equal(fetched.length,363);assert.equal(new Set(saved.map(row=>row.date)).size,365);
    assert.ok(excludedDates.every(day=>!fetched.includes(day.date)));
    assert.deepEqual(run.records.filter(row=>row.status==='skipped').map(row=>row.date),excludedDates.map(row=>row.date));
    assert.equal(run.records.at(-1).status,'completed');
    assert.equal(statuses.filter(row=>row.status==='skipped').length,2);
    const result=aggregateDailyRun(run);
    assert.equal(result.total_days,363);assert.equal(result.requested_days,365);
    assert.equal(result.skipped_dates.length,2);assert.equal(result.failed_attempts.length,0);
    assert.ok(Math.abs(result.total_energy_mwh-363*.005)<1e-9);
    assert.ok(Math.abs(result.total_cost_eur-363*1.05)<1e-8);
    const {files}=await resultAnalysisFiles(result,input.project,async()=>null);
    const status=JSON.parse(files.find(file=>file.name==='run/days/status.json').data);
    assert.equal(status.dst_policy,'skip');assert.deepEqual(status.skipped_dates,excludedDates);
    const csv=files.find(file=>file.name==='tables/daily_summary.csv').data;
    assert.ok(csv.includes('DST_DAY_SKIPPED'));assert.ok(csv.includes('23-hour daylight-saving day'));
  }
});

test('a skipped first date selects the next valid seed and an all-skipped range submits no solver jobs',async()=>{
  const input=fixture(),dates=['2025-10-26','2025-10-27'];
  const excludedDates=[{date:dates[0],code:'DST_DAY_SKIPPED',local_day_hours:25,reason:'25-hour daylight-saving day'}];
  let calls=0;
  const options={...input,dates,excludedDates,concurrency:4,fetchPrices:async date=>priceDay(date),
    optimize:async request=>{calls++;return solved(request);},checkpoint:async()=>{}};
  const run=await runDailyCyclic(options);
  assert.equal(calls,1);assert.equal(run.execution.seed_date,dates[1]);
  assert.deepEqual(run.records.map(row=>row.status),['skipped','completed']);
  calls=0;
  const skipped=await runDailyCyclic({...options,dates:[dates[0]]});
  assert.equal(calls,0);assert.equal(skipped.finished,true);assert.equal(aggregateDailyRun(skipped),null);
});

test('selected solver budget is validated and shared by short, daily and flexible requests',()=>{
  const {project,settings,buses}=fixture();
  assert.equal(buildSolverInputs(project,settings,{buses}).solver_time_limit_seconds,180);
  assert.equal(buildSolverInputs({...project,constraints:{solver_time_limit_seconds:41}},settings,{buses}).solver_time_limit_seconds,41);
  for(const options of [{buses},{buses,daily:true},{buses,hours:72,cyclicConnections:false}]) {
    assert.equal(buildSolverInputs(project,{...settings,solver_time_limit_seconds:37},options).solver_time_limit_seconds,37);
  }
  for(const value of [0,-1,1.5,86401,NaN,Infinity,'']) {
    assert.equal(solverTimeLimitIssues({solver_time_limit_seconds:value}).length,1);
    assert.throws(()=>buildSolverInputs(project,{...settings,solver_time_limit_seconds:value},{buses}),/Solver time limit/);
  }
});

test('price retry runs after all dates, preserves successes and recovers with the same boundary and frozen settings',async()=>{
 for (const concurrency of [1,4]) {
  const input=fixture(),dates=['2026-02-02','2026-02-03','2026-02-04'];
  const fetched=[],calls=new Map(),requests=[],phases=[];
  const run=await runDailyCyclic({...input,concurrency,dates,fetchPrices:async date=>{
    fetched.push(date);calls.set(date,(calls.get(date)||0)+1);
    if(date===dates[1] && calls.get(date)===1) throw new Error('Incomplete historical prices');
    return priceDay(date);
  },optimize:async (request,context)=>{requests.push({request,context});return solved(request);},checkpoint:async()=>{},onExecution:phase=>phases.push(phase)});
  assert.deepEqual(fetched,[...dates,dates[1]]);
  assert.equal(run.status,'completed');assert.equal(run.execution.price_retry.recovered,1);
  assert.equal(run.records[1].attempt_history[0].error.detail,'Incomplete historical prices');
  assert.equal(run.records[1].retry_attempts,1);
  assert.equal(requests.filter(row=>row.context.date===dates[0]).length,1);
  assert.equal(requests.filter(row=>row.context.date===dates[2]).length,1);
  assert.equal(requests.at(-1).context.day_index,1);
  assert.equal(requests.at(-1).context.retry_attempt,1);
  if (concurrency===4) assert.deepEqual(requests.at(-1).request.daily_connection_boundary,run.execution.boundary);
  assert.ok(phases.some(phase=>phase.mode==='retry'));
  const result=aggregateDailyRun(run);
  assert.equal(result.total_days,3);assert.ok(Math.abs(result.total_cost_eur-3.15)<1e-9);
  const {files}=await resultAnalysisFiles(result,input.project,async()=>null);
  assert.ok(files.some(file=>file.name.endsWith('/attempt_history.json') && file.data.includes('Incomplete historical prices')));
 }
});

test('persistent price gaps are retried once while solver failures and DST exclusions are not retried',async()=>{
 const input=fixture(),dates=['2026-02-02','2026-02-03','2026-02-04','2026-02-05'],calls={};
 const run=await runDailyCyclic({...input,dates,excludedDates:[{date:dates[3],reason:'DST',code:'DST_DAY_SKIPPED'}],
  fetchPrices:async date=>{calls[date]=(calls[date]||0)+1;if(date===dates[1]) throw new Error('Missing prices');return priceDay(date);},
  optimize:async (request,context)=>{if(context.date===dates[2]) throw new Error('Infeasible');return solved(request);},checkpoint:async()=>{}});
 assert.deepEqual(calls,{[dates[0]]:1,[dates[1]]:2,[dates[2]]:1});
 assert.equal(run.execution.price_retry.recovered,0);assert.equal(run.execution.price_retry.attempted,1);
 assert.deepEqual(run.records.map(row=>row.status),['completed','failed','failed','skipped']);
});

test('cancelling a price retry retains successful days and does not start another retry',async()=>{
 const input=fixture(),dates=['2026-02-02','2026-02-03','2026-02-04'],calls={};
 const run=await runDailyCyclic({...input,dates,fetchPrices:async date=>{
  calls[date]=(calls[date]||0)+1;
  if(calls[date]===2) throw cancellationError();
  if(date!==dates[0]) throw new Error('Missing prices');return priceDay(date);
 },optimize:async request=>solved(request),checkpoint:async()=>{}});
 assert.equal(run.finished,false);assert.equal(run.records[0].status,'completed');
 assert.equal(run.records[1].retry_cancelled,true);assert.equal(calls[dates[2]],1);
 assert.equal(run.execution.price_retry.cancelled,true);
});

test('a recovered price day cannot be inserted with a connector mismatch against an existing next day',async()=>{
 const input=fixture(),dates=['2026-02-02','2026-02-03','2026-02-04'],calls={};
 const run=await runDailyCyclic({...input,dates,fetchPrices:async date=>{
  calls[date]=(calls[date]||0)+1;
  if(date===dates[1] && calls[date]===1) throw new Error('Missing prices');return priceDay(date);
 },optimize:async(request,context)=>context.retry_attempt ? {...solved(request),final_connections:{B:null}} : solved(request),checkpoint:async()=>{}});
 assert.deepEqual(run.records.map(row=>row.status),['completed','failed','completed']);
 assert.match(run.records[1].error.detail,/connector continuity/);
 assert.equal(run.execution.price_retry.recovered,0);
 assert.equal(run.records[2].result.final_connections.B,'D');
});

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

test('failure at day 2 retains day 1 and continues day 3 as an explicit independent segment',async()=>{
  const input=fixture(),saved=[];
  const run=await runDailyCyclic({...input,retryPriceFailures:false,dates:['2026-02-02','2026-02-03','2026-02-04'],fetchPrices:async date=>{
    if(date.endsWith('03')) throw new Error('Missing source prices');return priceDay(date);
  },optimize:async request=>solved(request),checkpoint:async record=>saved.push(record)});
  assert.equal(run.status,'partial');
  assert.deepEqual(run.records.map(row=>row.status),['completed','failed','completed']);
  assert.equal(run.records[2].continuity_scope,'independent_segment_after_failed_day');
  assert.equal(run.records[2].reconciliation.proofs[0].previous_final_soc_kwh,null);
  assert.equal(run.finished,true);
  const result=aggregateDailyRun(run);
  assert.equal(result.total_days,2);assert.equal(result.requested_days,3);
  assert.equal(result.daily_results.length,2);
  assert.deepEqual(input.project.meta.excluded_bus_ids,['EXCLUDED']);
  assert.equal(saved.length,3);
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
  assert.equal(dailyConfigurationIssues({...project,buses},settings,'pv').length,0);
  assert.equal(dailyConfigurationIssues({...project,buses},settings,'compare_all').length,1);
  assert.equal(dailyConfigurationIssues({...project,buses},settings,'bess',{enable_temperature_capacity_derating:true}).length,1);
  assert.deepEqual(endConditionIssues({...settings,use_next_day_readiness:true},'daily_cyclic'),[]);
  assert.ok(dailyConfigurationIssues({...project,buses:[{...buses[0],opportunity_visits:[{pause_start_min:1300,pause_end_min:1500}]}]},settings,'baseline').length);
  for (const hours of [24,48,72]) {
    const flexible=buildSolverInputs(project,{...settings,use_cyclic_soc:false},{buses,hours,cyclicConnections:false,initialEnergies:{B:7},initialConnections:{B:''}});
    assert.equal(flexible.use_cyclic_soc,false);assert.equal(flexible.planning_horizon_hours,hours);assert.equal(flexible.buses[0].initial_soc_kwh,7);
    assert.equal(flexible.buses[0].initial_connection_site,'');
  }
});
