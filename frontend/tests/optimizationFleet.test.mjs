import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizationFleet, excludableBusIds, diagnosedRouteIds, fleetRunMetadata,validationExclusionReasons,diagnosedExclusionReasons,exclusionReasonLabel } from '../src/utils/optimizationFleet.js';

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
  assert.deepEqual(fleetRunMetadata(restored).excluded_bus_ids,['2']);
  assert.equal(fleetRunMetadata(restored).excluded_bus_reasons['2'].category,'manual_or_unspecified');
  assert.equal(optimizationFleet({...restored,meta:{excluded_bus_ids:[]}}).included.length,2);
});

test('an empty included fleet stays empty rather than falling back to imported buses', () => {
  const project = {buses:[{id:'A'}],meta:{excluded_bus_ids:['A']}};
  assert.deepEqual(optimizationFleet(project).included,[]);
  assert.equal(optimizationFleet(project).excluded.length,1);
});

test('disabled optional trips never reach the solver, while scheduled charging and original import survive', () => {
  const bus = {id:'B',availability:[1],site_availability:{HOME:[1]},opportunity_visits:[{id:'V'}]};
  const project = {buses:[bus],charging:{enabled:true,opportunity:{enabled:false}}};
  const active = optimizationFleet(project).included[0];
  assert.deepEqual(active.opportunity_visits,[]);
  assert.deepEqual(active.site_availability,{HOME:[1]});
  assert.deepEqual(active.availability,[1]);
  assert.equal(bus.opportunity_visits.length,1);
  project.charging.opportunity.enabled = true;
  assert.equal(optimizationFleet(project).included[0],bus);
  project.charging.enabled = false;
  assert.deepEqual(optimizationFleet(project).included[0].opportunity_visits,[]);
});

test('diagnosed exclusion requires an exact known classification, never just a deficit or timeout', () => {
  const buses = ['bad','conflict','solo','timeout'].map(id => ({id}));
  const diagnostic = {result:{diagnostics:{energy_relaxation:{findings:[{bus_id:'solo'}]},route_feasibility:{routes:[
    {bus_id:'bad',status:'individually_infeasible'},{bus_id:'conflict',status:'affected_by_fleet_conflict'},
    {bus_id:'solo',status:'feasible_in_isolation'},{bus_id:'timeout',status:'not_determined'},
    {bus_id:'unknown',status:'individually_infeasible'},
  ]}}}};
  assert.deepEqual(diagnosedRouteIds(diagnostic,buses),['bad','conflict']);
  assert.deepEqual(diagnosedRouteIds(diagnostic,buses,true),['bad']);
  assert.deepEqual(diagnosedRouteIds(null,buses),[]);
});

test('recorded exclusion causes separate energy proof, missing mapping, manual history and fleet conflicts',()=>{
 const validation={issues:[{bus_id:'E',type:'ERROR',code:'BUS_ENERGY_INFEASIBLE',details:{proof:'optimistic_energy_bound',scope:'current_model_assumptions',reason:'cyclic_soc_shortfall',missing_energy_kwh:.2}},
  {bus_id:'N',type:'WARNING',code:'NO_CHARGING_AVAILABILITY',details:{proof:'none'}}]};
 const reasons=validationExclusionReasons(validation,['E','N'],'fixture');
 assert.equal(reasons.E.category,'energy_proven');assert.equal(reasons.N.category,'missing_availability');
 assert.match(exclusionReasonLabel(reasons.N.category),/not proven infeasible/);
 const project={buses:[{id:'E'},{id:'N'},{id:'M'}],meta:{excluded_bus_ids:['E','N','M'],excluded_bus_reasons:reasons}};
 const metadata=fleetRunMetadata(project);
 assert.equal(metadata.excluded_bus_reasons.M.category,'manual_or_unspecified');
 assert.deepEqual(metadata.excluded_bus_reasons.E.evidence[0].details.missing_energy_kwh,.2);
 const diagnostic={result:{diagnostics:{route_feasibility:{routes:[{bus_id:'B',status:'individually_infeasible'},{bus_id:'F',status:'affected_by_fleet_conflict'}]}}}};
 const diagnosed=diagnosedExclusionReasons(diagnostic,['B','F']);
 assert.equal(diagnosed.B.category,'model_infeasible');assert.equal(diagnosed.F.category,'fleet_conflict');
 assert.deepEqual(project.buses.map(bus=>bus.id),['E','N','M']);
});
