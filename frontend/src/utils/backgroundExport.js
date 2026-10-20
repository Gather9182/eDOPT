export function backgroundExport(options,{identity=null,getItem,onProgress=()=>{},signal,
  createWorker=()=>new Worker(new URL('../workers/export.worker.js',import.meta.url),{type:'module'})}={}) {
  return new Promise((resolve,reject)=>{
    let worker,settled=false,lastProgress=0;
    const finish=(error,result)=>{
      if(settled) return;
      settled=true;signal?.removeEventListener('abort',abort);worker?.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort=()=>{const error=new Error('Export cancelled.');error.name='AbortError';finish(error);};
    if(signal?.aborted) {abort();return;}
    try {
      worker=createWorker();
      signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage=async ({data})=>{
        if(settled) return;
        if(data.type==='progress') {
          const now=Date.now();
          if(now-lastProgress>=100 || data.progress.completed===data.progress.total) {lastProgress=now;onProgress(data.progress);}
        }
        else if(data.type==='complete') finish(null,data.result);
        else if(data.type==='error') finish(new Error(data.message));
        else if(data.type==='storage') {
          try {
            const value=await getItem(data.key);
            if(!settled) worker.postMessage({type:'storage-result',id:data.id,value});
          } catch(error) {if(!settled) worker.postMessage({type:'storage-result',id:data.id,error:error.message});}
        }
      };
      worker.onerror=event=>finish(new Error(event.message || 'Background export worker failed.'));
      worker.onmessageerror=()=>finish(new Error('Background export data could not be transferred.'));
      // Read annual results directly from IndexedDB in the worker. Passing the
      // entire result here would synchronously clone it on the UI thread.
      worker.postMessage({type:'start',identity,options});
    } catch(error) {finish(error);}
  });
}
