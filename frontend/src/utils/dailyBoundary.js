const minute = value => value.split(':').reduce((hours,part)=>hours*60+Number(part),0);
const locked = (site,t) => (site.no_switch_windows || []).some(window=>{
  const start=minute(window.start),end=minute(window.end);
  return start===end || (start<end ? t>=start && t<end : t>=start || t<end);
});

export function dailyBoundaryEligibility(request) {
  const pairs=[];
  for (const bus of request.buses) {
    if ((bus.opportunity_visits || []).some(visit=>visit.pause_start_min<request.time_step_minutes || visit.pause_end_min>1440-request.time_step_minutes)) {
      return {reason:`Route ${bus.id}: optional visits affect midnight intervals.`};
    }
    for (const site of request.charging_sites || []) {
      if (!locked(site,0) && (site.no_switch_windows || []).some(window=>minute(window.start)>0 && minute(window.start)<request.time_step_minutes)) {
        return {reason:`Location ${site.id}: a switching boundary intersects the first interval.`};
      }
      const presence=bus.site_presence?.[site.id] || bus.site_availability?.[site.id] || [];
      const arrival=bus.site_arrivals?.[site.id]?.[0] ?? Number(presence[0] && !presence.at(-1));
      if (!presence[0] || arrival || !locked(site,0)) continue;
      if (!presence.at(-1)) return {reason:`Route ${bus.id}: ambiguous midnight presence at ${site.id}.`};
      pairs.push([bus.id,site.id]);
    }
  }
  return {pairs};
}

export function seedConnectionBoundary(pairs,result) {
  const boundary={};
  for (const [bus,site] of pairs) {
    const profile=result.connection_schedules?.[bus];
    const value=Number(profile?.[0]===site);
    if (!profile || Number(result.final_connections?.[bus]===site)!==value) throw new Error(`Route ${bus}: seed does not prove a repeatable midnight connection at ${site}.`);
    (boundary[bus] ||= {})[site]=value;
  }
  return boundary;
}

export function dailyPhysicalKey(request) {
  const physical={...request};
  for (const key of ['electricity_prices','market_prices','daily_boundary_seed','daily_connection_boundary']) delete physical[key];
  return JSON.stringify(physical);
}

export const calendarDayIndex = (results,slot) => results.completed_day_indices?.[slot] ?? Number(slot);
export const completedSlotForCalendarDay = (results,day) => results.completed_day_indices ? results.completed_day_indices.indexOf(day) : day;
