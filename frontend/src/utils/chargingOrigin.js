const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// Classify executed charging, never merely an imported candidate connection.
// Day drill-downs use local schedules but globally indexed visit/connection data.
export function chargingOriginAt(results, busId, minute) {
  const inputs = results.run_metadata?.inputs || {};
  const step = inputs.time_step_minutes || 15;
  const index = Math.floor(minute / step);
  const recordedSite = results.connection_schedules?.[busId]?.[index];
  const period = (results.aggregated_load_profile?.length || results.schedules?.[busId]?.length || 0) * step;
  const cyclic = !results.is_long_term && inputs.cyclic_connections !== false && period > 0;
  const visits = results.opportunity_charging_visits;
  const visitIndex = (visits || []).findIndex(visit => {
    if (String(visit.bus_id) !== String(busId) || (recordedSite && recordedSite !== visit.site_id)) return false;
    const arrival = visit.charger_arrival_min;
    const query = cyclic ? minute + Math.ceil((arrival - minute) / period) * period : minute;
    return query >= arrival && query < visit.return_departure_min;
  });
  const visit = visitIndex < 0 ? null : visits[visitIndex];
  const bus = inputs.buses?.find(bus => String(bus.id) === String(busId));
  const directSites = Object.entries(bus?.site_availability || {}).filter(([, profile]) =>
    profile.length && profile[index % profile.length] > 0).map(([site]) => site);
  const siteId = visit?.site_id || recordedSite || (directSites.length === 1 ? directSites[0] : null);
  const siteName = inputs.charging_sites?.find(site => site.id === siteId)?.name || siteId;
  const travelMinutes = visit ? (visit.charger_arrival_min - visit.departure_min) +
    (visit.return_arrival_min - visit.return_departure_min) : 0;
  const detour = visit && (travelMinutes > 0 || visit.distance_km > 0);
  // Old saved results may predate provenance records. Do not claim they were
  // depot sessions just because the old UI called every charger a depot.
  const scheduled = visit || Array.isArray(visits) || (siteId && directSites.includes(siteId)) ||
    (!siteId && !bus?.opportunity_visits?.length && bus?.availability?.[index % bus.availability.length] > 0);
  const origin = detour ? 'detour' : scheduled ? 'scheduled' : 'unknown';
  return {
    origin, siteId, siteName, visit, travelMinutes,
    key: `${origin}|${siteId || ''}|${visitIndex}`,
    badge: origin === 'detour' ? 'Optional charging detour' : origin === 'scheduled' ? 'No detour · Scheduled stop' : 'Origin not recorded',
    label: origin === 'detour' ? 'Charging via an additional trip' : origin === 'scheduled' ? 'Depot / scheduled-stop charging' : 'Charging session',
    explanation: origin === 'detour'
      ? `From ${visit.from_node} · Return to ${visit.to_node} · ${Number(visit.distance_km || 0).toFixed(1)} km round trip · ${travelMinutes} min driving`
      : origin === 'scheduled' ? 'Already at this location on the scheduled route; no additional charging trip.'
      : 'This saved result has no charging origin record. Run the optimization again to identify it.',
  };
}

export function buildChargingSessions(results, busId, { schedule = results.schedules?.[busId] || [], offsetMinutes = 0 } = {}) {
  const step = results.run_metadata?.inputs?.time_step_minutes || 15;
  const sessions = [];
  let current = null;
  const finish = end => {
    if (!current) return;
    const { count, totalKw, ...session } = current;
    sessions.push({ ...session, end: clock(end * step), endTimeMin: end * step,
      avgKw: totalKw / count, totalKwh: totalKw * step / 60 });
    current = null;
  };
  schedule.forEach((kw, t) => {
    if (!(kw > 0.001)) { finish(t); return; }
    const origin = chargingOriginAt(results, busId, offsetMinutes + t * step);
    if (current && current.key !== origin.key) finish(t);
    if (!current) current = { ...origin, type: 'C', start: clock(t * step), startTimeMin: t * step, count: 0, totalKw: 0 };
    current.count += 1;
    current.totalKw += kw;
  });
  finish(schedule.length);
  return sessions;
}
