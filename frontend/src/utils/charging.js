// Charging may use only intervals that are fully inside the original stay.
export function locationProfilesForHorizon(bus, targetLength, targetStep, sourceStep = 15) {
  if (!Object.keys(bus.site_availability || {}).length) return {};
  const sourceLength = bus.availability.length;
  const transform = (mapping, all) => Object.fromEntries(Object.entries(mapping || {}).map(([id, values]) => [id,
    Array.from({ length: targetLength }, (_, i) => {
      const from = Math.floor(i * targetStep / sourceStep);
      const to = Math.ceil((i+1) * targetStep / sourceStep);
      const slots = Array.from({ length: to-from }, (_, j) => values[(from+j) % sourceLength]);
      return Number(all ? slots.every(Boolean) : slots.some(Boolean));
    })]));
  const availability = transform(bus.site_availability, true);
  // Arrival events must occur once, even when the target grid is finer.
  const arrivals = Object.fromEntries(Object.entries(bus.site_arrivals || {}).map(([id, values]) => [id,
    Array.from({ length: targetLength }, (_, i) => {
      const from = Math.ceil(i * targetStep / sourceStep);
      const to = Math.ceil((i+1) * targetStep / sourceStep);
      return Number(Array.from({ length: to-from }, (_, j) => values[(from+j) % sourceLength]).some(Boolean));
    })]));
  const energy = Array(targetLength).fill(0);
  const sourceDuration = sourceLength * sourceStep;
  if (bus.trips?.every(trip => Number.isFinite(trip.start_min))) {
    for (const trip of bus.trips) {
      for (let minute = ((trip.start_min % sourceDuration)+sourceDuration)%sourceDuration; minute < targetLength * targetStep; minute += sourceDuration) {
        energy[Math.floor(minute / targetStep)] += trip.energy_kwh || 0;
      }
    }
  } else {
    for (let minute = 0; minute < targetLength * targetStep; minute += sourceStep) energy[Math.floor(minute / targetStep)] += bus.trip_energy_profile_kwh[Math.floor(minute / sourceStep) % sourceLength] || 0;
  }
  return { site_availability: availability, site_presence: transform(bus.site_presence || bus.site_availability, false), site_arrivals: arrivals,
    availability: Array.from({ length: targetLength }, (_, t) => Number(Object.values(availability).some(p => p[t]))), trip_energy_profile_kwh: energy };
}

export function chargingInputs(projectData) {
  return projectData.charging?.enabled ? { use_charging_sites: true, charging_sites: projectData.charging.sites || [], energy_site_id: projectData.charging.energy_site_id || null } : {};
}

// Transfer only selected A/E nodes. Preserve capacities, locks and existing
// assignments, including locations whose IDs were created manually.
export function addSelectedDepotSites(sites, selectedNodes, suggestions, createSite) {
  const selected = new Set(selectedNodes);
  const result = sites.map(site => ({ ...site, nodes: [...site.nodes] }));
  for (const suggestion of suggestions) {
    const additions = suggestion.nodes.filter(node => selected.has(node) && !result.some(site => site.nodes.includes(node)));
    if (!additions.length) continue;
    const existing = result.find(site => site.id === suggestion.id) || result.find(site => site.nodes.some(node => suggestion.nodes.includes(node)));
    if (existing) existing.nodes.push(...additions);
    else result.push(createSite({ ...suggestion, nodes: additions }));
  }
  return result;
}
