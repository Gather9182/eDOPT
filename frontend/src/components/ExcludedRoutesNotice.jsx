import React from 'react';
import {exclusionReasonLabel} from '../utils/optimizationFleet';

export default function ExcludedRoutesNotice({ ids = [], reasons={}, onRestore, disabled = false }) {
  if (!ids.length) return null;
  return <div className="card mb-6" role="status" style={{ borderColor: 'var(--warning)', overflowWrap: 'anywhere' }}>
    <p className="font-bold mb-2">{ids.length} {ids.length === 1 ? 'route' : 'routes'} excluded from optimization</p>
    <p className="text-sm mb-2">Optimization and results include only the remaining routes. The imported data is retained.</p>
    <div className="excluded-route-reasons">{Object.entries(ids.reduce((groups,id)=>{
      const category=reasons[id]?.category || 'manual_or_unspecified';(groups[category] ||= []).push(id);return groups;
    },{})).map(([category,routes])=><p className="text-xs mb-3" key={category}><strong>{exclusionReasonLabel(category)}:</strong> {routes.join(', ')}</p>)}</div>
    <p className="text-xs text-muted mb-3">Causes describe the settings when excluded. Restore and recheck routes after changing battery, SoC or charging assumptions.</p>
    {onRestore && <button className="btn btn-outline" disabled={disabled} onClick={onRestore}>Restore all excluded routes</button>}
  </div>;
}
