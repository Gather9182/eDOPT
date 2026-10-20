import React from 'react';

export default function ExcludedRoutesNotice({ ids = [], onRestore, disabled = false }) {
  if (!ids.length) return null;
  return <div className="card mb-6" role="status" style={{ borderColor: 'var(--warning)', overflowWrap: 'anywhere' }}>
    <p className="font-bold mb-2">{ids.length} {ids.length === 1 ? 'route' : 'routes'} excluded from optimization</p>
    <p className="text-sm mb-2">Optimization and results include only the remaining routes. The imported data is retained.</p>
    <p className="text-xs mb-3">{ids.join(', ')}</p>
    {onRestore && <button className="btn btn-outline" disabled={disabled} onClick={onRestore}>Restore all excluded routes</button>}
  </div>;
}
