import { resolvedOpportunityConfig } from './opportunity.js';

export function importedVehicleTypes(record, options) {
  const types = (options.useVehicleTypeGroup ? record?.vehicle_type_groups : record?.vehicle_types) || [];
  return [...new Set(types.map(type => options.useFirstVehicleType ? type.split('/', 1)[0].trim() : type).filter(Boolean))];
}

export function timetableSettings({ projectData, options, selectedDepots, initialSoc, minFinalSoc }) {
  const specs = Object.fromEntries(Object.entries(projectData.meta.vehicle_types_config || {}).map(([type, config]) => [type,
    typeof config === 'object' && config !== null
      ? { consumption_wh_per_m: config.consumption, battery_capacity_kwh: config.battery }
      : { consumption_wh_per_m: Number(config), battery_capacity_kwh: projectData.constraints.max_battery_capacity_kwh },
  ]));
  return {
    SHEET_NAME: options.sheet, BETRIEBSTAGE: options.days,
    DISTANCE_UNIT: options.distanceUnit, MIXED_KM_THRESHOLD: options.mixedThreshold,
    UMLAUF_VEHICLE_TYPES: Object.fromEntries(Object.entries(options.vehicleOverrides || {}).filter(([, type]) => type)),
    USE_FIRST_VEHICLE_TYPE: Boolean(options.useFirstVehicleType),
    USE_VEHICLE_TYPE_GROUP: Boolean(options.useVehicleTypeGroup),
    CHARGING_SITES: projectData.charging?.enabled ? projectData.charging.sites || [] : [],
    OPPORTUNITY_CHARGING: resolvedOpportunityConfig(projectData),
    VEHICLE_TYPE_SPECS: specs,
    DEFAULT_CONSUMPTION_WH_PER_M: projectData.meta.default_consumption_wh_m,
    DEFAULT_BATTERY_CAPACITY_KWH: projectData.constraints.max_battery_capacity_kwh,
    INITIAL_SOC_FRACTION: initialSoc / 100, MIN_FINAL_SOC_FRACTION: minFinalSoc / 100,
    DEPOT_NODES: selectedDepots,
  };
}

export function timetableFingerprint(settings, roundWindows) {
  // Capacity and staffing changes do not require a different location matrix.
  return JSON.stringify({ ...settings, CHARGING_SITES: settings.CHARGING_SITES.map(site => ({ id: site.id, nodes: site.nodes })), roundWindows });
}

export function assertTimetableResult(data, settings) {
  if (!data?.bus_inputs?.length) throw new Error('No routes found. Please upload a valid Excel file.');
  const sites = settings.CHARGING_SITES;
  for (const bus of data.bus_inputs) {
    if (!bus.availability?.length || bus.trip_energy_profile_kwh?.length !== bus.availability.length) {
      throw new Error(`Route ${bus.id}: Incomplete time profiles. Please upload the Excel file again.`);
    }
    for (const site of sites) {
      if (bus.site_availability?.[site.id]?.length !== bus.availability.length ||
          !bus.site_nodes || JSON.stringify([...(bus.site_nodes[site.id] || [])].sort()) !== JSON.stringify([...site.nodes].sort())) {
        throw new Error('Bus data does not match the charging locations. Upload the original Excel file again; it will then be processed automatically.');
      }
    }
    if (sites.length && Object.keys(bus.site_availability || {}).some(id => !sites.some(site => site.id === id))) {
      throw new Error('Charging locations have changed. Please upload the original Excel file again.');
    }
  }
}

export async function processTimetableDraft(context, processExcel) {
  if (![context.initialSoc, context.minFinalSoc].every(value => Number.isFinite(Number(value)) && value >= 0 && value <= 100)) {
    throw new Error('Initial SoC and reserve must be between 0 and 100 percent.');
  }
  const settings = timetableSettings(context);
  if (context.projectData.charging?.enabled && !settings.CHARGING_SITES.length) throw new Error('Please add at least one charging location.');
  let data;
  if (context.file) {
    data = await processExcel(context.file, context.roundWindows, settings);
  } else {
    if (context.initialFingerprint !== timetableFingerprint(settings, context.roundWindows)) {
      throw new Error('These changes require the original Excel file. Upload it again, then click Continue to Settings.');
    }
    data = { bus_inputs: context.projectData.buses, charging_sites: settings.CHARGING_SITES };
  }
  assertTimetableResult(data, settings);
  return data;
}

export function projectWithTimetable(project, data, context) {
  assertTimetableResult(data, timetableSettings({ ...context, projectData: project }));
  return {
    ...project,
    buses: data.bus_inputs.map(bus => ({ ...bus, id: String(bus.id),
      max_power_kw: Number(project.constraints.max_power_per_bus), efficiency: Number(project.constraints.efficiency),
      initial_soc_kwh: bus.max_battery_capacity_kwh * context.initialSoc / 100,
      min_final_soc_kwh: bus.max_battery_capacity_kwh * context.minFinalSoc / 100,
    })),
    meta: { ...project.meta, data_source: 'uploaded', import_settings: context.options,
      excluded_bus_ids: [],
      timetable_nodes: context.allNodes, selected_depot_nodes: context.selectedDepots,
      timetable_scan: context.scan, round_charging_windows: context.roundWindows,
      opportunity_import_signature: JSON.stringify(resolvedOpportunityConfig(project)),
      timetable_warnings: data.validation_results?.warnings || [],
      timetable_source_key: context.sourceKey || null,
      timetable_source_name: context.file?.name || project.meta.timetable_source_name || '',
      last_upload: new Date().toISOString(),
      initial_soc_fraction: context.initialSoc / 100, min_final_soc_fraction: context.minFinalSoc / 100,
      charger_capacity_kw: project.constraints.charger_capacity_kw, grid_limit_kw: project.constraints.grid_limit_kw,
      num_chargers: project.constraints.num_chargers,
      planning_horizon: context.file ? 24 : project.meta.planning_horizon || 24,
      time_resolution: context.file ? 15 : project.meta.time_resolution || 15,
    },
  };
}

// Strings survive both IndexedDB and the existing JSON localStorage fallback.
export async function saveTimetableSource(file, setItem) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i+32768)));
  const key = `timetable_source_${crypto.randomUUID()}`;
  await setItem(key, { name: file.name, type: file.type, lastModified: file.lastModified, base64: btoa(chunks.join('')) });
  return key;
}

export async function loadTimetableSource(key, getItem) {
  if (!key) return null;
  const saved = await getItem(key);
  if (!saved?.base64) throw new Error('The locally saved Excel file is unavailable. Please upload the file again.');
  return new File([Uint8Array.from(atob(saved.base64), char => char.charCodeAt(0))], saved.name, { type: saved.type, lastModified: saved.lastModified });
}
