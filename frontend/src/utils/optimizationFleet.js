import { opportunityConfig } from './opportunity.js';

// Keep the imported timetable intact; exclusions affect only solver inputs.
export function optimizationFleet(project) {
  const buses = project.buses || [];
  const excluded = new Set((project.meta?.excluded_bus_ids || []).map(String));
  return {
    included: buses.filter(bus => !excluded.has(String(bus.id))).map(bus =>
      (!project.charging?.enabled || !opportunityConfig(project).enabled) && bus.opportunity_visits?.length
        ? { ...bus, opportunity_visits: [] } : bus),
    excluded: buses.filter(bus => excluded.has(String(bus.id))),
  };
}

export function excludableBusIds(validation, buses) {
  const known = new Set(buses.map(bus => String(bus.id)));
  return [...new Set((validation?.issues || [])
    .filter(issue => ['NO_CHARGING_AVAILABILITY', 'BUS_ENERGY_INFEASIBLE', 'BUS_FINAL_TARGET_EXCEEDS_CAPACITY'].includes(issue.code) && known.has(String(issue.bus_id)))
    .map(issue => String(issue.bus_id)))];
}

export function diagnosedRouteIds(diagnostic, buses, individuallyOnly = false) {
  const known = new Set(buses.map(bus => String(bus.id)));
  return [...new Set((diagnostic?.result?.diagnostics?.route_feasibility?.routes || [])
    .filter(row => known.has(String(row.bus_id)) && (row.status === 'individually_infeasible' ||
      (!individuallyOnly && row.status === 'affected_by_fleet_conflict')))
    .map(row => String(row.bus_id)))];
}

export function fleetRunMetadata(project) {
  return {
    imported_bus_count: (project.buses || []).length,
    excluded_bus_ids: optimizationFleet(project).excluded.map(bus => String(bus.id)),
  };
}
