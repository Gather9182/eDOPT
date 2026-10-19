import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvedOpportunityConfig, mergeScannedMappings, inputsWithRealizedVisits } from '../src/utils/opportunity.js';

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
  const existing=[{id:'old',stop_name:' STOP ',target_name:'Linz',outbound_km:4,outbound_minutes:20,enabled:false,nodes:['OLD']},
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
