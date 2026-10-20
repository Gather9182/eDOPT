import React from 'react';
import { ChevronRight } from 'lucide-react';

export default function ResultInfoCard({ title, summary, status, tone, children }) {
  return <details className="card result-info-card result-info-disclosure mb-4">
    <summary className="result-info-summary">
      <ChevronRight size={18} className="result-info-chevron" aria-hidden="true" />
      <span className="result-info-summary-copy">
        <span className="result-info-summary-title">{title}</span>
        <span className="result-info-summary-text">{summary}</span>
      </span>
      {status && <span className={`result-info-status ${tone ? `is-${tone}` : ''}`}>{status}</span>}
    </summary>
    <div className="result-info-body">{children}</div>
  </details>;
}
