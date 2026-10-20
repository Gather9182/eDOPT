import test from 'node:test';
import assert from 'node:assert/strict';
import { importedVehicleTypes, timetableSettings, timetableFingerprint, processTimetableDraft, projectWithTimetable, saveTimetableSource, loadTimetableSource } from '../src/utils/timetableImport.js';

const oldBus = {id:'OLD',availability:[1,0],trip_energy_profile_kwh:[0,10],max_battery_capacity_kwh:100};
function draft() {
  return { projectData:{buses:[oldBus],constraints:{max_power_per_bus:150,efficiency:.92,max_battery_capacity_kwh:350,grid_limit_kw:600,charger_capacity_kw:600},
    pricing:[42,43],meta:{default_consumption_wh_m:1.5,vehicle_types_config:{NGB:{consumption:1.8,battery:450}},price_assumptions:{supplier_markup:10}},
    charging:{enabled:true,sites:[{id:'D',nodes:['D_A','D_E'],num_chargers:12,no_switch_windows:[{start:'22:00',end:'05:00'}]}]}},
    options:{sheet:'Mo-Do Schule',days:[],distanceUnit:'mixed',mixedThreshold:50,vehicleOverrides:{},useFirstVehicleType:true},
    selectedDepots:['D_A','D_E'],initialSoc:0,minFinalSoc:20,roundWindows:true,allNodes:['D_A','D_E'],scan:{selected_sheet:'Mo-Do Schule'},
    file:new File(['example workbook'],'input.xlsx'),sourceKey:'source-key' };
}
const result = () => ({bus_inputs:[{id:'NEW',availability:[1,0],trip_energy_profile_kwh:[0,25],site_availability:{D:[1,0]},
  site_presence:{D:[1,0]},site_arrivals:{D:[0,0]},site_nodes:{D:['D_A','D_E']},max_battery_capacity_kwh:450}],charging_sites:[{id:'D',nodes:['D_A','D_E']}]});

test('group selection changes source labels and is preserved through continue', async () => {
  const context = draft();
  const original = timetableFingerprint(timetableSettings(context), context.roundWindows);
  assert.equal(timetableSettings(context).USE_VEHICLE_TYPE_GROUP, false);
  context.options.useVehicleTypeGroup = true;
  const bus = { vehicle_types:['RB12'], vehicle_type_groups:['GB/LB', 'GB'] };
  assert.deepEqual(importedVehicleTypes(bus, context.options), ['GB']);
  assert.deepEqual(importedVehicleTypes(bus, {...context.options, useFirstVehicleType:false}), ['GB/LB', 'GB']);
  assert.deepEqual(importedVehicleTypes(bus, {...context.options, useVehicleTypeGroup:false}), ['RB12']);
  assert.deepEqual(importedVehicleTypes({vehicle_types:['RB12']}, context.options), []);
  assert.notEqual(timetableFingerprint(timetableSettings(context), context.roundWindows), original);
  const data = await processTimetableDraft(context, async (file, round, settings) => {
    assert.equal(settings.USE_VEHICLE_TYPE_GROUP, true);
    return result();
  });
  assert.equal(projectWithTimetable(context.projectData, data, context).meta.import_settings.useVehicleTypeGroup, true);
});

test('continue prepares current configuration and replaces old project buses with the fresh response',async () => {
  const context=draft();
  context.projectData.meta.excluded_bus_ids=['OLD','NEW'];
  const data=await processTimetableDraft(context,async (file,round,settings) => {
    assert.equal(file,context.file);
    assert.equal(round,true);
    assert.equal(settings.USE_FIRST_VEHICLE_TYPE,true);
    assert.equal(settings.VEHICLE_TYPE_SPECS.NGB.battery_capacity_kwh,450);
    assert.equal(settings.CHARGING_SITES[0].num_chargers,12);
    return result();
  });
  const next=projectWithTimetable(context.projectData,data,context);
  assert.equal(next.buses[0].id,'NEW');
  assert.equal(next.buses[0].initial_soc_kwh,0);
  assert.equal(next.buses[0].min_final_soc_kwh,90);
  assert.equal(next.buses[0].efficiency,.92);
  assert.deepEqual(next.charging,context.projectData.charging);
  assert.deepEqual(next.pricing,[42,43]);
  assert.equal(next.meta.timetable_source_key,'source-key');
  assert.equal(next.meta.import_settings.useFirstVehicleType,true);
  assert.deepEqual(next.meta.excluded_bus_ids,[]);
  assert.deepEqual(context.projectData.meta.excluded_bus_ids,['OLD','NEW']);
  assert.equal(context.projectData.buses[0].id,'OLD');
});

test('failed processing leaves project data intact',async () => {
  const context=draft(), before=JSON.stringify(context.projectData);
  await assert.rejects(processTimetableDraft(context,async () => {throw new Error('Backend unavailable');}),/Backend unavailable/);
  assert.equal(JSON.stringify(context.projectData),before);
});

test('old buses with no location profiles cannot silently continue when locations are enabled',async () => {
  const context=draft();context.file=null;
  context.initialFingerprint=timetableFingerprint(timetableSettings(context),context.roundWindows);
  await assert.rejects(processTimetableDraft(context,async()=>assert.fail('No file to process')),/original Excel file/);
});

test('changes requiring reprocessing do not fall back to old buses if the source is missing',async () => {
  const context=draft();context.file=null;
  context.initialFingerprint=timetableFingerprint(timetableSettings(context),context.roundWindows);
  context.options={...context.options,useFirstVehicleType:false};
  await assert.rejects(processTimetableDraft(context,async()=>assert.fail('No file to process')),/Upload it again/);
});

test('unchanged existing legacy projects can continue without uploading again',async () => {
  const context=draft();context.file=null;context.projectData.charging.enabled=false;
  context.initialFingerprint=timetableFingerprint(timetableSettings(context),context.roundWindows);
  const data=await processTimetableDraft(context,async()=>assert.fail('No processing needed'));
  assert.equal(data.bus_inputs[0].id,'OLD');
});

test('invalid or stale location responses are rejected before being applied',async () => {
  const context=draft(), stale=result();stale.bus_inputs[0].site_nodes.D=['other'];
  await assert.rejects(processTimetableDraft(context,async()=>stale),/charging locations/);
  await assert.rejects(processTimetableDraft(context,async()=>({bus_inputs:[]})),/No routes found/);
});

test('saved source bytes survive JSON storage and reopening, including binary XLSX data',async () => {
  const store=new Map();
  const file=new File([new Uint8Array([0,255,1,128,13,10])],'Umläufe.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:123456});
  const key=await saveTimetableSource(file,async(k,v)=>store.set(k,JSON.stringify(v)));
  const restored=await loadTimetableSource(key,async k=>JSON.parse(store.get(k)));
  assert.equal(restored.name,file.name);
  assert.equal(restored.lastModified,123456);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),new Uint8Array(await file.arrayBuffer()));
  await assert.rejects(loadTimetableSource('missing',async()=>null),/unavailable/);
});

test('invalid SoC settings fail before the backend request',async () => {
  const context=draft();context.initialSoc=101;
  await assert.rejects(processTimetableDraft(context,async()=>assert.fail('Must validate before processing')),/0 and 100/);
});
