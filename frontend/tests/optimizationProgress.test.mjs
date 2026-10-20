import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationJob} from '../src/utils/optimizationProgress.js';

test('cancellation waits for backend confirmation and never accepts an interrupted result',async()=>{
  const controller=new AbortController();let cancels=0,polls=0;
  await assert.rejects(optimizationJob({}, {
    start:async()=>({job_id:'owned'}),
    cancel:async id=>{assert.equal(id,'owned');cancels++;},
    get:async()=>++polls===1 ? {status:'running'} : polls===2 ? {status:'cancelling'} : {status:'cancelled'},
  },state=>{if(state.status==='running')controller.abort();},async()=>{}, {signal:controller.signal}),
  error=>error.code==='OPTIMIZATION_CANCELLED');
  assert.equal(cancels,1);assert.equal(polls,3);
});

test('cancellation during submit still cancels the returned job; completed race is discarded',async()=>{
  const controller=new AbortController();let cancelled=false;
  await assert.rejects(optimizationJob({}, {
    start:async()=>{controller.abort();return {job_id:'owned'};},
    cancel:async()=>{cancelled=true;},get:async()=>({status:'completed',result:{notAccepted:true}}),
  },()=>{},async()=>{}, {signal:controller.signal}),error=>error.code==='OPTIMIZATION_CANCELLED');
  assert.equal(cancelled,true);
  let starts=0;
  await assert.rejects(optimizationJob({}, {start:async()=>{starts++;}},()=>{},async()=>{}, {signal:controller.signal}));
  assert.equal(starts,0);
});

test('failed cancellation is retried and never claims that the worker stopped',async()=>{
  const controller=new AbortController();let attempts=0;
  await assert.rejects(optimizationJob({}, {
    start:async()=>{controller.abort();return {job_id:'owned'};},
    cancel:async()=>{attempts++;throw new Error('Offline');},
  },()=>{},async()=>{}, {signal:controller.signal}),/backend run may still be active/);
  assert.equal(attempts,10);
});

test('polling submits once, delivers live phases and returns the unchanged result',async () => {
  const states=[{status:'running',phase:'building_model'}, {status:'running',phase:'minimizing_soc',metrics:{incumbent:3}},
    {status:'completed',result:{scenario:'baseline',schedules:{B:[1,2]}}}];
  const observed=[];
  let starts=0;
  const result=await optimizationJob({buses:[]},{start:async()=>{starts++;return {job_id:'job'};},get:async()=>states.shift()},
    state=>observed.push(state),async()=>{});
  assert.equal(starts,1);
  assert.deepEqual(result.schedules.B,[1,2]);
  assert.equal(observed[2].phase,'minimizing_soc');
  assert.equal(observed.at(-1).result,undefined);
});

test('failed jobs keep full diagnostics for the existing export flow',async () => {
  const evidence={detail:'Infeasible',diagnostics:{model_lp:'exact model'}};
  await assert.rejects(optimizationJob({}, {start:async()=>({job_id:'job'}),get:async()=>({status:'failed',error:evidence})},()=>{},async()=>{}),
    error=>error.response.data.diagnostics.model_lp==='exact model');
});

test('a transient polling error does not submit the calculation twice',async () => {
  let polls=0,starts=0;
  const observed=[];
  const result=await optimizationJob({}, {start:async()=>{starts++;return {job_id:'job'};},get:async()=>{
    if (++polls===1) throw new Error('Temporary outage');
    return {status:'completed',result:{ok:true}};
  }},state=>observed.push(state),async()=>{});
  assert.equal(result.ok,true);
  assert.equal(starts,1);
  assert.ok(observed.some(state=>state.connection_warning));
});

test('backend restart or expiration ends polling explicitly without starting another job',async () => {
  await assert.rejects(optimizationJob({}, {start:async()=>({job_id:'lost'}),get:async()=>{
    const error=new Error('Not found');error.response={status:404,data:{detail:'Backend restarted'}};throw error;
  }},()=>{},async()=>{}), /lost.*Backend restarted/);
});
