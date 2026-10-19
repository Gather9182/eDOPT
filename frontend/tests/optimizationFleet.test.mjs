import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizationFleet, excludableBusIds, fleetRunMetadata } from '../src/utils/optimizationFleet.js';

test('only explicitly identified route energy or availability issues can exclude known routes', () => {
  const buses = [{id:'Bus: A'}, {id:2}, {id:'Other'}];
  const validation = {issues:[
    {code:'NO_CHARGING_AVAILABILITY',bus_id:'Bus: A'},
    {code:'NO_CHARGING_AVAILABILITY',bus_id:'2'},
    {code:'NO_CHARGING_AVAILABILITY',bus_id:'Bus: A'},
    {code:'NO_CHARGING_AVAILABILITY',bus_id:'unknown'},
    {type:'ERROR',bus_id:'Other',message:'Invalid battery or profile'},
    {type:'WARNING',message:'Bus Other has NO availability for charging during the entire horizon.'},
    {type:'ERROR',message:'Electricity price length mismatch'},
  ]};
  assert.deepEqual(excludableBusIds(validation,buses),['Bus: A','2']);
  assert.deepEqual(excludableBusIds(null,buses),[]);
  assert.deepEqual(excludableBusIds({issues:[
    {code:'BUS_ENERGY_INFEASIBLE',bus_id:'Other'},
    {code:'BUS_FINAL_TARGET_EXCEEDS_CAPACITY',bus_id:'2'},
    {code:'FLEET_ENERGY_SHORTFALL',bus_id:'Bus: A'},
  ]},buses),['Other','2']);
});

test('exclusions survive project persistence without removing or editing imported trips', () => {
  const original = {buses:[{id:'A',trips:[{energy_kwh:10}]},{id:2,trips:[{energy_kwh:20}]}],meta:{}};
  const project = {...original,meta:{excluded_bus_ids:['2','no-longer-imported']}};
  const restored = JSON.parse(JSON.stringify(project));
  assert.deepEqual(optimizationFleet(restored).included, [original.buses[0]]);
  assert.deepEqual(optimizationFleet(restored).excluded, [original.buses[1]]);
  assert.equal(original.buses.length,2);
  assert.deepEqual(original.meta,{});
  assert.deepEqual(fleetRunMetadata(restored), {imported_bus_count:2,excluded_bus_ids:['2']});
  assert.equal(optimizationFleet({...restored,meta:{excluded_bus_ids:[]}}).included.length,2);
});

test('an empty included fleet stays empty rather than falling back to imported buses', () => {
  const project = {buses:[{id:'A'}],meta:{excluded_bus_ids:['A']}};
  assert.deepEqual(optimizationFleet(project).included,[]);
  assert.equal(optimizationFleet(project).excluded.length,1);
});
