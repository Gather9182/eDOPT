import test from 'node:test';
import assert from 'node:assert/strict';
import { locationProfilesForHorizon, chargingInputs, addSelectedDepotSites } from '../src/utils/charging.js';

const bus = {availability:[0,1,1,0], site_availability:{D:[0,1,1,0]}, site_presence:{D:[1,1,1,0]}, site_arrivals:{D:[1,0,0,0]}, trip_energy_profile_kwh:[10,0,0,20], trips:[{start_min:0,energy_kwh:10},{start_min:45,energy_kwh:20}]};
test('coarser periods never make a partially available slot chargeable', () => {
  const profiles=locationProfilesForHorizon(bus,2,30,15);
  assert.deepEqual(profiles.availability,[0,0]);
  assert.deepEqual(profiles.trip_energy_profile_kwh,[10,20]);
});
test('finer grid preserves energy and fires arrivals only once', () => {
  const profiles=locationProfilesForHorizon(bus,12,5,15);
  assert.equal(profiles.site_arrivals.D.reduce((a,b)=>a+b),1);
  assert.equal(profiles.trip_energy_profile_kwh.reduce((a,b)=>a+b),30);
  assert.deepEqual(profiles.availability.slice(0,3),[0,0,0]);
});
test('repeated planning horizons preserve each daily trip once', () => {
  const profiles=locationProfilesForHorizon(bus,8,15,15);
  assert.equal(profiles.trip_energy_profile_kwh.reduce((a,b)=>a+b),60);
  assert.deepEqual(profiles.site_availability.D,[0,1,1,0,0,1,1,0]);
});
test('legacy projects need no location migration; enabled empty configurations remain explicit', () => {
  assert.deepEqual(chargingInputs({}),{});
  assert.equal(chargingInputs({charging:{enabled:true,sites:[]}}).use_charging_sites,true);
});

test('automatic locks prohibit new connections in exact requests and preserve an explicit optimized mode', () => {
  const sites=[{id:'A',allow_connect_on_arrival:true},{id:'B',lock_charging_mode:'optimized',allow_connect_on_arrival:true}];
  const request=chargingInputs({charging:{enabled:true,sites}});
  assert.equal(request.charging_sites[0].lock_charging_mode,'automatic_balanced');
  assert.equal(request.charging_sites[0].allow_connect_on_arrival,false);
  assert.equal(request.charging_sites[1].allow_connect_on_arrival,true);
  assert.equal(sites[0].allow_connect_on_arrival,true);
});

const suggestions = [{id:'A',name:'Depot A',nodes:['A_A','A_E']},{id:'B',name:'Depot B',nodes:['B_A','B_E']}];
const createSite = suggestion => ({...suggestion, num_chargers:1, no_switch_windows:[]});
test('only selected A/E nodes are transferred and paired at the same location', () => {
  const result=addSelectedDepotSites([],['A_A','A_E','unrelated_stop'],suggestions,createSite);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].nodes,['A_A','A_E']);
  assert.deepEqual(addSelectedDepotSites([],['B_E'],suggestions,createSite)[0].nodes,['B_E']);
});
test('transfer merges into a manually created depot without resetting infrastructure or locks', () => {
  const existing=[{id:'custom',name:'Configured depot',nodes:['A_A'],num_chargers:7,no_switch_windows:[{start:'22:00',end:'05:00'}]}];
  const result=addSelectedDepotSites(existing,['A_A','A_E'],suggestions,createSite);
  assert.equal(result.length,1);
  assert.equal(result[0].num_chargers,7);
  assert.deepEqual(result[0].no_switch_windows,existing[0].no_switch_windows);
  assert.deepEqual(result[0].nodes,['A_A','A_E']);
  assert.deepEqual(existing[0].nodes,['A_A']);
  assert.deepEqual(addSelectedDepotSites(result,['A_A','A_E'],suggestions,createSite),result);
});
test('transfer preserves nodes already assigned to another location', () => {
  const existing=[{id:'A',nodes:[],num_chargers:3},{id:'other',nodes:['A_E'],num_chargers:4}];
  const result=addSelectedDepotSites(existing,['A_A','A_E'],suggestions,createSite);
  assert.deepEqual(result[0].nodes,['A_A']);
  assert.deepEqual(result[1].nodes,['A_E']);
});
