import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resultAnalysisFiles, runAuditMetadata, archiveChunkRequest } from '../src/utils/resultAnalysisExport.js';
import { diagnosticZip } from '../src/utils/diagnosticExport.js';

const lookup = async key => ({old:{name:'Run.xlsx',base64:btoa('PK\x03\x04RUN'),lastModified:1},
  current:{name:'Current.xlsx',base64:btoa('PK\x03\x04CURRENT'),lastModified:2}})[key];
function fixture() {
  const bus = {id:'B',vehicle_type:'EV',max_battery_capacity_kwh:100,initial_soc_kwh:50,min_final_soc_kwh:10,
    efficiency:1,max_power_kw:150,availability:[0,1,1,1],site_availability:{D:[0,1,1,1]},
    site_presence:{D:[0,1,1,1]},site_arrivals:{D:[0,1,0,0]},trip_energy_profile_kwh:[2,0,0,0],
    trips:[{von:'=unsafe text',nach:'D_A',start_min:0,end_min:15,dist_m:2000,energy_kwh:2}],opportunity_visits:[{id:'candidate'}]};
  const site = {id:'D',name:'Depot',nodes:['D_A','D_E'],num_chargers:2,charger_power_kw:150,charger_capacity_kw:300,grid_limit_kw:300,no_switch_windows:[]};
  const project = {buses:[bus,{...bus,id:'EXCLUDED'}],constraints:{grid_limit_kw:300},charging:{enabled:true,sites:[site],opportunity:{enabled:true,mappings:[{id:'mapping',site_id:'D'}]}},
    meta:{timetable_source_key:'old',excluded_bus_ids:['EXCLUDED']}};
  const request = {scenario:'baseline',buses:[bus],charging_sites:[site],time_step_minutes:15,electricity_prices:[100,100,100,100],grid_limit_kw:300};
  const results = {scenario:'baseline',status:'Optimal',total_cost_eur:1.5,total_energy_mwh:.015,baseline_feasible:false,baseline_issues:['Comparison readiness failed'],
    aggregated_load_profile:[0,20,30,10],grid_import_profile:[0,20,30,10],electricity_prices:[100,100,100,100],
    schedules:{B:[0,20,30,10]},soc_profiles:{B:[50,48,53,60.5,63]},connection_schedules:{B:[null,'D','D','D']},
    site_load_profiles:{D:[0,20,30,10]},site_grid_import_profiles:{D:[0,20,30,10]},site_occupied_connectors:{D:[0,1,1,1]},
    bus_diagnostics:[{id:'B',diagnostic_reason:'Test'}],
    opportunity_charging_visits:[{bus_id:'B',site_id:'D',from_node:'STOP',to_node:'STOP',departure_min:0,charger_arrival_min:15,return_departure_min:45,return_arrival_min:60,distance_km:7}],
    additional_trips:{B:[{start_min:0,end_min:15,opportunity_id:'candidate',energy_kwh:2}]},
    additional_trip_energy_profiles:{B:[2,0,0,0]},future_extension:{full_nested_data:[{test:42}]},
    run_metadata:{inputs:request,request_inputs:request,excluded_bus_ids:['EXCLUDED'],run_id:'RUN',
      ...runAuditMetadata({project,runtime_settings:{scenario:'baseline',localSettings:{grid_limit_kw:300}}},{status:'valid'},[{msg:'Run log'}])}};
  const current = structuredClone(project);
  current.constraints.grid_limit_kw = 999;
  current.meta.timetable_source_key = 'current';
  return {results,project,current,request};
}

test('analysis package exports the saved charging curve without substituting current settings',async () => {
  const {results,current}=fixture();
  results.charging_curve={enabled:true,nominal_power_kw:150,bands:[{end_soc_fraction:1,power_fraction:.15}]};
  current.constraints.charging_curve={enabled:false,nominal_power_kw:900,bands:[]};
  const {files}=await resultAnalysisFiles(results,current,lookup);
  const saved=JSON.parse(files.find(file=>file.name==='run/charging_curve.json').data);
  assert.equal(saved.nominal_power_kw,150);
  assert.equal(saved.enabled,true);
  assert.match(files.find(file=>file.name==='tables/charging_curve.csv').data,/22.5/);
});

test('analysis package preserves cyclic end condition and per-bus equality evidence',async () => {
  const {results,current}=fixture();
  results.run_metadata.request_inputs.use_cyclic_soc=true;
  results.end_condition={mode:'cyclic_soc',cyclic_soc_enabled:true,next_day_readiness_enabled:false,tolerance_kwh:.001,
    buses:[{bus_id:'B',initial_soc_kwh:50,final_soc_kwh:50,difference_kwh:0,target_soc_kwh:50,min_final_soc_kwh:10,compliant:true}]};
  const {files}=await resultAnalysisFiles(results,current,lookup);
  const saved=JSON.parse(files.find(file=>file.name==='run/end_condition.json').data);
  assert.equal(saved.mode,'cyclic_soc');
  assert.equal(saved.buses[0].difference_kwh,0);
  assert.match(files.find(file=>file.name==='tables/bus_end_conditions.csv').data,/B/);
});

test('complete analysis preserves raw results, original settings, sources and excluded routes separately from the current project', async () => {
  const {results,current,request} = fixture();
  const before = JSON.stringify(results);
  const {files,manifest} = await resultAnalysisFiles(results,current,lookup,{},new Date('2026-10-20T12:00:00Z'));
  const data = Object.fromEntries(files.map(file => [file.name,file.data]));
  assert.deepEqual(JSON.parse(data['results.json']),results);
  assert.deepEqual(JSON.parse(data['run/solver_request.json']),request);
  assert.equal(JSON.parse(data['run/project_at_run.json']).constraints.grid_limit_kw,300);
  assert.equal(JSON.parse(data['project_current.json']).constraints.grid_limit_kw,999);
  assert.equal(JSON.parse(data['run/runtime_settings.json']).localSettings.grid_limit_kw,300);
  assert.deepEqual(manifest.included_bus_ids,['B']);
  assert.deepEqual(manifest.excluded_bus_ids,['EXCLUDED']);
  assert.deepEqual(manifest.missing_information,[]);
  assert.equal(manifest.sources[0].name,'Run.xlsx');
  assert.equal(manifest.sources[1].name,'Current.xlsx');
  assert.deepEqual([...data['source/run_original_timetable.xlsx']],[80,75,3,4,82,85,78]);
  assert.match(data['tables/charging_sessions.csv'],/"detour"/);
  assert.match(data['tables/charging_sessions.csv'],/"scheduled"/);
  assert.match(data['tables/recorded_trips.csv'],/"'=unsafe text"/);
  assert.equal(JSON.parse(data['results.json']).run_metadata.inputs.buses[0].trips[0].von,'=unsafe text');
  assert.match(data['tables/routes.csv'],/"EXCLUDED";"false";"true"/);
  assert.match(data['tables/mappings_at_run.csv'],/"mapping"/);
  const audit = JSON.parse(data['reconciliation.json']);
  assert.equal(audit.cost_eur_from_profile,1.5);
  assert.equal(audit.energy_difference_mwh,0);
  assert.equal(audit.baseline_feasible,false);
  assert.equal(JSON.stringify(results),before,'export must not mutate the saved result');

  const python = fileURLToPath(new URL('../../backend/.venv/Scripts/python.exe',import.meta.url));
  const checked = spawnSync(python,['-c',
    'import sys,io,zipfile,csv,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); assert set(m["files"])==set(z.namelist()); rows=list(csv.DictReader(io.StringIO(z.read("tables/fleet_timeseries.csv").decode("utf-8-sig")),delimiter=";")); assert len(rows)==4; print(len(z.namelist()))'],
    {input:Buffer.from(await diagnosticZip(files).arrayBuffer()),encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
  assert.equal(Number(checked.stdout),files.length);
});

test('long-term daily power and N+1 SoC boundaries keep global offsets and exact archived chunk inputs', async () => {
  const {results,current} = fixture();
  Object.assign(results,{is_long_term:true,total_days:2,schedules:undefined,soc_profiles:undefined,
    aggregated_load_profile:[10,20,30,40],grid_import_profile:[10,20,30,40],electricity_prices:[100,100,100,100],
    total_cost_eur:120,total_energy_mwh:1.2,schedules_by_day:[{B:[10,20]},{B:[30,40]}],
    soc_profiles_by_day:[{B:[10,20,30]},{B:[30,40,50]}],diagnostics_by_day:[[{id:'B',value:1}],[{id:'B',value:2}]]});
  results.run_metadata.inputs.time_step_minutes = 720;
  results.run_metadata.request_inputs = undefined;
  results.run_metadata.request_archive = [{chunk_number:1,status:'stored',storage_key:'chunk',global_start_minute:0}];
  const {files,manifest} = await resultAnalysisFiles(results,current,async key => key==='chunk' ? {buses:[{id:'B',initial_soc_kwh:10}],time_step_minutes:720} : lookup(key));
  const data = Object.fromEntries(files.map(file => [file.name,file.data]));
  assert.match(data['tables/bus_charging.csv'],/"B";"1";"0";"2";"1440";"30"/);
  assert.match(data['tables/bus_soc.csv'],/"B";"0";"2";"2";"1440";"30"/);
  assert.match(data['tables/bus_soc.csv'],/"B";"1";"0";"2";"1440";"30"/);
  assert.match(data['tables/bus_soc.csv'],/"B";"1";"2";"4";"2880";"50"/);
  assert.equal(JSON.parse(data['run/requests/chunk_00001.json']).buses[0].initial_soc_kwh,10);
  assert.equal(manifest.request_archive[0].export_status,'included');
  assert.equal(JSON.parse(data['reconciliation.json']).cost_eur_from_profile,120);
});

test('legacy/pruned results and missing chunks remain exportable without reconstructing absent run information', async () => {
  const current = fixture().current;
  const results = {scenario:'pv',is_long_term:true,total_days:2,storage_pruned:true,run_metadata:{request_archive:[{chunk_number:2,status:'stored',storage_key:'gone'}]},
    aggregated_load_profile:[1,2],electricity_prices:[100,100],schedules_by_day:[{B:[1]},null]};
  const {files,manifest} = await resultAnalysisFiles(results,current,async () => null);
  const data = Object.fromEntries(files.map(file => [file.name,file.data]));
  assert.equal(JSON.parse(data['run/project_at_run.json']),null);
  assert.equal(JSON.parse(data['run/recorded_inputs.json']),null);
  assert.equal(manifest.time_step_minutes,null);
  assert.equal(manifest.request_archive[0].export_status,'unavailable');
  assert.ok(manifest.missing_information.some(note => note.includes('1 days unavailable')));
  assert.ok(manifest.missing_information.some(note => note.includes('previously removed')));
  assert.equal(data['tables/charging_sessions.csv'].split('\r\n').filter(Boolean).length,1);
  assert.equal(JSON.parse(data['reconciliation.json']).grid_energy_mwh_from_profile,null);
});

test('run audit and archived requests are immutable, and storage failures never pretend inputs were saved', async () => {
  const {project,request} = fixture();
  const logs = [{msg:'original'}];
  const audit = runAuditMetadata({project},{status:'valid'},logs);
  project.constraints.grid_limit_kw = 999;
  logs[0].msg = 'changed';
  assert.equal(audit.audit_context.project.constraints.grid_limit_kw,300);
  assert.equal(audit.interface_logs[0].msg,'original');
  const store = new Map();
  const record = await archiveChunkRequest(request,{chunk_number:2,global_start_minute:1440},'RUN',async (key,value) => store.set(key,value),{status:'Optimal',solver_logs:['CBC']});
  request.buses[0].initial_soc_kwh = 999;
  assert.equal(store.get(record.storage_key).buses[0].initial_soc_kwh,50);
  assert.deepEqual(record.solver_logs,['CBC']);
  const failed = await archiveChunkRequest(request,{chunk_number:3},'RUN',async()=>{throw new Error('Quota reached');});
  assert.equal(failed.status,'unavailable');
  assert.equal(failed.error,'Quota reached');
});

test('unavailable Excel sources do not abort the export and unknown extensions survive', async () => {
  const {results,current} = fixture();
  const {files,manifest} = await resultAnalysisFiles(results,current,async()=>{throw new Error('Source unavailable');});
  assert.ok(manifest.sources.every(source=>source.status==='unavailable'));
  assert.ok(manifest.missing_information.some(note=>note.includes('original timetable')));
  assert.deepEqual(JSON.parse(files.find(file=>file.name==='results.json').data).future_extension,{full_nested_data:[{test:42}]});
});

test('missing profile values remain blank and are not converted into a successful zero-valued audit', async () => {
  const {results,current} = fixture();
  results.grid_import_profile[1] = null;
  const {files,manifest} = await resultAnalysisFiles(results,current,lookup);
  const data = Object.fromEntries(files.map(file=>[file.name,file.data]));
  const reconciliation = JSON.parse(data['reconciliation.json']);
  assert.equal(reconciliation.grid_energy_mwh_from_profile,null);
  assert.equal(reconciliation.cost_eur_from_profile,null);
  assert.ok(manifest.missing_information.some(note=>note.startsWith('Energy/cost reconciliation is incomplete')));
});
