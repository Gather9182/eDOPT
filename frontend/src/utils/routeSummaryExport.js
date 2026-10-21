// Saved-run route accounting. No current-project values or annual extrapolation.
export const routeSummaryHeaders=['Umlauf-ID','Bustyp / Fahrzeuggruppe','Gesamt-km/Jahr Diesel',
  'Gesamt-km/Jahr Elektro inkl. Ladefahrten','Elektrische Fahrbarkeit','Netzstrombezug/Jahr [kWh]',
  'Genutzte Ladestandorte','Energieherkunft / Erläuterung'];
const finite=value=>typeof value==='number' && Number.isFinite(value);
const sum=values=>values.reduce((a,b)=>a+b,0);
const list=value=>Array.isArray(value) ? value : [];
const textNumber=value=>finite(value) ? value.toFixed(3).replace('.',',') : 'Nicht bestimmbar';
const validated=result=>!/(heuristic|infeasible|failed|error)/i.test(result.status || '');
const scheduled=request=>request?.scheduled_buses || request?.buses || [];

function slices(results,step) {
  if(results.long_term_mode==='daily_cyclic' && results.daily_results?.length) return results.daily_results.map(day=>({
    result:day.result,request:day.request,profiles:day.result.schedules || {},offset:0,date:day.date}));
  const request=results.run_metadata?.request_inputs || results.run_metadata?.inputs || {};
  if(results.schedules_by_day?.length) return results.schedules_by_day.map((profiles,day)=>({result:results,request,profiles,offset:day*1440/step}));
  return [{result:results,request,profiles:results.schedules || {},offset:0}];
}

function dailyKm(bus) {
  const trips=bus?.trips;
  if(!Array.isArray(trips) || !trips.length || trips.some(trip=>!finite(trip.dist_m) || trip.dist_m<0)) return null;
  return sum(trips.map(trip=>trip.dist_m))/1000;
}

export function buildRouteSummary(results,onProgress=()=>{}) {
  if(!results?.is_long_term) throw new Error('Route summary is available for long-term analyses.');
  const meta=results.run_metadata || {},project=meta.audit_context?.project;
  const inputs=meta.request_inputs || meta.inputs || {};
  const step=inputs.time_step_minutes ?? meta.settings?.time_resolution ?? results.daily_results?.[0]?.request?.time_step_minutes;
  if(!finite(step) || step<=0 || 1440%step) throw new Error('Saved simulation time step is missing or invalid.');
  const parts=slices(results,step),periodsPerDay=1440/step;
  const sourceBuses=project?.buses || inputs.scheduled_buses || results.daily_results?.[0]?.request?.buses || inputs.buses || [];
  const buses=new Map();
  for(const bus of [...sourceBuses,...scheduled(inputs),...parts.flatMap(part=>scheduled(part.request))]) if(!buses.has(String(bus.id))) buses.set(String(bus.id),bus);
  const excluded=new Set((meta.excluded_bus_ids ?? project?.meta?.excluded_bus_ids ?? []).map(String));
  for(const id of excluded) if(!buses.has(id)) buses.set(id,{id});
  const reasons=meta.excluded_bus_reasons || project?.meta?.excluded_bus_reasons || {};
  const sites=new Map([...(project?.charging?.sites || []),...(inputs.charging_sites || []),...parts.flatMap(part=>part.request.charging_sites || [])].map(site=>[String(site.id),site]));
  const stats=new Map();
  const get=id=>{
    id=String(id);
    if(!stats.has(id)) stats.set(id,{id,energy:0,grid:0,pv:0,battery:0,storageGrid:0,unknown:false,valid:true,days:0,detour:0,detourKnown:true,sites:new Set()});
    return stats.get(id);
  };
  for(const id of buses.keys()) get(id);
  let days=0,storageGrid=0,storageGridKnown=true,siteUnknown=0;
  const warnings=new Set();
  for(const [partIndex,part] of parts.entries()) {
    const {result,request,profiles,offset}=part;
    const n=Math.max(0,...Object.values(profiles).map(values=>values.length));
    days+=n/periodsPerDay;
    const pvActive=['pv','pv_bess'].includes(result.scenario || results.scenario);
    const batteryActive=['bess','pv_bess'].includes(result.scenario || results.scenario);
    const energySite=String(request.energy_site_id || inputs.energy_site_id || (sites.size===1 ? [...sites.keys()][0] : ''));
    const localBuses=new Map(scheduled(request).map(bus=>[String(bus.id),bus]));
    for(const [id,values] of Object.entries(profiles)) {
      const row=get(id);row.days+=values.length/periodsPerDay;row.valid&&=validated(result);
      if(!buses.has(id)) buses.set(id,localBuses.get(id) || {id});
      const transfers=result.additional_trips?.[id];
      const visits=list(result.opportunity_charging_visits).filter(visit=>String(visit.bus_id)===id);
      // Daily leaf data uses local minutes; flexible results contain global trip minutes.
      const start=offset*step,end=(offset+n)*step;
      const selectedTransfers=list(transfers).filter(trip=>part.offset===0 && parts.length===1 || trip.start_min>=start && trip.start_min<end);
      const selectedVisits=visits.filter(visit=>part.offset===0 && parts.length===1 || visit.departure_min>=start && visit.departure_min<end);
      if(selectedTransfers.length) {
        if(selectedTransfers.every(trip=>finite(trip.dist_m))) row.detour+=sum(selectedTransfers.map(trip=>trip.dist_m))/1000;
        else row.detourKnown=false;
      } else if(selectedVisits.length) {
        if(selectedVisits.every(visit=>finite(visit.distance_km))) row.detour+=sum(selectedVisits.map(visit=>visit.distance_km));
        else row.detourKnown=false;
      } else if(!result.additional_trips && !Array.isArray(result.opportunity_charging_visits) && (localBuses.get(id) || buses.get(id))?.opportunity_visits?.length) row.detourKnown=false;
    }
    for(let t=0;t<n;t++) {
      const index=offset+t,groups=new Map();
      if(batteryActive) {
        const value=result.bess_charge_from_grid_profile?.[index];
        if(finite(value)) storageGrid+=Math.max(0,value)*step/60;
        else storageGridKnown=false;
      }
      for(const [id,values] of Object.entries(profiles)) {
        const row=get(id),power=values[t];
        if(!finite(power) || power<-.001) {row.unknown=true;row.valid=false;continue;}
        if(power<=0) continue;
        row.energy+=power*step/60;
        let site=result.connection_schedules?.[id]?.[index];
        if(!site) {
          const available=Object.entries((localBuses.get(id) || buses.get(id))?.site_availability || {}).filter(([,profile])=>profile.length && profile[t%profile.length]>0);
          if(available.length===1) site=available[0][0];
        }
        const key=site ? String(site) : '';
        if(key) row.sites.add(sites.get(key)?.name || key);
        else siteUnknown++;
        if(!groups.has(key)) groups.set(key,[]);
        groups.get(key).push({row,power});
      }
      for(const [site,items] of groups) {
        const load=sum(items.map(item=>item.power));
        let pv=0,battery=0;
        const needsSources=(pvActive || batteryActive) && (!site || !energySite || site===energySite);
        let unknown=needsSources && (!site || !energySite) && sites.size>1;
        if(needsSources) {
          if(pvActive) {pv=result.pv_to_bus_profile?.[index];unknown||=!finite(pv);}
          if(batteryActive) {battery=result.bess_to_bus_profile?.[index];unknown||=!finite(battery);}
          unknown||=finite(pv) && finite(battery) && (pv<-.001 || battery<-.001 || pv+battery>load+.02);
        }
        for(const {row,power} of items) {
          if(unknown) {row.unknown=true;continue;}
          const factor=power/load*step/60;
          row.pv+=Math.max(0,pv)*factor;row.battery+=Math.max(0,battery)*factor;
          row.grid+=Math.max(0,load-pv-battery)*factor;
        }
      }
    }
    onProgress({phase:'routes',message:'Summarizing saved routes',completed:partIndex+1,total:parts.length});
  }
  const totalBattery=sum([...stats.values()].map(row=>row.battery));
  const evaluatedDays=days || results.total_days || 0;
  const config=meta.settings?.longTermConfig || meta.audit_context?.runtime_settings?.longTermConfig || {};
  const start=inputs.start_date || config.startDate || results.completed_dates?.[0] || 'Nicht dokumentiert';
  const end=inputs.end_date || config.endDate || results.completed_dates?.at(-1) || 'Nicht dokumentiert';
  const excludedDays=list(results.day_records).filter(day=>day.status!=='completed').length;
  const coverage=`Zeitraum ${start} bis ${end}; ${textNumber(evaluatedDays)} ausgewertete Tage; ${excludedDays} Tage ausgelassen/fehlgeschlagen; keine Hochrechnung. Gespeicherter Tagesfahrplan je ausgewertetem Tag wiederholt. Fahrbarkeit gilt nur unter den gespeicherten Modellannahmen.`;
  if(!days) warnings.add('Detaillierte Ladeprofile fehlen; Energie und Fahrbarkeit sind nicht vollständig bestimmbar.');
  if(siteUnknown) warnings.add('Einige genutzte Ladestandorte sind nicht eindeutig dokumentiert.');
  if(!storageGridKnown) warnings.add('Netzladung des Speichers ist nicht vollständig dokumentiert.');
  if(storageGrid>0 && totalBattery<=0) warnings.add(`${textNumber(storageGrid)} kWh Netz-Speicherladung ohne zuordenbare Batterieabgabe bleiben ohne Umlaufzuordnung.`);
  const rows=[];
  for(const [id,bus] of buses) {
    const row=get(id),isExcluded=excluded.has(id),reason=reasons[id];
    if(!isExcluded && storageGridKnown && totalBattery>0) row.storageGrid=storageGrid*row.battery/totalBattery;
    const km=dailyKm(bus),complete=!isExcluded && days>0 && Math.abs(row.days-days)<1e-6 && row.valid;
    const energyKnown=complete && !row.unknown && (storageGridKnown || row.battery<=0);
    const proven=['energy_proven','model_infeasible'].includes(reason?.category);
    const feasibility=isExcluded ? (proven ? 'Nein (dokumentierter Modellnachweis)' : 'Nicht bewertet / ausgeschlossen') : complete ? 'Ja (ausgewertete Tage)' : 'Nicht vollständig bestimmbar';
    const detail=[coverage];
    if(isExcluded) detail.push(`Ausgeschlossen: ${reason?.category || 'Ursache nicht dokumentiert'}. ${reason?.scope || 'Kein Unzulässigkeitsnachweis vorhanden.'}`);
    else {
      detail.push(`Ladestrom gesamt: ${textNumber(row.energy)} kWh; Netz direkt: ${row.unknown ? 'Nicht bestimmbar' : textNumber(row.grid)} kWh; PV direkt: ${row.unknown ? 'Nicht bestimmbar' : textNumber(row.pv)} kWh; Batterieabgabe: ${row.unknown ? 'Nicht bestimmbar' : textNumber(row.battery)} kWh.`);
      if(row.battery>0) detail.push(`Netzladung des Speichers zugeordnet: ${storageGridKnown ? textNumber(row.storageGrid) : 'Nicht bestimmbar'} kWh; bilanziell anteilig nach Batterieabgabe im Auswertezeitraum, inkl. Ladeverlusten/ggf. Endbestand. Herkunft des initialen Speicherinhalts nicht nachgewiesen. Batterieabgabe nicht nochmals als direkten Netzstrom zählen.`);
      if(row.pv>0 || row.battery>0) detail.push('PV/Batterie je Ladezeitfenster am versorgten Standort anteilig nach Bus-Ladeleistung zugeordnet; keine individuelle Messung.');
      if(!complete) detail.push('Unvollständiger oder nicht validierter Umlauf-Ladeplan.');
      if(!row.detourKnown) detail.push('Zusätzliche Ladefahrten nicht vollständig dokumentiert.');
    }
    if(km===null) detail.push('Fahrplanentfernung nicht dokumentiert.');
    detail.push(...warnings);
    rows.push([id,bus.vehicle_type || bus.vehicle_type_group || bus.vehicle_group || 'Nicht dokumentiert',
      km===null || !Number.isInteger(evaluatedDays) ? null : km*evaluatedDays,
      complete && km!==null && Number.isInteger(evaluatedDays) && row.detourKnown ? km*evaluatedDays+row.detour : null,
      feasibility,energyKnown ? row.grid+row.storageGrid : null,[...row.sites].sort().join('; '),detail.join(' ')]);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  const cell=value=>{
    if(typeof value==='number') return textNumber(value);
    const text=String(value ?? 'Nicht bestimmbar');
    return '"'+(/^[=+\-@\t\r]/.test(text) ? "'"+text : text).replaceAll('"','""')+'"';
  };
  const csv='\uFEFF'+[routeSummaryHeaders,...rows].map(row=>row.map(cell).join(';')).join('\r\n');
  return {rows,csv,notice:coverage+' '+[...warnings].join(' '),filename:`eDOPT_Umlaufuebersicht_${String(start).replaceAll(':','-')}_${String(end).replaceAll(':','-')}.csv`};
}
