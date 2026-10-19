const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function opportunityConfig(project) {
  return { enabled:false, min_charge_minutes:30, buffer_minutes:0, min_net_energy_kwh:0,
    min_charging_power_kw:1, allowed_windows:[], mappings:[], ...project.charging?.opportunity };
}

export function mergeScannedMappings(existing, scanned) {
  const key = row => `${normalize(row.stop_name)}|${normalize(row.target_name)}`;
  return scanned.map(row => {
    const previous = existing.find(old => key(old) === key(row));
    return { ...row, ...previous, id:row.id,
      outbound_km:previous?.outbound_km ?? row.outbound_km, return_km:previous?.return_km ?? row.return_km,
      nodes:previous?.nodes_overridden ? previous.nodes : row.nodes.length ? row.nodes : previous?.nodes || [] };
  }).concat(existing.filter(row => row.manual));
}

export function resolvedOpportunityConfig(project) {
  const config = opportunityConfig(project);
  const sites = project.charging?.sites || [];
  return { ...config, enabled:Boolean(project.charging?.enabled && config.enabled), mappings:config.mappings.map(row => {
    const directNodes = config.mappings.filter(other => normalize(other.target_name) === normalize(row.target_name) &&
      other.outbound_minutes === 0 && other.return_minutes === 0).flatMap(other => other.nodes);
    const matches = sites.filter(site => site.nodes.some(node => directNodes.includes(node)) || normalize(site.name) === normalize(row.target_name));
    return { ...row, site_id:row.site_id || (matches.length === 1 ? matches[0].id : '') };
  }) };
}

// Save the actual transfer consumption/trips alongside the exact solver inputs,
// so result audits and exports can reconcile SoC and charged energy.
export function inputsWithRealizedVisits(inputs, result) {
  if (!Object.keys(result.additional_trip_energy_profiles || {}).length) return inputs;
  return { ...inputs, scheduled_buses:inputs.buses, buses:inputs.buses.map(bus => {
    const extra = result.additional_trip_energy_profiles?.[bus.id];
    const trips = result.additional_trips?.[bus.id] || [];
    if (!extra) return bus;
    const clock = minute => `${String(Math.floor(minute/60)%24).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
    return { ...bus, trip_energy_profile_kwh:bus.trip_energy_profile_kwh.map((energy,t) => energy+(extra[t] || 0)),
      energy_demand_kwh:(bus.energy_demand_kwh || 0)+extra.reduce((a,b) => a+b,0),
      trips:[...(bus.trips || []), ...trips.map(trip => ({...trip,start:clock(trip.start_min),end:clock(trip.end_min)}))].sort((a,b) => a.start_min-b.start_min) };
  }) };
}
