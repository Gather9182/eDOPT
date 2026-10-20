import {getItem} from '../utils/db.js';
import {buildExport} from '../utils/exportPackage.js';

const pending=new Map();
let sequence=0;
async function readStorage(key) {
  const value=await getItem(key);
  if(value!=null) return value;
  // Workers cannot access localStorage. Only legacy storage needs a UI bridge.
  return new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});
    self.postMessage({type:'storage',id,key});
  });
}
self.onmessage=async ({data})=>{
  if(data.type==='storage-result') {
    const entry=pending.get(data.id);pending.delete(data.id);
    if(entry) data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.value);
    return;
  }
  if(data.type!=='start') return;
  try {
    self.postMessage({type:'progress',progress:{phase:'load',message:'Reading saved results in background'}});
    const results=await readStorage('optimization_results');
    const identity=results?.run_metadata?.run_id || results?.run_metadata?.timestamp || null;
    if(identity!==data.identity) throw new Error('Saved results changed. Reload the Export page before exporting.');
    const result=await buildExport({...data.options,results,now:new Date(data.options.now)},readStorage,
      progress=>self.postMessage({type:'progress',progress}));
    self.postMessage({type:'complete',result});
  } catch(error) {self.postMessage({type:'error',message:error.message});}
};
