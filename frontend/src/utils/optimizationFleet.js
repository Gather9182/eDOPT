// Keep the imported timetable intact; exclusions affect only solver inputs.
export function optimizationFleet(project) {
  const buses = project.buses || [];
  const excluded = new Set((project.meta?.excluded_bus_ids || []).map(String));
  return {
    included: buses.filter(bus => !excluded.has(String(bus.id))),
    excluded: buses.filter(bus => excluded.has(String(bus.id))),
  };
}

export function excludableBusIds(validation, buses) {
  const known = new Set(buses.map(bus => String(bus.id)));
  return [...new Set((validation?.issues || [])
    .filter(issue => ['NO_CHARGING_AVAILABILITY', 'BUS_ENERGY_INFEASIBLE', 'BUS_FINAL_TARGET_EXCEEDS_CAPACITY'].includes(issue.code) && known.has(String(issue.bus_id)))
    .map(issue => String(issue.bus_id)))];
}

export function fleetRunMetadata(project) {
  return {
    imported_bus_count: (project.buses || []).length,
    excluded_bus_ids: optimizationFleet(project).excluded.map(bus => String(bus.id)),
  };
}
