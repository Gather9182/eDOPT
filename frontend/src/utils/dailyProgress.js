const labels={not_calculated:'Not started',queued:'Queued',running:'Running',cancelling:'Cancelling',completed:'Completed',failed:'Failed',cancelled:'Cancelled'};
const phases={precheck:'Checking inputs',building_model:'Building model',minimizing_soc:'Minimizing SoC deviations',minimizing_cost:'Minimizing cost',processing_results:'Preparing results',energy_diagnostics:'Checking energy shortfalls',route_diagnostics:'Checking routes',queued:'Waiting for worker',cancelling:'Stopping job'};
const priority={running:0,cancelling:0,failed:1,cancelled:1,queued:2,not_calculated:3,completed:4};

export function dailyProgressSummary(statuses) {
  const rows=Object.entries(statuses).map(([date,status])=>({date,status,label:labels[status] || status}));
  rows.sort((a,b)=>(priority[a.status] ?? 5)-(priority[b.status] ?? 5) || a.date.localeCompare(b.date));
  const count=status=>rows.filter(row=>status.includes(row.status)).length;
  return {rows,total:rows.length,completed:count(['completed']),active:count(['running','cancelling']),pending:count(['queued','not_calculated']),failed:count(['failed']),cancelled:count(['cancelled'])};
}

export const dailyPhaseLabel = phase => phases[phase] || 'Computing schedule';
