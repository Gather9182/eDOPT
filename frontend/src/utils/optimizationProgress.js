export async function optimizationJob(inputs, transport, onProgress = () => {}, pause = ms => new Promise(resolve => setTimeout(resolve,ms))) {
  const {job_id} = await transport.start(inputs);
  let last = {job_id,status:'queued',phase:'queued',message:'Waiting for the optimization worker.',metrics:{}};
  let failures = 0;
  onProgress(last);
  while (true) {
    let state;
    try {
      state = await transport.get(job_id);
      failures = 0;
    } catch (error) {
      failures += 1;
      onProgress({...last,connection_warning:'Live updates interrupted. The backend run may still be active; no replacement run has been started.'});
      if (error.response?.status === 404 || failures >= 10) {
        const interrupted = new Error(`Cannot retrieve optimization job ${job_id}. ${error.response?.data?.detail || 'Live connection was lost. The backend run may still be active; do not automatically submit it again.'}`);
        interrupted.response = error.response;
        throw interrupted;
      }
      await pause(1000);
      continue;
    }
    const {result, error, ...progress} = state;
    last = {...progress,job_id,polled_at:Date.now(),connection_warning:null};
    onProgress(last);
    if (state.status === 'completed') return result;
    if (state.status === 'failed') {
      const failure = new Error(error?.detail || 'Optimization failed.');
      failure.response = {status:500,data:error || {detail:failure.message}};
      throw failure;
    }
    await pause(1000);
  }
}
