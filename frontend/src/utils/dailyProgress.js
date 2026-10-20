const labels={not_calculated:'Not started',queued:'Queued',running:'Running',cancelling:'Cancelling',completed:'Completed',failed:'Failed',cancelled:'Cancelled',skipped:'Skipped (DST)'};
const phases={precheck:'Checking inputs',building_model:'Building model',minimizing_soc:'Minimizing SoC deviations',minimizing_cost:'Minimizing cost',processing_results:'Preparing results',energy_diagnostics:'Checking energy shortfalls',route_diagnostics:'Checking routes',queued:'Waiting for worker',cancelling:'Stopping job'};
const priority={running:0,cancelling:0,failed:1,cancelled:1,skipped:1,queued:2,not_calculated:3,completed:4};

export function dailyProgressSummary(statuses) {
  const rows=Object.entries(statuses).map(([date,status])=>({date,status,label:labels[status] || status}));
  rows.sort((a,b)=>(priority[a.status] ?? 5)-(priority[b.status] ?? 5) || a.date.localeCompare(b.date));
  const count=status=>rows.filter(row=>status.includes(row.status)).length;
  return {rows,total:rows.length,completed:count(['completed']),active:count(['running','cancelling']),pending:count(['queued','not_calculated']),failed:count(['failed']),cancelled:count(['cancelled']),skipped:count(['skipped'])};
}

export const dailyPhaseLabel = phase => phases[phase] || 'Computing schedule';

export const excludedDailyDates = results => (results.day_records || []).filter(day=>day.status!=='completed');
export const dailyStatusLabel = status => labels[status] || status;

export function workerCapacityExplanation(report) {
  if (!report?.resources) return ['Backend resource details are unavailable. Restart/update the backend to obtain measured limits.'];
  const resource=report.resources;
  const gib=value=>(value/1024**3).toFixed(1);
  const messages=[`Backend measurement: ${Number.isFinite(resource.available_memory_bytes) ? `${gib(resource.available_memory_bytes)} GiB available RAM` : 'available RAM unknown'}; ${resource.cpu_count} logical CPU cores.`,
    `RAM rule: ${gib(resource.memory_per_worker_bytes)} GiB per job (conservative estimate, not measured model usage). Memory permits ${resource.memory_worker_limit ?? 'unknown'} jobs; configured ceiling: ${resource.environment_worker_limit ?? 'unknown'} (EDOPT_DAILY_WORKERS).`];
  if (resource.detection_error) messages.push(resource.detection_error);
  if (resource.limiting_factors?.length) messages.push(`Limiting factors: ${resource.limiting_factors.map(value=>({available_memory:'available RAM',cpu_count:'CPU cores',environment_limit:'EDOPT_DAILY_WORKERS',detection_failed:'resource detection failed'}[value] || value)).join(', ')}.`);
  if (report.refresh_deferred) messages.push(`Current resources permit ${resource.daily_workers} jobs, but active/queued jobs retain the existing pool of ${report.daily_workers}. Capacity will refresh when idle before the next run.`);
  if (resource.checked_at) messages.push(`Checked: ${new Date(resource.checked_at).toLocaleString()}. Values describe the backend environment, which may differ from Task Manager if the backend runs in a restricted environment.`);
  return messages;
}

export function contiguousDayWindow(data,index,before,after=0) {
  let start=index,end=index;
  const day=position=>data[position].calendarDay ?? position;
  while (start>Math.max(0,index-before) && day(start)===day(start-1)+1) start--;
  while (end<Math.min(data.length-1,index+after) && day(end+1)===day(end)+1) end++;
  return {start,end};
}
