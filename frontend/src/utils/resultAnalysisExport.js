import { diagnosticClone } from './diagnosticExport.js';
import { loadTimetableSource } from './timetableImport.js';
import { buildChargingSessions } from './chargingOrigin.js';
import {calendarDayIndex} from './dailyBoundary.js';

const json = value => JSON.stringify(value ?? null, null, 2);
const present = value => value !== null && value !== undefined;
const entries = value => Object.entries(value || {});
const list = value => Array.isArray(value) ? value : [];
const total = values => list(values).reduce((sum, value) => sum + value, 0);

// Generators keep annual bus profiles from allocating millions of row arrays.
function csv(rows) {
  const chunks = [];
  let chunk = '\uFEFF';
  for (const row of rows) {
    chunk += row.map(value => {
      const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
      const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"','""')}"`;
    }).join(';') + '\r\n';
    if (chunk.length > 65536) { chunks.push(chunk); chunk = ''; }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join('');
}

function objectCsv(rows, leading = []) {
  const fields = [...new Set([...leading,...rows.flatMap(row => Object.keys(row))])];
  return csv((function* () { yield fields; for (const row of rows) yield fields.map(field => row[field]); })());
}

export function runAuditMetadata(context, validation, logs, requestArchive = []) {
  return diagnosticClone({audit_context:context,validation_snapshot:validation,
    interface_logs:logs,request_archive:requestArchive});
}

export async function archiveChunkRequest(inputs, attempt, runId, setItem, result = {}) {
  const record = {...attempt,storage_key:`analysis_request_${runId}_${attempt.chunk_number}`,status:'stored',
    solver_status:result.status,solver_logs:diagnosticClone(result.solver_logs || []),optimization_gap:result.optimization_gap,
    baseline_feasible:result.baseline_feasible,baseline_issues:diagnosticClone(result.baseline_issues || [])};
  try { await setItem(record.storage_key,diagnosticClone(inputs)); }
  catch (error) { record.status = 'unavailable'; record.error = error.message; }
  return record;
}

export async function resultAnalysisFiles(results, currentProject, getItem, environment = {}, now = new Date(), onProgress=()=>{}) {
  onProgress({phase:'snapshot',message:'Writing results and configuration snapshots'});
  if (!results || typeof results !== 'object') throw new Error('No saved optimization result is available.');
  // These are separately named snapshots. Current settings never replace run inputs.
  const metadata = results.run_metadata || {};
  const context = metadata.audit_context;
  const project = context?.project || null;
  const inputs = metadata.inputs || null;
  const buses = inputs?.buses || [];
  const step = inputs?.time_step_minutes;
  const usableStep = Number.isFinite(step) && step > 0 ? step : null;
  const missing = [];
  if (!project) missing.push('The original project snapshot at run time was not recorded for this older result. project_current.json is the current project only.');
  if (!inputs) missing.push('Run inputs are unavailable. Current project values have not been substituted.');
  if (!usableStep) missing.push('The run time step is unavailable. Minute offsets are left blank.');
  if (results.storage_pruned) missing.push(results.storage_message || 'Detailed result profiles were previously removed by the storage fallback and cannot be reconstructed.');
  if (!metadata.request_inputs && !metadata.request_archive?.length) missing.push('Exact solver requests were not archived for this older result. Recorded run inputs may include realized additional trips or summarized long-term settings.');
  const files = [
    {name:'results.json',data:json(results)},
    {name:'project_current.json',data:json(currentProject)},
    {name:'run/metadata.json',data:json(metadata)},
    {name:'run/project_at_run.json',data:json(project)},
    {name:'run/recorded_inputs.json',data:json(inputs)},
    {name:'run/solver_request.json',data:json(metadata.request_inputs)},
    {name:'run/runtime_settings.json',data:json(context?.runtime_settings || metadata.settings)},
    {name:'run/input_check.json',data:json(metadata.validation_snapshot)},
    {name:'run/market_price_data.json',data:json(metadata.market_price_data || metadata.audit_context?.project?.meta?.price_evidence || null)},
    {name:'run/logs.json',data:json({solver:results.solver_logs || [],interface:metadata.interface_logs || []})},
    {name:'environment_at_export.json',data:json(environment)},
  ];
  if (results.price_assumption?.mode==='flat_rate' || results.flat_rate_comparison?.enabled) {
    files.push({name:'run/flat_rate.json',data:json({price_assumption:results.price_assumption,comparison:results.flat_rate_comparison})});
    if (results.flat_rate_comparison?.enabled) files.push({name:'tables/flat_rate_comparison.csv',data:objectCsv([{
      ...results.flat_rate_comparison,main_analysis_cost_eur:results.total_cost_eur,evaluated_days:results.total_days ?? null}])});
  }
  if (results.long_term_mode === 'daily_cyclic') {
    files.push({name:'run/days/price_preparation.json',data:json(results.historical_price_preparation || null)});
    files.push({name:'run/days/status.json',data:json({status:results.run_status,scope:results.timetable_scope,execution:results.daily_execution,dst_policy:results.dst_policy,skipped_dates:results.skipped_dates || [],completed_dates:results.completed_dates,completed_day_indices:results.completed_day_indices,days:results.day_records,failed_attempts:results.failed_attempts || []})});
    for (const [index,day] of (results.daily_results || []).entries()) {
      if(index%8===0) onProgress({phase:'daily',message:'Writing daily evidence',completed:index,total:results.daily_results.length});
      const prefix=`run/days/day_${String(index+1).padStart(5,'0')}`;
      files.push({name:`${prefix}/request.json`,data:json(day.request)},{name:`${prefix}/prices.json`,data:json(day.prices)},
        {name:`${prefix}/attempt_history.json`,data:json(day.attempt_history || [])},
        {name:`${prefix}/result.json`,data:json(day.result)},{name:`${prefix}/date.json`,data:json({date:day.date,day_index:day.day_index})});
    }
    files.push({name:'tables/daily_summary.csv',data:objectCsv((results.day_records || []).map(day=>({date:day.date,status:day.status,
      solver_status:day.solver_status,optimality_proven:day.optimality_proven,exclusion_code:day.exclusion?.code,local_day_hours:day.exclusion?.local_day_hours,
      cost_eur:day.reconciliation?.cost_eur,grid_energy_kwh:day.reconciliation?.grid_energy_kwh,charger_energy_mwh:day.reconciliation?.charger_energy_mwh,error:day.error?.detail})),['date','status','cost_eur','grid_energy_kwh','charger_energy_mwh'])},
      {name:'tables/daily_soc_connections.csv',data:objectCsv(results.end_condition?.buses || [],['date','day_index','bus_id','initial_soc_kwh','final_soc_kwh','previous_final_soc_kwh','initial_connection','previous_final_connection','final_connection','compliant'])},
      {name:'tables/daily_prices.csv',data:objectCsv((results.daily_results || []).flatMap(day=>day.prices.timestamps.map((timestamp,t)=>({date:day.date,timestamp,market_price_eur_mwh:day.prices.market_prices[t],effective_price_eur_mwh:day.request.electricity_prices[t]}))),['date','timestamp','market_price_eur_mwh','effective_price_eur_mwh'])});
  }
  const requestArchive = [];
  onProgress({phase:'sources',message:'Reading archived solver requests and source files'});
  for (const record of metadata.request_archive || []) {
    const descriptor = {...record};
    try {
      const request = record.status === 'stored' ? await getItem(record.storage_key) : null;
      if (!request) throw new Error(record.error || 'The locally archived request is unavailable.');
      // Archive paths come from array positions, never user-supplied names.
      descriptor.archive_path = `run/requests/chunk_${String(requestArchive.length + 1).padStart(5,'0')}.json`;
      files.push({name:descriptor.archive_path,data:json(request)});
      descriptor.export_status = 'included';
    } catch (error) {
      descriptor.export_status = 'unavailable'; descriptor.export_error = error.message;
      missing.push(`Exact request for chunk ${record.chunk_number}: ${error.message}`);
    }
    requestArchive.push(descriptor);
  }

  const sources = [];
  const sourceKeys = new Map();
  for (const [scope, sourceProject] of [['run',project],['current',currentProject]]) {
    const key = sourceProject?.meta?.timetable_source_key;
    if (!key) {
      sources.push({scope,status:'unavailable',name:sourceProject?.meta?.timetable_source_name || null});
      continue;
    }
    if (sourceKeys.has(key)) { sources.push({...sourceKeys.get(key),scope}); continue; }
    const descriptor = {scope,name:sourceProject.meta.timetable_source_name || null,status:'unavailable'};
    try {
      const file = await loadTimetableSource(key,getItem);
      if (!file) throw new Error('Original Excel file is unavailable.');
      descriptor.name = file.name;
      descriptor.status = 'included';
      descriptor.bytes = file.size;
      descriptor.archive_path = `source/${scope}_original_timetable.xlsx`;
      files.push({name:descriptor.archive_path,data:new Uint8Array(await file.arrayBuffer())});
    } catch (error) { descriptor.error = error.message; }
    sourceKeys.set(key,descriptor);
    sources.push(descriptor);
  }
  if (!sources.some(source => source.scope === 'run' && source.status === 'included')) missing.push('The original timetable for this run is unavailable. A current-project source, if included, is identified separately and is not assumed to match the run.');

  const series = entries(results).filter(([key,values]) => key!=='completed_day_indices' && Array.isArray(values) && values.length && values.every(value => typeof value === 'number' || value === null));
  onProgress({phase:'tables',message:'Writing detailed fleet and bus tables'});
  const calendarMinute = t => usableStep ? calendarDayIndex(results,Math.floor(t*step/1440))*1440+(t*step)%1440 : null;
  const maxPeriods = series.reduce((max,[,values]) => Math.max(max,values.length),0);
  files.push({name:'tables/fleet_timeseries.csv',data:csv((function* () {
    yield ['Period_zero_based','Minutes_from_start',...(results.completed_dates ? ['Calendar_date','Calendar_minutes_from_start'] : []),...series.map(([key]) => key)];
    for (let t=0;t<maxPeriods;t++) {
      const slot=usableStep ? Math.floor(t*step/1440) : null;
      yield [t,calendarMinute(t),...(results.completed_dates ? [results.completed_dates[slot],calendarMinute(t)] : []),...series.map(([,values]) => values[t])];
    }
  })())});
  files.push({name:'tables/summary.csv',data:csv([['Metric','Saved_value'],...entries(results).filter(([,value]) => typeof value !== 'object')])});

  const profileSets = (single, byDay) => results.is_long_term && results[byDay]
    ? entries(results[byDay]).map(([day,profiles]) => ({day:calendarDayIndex(results,day),profiles:profiles || {},profileOffset:usableStep ? Number(day)*1440/step : null,offset:usableStep ? calendarDayIndex(results,day)*1440/step : null}))
    : [{day:null,profiles:results[single] || {},offset:0}];
  function* busProfileRows(single,byDay,column) {
    yield ['Route','Day_zero_based','Period_in_profile','Global_period','Minutes_from_start',column];
    for (const {day,profiles,offset} of profileSets(single,byDay)) {
      for (const [id,values] of entries(profiles)) for (const [t,value] of list(values).entries()) {
        const global = offset === null ? null : offset+t;
        yield [id,day,t,global,global !== null && usableStep ? global*step : null,value];
      }
    }
  }
  files.push({name:'tables/bus_charging.csv',data:csv(busProfileRows('schedules','schedules_by_day','Charging_power_kW'))},
    {name:'tables/bus_soc.csv',data:csv(busProfileRows('soc_profiles','soc_profiles_by_day','Boundary_SoC_kWh'))},
    {name:'tables/additional_trip_energy.csv',data:csv(busProfileRows('additional_trip_energy_profiles','unused_by_day','Additional_trip_energy_kWh'))});
  if (results.is_long_term && (!results.schedules_by_day || !results.soc_profiles_by_day)) missing.push('Some daily bus charging/SoC profiles are absent from the stored long-term result. Only available profiles are exported.');
  if (results.is_long_term && Number.isInteger(results.total_days) && results.total_days > 0) {
    for (const field of ['schedules_by_day','soc_profiles_by_day','diagnostics_by_day']) {
      const absent = [];
      for (let day=0;day<results.total_days;day++) if (!results[field]?.[day] || !Object.keys(results[field][day]).length) absent.push(day);
      if (absent.length) missing.push(`${field}: ${absent.length} days unavailable (zero-based day indexes: ${absent.slice(0,12).join(', ')}${absent.length > 12 ? ', …' : ''}).`);
    }
  }
  const diagnostics = list(results.bus_diagnostics).map(row => ({day_index:null,...row}));
  for (const [day,rows] of entries(results.diagnostics_by_day)) for (const row of list(rows)) diagnostics.push({day_index:calendarDayIndex(results,day),date:results.completed_dates?.[day],...row});
  onProgress({phase:'tables',message:'Writing site, route and charging-session tables'});
  files.push({name:'tables/bus_diagnostics.csv',data:objectCsv(diagnostics,['day_index','id'])});

  const sites = inputs?.charging_sites || [];
  const siteIds = [...new Set([...sites.map(site => site.id),...Object.keys(results.site_load_profiles || {}),
    ...Object.keys(results.site_grid_import_profiles || {}),...Object.keys(results.site_occupied_connectors || {})])];
  files.push({name:'tables/charging_sites.csv',data:objectCsv(sites,['id','name','nodes','num_chargers','charger_power_kw','charger_capacity_kw','grid_limit_kw','no_switch_windows','lock_charging_mode','allow_connect_on_arrival'])},
    {name:'tables/site_profiles.csv',data:csv((function* () {
      yield ['Charging_site','Period_zero_based','Minutes_from_start','Load_kW','Grid_import_kW','Occupied_connectors'];
      for (const id of siteIds) {
        const load = results.site_load_profiles?.[id] || [], grid = results.site_grid_import_profiles?.[id] || [], occupied = results.site_occupied_connectors?.[id] || [];
        for (let t=0;t<Math.max(load.length,grid.length,occupied.length);t++) yield [id,t,calendarMinute(t),load[t],grid[t],occupied[t]];
      }
    })())},
    {name:'tables/bus_connections.csv',data:csv((function* () {
      yield ['Route','Period_zero_based','Minutes_from_start','Connected_site'];
      for (const [id,values] of entries(results.connection_schedules)) for (const [t,site] of list(values).entries()) yield [id,t,calendarMinute(t),site];
    })())});
  files.push({name:'run/operating_soc_policy.json',data:json(results.soc_policy || null)},
    {name:'tables/operating_soc_deviations.csv',data:objectCsv(results.soc_policy?.violations || [],['bus_id','minute','state_index','kind','soc_kwh','limit_kwh','deviation_kwh','soc_percent','initial_state'])});
  files.push({name:'run/end_condition.json',data:json(results.end_condition || null)},
    {name:'tables/bus_end_conditions.csv',data:objectCsv(results.end_condition?.buses || [],['bus_id','initial_soc_kwh','final_soc_kwh','difference_kwh','target_soc_kwh','min_final_soc_kwh','compliant'])});
  const curve = results.charging_curve || inputs?.charging_curve || null;
  files.push({name:'run/charging_curve.json',data:json(curve)},
    {name:'tables/charging_curve.csv',data:objectCsv((curve?.bands || []).map((band,i) => ({enabled:curve.enabled,
      power_basis:curve.power_basis || 'historical_fixed_reference',start_soc_fraction:curve.bands[i-1]?.end_soc_fraction || 0,
      ...band,...(curve.power_basis !== 'site_charger_power' && Number.isFinite(curve.nominal_power_kw) ?
        {historical_nominal_power_kw:curve.nominal_power_kw,historical_power_kw:curve.nominal_power_kw*band.power_fraction} : {})})),['enabled','power_basis','start_soc_fraction','end_soc_fraction','power_fraction'])});
  files.push({name:'tables/charging_sessions.csv',data:csv((function* () {
    yield ['Route','Day_zero_based','Global_start_min','Global_end_min','Origin','Site_ID','Site_name','Average_kW','Grid_energy_kWh','Round_trip_km','Driving_minutes','Explanation'];
    if (!usableStep) return;
    for (const {day,profiles,offset,profileOffset} of profileSets('schedules','schedules_by_day')) {
      for (const [id,schedule] of entries(profiles)) for (const session of buildChargingSessions(results,id,{schedule,offsetMinutes:(profileOffset ?? offset)*step})) {
        yield [id,day,offset*step+session.startTimeMin,offset*step+session.endTimeMin,session.origin,session.siteId,session.siteName,
          session.avgKw,session.totalKwh,session.visit?.distance_km,session.visit ? session.travelMinutes : null,session.explanation];
      }
    }
  })())});
  files.push({name:'tables/optional_charging_visits.csv',data:objectCsv(list(results.opportunity_charging_visits),['bus_id','site_id','departure_min','charger_arrival_min','return_departure_min','return_arrival_min'])},
    {name:'tables/additional_trips.csv',data:objectCsv(entries(results.additional_trips).flatMap(([id,trips]) => list(trips).map(trip => ({bus_id:id,...trip}))),['bus_id','start_min','end_min'])},
    {name:'tables/recorded_trips.csv',data:objectCsv(buses.flatMap(bus => list(bus.trips).map(trip => ({bus_id:bus.id,...trip}))),['bus_id','start_min','end_min'])},
    {name:'tables/opportunity_options.csv',data:objectCsv(buses.flatMap(bus => list(bus.opportunity_visits).map(visit => ({bus_id:bus.id,...visit}))),['bus_id','id','site_id'])},
    {name:'tables/mappings_at_run.csv',data:objectCsv(context?.runtime_settings?.resolved_opportunity?.mappings || project?.charging?.opportunity?.mappings || [],['id','source_node_code','site_id'])});
  files.push({name:'tables/recorded_input_profiles.csv',data:csv((function* () {
    yield ['Route','Profile_period','Minutes_in_recorded_profile','Availability','Trip_energy_kWh','Site_ID','Site_availability','Site_presence','Site_arrival'];
    for (const bus of buses) {
      const ids = [...new Set([...Object.keys(bus.site_availability || {}),...Object.keys(bus.site_presence || {}),...Object.keys(bus.site_arrivals || {})])];
      const count = Math.max(bus.availability?.length || 0,bus.trip_energy_profile_kwh?.length || 0,...ids.map(id => Math.max(bus.site_availability?.[id]?.length || 0,bus.site_presence?.[id]?.length || 0,bus.site_arrivals?.[id]?.length || 0)));
      for (let t=0;t<count;t++) for (const id of ids.length ? ids : [null]) yield [bus.id,t,usableStep ? t*step : null,
        bus.availability?.[t],bus.trip_energy_profile_kwh?.[t],id,bus.site_availability?.[id]?.[t],bus.site_presence?.[id]?.[t],bus.site_arrivals?.[id]?.[t]];
    }
  })())});
  const includedIds = new Set(buses.map(bus => String(bus.id)));
  const excludedIds = (metadata.excluded_bus_ids || []).map(String);
  const excludedReasons=metadata.excluded_bus_reasons || project?.meta?.excluded_bus_reasons || {};
  const originalRoutes = project?.buses || buses;
  files.push({name:'tables/routes.csv',data:objectCsv(originalRoutes.map(bus => ({
    id:bus.id,included_in_run:includedIds.has(String(bus.id)),excluded_from_run:excludedIds.includes(String(bus.id)),
    exclusion_category:excludedIds.includes(String(bus.id)) ? excludedReasons[bus.id]?.category || 'manual_or_unspecified' : null,
    exclusion_evidence:excludedIds.includes(String(bus.id)) ? excludedReasons[bus.id] || null : null,
    vehicle_type:bus.vehicle_type,battery_kwh:bus.max_battery_capacity_kwh,efficiency:bus.efficiency,max_power_kw:bus.max_power_kw,
    initial_soc_kwh:bus.initial_soc_kwh,minimum_final_soc_kwh:bus.min_final_soc_kwh,next_day_required_energy_kwh:bus.next_day_required_energy_kwh,
    trip_energy_kwh:total(bus.trip_energy_profile_kwh),trips:bus.trips?.length || 0,
  })),['id','included_in_run','excluded_from_run'])});

  const energyProfile = results.grid_import_profile?.length ? results.grid_import_profile : results.scenario === 'baseline' ? results.aggregated_load_profile : null;
  const prices = results.electricity_prices;
  const completeEnergy = list(energyProfile).length > 0 && energyProfile.every(Number.isFinite);
  const completePrices = Array.isArray(prices) && prices.every(Number.isFinite);
  const energy = completeEnergy && usableStep ? total(energyProfile)*step/60/1000 : null;
  const cost = completeEnergy && completePrices && usableStep && prices.length === energyProfile.length
    ? energyProfile.reduce((sum,power,t) => sum+power*prices[t]*step/60/1000,0) : null;
  if (energy === null || cost === null) missing.push('Energy/cost reconciliation is incomplete: A complete recorded grid-power profile, matching price profile and time step are required.');
  const reconciliation = {grid_energy_mwh_from_profile:energy,saved_total_energy_mwh:results.total_energy_mwh,
    energy_difference_mwh:present(energy) && present(results.total_energy_mwh) ? energy-results.total_energy_mwh : null,
    cost_eur_from_profile:cost,saved_total_cost_eur:results.total_cost_eur,
    cost_difference_eur:present(cost) && present(results.total_cost_eur) ? cost-results.total_cost_eur : null,
    baseline_feasible:results.baseline_feasible ?? null,baseline_issues:results.baseline_issues || [],
    note:'Profile arithmetic only; not a new solver feasibility certificate. Savings require an explicitly validated arrival reference and recorded comparison data. False or unknown feasibility is not a valid savings reference.'};
  files.push({name:'reconciliation.json',data:json(reconciliation)});
  const manifest = {format:'edopt-result-analysis',schema_version:1,exported_at:now.toISOString(),run_id:metadata.run_id || null,
    run_timestamp:metadata.timestamp || null,scenario:results.scenario || null,is_long_term:Boolean(results.is_long_term),
    long_term_mode:results.long_term_mode || metadata.long_term_mode || null,run_status:results.run_status || null,requested_days:results.requested_days ?? null,timetable_scope:results.timetable_scope || null,
    solver_status:results.status ?? null,optimization_gap:results.optimization_gap ?? null,baseline_feasible:results.baseline_feasible ?? null,
    total_days:results.total_days ?? null,time_step_minutes:usableStep,included_bus_ids:[...includedIds],excluded_bus_ids:excludedIds,excluded_bus_reasons:excludedReasons,
    project_snapshot_available:Boolean(project),exact_single_request_available:Boolean(metadata.request_inputs),
    request_archive:requestArchive,storage_pruned:Boolean(results.storage_pruned),sources,missing_information:missing,
    units:{power:'kW',battery_energy:'kWh',electricity_prices:'EUR/MWh',distance:'m for timetable trips; km for mappings',time:'minutes; periods/days are zero-based'},
    files:[...files.map(file => file.name),'README.txt','manifest.json']};
  const report = ['eDOPT - Complete result analysis package',`Run: ${manifest.run_id || 'Not recorded'}; ${manifest.run_timestamp || 'Time not recorded'}`,
    `Scenario: ${manifest.scenario}; Long-term: ${manifest.is_long_term}; Included routes: ${includedIds.size}; Excluded: ${excludedIds.length}`,
    '', 'AUTHORITATIVE DATA',
    'results.json is the complete, unchanged stored result, including every available profile, diagnostic, solver message, input and unrecognized/extension field.',
    'run/project_at_run.json and run/runtime_settings.json contain the recorded original project and unsaved solver settings. null means not recorded.',
    'project_current.json is the project at export time only. It may belong to a different scenario or have changed since the run; it never replaces original run inputs.',
    'run/solver_request.json is the exact request for new single-horizon runs. run/requests/ contains exact archived requests for new long-term chunks; manifest.json maps each file to its chunk and global offset.',
    'run/recorded_inputs.json preserves the existing run metadata. For single runs, realized trip energy can already be added; do not add additional-trip energy twice. Long-term recorded inputs may contain daily base profiles, not every actual chunk state.',
    'run/input_check.json contains the earlier check and may cover a different horizon/state. Sources identify whether an Excel file belongs to the original run or only the current project.',
    '', 'CSV TABLES',
    'UTF-8 BOM, semicolon separated, quoted values; spreadsheet formulas in text are neutralized. JSON preserves exact raw text.',
    'fleet_timeseries.csv preserves numeric top-level series under their original field names. State profiles can have N+1 boundary samples; missing values stay blank, not zero.',
    'bus_charging.csv: period charging power. bus_soc.csv: boundary states, including each day/chunk end. Adjacent day end/start states share a global period and remain separately identified by day.',
    'bus_connections.csv and site_profiles.csv use global period indexes. recorded_input_profiles.csv describes only the recorded input profile and is not silently tiled across a long-term horizon. Energy/availability repeat on site rows and must not be summed across sites.',
    'charging_sessions.csv identifies executed detours versus scheduled-stop charging; older results without provenance retain unknown origin.',
    'recorded_trips.csv, additional_trips.csv, optional_charging_visits.csv and opportunity_options.csv distinguish recorded trips, executed transfers and candidate options. Their contents also remain fully available in results.json.',
    'routes.csv describes the original imported fleet when its project snapshot exists; otherwise only recorded included buses are known. Excluded IDs remain in the manifest.',
    'mappings_at_run.csv is empty when original mapping settings were not retained. Current mappings are still available in project_current.json.',
    'summary.csv contains saved headline values. reconciliation.json independently integrates saved grid power/prices; no current-project values enter these calculations.',
    '', 'LIMITATIONS',
    ...(results.long_term_mode==='daily_cyclic' ? ['Daily Cyclic skips 23/25-hour daylight-saving dates in Europe/Vienna. These dates have no synthetic prices or schedules and do not contribute to totals. See run/days/status.json and daily_summary.csv. A partial date range is not a complete-year total or an annual extrapolation.'] : []),
    'This export does not rerun the solver or infer missing information. Old/pruned results cannot regain profiles or request snapshots that were never saved.',
    'Successful runs do not normally retain an LP/IIS model. Failed-run diagnostic ZIPs remain available on the Optimization page.',
    ...(missing.length ? missing : ['No missing-information warnings.']),
  ].join('\n');
  onProgress({phase:'manifest',message:'Writing completeness manifest'});
  files.push({name:'README.txt',data:report},{name:'manifest.json',data:json(manifest)});
  return {files,manifest};
}
