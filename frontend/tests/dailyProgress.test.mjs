import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyProgressSummary,dailyPhaseLabel} from '../src/utils/dailyProgress.js';

test('overview prioritizes active dates and counts real completed days separately from pending work',()=>{
  const summary=dailyProgressSummary({'2026-10-01':'completed','2026-10-02':'not_calculated','2026-10-03':'running','2026-10-04':'queued','2026-10-05':'cancelling','2026-10-06':'failed'});
  assert.deepEqual(summary.rows.map(row=>row.date),['2026-10-03','2026-10-05','2026-10-06','2026-10-04','2026-10-02','2026-10-01']);
  assert.equal(summary.completed,1);assert.equal(summary.active,2);assert.equal(summary.pending,2);assert.equal(summary.failed,1);assert.equal(summary.total,6);
  assert.equal(summary.rows.find(row=>row.status==='not_calculated').label,'Not started');
  assert.equal(dailyPhaseLabel('minimizing_soc'),'Minimizing SoC deviations');
});
