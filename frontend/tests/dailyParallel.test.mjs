import test from 'node:test';
import assert from 'node:assert/strict';
import {runDailyCyclic,aggregateDailyRun} from '../src/utils/dailyCyclic.js';
import {dailyPhysicalKey,calendarDayIndex,completedSlotForCalendarDay} from '../src/utils/dailyBoundary.js';
import {cancellationError} from '../src/utils/optimizationProgress.js';

const dates=['2026-02-02','2026-02-03','2026-02-04','2026-02-05','2026-02-06'];
function fixture() {
  const bus={id:'B',max_battery_capacity_kwh:20,max_power_kw:40,efficiency:1,initial_soc_kwh:10,min_final_soc_kwh:0,
    availability:[0,1],site_availability:{D:[0,1]},site_presence:{D:[1,1]},site_arrivals:{D:[0,0]},trip_energy_profile_kwh:[5,0]};
  const project={buses:[bus],pricing:[100,100],meta:{time_resolution:720,initial_soc_fraction:.5,min_final_soc_fraction:0,
    price_assumptions:{pricing_mode:'spot'}},constraints:{},charging:{enabled:true,sites:[{id:'D',nodes:['D'],num_chargers:1,
      charger_power_kw:40,charger_capacity_kw:40,grid_limit_kw:40,lock_charging_mode:'optimized',no_switch_windows:[{start:'00:00',end:'00:00'}]}]}};
  return {project,buses:[bus],settings:{planning_horizon:24,time_resolution:720,grid_limit_kw:0,charger_capacity_kw:0,num_chargers:0,use_cyclic_soc:true},
    dates:dates.slice(0,3),concurrency:2,checkpoint:async()=>{},fetchPrices:async date=>({date,coverage:'complete',timestamps:[date+'T00:00:00+01:00',date+'T12:00:00+01:00'],market_prices:[100,Number(date.slice(-2))*100]})};
}
function solved(request){const p=5/12;return {status:'Optimal (Baseline Optimized)',scenario:'baseline',schedules:{B:[0,p]},soc_profiles:{B:[10,5,10]},
 grid_import_profile:[0,p],aggregated_load_profile:[0,p],electricity_prices:request.electricity_prices,market_prices:request.market_prices,
 total_cost_eur:5*request.electricity_prices[1]/1000,total_energy_mwh:.005,connection_schedules:{B:['D','D']},final_connections:{B:'D'},baseline_feasible:false};}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitAbort=signal=>new Promise((_,reject)=>{if(signal.aborted)return reject(cancellationError());signal.addEventListener('abort',()=>reject(cancellationError()),{once:true});});

test('seed then two bounded workers complete out of order with ordered evidence and serialized checkpoints',async()=>{
 const options=fixture(),before=JSON.stringify(options.project),completed=[],requests=[];let active=0,max=0,saving=0,maxSaving=0;
 const run=await runDailyCyclic({...options,checkpoint:async record=>{saving++;maxSaving=Math.max(maxSaving,saving);await delay(1);saving--;completed.push(record.date);},
 optimize:async (request,attempt)=>{requests.push(request);active++;max=Math.max(max,active);await delay(attempt.day_index===1?25:2);active--;return solved(request);}});
 assert.equal(run.status,'completed');assert.equal(max,2);assert.equal(maxSaving,1);
 assert.deepEqual(run.records.map(row=>row.date),options.dates);
 assert.equal(completed[1],options.dates[2]);
 assert.equal(requests[0].daily_boundary_seed,true);
 assert.deepEqual(requests[1].daily_connection_boundary,{B:{D:1}});
 assert.ok(requests.every(request=>dailyPhysicalKey(request)===dailyPhysicalKey(requests[0])));
 assert.equal(JSON.stringify(options.project),before);
 const result=aggregateDailyRun(run);
 assert.deepEqual(result.completed_dates,options.dates);assert.equal(result.daily_execution.used_workers,2);
 const serial=await runDailyCyclic({...options,concurrency:1,optimize:async request=>solved(request)});
 assert.equal(result.total_cost_eur,aggregateDailyRun(serial).total_cost_eur);
});

test('unsafe midnight preparation falls back to unchanged serial mode with an explicit reason',async()=>{
 const options=fixture();options.buses[0].opportunity_visits=[{pause_start_min:0,pause_end_min:900}];let active=0,max=0;
 const run=await runDailyCyclic({...options,optimize:async request=>{active++;max=Math.max(max,active);await delay(1);active--;return solved(request);}});
 assert.equal(max,1);assert.match(run.execution.fallback_reason,/midnight/);assert.equal(run.execution.used_workers,1);
});

test('an infeasible seed uses a normal serial retry without changing user configuration',async()=>{
 const options=fixture();let calls=0;
 const run=await runDailyCyclic({...options,optimize:async request=>{calls++;if(request.daily_boundary_seed)throw new Error('Seed infeasible');return solved(request);}});
 assert.equal(calls,4);assert.equal(run.status,'completed');assert.match(run.execution.fallback_reason,/seed/);
 assert.equal(run.execution.seed_failure.detail,'Seed infeasible');
});

test('one failed day cancels its active sibling and retains an earlier out-of-order complete day',async()=>{
 const options=fixture();let calls=0;
 const run=await runDailyCyclic({...options,dates,optimize:async (request,attempt,{signal})=>{
   calls++;if(attempt.day_index===1){await delay(20);throw new Error('Solver time budget exhausted');}
   if(attempt.day_index===3)return waitAbort(signal);
   return solved(request);
 }});
 assert.equal(run.status,'partial');assert.equal(calls,4);
 assert.deepEqual(run.records.map(row=>row.status),['completed','failed','completed','cancelled','not_calculated']);
 const result=aggregateDailyRun(run);assert.deepEqual(result.completed_day_indices,[0,2]);
 assert.deepEqual(result.completed_dates,[dates[0],dates[2]]);
 assert.equal(calendarDayIndex(result,1),2);assert.equal(completedSlotForCalendarDay(result,1),-1);
 assert.equal(completedSlotForCalendarDay(result,2),1);
});

test('cancel stops both active day jobs and starts no later day',async()=>{
 const options=fixture(),controller=new AbortController();let active=0,cancelled=0,calls=0;
 const run=await runDailyCyclic({...options,dates,signal:controller.signal,optimize:async(request,attempt,{signal})=>{
   calls++;if(!attempt.day_index)return solved(request);
   if(++active===2)controller.abort();
   try {await waitAbort(signal);}catch(error){cancelled++;throw error;}
 }});
 assert.equal(calls,3);assert.equal(cancelled,2);assert.equal(run.status,'partial');
 assert.deepEqual(run.records.map(row=>row.status),['completed','cancelled','cancelled','not_calculated','not_calculated']);
});

test('a fixed connector violation and changed physical inputs cannot become a successful day',async()=>{
 const options=fixture();
 const run=await runDailyCyclic({...options,optimize:async(request,attempt)=>attempt.day_index===1 ? {...solved(request),final_connections:{B:''}} : solved(request)});
 assert.equal(run.status,'partial');assert.equal(run.records[1].status,'failed');
 assert.match(run.records[1].error.detail,/fixed midnight/);
 const original=options.fetchPrices;
 const changed=await runDailyCyclic({...options,fetchPrices:async date=>{if(date===dates[1])options.buses[0].max_power_kw=30;return original(date);},optimize:async request=>solved(request)});
 assert.notEqual(changed.status,'completed');assert.match(changed.records[1].error.detail,/physical inputs changed/);
});
