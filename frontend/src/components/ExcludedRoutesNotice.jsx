import React from 'react';

export default function ExcludedRoutesNotice({ ids = [], onRestore, disabled = false }) {
  if (!ids.length) return null;
  return <div className="card mb-6" role="status" style={{ borderColor: 'var(--warning)', overflowWrap: 'anywhere' }}>
    <p className="font-bold mb-2">{ids.length} {ids.length === 1 ? 'Umlauf' : 'Umläufe'} von der Optimierung ausgeschlossen</p>
    <p className="text-sm mb-2">Optimierung und Ergebnisse berücksichtigen nur die verbleibenden Umläufe. Die importierten Daten bleiben erhalten.</p>
    <p className="text-xs mb-3">{ids.join(', ')}</p>
    {onRestore && <button className="btn btn-outline" disabled={disabled} onClick={onRestore}>Alle Umläufe wieder einschließen</button>}
  </div>;
}
