import React, { useId, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronDown, Download, Loader2, Search } from 'lucide-react';
import { groupValidationIssues, validationCounts } from '../utils/validationPresentation';

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
  return <section className={`validation-panel validation-panel-${result.status}`} aria-labelledby={titleId}>
    <div className="validation-panel-header">
      <div>
        <h3 id={titleId} className="validation-panel-title">
          {valid ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          Input check: {invalid ? 'Invalid' : valid ? 'Valid' : 'Warning'}
        </h3>
        <p className="validation-panel-description">{invalid ? 'Optimization is blocked. Resolve the errors below or exclude the flagged routes where offered.'
          : valid ? 'Input consistency and individual energy checks passed. Shared connectors, power limits and switching restrictions still need to be solved together.'
            : 'Review the warnings below before starting optimization.'}</p>
      </div>
      {!valid && <button className="btn btn-outline" onClick={onExport} disabled={isExporting || isValidating}>
        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {isExporting ? 'Preparing diagnostics…' : 'Export diagnostics (.zip)'}
      </button>}
    </div>
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
      <p>{excludableIds.length} {excludableIds.length === 1 ? 'route has' : 'routes have'} no charging availability or an infeasible energy requirement. Excluding these routes only affects the optimization; the imported data is retained.</p>
      <button className="btn btn-outline" onClick={onExclude} disabled={isValidating || excludableIds.length >= activeBusCount}>
        Exclude flagged routes and continue ({excludableIds.length})
      </button>
      {excludableIds.length >= activeBusCount && <p className="text-error">At least one route must remain. Correct the charging locations or timetable data first.</p>}
    </div>}
  </section>;
}
