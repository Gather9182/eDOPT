import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvedOpportunityConfig, opportunityImportNeedsRefresh, mergeScannedMappings, inputsWithRealizedVisits } from '../src/utils/opportunity.js';

test('enabling, editing AND disabling optional trips require reimport of visits and next-day requirements', () => {
  const project = {charging:{enabled:true,sites:[],opportunity:{enabled:true}},buses:[{id:'B',opportunity_visits:[{id:'V'}]}],meta:{}};
  project.meta.opportunity_import_signature = JSON.stringify(resolvedOpportunityConfig(project));
  assert.equal(opportunityImportNeedsRefresh(project),false);
  const disabled = {...project,charging:{...project.charging,opportunity:{enabled:false}}};
  assert.equal(resolvedOpportunityConfig(disabled).enabled,false);
  assert.equal(opportunityImportNeedsRefresh(disabled),true);
  assert.equal(opportunityImportNeedsRefresh({...project,charging:{...project.charging,enabled:false}}),true);
  assert.equal(opportunityImportNeedsRefresh({...project,meta:{}}),true);
  const reimported = {...disabled,buses:[{id:'B'}],meta:{opportunity_import_signature:JSON.stringify(resolvedOpportunityConfig(disabled))}};
  assert.equal(opportunityImportNeedsRefresh(reimported),false);
  assert.equal(opportunityImportNeedsRefresh({...reimported,charging:project.charging}),true);
  // Unused mapping edits should not force an import when both states are off.
  assert.equal(opportunityImportNeedsRefresh({...reimported,charging:{...disabled.charging,opportunity:{enabled:false,min_charge_minutes:75}}}),false);
});

test('mapping targets share their actual depot capacity; missing distances stay missing', () => {
  const project={charging:{enabled:true,sites:[{id:'LINZ',name:'Depot',nodes:['L_A','L_E']}],opportunity:{enabled:true,mappings:[
    {id:'direct',target_name:'Linz',nodes:['L_A'],outbound_minutes:0,return_minutes:0,outbound_km:0,return_km:0},
    {id:'remote',target_name:'Linz',nodes:['STOP'],outbound_minutes:15,return_minutes:15,outbound_km:null,return_km:null},
  ]}}};
  const resolved=resolvedOpportunityConfig(project);
  assert.equal(resolved.mappings[1].site_id,'LINZ');
  assert.equal(resolved.mappings[1].outbound_km,null);
  assert.equal(project.charging.opportunity.mappings[1].site_id,undefined);
});

test('rescanning preserves configured times and distances without merging distinct destinations', () => {
  const existing=[{id:'old',stop_name:' STOP ',target_name:'Linz',outbound_km:4,outbound_minutes:20,overridden_fields:['outbound_minutes'],enabled:false,nodes:['OLD']},
    {id:'manual',manual:true,stop_name:'Custom',nodes:['C']}];
  const scanned=[{id:'new',stop_name:'Stop',target_name:'Linz',nodes:['NEW'],outbound_km:null,outbound_minutes:15},
    {id:'different',stop_name:'Stop',target_name:'Freistadt',nodes:['NEW'],outbound_km:null}];
  const merged=mergeScannedMappings(existing,scanned);
  assert.equal(merged[0].id,'new');
  assert.equal(merged[0].outbound_km,4);
  assert.equal(merged[0].outbound_minutes,20);
  assert.equal(merged[0].enabled,false);
  assert.deepEqual(merged[0].nodes,['NEW']);
  assert.equal(merged[1].outbound_km,null);
  assert.equal(merged[2].id,'manual');
  const updated=mergeScannedMappings([{...scanned[0],outbound_km:null,nodes:['CUSTOM'],nodes_overridden:true}], [{...scanned[0],outbound_km:7}]);
  assert.equal(updated[0].outbound_km,7);
  assert.deepEqual(updated[0].nodes,['CUSTOM']);
});

test('new workbook values replace stale imports while explicit edits and site choices survive', () => {
  const previous = [{id:'old',source_node_code:'STOP',stop_name:'Old name',target_name:'Linz',site_id:'SITE',
    outbound_minutes:20,return_minutes:20,outbound_km:3,return_km:3,enabled:true,overridden_fields:['return_km']}];
  const scanned = [{id:'new',source_node_code:'STOP',stop_name:'Renamed stop',target_name:'Linz',nodes:['STOP'],
    outbound_minutes:15,return_minutes:10,outbound_km:10,return_km:9,enabled:true,site_id:''}];
  const merged = mergeScannedMappings(previous, scanned)[0];
  assert.equal(merged.site_id,'SITE');
  assert.equal(merged.stop_name,'Renamed stop');
  assert.equal(merged.outbound_minutes,15);
  assert.equal(merged.outbound_km,10);
  assert.equal(merged.return_minutes,10);
  assert.equal(merged.return_km,3);
  assert.equal(merged.source_values.return_km,9);
  assert.equal(mergeScannedMappings([{...previous[0],source_node_code:'OTHER'}], scanned)[0].site_id,'');
  const legacy = mergeScannedMappings([{...previous[0],source_node_code:undefined,stop_name:'Renamed stop',overridden_fields:[]}],scanned)[0];
  assert.equal(legacy.outbound_minutes,15);
  assert.equal(legacy.outbound_km,10);
});

test('result audit includes only chosen transfer consumption and retains original baseline inputs', () => {
  const bus={id:'B',trips:[{start_min:90,energy_kwh:15}],trip_energy_profile_kwh:[0,0,15,0],energy_demand_kwh:15};
  const inputs={buses:[bus]};
  const actual=inputsWithRealizedVisits(inputs,{additional_trip_energy_profiles:{B:[2,2,0,0]},additional_trips:{B:[{start_min:0,end_min:15,energy_kwh:2},{start_min:30,end_min:45,energy_kwh:2}]}});
  assert.deepEqual(actual.buses[0].trip_energy_profile_kwh,[2,2,15,0]);
  assert.equal(actual.buses[0].energy_demand_kwh,19);
  assert.equal(actual.buses[0].trips.length,3);
  assert.equal(actual.scheduled_buses[0],bus);
  assert.equal(bus.energy_demand_kwh,15);
  assert.equal(inputsWithRealizedVisits(inputs,{}),inputs);
});
