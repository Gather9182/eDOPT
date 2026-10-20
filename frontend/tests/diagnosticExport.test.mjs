import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureValidationContext, validationDiagnostic, optimizationDiagnostic, diagnosticFiles, diagnosticZip } from '../src/utils/diagnosticExport.js';

function fixture() {
  const bus = {id:'Ü1',vehicle_type:'JS',max_battery_capacity_kwh:430,initial_soc_kwh:200,min_final_soc_kwh:100,
    availability:[0,1],trip_energy_profile_kwh:[7,0],site_availability:{D:[0,1]},site_presence:{D:[0,1]},site_arrivals:{D:[0,1]},
    trips:[{start_min:0,end_min:15,von:'X',nach:'D_A',dist_m:1000,energy_kwh:7}],opportunity_visits:[{id:'visit',outbound_km:3}]};
  const project = {buses:[bus,{...bus,id:'EXCLUDED'}],pricing:[-10,35],meta:{timetable_source_key:'source',timetable_source_name:'Original.xlsx',
    excluded_bus_ids:['EXCLUDED'],import_settings:{useVehicleTypeGroup:true},vehicle_types_config:{JS:{consumption:1.5,battery:430}}},
    constraints:{grid_limit_kw:900},charging:{enabled:true,sites:[{id:'D',name:'Depot',nodes:['D_A'],num_chargers:12,no_switch_windows:[{start:'22:00',end:'05:00'}]}]}};
  const runtime = {scenario:'baseline',simulationMode:'long_term',localSettings:{grid_limit_kw:600},longTermConfig:{chunkSizeHours:48},resolved_opportunity:{mappings:[{id:'mapping',site_id:'D',outbound_km:3}]}};
  const request = {buses:[bus],electricity_prices:[-10,35],time_step_minutes:15,grid_limit_kw:600};
  const result = {status:'invalid',issues:[{type:'ERROR',code:'BUS_ENERGY_INFEASIBLE',bus_id:'Ü1',message:'Fehlt; "Energie"\nDetails',details:{missing_kwh:31.8}}],
    diagnostics:{effective_inputs:{...request,num_chargers:50},python_version:'test'}};
  return {project,runtime,request,result};
}

test('diagnostic is an immutable complete check snapshot, including unsaved settings and excluded buses', async () => {
  const {project,runtime,request,result} = fixture();
  const context = captureValidationContext(project,runtime,{timezone:'Europe/Vienna'},['Ü1'],new Date('2026-10-20T12:00:00Z'));
  const diagnostic = validationDiagnostic(context,result,request);
  project.constraints.grid_limit_kw = 123;
  runtime.localSettings.grid_limit_kw = 123;
  request.buses[0].availability[0] = 1;
  result.issues[0].message = 'changed';
  const files = await diagnosticFiles(diagnostic,[{time:'14:00',msg:'log'}],async () => ({name:'Original.xlsx',base64:btoa('PK\x03\x04\x00\xff'),lastModified:123}),new Date('2026-10-20T12:01:00Z'));
  const content = Object.fromEntries(files.map(file => [file.name,file.data]));
  const manifest = JSON.parse(content['manifest.json']);
  assert.deepEqual(manifest.excluded_from_check,['EXCLUDED']);
  assert.equal(manifest.source.status,'included');
  assert.equal(manifest.issue_count,1);
  assert.deepEqual(manifest.missing_information,[]);
  assert.equal(JSON.parse(content['project.json']).constraints.grid_limit_kw,900);
  assert.equal(JSON.parse(content['runtime_settings.json']).localSettings.grid_limit_kw,600);
  assert.deepEqual(JSON.parse(content['request.json']).buses[0].availability,[0,1]);
  assert.equal(JSON.parse(content['validation.json']).issues[0].details.missing_kwh,31.8);
  assert.match(content['issues.csv'],/Fehlt; ""Energie""\nDetails/);
  assert.match(content['routes.csv'],/EXCLUDED/);
  assert.match(content['profiles.csv'],/"Ü1";"0";"0";"0";"7"/);
  assert.match(content['site_profiles.csv'],/"Ü1";"D";"1";"15";"1";"1";"1"/);
  assert.match(content['trips.csv'],/EXCLUDED/);
  assert.match(content['prices.csv'],/"0";"-10";"-10";"-10"/);
  assert.deepEqual([...content['source/original_timetable.xlsx']],[80,75,3,4,0,255]);

  // Independently verify the generated archive with Python's standard ZIP reader.
  const blob = diagnosticZip(files,new Date('2026-10-20T12:01:00Z'));
  const python = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url));
  const check = spawnSync(python,['-c',
    'import io,sys,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.read("source/original_timetable.xlsx")==bytes([80,75,3,4,0,255]); print(json.dumps(z.namelist()))'],
    {input:Buffer.from(await blob.arrayBuffer()),encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  assert.deepEqual(JSON.parse(check.stdout),files.map(file => file.name));
});

test('frontend and transport failures remain exportable with explicit missing-information notes', async () => {
  const {project,runtime} = fixture();
  const context = captureValidationContext(project,runtime,{},[]);
  const result = {status:'invalid',issues:[{type:'ERROR',message:'Mapping changed'}]};
  const diagnostic = validationDiagnostic(context,result,null,'frontend');
  const files = await diagnosticFiles(diagnostic,[],async()=>{throw new Error('Source unavailable');});
  const content = Object.fromEntries(files.map(file => [file.name,file.data]));
  assert.equal(JSON.parse(content['request.json']),null);
  const manifest = JSON.parse(content['manifest.json']);
  assert.equal(manifest.validation_origin,'frontend');
  assert.equal(manifest.source.status,'unavailable');
  assert.equal(manifest.missing_information.length,3);
  assert.deepEqual(manifest.excluded_from_check,['Ü1','EXCLUDED']);
  assert.match(content['README.txt'],/Source unavailable/);
  const failed = validationDiagnostic(context,result,{buses:[]},'transport',{http_status:422,response:{detail:[{loc:['body','buses']}]}});
  assert.equal(failed.transport_error.response.detail[0].loc[1],'buses');
});

test('CSV exports preserve raw JSON while neutralizing spreadsheet formulas in text', async () => {
  const {project,runtime,request,result} = fixture();
  result.issues[0].message='=1+1';
  const diagnostic=validationDiagnostic(captureValidationContext(project,runtime,{},['Ü1']),result,request);
  const files=await diagnosticFiles(diagnostic,[],async()=>null);
  const content=Object.fromEntries(files.map(file=>[file.name,file.data]));
  assert.match(content['issues.csv'],/"'=1\+1"/);
  assert.equal(JSON.parse(content['validation.json']).issues[0].message,'=1+1');
});

test('failed-run export freezes the actual request/chunk, backend model, findings, exclusions and logs', async () => {
  const {project,runtime,request,result} = fixture();
  const context = captureValidationContext(project,runtime,{},['Ü1']);
  const error = {message:'HTTP 500',response:{status:500,data:{detail:'Optimization ended with status: Infeasible',diagnostics:{
    solver_status:'Infeasible',effective_inputs:{...request,num_chargers:12},model_lp:'minimize\n cost: x\n',cbc_log:'CBC: Infeasible',
    variable_index:{buses:[{index:0,id:'Ü1'}]},route_feasibility:{routes:[{bus_id:'Ü1',status:'individually_infeasible',solver_status:'Infeasible',diagnostic_candidate:true,reason:'Infeasible even alone.'}]},energy_relaxation:{status:'Optimal',minimum_proven:true,
      findings:[{bus_id:'Ü1',period:1,start_min:15,end_min:30,missing_battery_energy_kwh:5}],total_artificial_energy_kwh:5}}}}};
  const logs = [{time:'12:00',msg:'Optimizing chunk 3'}];
  const diagnostic = optimizationDiagnostic(context,request,error,{scenario:'baseline',chunk_number:3,global_start_minute:2880},result,logs);
  request.grid_limit_kw = 123;
  logs[0].msg = 'changed';
  error.response.data.diagnostics.model_lp = 'changed';
  const files = await diagnosticFiles(diagnostic,[{msg:'unrelated new check'}],async()=>null);
  const content = Object.fromEntries(files.map(file=>[file.name,file.data]));
  assert.equal(JSON.parse(content['manifest.json']).format,'edopt-optimization-diagnostic');
  assert.equal(JSON.parse(content['manifest.json']).endpoint,'/api/optimize');
  assert.deepEqual(JSON.parse(content['manifest.json']).excluded_from_check,['EXCLUDED']);
  assert.equal(JSON.parse(content['request.json']).grid_limit_kw,600);
  assert.equal(JSON.parse(content['attempt.json']).chunk_number,3);
  assert.equal(JSON.parse(content['attempt.json']).global_start_minute,2880);
  assert.equal(JSON.parse(content['backend_inputs.json']).num_chargers,12);
  assert.equal(JSON.parse(content['run_check.json']).status,'invalid');
  assert.equal(JSON.parse(content['optimization_failure.json']).failure.http_status,500);
  assert.match(content['solver/model.lp'],/cost: x/);
  assert.equal(content['solver/cbc.log'],'CBC: Infeasible');
  assert.equal(JSON.parse(content['solver/energy_relaxation.json']).findings[0].bus_id,'Ü1');
  assert.equal(JSON.parse(content['solver/route_feasibility.json']).routes[0].status,'individually_infeasible');
  assert.match(content['route_classification.csv'],/individually_infeasible/);
  assert.equal(JSON.parse(content['logs.json'])[0].msg,'Optimizing chunk 3');
  assert.match(content['README.txt'],/not a valid schedule or IIS/);
  assert.match(content['README.txt'],/failed scenario\/chunk/);
  assert.equal(content['validation.json'],undefined);
});

test('transport, old backend, 422 and preparation failures are exportable without fabricating solver evidence', async () => {
  const {project,runtime,request} = fixture();
  const context = captureValidationContext(project,runtime,{},['Ü1']);
  for (const error of [{message:'Network error'},{message:'HTTP 500',response:{status:500,data:{detail:'Infeasible'}}},
    {message:'HTTP 422',response:{status:422,data:{detail:[{loc:['body','buses']}]}}}]) {
    const diagnostic = optimizationDiagnostic(context,request,error);
    const files = Object.fromEntries((await diagnosticFiles(diagnostic,[],async()=>null)).map(file=>[file.name,file.data]));
    assert.deepEqual(JSON.parse(files['request.json']),request);
    assert.equal(files['solver/model.lp'],undefined);
    assert.ok(JSON.parse(files['manifest.json']).missing_information.some(message=>message.includes('failed solver model')));
  }
  const diagnostic = optimizationDiagnostic(context,null,{message:'Historical context unavailable'},{phase:'outside_solver_request'});
  const files = Object.fromEntries((await diagnosticFiles(diagnostic,[],async()=>null)).map(file=>[file.name,file.data]));
  assert.equal(JSON.parse(files['request.json']),null);
  assert.deepEqual(JSON.parse(files['manifest.json']).checked_bus_ids,[]);
});
