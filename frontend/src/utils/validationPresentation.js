const categories = {
  data: { title:'Data and time profiles', hint:'Check timetable data, electricity prices, profile lengths and route IDs.' },
  infrastructure: { title:'Charging infrastructure and mapping', hint:'Review charging locations, assigned nodes, connector counts, power limits and mapping settings.' },
  vehicle: { title:'Vehicle configuration', hint:'Review battery capacity, charging power, efficiency and vehicle type settings.' },
  energy: { title:'Energy bounds under current model assumptions', hint:'Distinguish minimum battery energy during driving from the required end reserve or Start SoC = End SoC. Findings are conditional on current settings; passing an optimistic bound does not prove fleet feasibility.' },
  charging: { title:'Charging availability and possible mapping gaps', hint:'No availability may indicate missing charging-location/node assignments or layover windows. This warning alone does not prove that a route is undrivable.' },
  storage: { title:'Battery storage configuration', hint:'Review stationary battery capacity, state-of-charge limits, power and efficiency.' },
  solar: { title:'Solar generation configuration', hint:'Review PV capacity, generation profiles and the selected energy location.' },
  request: { title:'System and request errors', hint:'Review the request details and confirm that the backend is available.' },
  general: { title:'Other validation messages', hint:'Review the message details or export the diagnostic package for analysis.' },
};

export function validationCategory(issue) {
  if (categories[issue.category]) return issue.category;
  const code = issue.code || '';
  if (code === 'NO_CHARGING_AVAILABILITY') return 'charging';
  if (['BUS_ENERGY_INFEASIBLE','BUS_FINAL_TARGET_EXCEEDS_CAPACITY','NEXT_DAY_REQUIREMENT_EMPTY'].includes(code)) return 'energy';
  if (['TIMETABLE_REPROCESS_REQUIRED','CHARGING_SITE_CONFIGURATION','CHARGER_CAPACITY_INVALID','GRID_LIMIT_INVALID','BUS_POWER_EXCEEDS_SITE_CAPACITY'].includes(code)) return 'infrastructure';
  if (code.startsWith('BESS') || issue.message?.startsWith('BESS:')) return 'storage';
  if (code.startsWith('PV') || issue.message?.startsWith('PV:')) return 'solar';
  if (code === 'VALIDATION_REQUEST_FAILED') return 'request';
  if (['NO_ROUTES_INCLUDED','INPUT_VALIDATION','PRICE_PROFILE_LENGTH','AVAILABILITY_PROFILE_LENGTH','DUPLICATE_ROUTE_ID'].includes(code)) return 'data';
  if (code === 'BUS_EFFICIENCY_INVALID') return 'vehicle';
  return 'general';
}

export function validationCounts(issues = []) {
  return { errors:issues.filter(issue => issue.type?.toUpperCase() === 'ERROR').length,
    warnings:issues.filter(issue => issue.type?.toUpperCase() === 'WARNING').length,
    routes:new Set(issues.filter(issue => issue.bus_id != null).map(issue => String(issue.bus_id))).size,
    total:issues.length };
}

export function groupValidationIssues(issues = [], query = '') {
  const needle = query.trim().toLocaleLowerCase();
  const grouped = new Map();
  for (const issue of issues) {
    const category = validationCategory(issue);
    if (needle && ![issue.message,issue.bus_id,issue.code,categories[category].title].some(value => String(value ?? '').toLocaleLowerCase().includes(needle))) continue;
    if (!grouped.has(category)) grouped.set(category,{id:category,...categories[category],issues:[]});
    grouped.get(category).issues.push(issue);
  }
  return [...grouped.values()].map(group => ({...group,counts:validationCounts(group.issues)}))
    .sort((a,b) => Number(b.counts.errors > 0)-Number(a.counts.errors > 0) || Object.keys(categories).indexOf(a.id)-Object.keys(categories).indexOf(b.id));
}
