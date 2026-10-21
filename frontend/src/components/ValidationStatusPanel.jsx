import React, { useId, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Download, Loader2, Search } from 'lucide-react';
import { groupValidationIssues, validationCounts } from '../utils/validationPresentation';
import {validationExclusionReasons,exclusionReasonLabel} from '../utils/optimizationFleet';

const boundLabel=value=>({bound_passed_not_proven:'No shortfall in optimistic bound — feasibility not proven',shortfall_proven:'Energy shortfall proven under current assumptions',
  not_reachable_due_to_trip_shortfall:'Driving minimum cannot be maintained',not_checked_missing_mapping:'Not assessed — check charging mapping',not_checked:'Not assessed'}[value] || 'Not assessed');
const endLabel=value=>({cyclic_soc:'Start SoC = End SoC',next_day_readiness:'Reserve + next-day readiness',end_reserve:'Configured end reserve'}[value] || value);

export default function ValidationStatusPanel({ result, excludableIds = [], activeBusCount, onExclude,
  onExport, isExporting, isValidating, exportError }) {
  const [query,setQuery] = useState('');
  const titleId = useId();
  const issues = result.issues || [];
  const counts = validationCounts(issues);
  const groups = groupValidationIssues(issues,query);
  const visibleCount = groups.reduce((total,group) => total+group.issues.length,0);
  const invalid = result.status === 'invalid';
  const valid = result.status === 'valid';
  const exclusionGroups=Object.entries(excludableIds.reduce((groups,id)=>{
    const reason=validationExclusionReasons(result,[id])[id];(groups[reason.category] ||= []).push(id);return groups;
  },{}));
  return <section className={`validation-panel validation-panel-${result.status}`} aria-labelledby={titleId}>
    <div className="validation-panel-header">
      <div>
        <h3 id={titleId} className="validation-panel-title">
          {valid ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          Input check: {invalid ? 'Invalid' : valid ? 'Valid' : 'Warning'}
        </h3>
        <p className="validation-panel-description">{invalid ? 'Optimization is blocked. Resolve the errors below or exclude the flagged routes where offered.'
          : valid ? 'No input inconsistency or optimistic energy-bound failure was found under the current assumptions. A feasible charging schedule is not yet proven.'
            : 'Review the warnings below before starting optimization.'}</p>
      </div>
      {!valid && <button className="btn btn-outline" onClick={onExport} disabled={isExporting || isValidating}>
        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {isExporting ? 'Preparing diagnostics…' : 'Export diagnostics (.zip)'}
      </button>}
    </div>
    <p className="validation-export-note">All infeasibility findings apply only to the current battery, SoC, timetable and charging assumptions. Missing charging availability is a mapping/window warning, not a general undrivability verdict.</p>
    {result.route_energy_checks?.length>0 && <details className="mt-3 mb-3"><summary>Driving energy versus required end energy ({result.route_energy_checks.length} routes)</summary>
      <p className="text-xs text-muted mt-2">Driving energy tests the battery/operating minimum during the timetable. The end check additionally tests the selected reserve or Start SoC = End SoC. Passing these optimistic bounds does not prove feasibility with shared chargers or switching rules. Diagnostic tolerance: {result.route_energy_checks[0].tolerance_kwh} kWh; genuine 0.2 kWh shortfalls are not rounded away.</p>
      <div className="result-info-table-scroll"><table className="data-table"><thead><tr><th>Route</th><th>Driving energy</th><th>Required end condition</th><th>Energy evidence</th></tr></thead><tbody>
        {result.route_energy_checks.map(row=><tr key={row.bus_id}><td>{row.bus_id}</td><td>{boundLabel(row.driving_energy)}</td><td><strong>{endLabel(row.end_condition)}</strong><br/>{boundLabel(row.configured_end_energy)}</td><td className="text-xs">
          {row.maximum_final_energy_kwh!=null && <>Optimistic final: {row.maximum_final_energy_kwh.toFixed(3)} kWh · required: {row.configured_end_target_kwh.toFixed(3)} kWh</>}
          {row.missing_energy_kwh!=null && <div>Shortfall: {row.missing_energy_kwh.toFixed(3)} kWh</div>}{row.note && <p>{row.note}</p>}
        </td></tr>)}
      </tbody></table></div>
    </details>}
    {!valid && <p className="validation-export-note">Export includes the configuration at Run Check, all messages, complete profiles and the original Excel file if locally available.</p>}
    {exportError && <p role="alert" className="text-sm text-error mt-2">{exportError}</p>}
    {issues.length > 0 && <>
      <div className="validation-counts" aria-live="polite">
        <span className="validation-count validation-count-error">{counts.errors} {counts.errors === 1 ? 'error' : 'errors'}</span>
        <span className="validation-count validation-count-warning">{counts.warnings} {counts.warnings === 1 ? 'warning' : 'warnings'}</span>
        <span className="validation-count">{counts.routes} affected {counts.routes === 1 ? 'route' : 'routes'}</span>
      </div>
      <label className="validation-search"><Search size={16} aria-hidden="true" />
        <input type="search" className="form-input" aria-label="Filter validation messages" placeholder="Filter by route, category, code or message…" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <p className="validation-filter-note">{query.trim() ? `${visibleCount} of ${issues.length} messages match.` : 'Expand a category to review its messages.'}</p>
      <div className="validation-categories">
        {groups.map(group => <details key={group.id} className="validation-category" open={Boolean(query.trim()) || group.issues.length <= 3}>
          <summary><span className="validation-category-name"><ChevronDown size={16} />{group.title}</span>
            <span className="validation-category-counts">{group.counts.errors > 0 && <span className="text-error">{group.counts.errors} {group.counts.errors === 1 ? 'error' : 'errors'}</span>}
              {group.counts.warnings > 0 && <span className="text-warning">{group.counts.warnings} {group.counts.warnings === 1 ? 'warning' : 'warnings'}</span>}
              <span>{group.counts.routes} {group.counts.routes === 1 ? 'route' : 'routes'}</span>
            </span>
          </summary>
          <div className="validation-category-body"><p className="validation-category-hint">{group.hint}</p>
            <ul className="validation-issues">{group.issues.map((issue,index) => <li key={index}>
              <div className="validation-issue-meta"><span className={issue.type === 'ERROR' ? 'text-error' : issue.type === 'WARNING' ? 'text-warning' : 'text-muted'}>{issue.type === 'ERROR' ? 'Error' : issue.type === 'WARNING' ? 'Warning' : 'Information'}</span>
                {issue.bus_id != null && <strong>Route {issue.bus_id}</strong>}
                {issue.code && <code>{issue.code}</code>}</div>
              <p className="validation-issue-message">{issue.message}</p>
              {issue.details && <details className="validation-technical"><summary>Technical details</summary><pre>{JSON.stringify(issue.details,null,2)}</pre></details>}
            </li>)}</ul>
          </div>
        </details>)}
      </div>
      {!groups.length && <p className="validation-empty">No messages match this filter. Clear the search to see all categories.</p>}
    </>}
    {excludableIds.length > 0 && <div className="validation-exclusion">
      <p>Exclusion is optional and changes only the optimization fleet. Review the recorded cause; availability warnings do not prove energy infeasibility.</p>
      {exclusionGroups.map(([category,ids])=><div key={category} className="mt-2"><p>{exclusionReasonLabel(category)}: {ids.join(', ')}</p>
        <button className="btn btn-outline" onClick={()=>onExclude(ids)} disabled={isValidating || ids.length >= activeBusCount}>Exclude this group and recheck ({ids.length})</button>
        {ids.length>=activeBusCount && <p className="text-error">At least one route must remain. Review configuration or mapping first.</p>}
      </div>)}
    </div>}
  </section>;
}
