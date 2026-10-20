import { loadTimetableSource } from './timetableImport.js';
import { groupValidationIssues, validationCategory, validationCounts } from './validationPresentation.js';

export const diagnosticClone = value => JSON.parse(JSON.stringify(value));

export function captureValidationContext(project, runtimeSettings, environment, checkedBusIds, now = new Date()) {
  return diagnosticClone({ project, runtime_settings: runtimeSettings, environment,
    checked_bus_ids: checkedBusIds.map(String), checked_at: now.toISOString() });
}

export function validationDiagnostic(context, result, request = null, origin = 'backend', transportError = null) {
  return diagnosticClone({ ...context, result, request, origin, transport_error: transportError });
}

export function optimizationDiagnostic(context, request, error, attempt = {}, validation = null, logs = []) {
  const response = error.response?.data ?? null;
  const backend = response?.diagnostics || null;
  const detail = response?.detail || error.message || 'Optimization failed.';
  const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const findings = backend?.energy_relaxation?.findings || [];
  const issues = [{type:'ERROR',code:backend?.solver_status === 'Infeasible' ? 'SOLVER_INFEASIBLE' : 'OPTIMIZATION_FAILED',
    category:'request',message}, ...(backend?.issues || []), ...findings.map(finding => ({
    type:'INFO',code:'DIAGNOSTIC_ENERGY_SHORTFALL',category:'energy',bus_id:finding.bus_id,
    message:`Diagnostic model requires ${finding.missing_battery_energy_kwh.toFixed(2)} kWh of artificial battery energy in period ${finding.period} (${finding.start_min}–${finding.end_min} min). This is not a real charging solution or a unique root cause.`,
    details:finding,
  })), ...(backend?.route_feasibility?.routes || []).map(row => ({
    type:row.status === 'individually_infeasible' ? 'ERROR' : row.status === 'affected_by_fleet_conflict' ? 'WARNING' : 'INFO',
    code:row.status === 'individually_infeasible' ? 'ROUTE_INDIVIDUALLY_INFEASIBLE' : row.status === 'affected_by_fleet_conflict' ? 'ROUTE_FLEET_CONFLICT' : 'ROUTE_INDIVIDUAL_CHECK',
    category:'energy',bus_id:row.bus_id,message:row.reason,details:row,
  }))];
  return diagnosticClone({...context,stage:'optimization',request,origin:response ? 'backend' : request ? 'transport' : 'frontend',
    checked_bus_ids:(request?.buses || []).map(bus => String(bus.id)),
    result:{status:'failed',issues,diagnostics:backend}, optimization_attempt:attempt,
    failure:{message,http_status:error.response?.status ?? null,response}, previous_validation:validation, logs});
}

const json = value => JSON.stringify(value, null, 2);
const sum = values => (values || []).reduce((total, value) => total + (Number(value) || 0), 0);
const csv = rows => '\uFEFF' + rows.map(row => row.map(value => {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}).join(';')).join('\r\n');

export async function diagnosticFiles(diagnostic, logs, getItem, exportedAt = new Date()) {
  const { project, request, result, checked_bus_ids: checkedIds } = diagnostic;
  const checked = new Set(checkedIds);
  const issues = result.issues || [];
  const imported = project.buses || [];
  const effective = result.diagnostics?.effective_inputs;
  const validatedBuses = new Map((effective?.buses || request?.buses || []).map(bus => [String(bus.id), bus]));
  const missing = [];
  const files = [];
  const optimization = diagnostic.stage === 'optimization';
  const responseFile = optimization ? 'optimization_failure.json' : 'validation.json';
  let source = { status: 'unavailable', name: project.meta?.timetable_source_name || null };
  try {
    const file = await loadTimetableSource(project.meta?.timetable_source_key, getItem);
    if (file) {
      files.push({ name: 'source/original_timetable.xlsx', data: new Uint8Array(await file.arrayBuffer()) });
      source = { status: 'included', name: file.name, type: file.type, bytes: file.size, last_modified: file.lastModified,
        archive_path: 'source/original_timetable.xlsx' };
    } else missing.push('The original Excel file is not stored locally. Complete imported trips and profiles are included in project.json.');
  } catch (error) {
    missing.push(`Original Excel file unavailable: ${error.message}`);
  }
  if (!request) missing.push(optimization ? 'This failure occurred outside an optimization request. No failed solver request was captured.' : 'No backend request was sent: Validation stopped in the frontend.');
  if (!effective) missing.push('Normalized backend inputs are unavailable. request.json contains the actual request data if a request could be sent.');
  if (optimization && !result.diagnostics?.model_lp) missing.push('The failed solver model is unavailable (the backend may need restarting, or the failure occurred before model construction).');
  const manifest = {
    format: optimization ? 'edopt-optimization-diagnostic' : 'edopt-validation-diagnostic', schema_version: 1, exported_at: exportedAt.toISOString(),
    stage:optimization ? 'optimization' : 'validation', endpoint:optimization ? '/api/optimize' : '/api/data/validate',
    checked_at: diagnostic.checked_at, validation_origin: diagnostic.origin, status: result.status,
    imported_bus_count: imported.length, checked_bus_ids: checkedIds,
    excluded_from_check: imported.filter(bus => !checked.has(String(bus.id))).map(bus => String(bus.id)),
    saved_excluded_bus_ids: project.meta?.excluded_bus_ids || [],
    issue_count: issues.length, issue_counts:validationCounts(issues),
    categories:groupValidationIssues(issues).map(group => ({id:group.id,title:group.title,...group.counts})),
    language:'en', source, missing_information: missing,
    scope: optimization ? 'Exact failed optimization attempt, including the failing scenario/chunk and solver evidence if provided. Energy relaxation is diagnostic only, not a valid schedule or IIS.' : 'Pre-solver plausibility and energy checks; not a solver IIS.',
    units: { power:'kW', energy:'kWh', distance:'km (mapping) / m (timetable)',
      consumption:'Wh/m (numerically equal to kWh/km)', time_step:'minutes', electricity_prices:'EUR/MWh' },
  };
  const routeRows = [['Route', 'Checked', 'Vehicle_type', 'Battery_kWh', 'Start_SoC_kWh', 'Minimum_final_SoC_kWh',
    'Next_day_required_energy_kWh', 'Max_power_kW', 'Efficiency', 'Consumption_Wh_m', 'Trip_energy_kWh', 'Available_periods',
    'Profile_length', 'Trips', 'Additional_charging_options', 'Issue_codes']];
  for (const original of imported) {
    const bus = validatedBuses.get(String(original.id)) || original;
    routeRows.push([bus.id, checked.has(String(bus.id)) ? 'yes' : 'no', bus.vehicle_type,
      bus.max_battery_capacity_kwh, bus.initial_soc_kwh, bus.min_final_soc_kwh, bus.next_day_required_energy_kwh,
      bus.max_power_kw, bus.efficiency, original.consumption_wh_m ?? original.consumption_wh_per_m ?? project.meta?.vehicle_types_config?.[bus.vehicle_type]?.consumption ?? diagnostic.runtime_settings.localSettings?.consumption_wh_m,
      sum(bus.trip_energy_profile_kwh),
      (bus.availability || []).filter(Boolean).length, bus.availability?.length,
      bus.trips?.length || 0, bus.opportunity_visits?.length || 0,
      issues.filter(issue => String(issue.bus_id) === String(bus.id)).map(issue => issue.code || issue.type).join(', ')]);
  }
  const issueRows = [['Number', 'Severity', 'Category', 'Code', 'Route', 'Message', 'Full_issue_JSON'],
    ...issues.map((issue, i) => [i+1, issue.type, validationCategory(issue), issue.code, issue.bus_id, issue.message, JSON.stringify(issue)])];
  const sites = request?.charging_sites || project.charging?.sites || [];
  const mappings = diagnostic.runtime_settings.resolved_opportunity?.mappings || project.charging?.opportunity?.mappings || [];
  const siteRows = [['ID','Name','Nodes_JSON','Connectors','kW_per_connector','Charging_capacity_kW','Grid_capacity_kW','Switching_restrictions_JSON','Connect_on_arrival','PV_BESS_location','Locked_charging_mode'],
    ...sites.map(site => [site.id,site.name,JSON.stringify(site.nodes),site.num_chargers,site.charger_power_kw,
      site.charger_capacity_kw,site.grid_limit_kw,JSON.stringify(site.no_switch_windows),site.allow_connect_on_arrival,
      (request?.energy_site_id || project.charging?.energy_site_id) === site.id,site.lock_charging_mode || 'Not recorded'])];
  const mappingRows = [['ID','Enabled','Stop_code','Stop_name','Nodes_JSON','Destination','Destination_ID','Outbound_min','Return_min','Outbound_km','Return_km','Full_mapping_JSON'],
    ...mappings.map(row => [row.id,row.enabled,row.source_node_code,row.stop_name,JSON.stringify(row.nodes),row.target_name,row.site_id,
      row.outbound_minutes,row.return_minutes,row.outbound_km,row.return_km,JSON.stringify(row)])];
  const tripRows = [['Route','Checked','Trip_number','Start_min','End_min','From','To','Distance_m','Energy_kWh','Full_trip_JSON']];
  for (const bus of imported) for (const [i, trip] of (bus.trips || []).entries()) {
    tripRows.push([bus.id,checked.has(String(bus.id)),i+1,trip.start_min,trip.end_min,trip.von,trip.nach,trip.dist_m,trip.energy_kwh,JSON.stringify(trip)]);
  }
  const profileRows = [['Route','Period','Minutes_from_horizon_start','Availability','Trip_energy_kWh']];
  const siteProfileRows = [['Route','Charging_site_ID','Period','Minutes_from_horizon_start','Availability','Presence','Arrival']];
  const step = request?.time_step_minutes ?? project.meta?.time_resolution;
  for (const id of checkedIds) {
    const bus = validatedBuses.get(id) || imported.find(bus => String(bus.id) === id);
    if (!bus) continue;
    const n = Math.max(bus.availability?.length || 0, bus.trip_energy_profile_kwh?.length || 0);
    for (let t=0; t<n; t++) profileRows.push([id,t,t*step,bus.availability?.[t],bus.trip_energy_profile_kwh?.[t]]);
    const siteIds = new Set([...Object.keys(bus.site_availability || {}),...Object.keys(bus.site_presence || {}),...Object.keys(bus.site_arrivals || {})]);
    for (const site of siteIds) {
      const count = Math.max(bus.site_availability?.[site]?.length || 0,bus.site_presence?.[site]?.length || 0,bus.site_arrivals?.[site]?.length || 0);
      for (let t=0; t<count; t++) siteProfileRows.push([id,site,t,t*step,bus.site_availability?.[site]?.[t],bus.site_presence?.[site]?.[t],bus.site_arrivals?.[site]?.[t]]);
    }
  }
  const priceRows = [['Period','Project_price_EUR_MWh','Request_price_EUR_MWh','Backend_Preis_EUR_MWh']];
  for (let t=0; t<Math.max(project.pricing?.length || 0,request?.electricity_prices?.length || 0); t++) {
    priceRows.push([t,project.pricing?.[t],request?.electricity_prices?.[t],effective?.electricity_prices?.[t]]);
  }
  const report = [
    'eDOPT – Diagnostic report', `System status: ${String(result.status).toUpperCase()}`,
    `Checked at: ${diagnostic.checked_at}`, `Exported at: ${manifest.exported_at}`,
    `Scenario: ${diagnostic.runtime_settings.scenario}; Mode: ${diagnostic.runtime_settings.simulationMode}`,
    `Routes: ${imported.length} imported, ${checkedIds.length} checked, ${manifest.excluded_from_check.length} excluded`,
    `Messages: ${issues.length}`, '', 'CATEGORIES',
    ...manifest.categories.map(group => `${group.title}: ${group.errors} errors, ${group.warnings} warnings, ${group.routes} affected routes`),
    '', 'ALL MESSAGES',
    ...issues.map((issue, i) => `${i+1}. [${issue.type || 'INFO'}] ${issue.code || ''}${issue.bus_id ? ` / ${issue.bus_id}` : ''}\n${issue.message}\nDetails: ${JSON.stringify(issue)}`),
    '', optimization ? 'CONFIGURATION AT OPTIMIZATION' : 'CONFIGURATION AT VALIDATION',
    `Global settings: ${json(diagnostic.runtime_settings.localSettings)}`,
    `Initial SoC fraction: ${project.meta?.initial_soc_fraction}; Reserve fraction: ${project.meta?.min_final_soc_fraction}`,
    `Charging locations: ${sites.length}; Additional charging connections: ${mappings.length}`,
    ...sites.map(site => `${site.name || site.id} (${site.id}): ${site.num_chargers} connectors at ${site.charger_power_kw} kW; Charging capacity ${site.charger_capacity_kw} kW; Grid ${site.grid_limit_kw} kW; Nodes ${JSON.stringify(site.nodes)}; Switching restrictions ${JSON.stringify(site.no_switch_windows)}; Locked charging mode: ${site.lock_charging_mode || 'Not recorded'}`),
    `Vehicle type settings: ${json(project.meta?.vehicle_types_config || {})}`,
    '', 'FILES AND ANALYSIS',
    'manifest.json: Timestamps, scope, units, exclusions and missing information.',
    'project.json: Complete project snapshot at validation, including all imported/excluded routes, trips, profiles, import options, vehicle specifications, charging locations, nodes, mappings, switching restrictions and prices.',
    'runtime_settings.json: Actual local settings at validation, including changes not yet saved with Save Config; scenario, SoC, PV/BESS, geography and long-term configuration.',
    `request.json: Exact inputs sent to ${manifest.endpoint}. null means no optimization/validation request was sent.`,
    `${responseFile}: Complete response with all errors and normalized backend inputs/defaults if available.`,
    'environment.json: Browser, time zone, frontend mode and API address; backend versions are included in validation.json.',
    'issues.csv / routes.csv: All messages and imported routes; UTF-8 with semicolon separators.',
    'charging_sites.csv / mappings.csv: Charging locations, limits, switching restrictions and all additional charging connections.',
    'trips.csv: All imported trips, including excluded routes, with complete source details.',
    'profiles.csv / site_profiles.csv: Every checked time step with availability, trip energy, presence and arrivals per charging location.',
    'prices.csv: Saved prices and the prices sent/normalized during validation. Price markups are also stored in project.meta.price_assumptions.',
    optimization ? 'logs.json: Frozen interface messages at failure. solver/cbc.log: Raw CBC output, if available.' : 'logs.json: Unabridged messages from the current interface up to export.',
    'source/original_timetable.xlsx: Unchanged original file if locally stored.',
    '', 'INTERPRETATION',
    optimization ? 'request.json describes exactly the failed scenario/chunk, including current battery states, connection states, prices and PV/BESS profiles. attempt.json identifies the chunk. run_check.json is the earlier check and may cover different states or a different horizon.' : 'request.json and validation.json describe the checked horizon. For long-term simulations this is the checked calculation chunk, not a completed full-year schedule.',
    'JSON files contain every time series in full. routes.csv is an overview; excluded routes use their saved import data.',
    manifest.scope,
    ...(optimization ? ['', 'SOLVER ANALYSIS',
      `Solver status: ${result.diagnostics?.solver_status || 'Unavailable'}`,
      'solver/model.lp: Full failed model; soc_balance_b{bus index}_t{period} names identify energy constraints.',
      'solver/variable_index.json: Bus/site indexes used in model variables (connected_{bus index}_{site index}_{period}, site_power, site_grid).',
      `Energy relaxation: ${json(result.diagnostics?.energy_relaxation || null)}`,
      `Individual checks: ${json(result.diagnostics?.route_feasibility || null)}`,
      'Periods are zero-based. Multiply by time_step_minutes and add horizon_start_minute. Attempt chunk offsets are stored separately.',
      'The deficit allocation may not be unique. An optimal diagnostic proves the minimum artificial energy for that model; a time-limited incumbent does not prove a minimum.',
      'Never treat a diagnostic relaxation as an executable charging schedule.'] : []),
    '', 'MISSING INFORMATION', ...(missing.length ? missing : ['None.']),
  ].join('\n');
  files.push(
    { name:'README.txt', data:report }, { name:'manifest.json', data:json(manifest) },
    { name:'project.json', data:json(project) }, { name:'runtime_settings.json', data:json(diagnostic.runtime_settings) },
    { name:'request.json', data:json(request) }, { name:responseFile, data:json({ ...result, origin:diagnostic.origin, transport_error:diagnostic.transport_error, failure:diagnostic.failure }) },
    { name:'environment.json', data:json(diagnostic.environment) }, { name:'logs.json', data:json(optimization ? diagnostic.logs : logs) },
    { name:'issues.csv', data:csv(issueRows) }, { name:'routes.csv', data:csv(routeRows) },
    { name:'charging_sites.csv', data:csv(siteRows) }, { name:'mappings.csv', data:csv(mappingRows) },
    { name:'trips.csv', data:csv(tripRows) }, { name:'profiles.csv', data:csv(profileRows) },
    { name:'site_profiles.csv', data:csv(siteProfileRows) }, { name:'prices.csv', data:csv(priceRows) },
  );
  if (optimization) {
    files.push({name:'attempt.json',data:json(diagnostic.optimization_attempt)},
      {name:'run_check.json',data:json(diagnostic.previous_validation)},
      {name:'backend_inputs.json',data:json(effective || null)},
      {name:'solver/energy_relaxation.json',data:json(result.diagnostics?.energy_relaxation || null)},
      {name:'solver/variable_index.json',data:json(result.diagnostics?.variable_index || null)},
      {name:'solver/route_feasibility.json',data:json(result.diagnostics?.route_feasibility || null)},
      {name:'route_classification.csv',data:csv([['Route','Classification','Solver_status','Diagnostic_candidate','Reason'],
        ...(result.diagnostics?.route_feasibility?.routes || []).map(row => [row.bus_id,row.status,row.solver_status,row.diagnostic_candidate,row.reason])])});
    if (result.diagnostics?.model_lp) files.push({name:'solver/model.lp',data:result.diagnostics.model_lp});
    if (result.diagnostics?.cbc_log) files.push({name:'solver/cbc.log',data:result.diagnostics.cbc_log});
  }
  return files;
}

// ZIP "store" records: no dependency or backend round trip is needed for export.
// CRCs make corruption detectable by standard ZIP readers.
export function diagnosticZip(files, now = new Date()) {
  const encoder = new TextEncoder();
  const parts = [], directory = [];
  let offset = 0;
  const time = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  const date = ((Math.max(1980, now.getFullYear())-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    if (data.length + offset > 0xffffffff) throw new Error('The diagnostic package exceeds the ZIP size limit of 4 GB.');
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit=0; bit<8; bit++) crc = (crc>>>1) ^ ((crc&1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30), l = new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true);
    l.setUint16(10,time,true); l.setUint16(12,date,true); l.setUint32(14,crc,true);
    l.setUint32(18,data.length,true); l.setUint32(22,data.length,true); l.setUint16(26,name.length,true);
    parts.push(local,name,data);
    const central = new Uint8Array(46), c = new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true);
    c.setUint16(12,time,true); c.setUint16(14,date,true); c.setUint32(16,crc,true);
    c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true);
    directory.push(central,name);
    offset += local.length + name.length + data.length;
  }
  const directorySize = directory.reduce((total, part) => total+part.length,0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
  e.setUint32(12,directorySize,true); e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
