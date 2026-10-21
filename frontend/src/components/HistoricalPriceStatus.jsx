import React from 'react';

export default function HistoricalPriceStatus({state}) {
  if(!state) return null;
  const result=state.result;
  return <details className="price-source-panel price-source-disclosure live-status-disclosure historical-price-status">
    <summary className="price-source-summary">
      <span className="price-source-summary-copy"><strong>Historical AT price data</strong><small>{result ? `${result.complete_days} / ${result.required_days} days cached · ${result.missing_days} missing` : state.error ? 'Preparation failed — show details' : state.message || 'Preparing historical data…'}</small></span>
      <span className="price-source-summary-badge">SMARD · cache first</span>
    </summary>
    <div className="price-source-body" role="status" aria-live="polite">
    <p>{state.message || (state.status==='completed' ? 'Price preparation finished.' : state.status==='failed' ? 'Price preparation failed.' : 'Preparing historical data before solver jobs start.')}</p>
    {state.total_blocks>0 && <p>{state.completed_blocks} / {state.total_blocks} blocks loaded</p>}
    {result && <>
      <p className={result.missing_days ? 'text-warning' : 'text-success'}>{result.complete_days} / {result.required_days} supported days complete · {result.missing_days} missing · {result.excluded_dates?.length || 0} DST dates skipped</p>
      {result.missing_days>0 && <p className="text-warning">Only a partial evaluation is possible. Missing days are excluded from all totals. No replacement prices are generated.</p>}
      <p>{result.external_requests ?? 0} external requests · Source: Bundesnetzagentur | SMARD.de. Existing complete intervals are reused locally.</p>
      {(result.errors || []).map((error,index)=><p className="text-warning" key={index}>{error.code}: {error.message}</p>)}
      {result.conflicts?.length>0 && <p className="text-warning">PROVIDER_PRICE_CONFLICT: {result.conflicts.length} recorded conflicts. Existing selected prices were retained unless an explicit refresh was requested.</p>}
      <details><summary>Cache storage and persistence</summary><p>{result.persistence?.path}</p>{result.persistence?.warnings?.map(warning=><p className="text-warning" key={warning}>{warning}</p>)}</details>
    </>}
    {state.error && <p className="text-error">{state.error.message}</p>}
    <p className="text-xs text-muted">Cancelling the simulation stops waiting; a shared background cache import may finish for reuse by other runs.</p>
    </div>
  </details>;
}
