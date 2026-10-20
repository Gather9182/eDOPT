import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyProgressSummary,dailyPhaseLabel,excludedDailyDates,dailyStatusLabel,contiguousDayWindow} from '../src/utils/dailyProgress.js';

test('overview prioritizes active dates and counts real completed days separately from pending work',()=>{
  const summary=dailyProgressSummary({'2026-10-01':'completed','2026-10-02':'not_calculated','2026-10-03':'running','2026-10-04':'queued','2026-10-05':'cancelling','2026-10-06':'failed'});
  assert.deepEqual(summary.rows.map(row=>row.date),['2026-10-03','2026-10-05','2026-10-06','2026-10-04','2026-10-02','2026-10-01']);
  assert.equal(summary.completed,1);assert.equal(summary.active,2);assert.equal(summary.pending,2);assert.equal(summary.failed,1);assert.equal(summary.total,6);
  assert.equal(summary.rows.find(row=>row.status==='not_calculated').label,'Not started');
  assert.equal(dailyPhaseLabel('minimizing_soc'),'Minimizing SoC deviations');
});

test('failed and uncalculated dates remain visible as excluded dates, never as completed dates',()=>{
 const days=[{date:'2026-10-16',status:'completed'},{date:'2026-10-17',status:'failed',error:{detail:'Missing prices'}},{date:'2026-10-18',status:'not_calculated'}];
 assert.deepEqual(excludedDailyDates({day_records:days}),days.slice(1));
 assert.equal(dailyStatusLabel('failed'),'Failed');
});

test('moving averages cannot bridge a missing calendar date',()=>{
 const data=[0,1,3,4,5].map(calendarDay=>({calendarDay}));
 assert.deepEqual(contiguousDayWindow(data,2,20,20),{start:2,end:4});
 assert.deepEqual(contiguousDayWindow(data,1,20,20),{start:0,end:1});
 assert.deepEqual(contiguousDayWindow(data,4,20),{start:2,end:4});
 assert.deepEqual(contiguousDayWindow([{}, {}, {}],2,20),{start:0,end:2});
});
