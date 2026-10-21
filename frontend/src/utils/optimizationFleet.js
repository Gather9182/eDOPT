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
    excluded_bus_reasons:exclusionReasons(project),
  };
}

export function exclusionReasons(project) {
  return Object.fromEntries(optimizationFleet(project).excluded.map(bus=>{
    const id=String(bus.id);
    return [id,project.meta?.excluded_bus_reasons?.[id] || {category:'manual_or_unspecified',scope:'No diagnostic evidence was recorded for this exclusion.'}];
  }));
}

export const exclusionReasonLabel=category=>({energy_proven:'Energy shortfall proven under recorded assumptions',missing_availability:'Missing charging availability — not proven infeasible',
  model_infeasible:'Model infeasibility proven under recorded assumptions',fleet_conflict:'Fleet conflict — not individually infeasible',manual:'Manually excluded',manual_or_unspecified:'Manual / previous cause not recorded'}[category] || 'Unspecified exclusion');

export function validationExclusionReasons(validation,ids,now=new Date().toISOString()) {
  return Object.fromEntries(ids.map(id=>{
    const evidence=(validation?.issues || []).filter(issue=>String(issue.bus_id)===String(id));
    const energy=evidence.some(issue=>issue.details?.proof==='optimistic_energy_bound' && issue.type==='ERROR');
    return [String(id),{category:energy ? 'energy_proven' : evidence.some(issue=>issue.code==='NO_CHARGING_AVAILABILITY') ? 'missing_availability' : 'model_infeasible',
      recorded_at:now,scope:'Current model assumptions at exclusion time only. Restore and recheck after changing settings.',evidence}];
  }));
}

export function diagnosedExclusionReasons(diagnostic,ids,now=new Date().toISOString()) {
  const rows=diagnostic?.result?.diagnostics?.route_feasibility?.routes || [];
  return Object.fromEntries(ids.map(id=>{
    const row=rows.find(item=>String(item.bus_id)===String(id));
    return [String(id),{category:row?.status==='individually_infeasible' ? 'model_infeasible' : 'fleet_conflict',
      recorded_at:now,scope:'Recorded failed model only. Isolated MILP infeasibility does not identify a purely energetic cause.',evidence:row || null}];
  }));
}
