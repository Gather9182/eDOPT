import {resultAnalysisFiles} from './resultAnalysisExport.js';
import {diagnosticZip} from './diagnosticExport.js';

export async function buildExport({format,results,project,environment={},now=new Date(),apiBase},getItem,onProgress=()=>{}) {
  if (!results) throw new Error('No saved optimization result is available.');
  if (format==='analysis') {
    const {files,manifest}=await resultAnalysisFiles(results,project,getItem,environment,now,onProgress);
    onProgress({phase:'archive',message:'Creating ZIP archive',files:files.length});
    const blob=diagnosticZip(files,now,progress=>onProgress({phase:'archive',message:'Creating ZIP archive',...progress}));
    return {blob,fileCount:files.length,missingCount:manifest.missing_information.length};
  }
  if (format==='json') {
    onProgress({phase:'serialize',message:'Writing JSON data'});
    return {blob:new Blob([JSON.stringify(results,null,2)],{type:'application/json'})};
  }
  if (format==='csv') {
    onProgress({phase:'tables',message:'Writing timeseries CSV'});
    const columns=[['Period_Index',null],['Price_EUR_MWh','electricity_prices'],['Optimized_Grid_Load_kW','aggregated_load_profile'],
      ['Market_Price_EUR_MWh','market_prices'],['Baseline_Load_kW','baseline_aggregated_load_profile'],['Net_Grid_Import_kW','grid_import_profile'],
      ['PV_Generation_kW','pv_yield_profile'],['BESS_SoC_kWh','bess_soc_profile'],['Ambient_Temp_C','ambient_temperature_profile_c'],['BESS_Cell_Temp_C','bess_cell_temperature_profile_c']];
    const active=columns.filter(([,key],index)=>index<3 || results[key]?.length);
    const chunks=[active.map(([label])=>label).join(',')+'\n'];
    let chunk='';
    for(let t=0;t<(results.electricity_prices || []).length;t++) {
      chunk+=active.map(([,key])=>key ? results[key]?.[t] ?? 0 : t+1).join(',')+'\n';
      if(chunk.length>65536) {chunks.push(chunk);chunk='';}
      if(t%4096===0) onProgress({phase:'tables',message:'Writing timeseries CSV',completed:t,total:results.electricity_prices.length});
    }
    if(chunk) chunks.push(chunk);
    return {blob:new Blob(chunks,{type:'text/csv;charset=utf-8'})};
  }
  if(format==='excel') {
    onProgress({phase:'serialize',message:'Preparing Excel request'});
    results.run_metadata ??={};
    results.run_metadata.inputs ??={};
    results.run_metadata.inputs.co2_emission_factor ??= results.run_metadata.audit_context?.project?.meta?.co2_emission_factor ?? project?.meta?.co2_emission_factor ?? 400;
    const body=JSON.stringify(results);
    onProgress({phase:'server',message:'Backend is generating the Excel workbook'});
    const response=await fetch(`${apiBase}/export/excel`,{method:'POST',headers:{'Content-Type':'application/json'},body});
    if(!response.ok) throw new Error(`Excel export failed (HTTP ${response.status}).`);
    return {blob:await response.blob()};
  }
  throw new Error(`Unsupported export format: ${format}`);
}
