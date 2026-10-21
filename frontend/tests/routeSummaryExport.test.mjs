import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRouteSummary,routeSummaryHeaders} from '../src/utils/routeSummaryExport.js';
import {buildExport} from '../src/utils/exportPackage.js';

const bus=(id,vehicle_type='EV')=>({id,vehicle_type,trips:[{dist_m:10000,start_min:0}],site_availability:{D:[1,1]}});
function fixture() {
 const buses=[bus('A','Group A'),bus('B'),bus('E'),bus('M')];
 const sites=[{id:'D',name:'Depot North'},{id:'S',name:'Depot South'}];
 const request={time_step_minutes:720,buses:buses.slice(0,2),charging_sites:sites};
 const day=(date,site='D')=>({date,request,result:{status:'Optimal',scenario:'baseline',schedules:{A:[10,10],B:[10,10]},
   connection_schedules:{A:[site,site],B:['D','D']},additional_trips:{},opportunity_charging_visits:[]}});
 const first=day('2026-01-01');first.result.additional_trips={A:[{start_min:0,dist_m:2000},{start_min:60,dist_m:3000}]};
 first.result.opportunity_charging_visits=[{bus_id:'A',departure_min:0,distance_km:5}];
 return {is_long_term:true,long_term_mode:'daily_cyclic',total_days:2,completed_dates:['2026-01-01','2026-01-03'],
  day_records:[{status:'completed'},{status:'failed'},{status:'completed'}],daily_results:[first,day('2026-01-03','S')],
  run_metadata:{inputs:{...request,start_date:'2026-01-01',end_date:'2026-01-03'},audit_context:{project:{buses,charging:{sites}}},
   excluded_bus_ids:['E','M'],excluded_bus_reasons:{E:{category:'energy_proven'},M:{category:'manual'}}}};
}

test('saved original kilometres, executed detours, excluded causes and partial coverage stay separate',()=>{
 const saved=fixture();saved.schedules={A:[999999]}; // Day-view mutation must not change the full-period export.
 const output=buildRouteSummary(saved),rows=new Map(output.rows.map(row=>[row[0],row]));
 assert.equal(output.rows.length,4);assert.equal(routeSummaryHeaders.length,8);
 assert.equal(rows.get('A')[1],'Group A');assert.equal(rows.get('A')[2],20);assert.equal(rows.get('A')[3],25);
 assert.equal(rows.get('A')[5],480);assert.equal(rows.get('A')[6],'Depot North; Depot South');
 assert.match(rows.get('E')[4],/^Nein/);assert.equal(rows.get('E')[3],null);assert.equal(rows.get('E')[5],null);
 assert.match(rows.get('M')[4],/Nicht bewertet/);assert.match(output.notice,/2,000 ausgewertete Tage/);
 assert.match(output.notice,/1 Tage ausgelassen/);assert.match(output.notice,/keine Hochrechnung/);
});

test('PV and storage are allocated by site/time, grid charging of storage reconciles separately',()=>{
 const buses=[bus('A'),bus('B'),bus('C')],sites=[{id:'D',name:'Energy site'},{id:'S',name:'Other site'}];
 const result={is_long_term:true,total_days:1,status:'Optimal',scenario:'pv_bess',schedules_by_day:[{A:[1,3],B:[3,1],C:[2,2]}],
  connection_schedules:{A:['D','D'],B:['D','D'],C:['S','S']},pv_to_bus_profile:[2,0],bess_to_bus_profile:[1,0],
  bess_charge_from_grid_profile:[0,2],grid_import_profile:[3,8],additional_trips:{},opportunity_charging_visits:[],
  run_metadata:{inputs:{time_step_minutes:720,buses,charging_sites:sites,energy_site_id:'D'},audit_context:{project:{buses}}}};
 const rows=new Map(buildRouteSummary(result).rows.map(row=>[row[0],row]));
 assert.equal(rows.get('A')[5],45);assert.equal(rows.get('B')[5],39);assert.equal(rows.get('C')[5],48);
 assert.equal([...rows.values()].reduce((sum,row)=>sum+row[5],0),132);
 assert.match(rows.get('A')[7],/PV direkt: 6,000 kWh/);assert.match(rows.get('A')[7],/Batterieabgabe: 3,000 kWh/);
 assert.match(rows.get('A')[7],/Speichers zugeordnet: 6,000 kWh/);
 delete result.pv_to_bus_profile;
 assert.equal(buildRouteSummary(result).rows[0][5],null);
});

test('CSV is Excel-compatible and current project data cannot replace saved run values',async()=>{
 const saved=fixture();saved.run_metadata.audit_context.project.buses[0].vehicle_type='=UNSAFE';
 const output=await buildExport({format:'routes',results:saved,project:{buses:[{id:'A',trips:[{dist_m:999999}]}]}},async()=>null);
 const text=await output.blob.text();
 assert.match(text,/"Umlauf-ID";"Bustyp \/ Fahrzeuggruppe"/);
 assert.ok(text.includes(`"'=UNSAFE"`));assert.ok(text.includes('"Depot North; Depot South"'));
 assert.ok(text.includes('20,000;25,000;'));assert.equal(output.blob.type,'text/csv;charset=utf-8');
 assert.throws(()=>buildRouteSummary({is_long_term:false}),/long-term/);
});
