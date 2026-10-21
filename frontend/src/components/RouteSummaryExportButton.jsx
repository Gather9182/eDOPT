import React,{useEffect,useRef,useState} from 'react';
import {Download,Loader2} from 'lucide-react';
import {backgroundExport} from '../utils/backgroundExport';
import {getItem} from '../utils/db';

export default function RouteSummaryExportButton({results}) {
  const controller=useRef(null);
  const [progress,setProgress]=useState(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>()=>controller.current?.abort(),[]);
  const download=async()=>{
    if(controller.current || !results?.is_long_term) return;
    const active=new AbortController();controller.current=active;setProgress({message:'Preparing route summary'});setMessage('');setError('');
    try {
      const output=await backgroundExport({format:'routes',now:new Date().toISOString()},
        {identity:results.run_metadata?.run_id || results.run_metadata?.timestamp || null,getItem,signal:active.signal,onProgress:setProgress});
      const url=URL.createObjectURL(output.blob),link=document.createElement('a');
      link.href=url;link.download=output.filename;document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage(output.notice);
    } catch(error) {if(error.name!=='AbortError') setError(error.message);}
    finally {controller.current=null;setProgress(null);}
  };
  return <div className="route-summary-download">
    <button type="button" className="btn btn-outline" disabled={!results?.is_long_term || Boolean(progress)} onClick={download}
      title={results?.is_long_term ? 'Export all evaluated days and all saved routes, including excluded routes' : 'Available for long-term analyses'}>
      {progress ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />} {progress ? 'Exporting routes…' : 'Route Summary CSV'}
    </button>
    {progress && <div role="status" className="text-xs text-secondary"><span>{progress.message}</span> <button type="button" className="btn btn-outline btn-sm" onClick={()=>controller.current?.abort()}>Cancel export</button></div>}
    {error && <p role="alert" className="text-error text-xs mt-2">{error}</p>}
    {message && <details className="text-xs text-secondary mt-2"><summary>Route export information</summary><p>{message}</p></details>}
  </div>;
}
