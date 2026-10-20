import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChargingSessions, chargingOriginAt } from '../src/utils/chargingOrigin.js';

const visit = (changes = {}) => ({bus_id:'B',site_id:'D',from_node:'STOP',to_node:'STOP',departure_min:0,
  charger_arrival_min:15,return_departure_min:45,return_arrival_min:60,distance_km:7,...changes});
const result = (changes = {}) => ({run_metadata:{inputs:{time_step_minutes:15,charging_sites:[{id:'D',name:'Depot'}],
  buses:[{id:'B',opportunity_visits:[{id:'candidate'}]}]}},aggregated_load_profile:[0,20,30,10],
  schedules:{B:[0,20,30,10]},connection_schedules:{B:[null,'D','D','D']},opportunity_charging_visits:[visit()],...changes});

test('actual detour and scheduled charging split even at the same site with no power gap', () => {
  const sessions = buildChargingSessions(result(),'B');
  assert.deepEqual(sessions.map(s => [s.origin,s.start,s.end,s.siteName]),[
    ['detour','00:15','00:45','Depot'],['scheduled','00:45','01:00','Depot']]);
  assert.equal(sessions[0].totalKwh,12.5);
  assert.equal(sessions[0].travelMinutes,30);
  assert.match(sessions[0].explanation,/7.0 km round trip/);
  assert.equal(sessions[1].totalKwh,2.5);
});

test('unused candidates do not turn scheduled-stop charging into a detour', () => {
  const data = result({opportunity_charging_visits:[]});
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
  data.opportunity_charging_visits = [visit({bus_id:'OTHER'})];
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
  data.opportunity_charging_visits = [visit({site_id:'OTHER'})];
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
});

test('different visits and sites split continuous charging and low power is retained', () => {
  const data = result({opportunity_charging_visits:[visit({return_departure_min:30}),
    visit({departure_min:15,charger_arrival_min:30,return_departure_min:45,return_arrival_min:60})],schedules:{B:[0,1,1,1]}});
  assert.equal(buildChargingSessions(data,'B').length,3);
  data.opportunity_charging_visits = [];
  data.connection_schedules.B = [null,'D','OTHER','OTHER'];
  const sessions = buildChargingSessions(data,'B');
  assert.deepEqual(sessions.map(s => s.siteId),['D','OTHER']);
  assert.equal(sessions.reduce((sum,s) => sum+s.totalKwh,0),0.75);
});

test('overnight cyclic visits identify the early-morning portion without repeating long-term visits', () => {
  const data = result({aggregated_load_profile:Array(96).fill(0),opportunity_charging_visits:[visit({
    departure_min:1380,charger_arrival_min:1425,return_departure_min:1485,return_arrival_min:1500})]});
  assert.equal(chargingOriginAt(data,'B',15).origin,'detour');
  assert.equal(chargingOriginAt(data,'B',45).origin,'scheduled');
  assert.equal(chargingOriginAt({...data,is_long_term:true},'B',15).origin,'scheduled');
  data.run_metadata.inputs.cyclic_connections = false;
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
});

test('long-term day drill-down uses global visit times but displays local session times', () => {
  const data = result({is_long_term:true,opportunity_charging_visits:[visit({
    departure_min:1440,charger_arrival_min:1455,return_departure_min:1485,return_arrival_min:1500})],
    connection_schedules:{B:[...Array(96).fill(null),null,'D','D','D']}});
  const sessions = buildChargingSessions(data,'B',{offsetMinutes:1440});
  assert.equal(sessions[0].origin,'detour');
  assert.equal(sessions[0].start,'00:15');
  assert.equal(sessions[0].end,'00:45');
  assert.equal(sessions[1].end,'01:00');
});

test('old results without provenance remain unknown, and zero-travel visits have no detour', () => {
  const data = result({opportunity_charging_visits:undefined});
  assert.equal(chargingOriginAt(data,'B',15).origin,'unknown');
  data.run_metadata.inputs.buses[0].site_availability = {D:[0,1,1,0]};
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
  data.opportunity_charging_visits = [visit({departure_min:15,return_arrival_min:45,distance_km:0})];
  assert.equal(chargingOriginAt(data,'B',15).origin,'scheduled');
});
