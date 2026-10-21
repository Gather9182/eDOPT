import {flatRateQuotes} from '../utils/flatRate.js';
import axios from 'axios';
import {optimizationJob,checkOptimizationCancelled} from '../utils/optimizationProgress';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:8000/api`;

const api = axios.create({
  baseURL: API_BASE,
});

export const preScanExcel = async (file, sheetName = null) => {
  const formData = new FormData();
  formData.append('file', file);
  if (sheetName) formData.append('sheet_name', sheetName);
  const response = await api.post('/data/pre-scan-excel', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const processExcel = async (file, roundTo30 = false, settings = null) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('round_to_30', roundTo30);
  
  if (settings) {
    formData.append('settings', JSON.stringify(settings));
  }
  
  const response = await api.post('/data/process-excel', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const runOptimization = async (inputs, {onProgress,signal} = {}) => {
  if (onProgress) return optimizationJob(inputs,{
    start:async body => (await api.post('/optimize/jobs',body,{timeout:15000})).data,
    get:async id => (await api.get(`/optimize/jobs/${id}`,{timeout:10000})).data,
    cancel:async id => (await api.post(`/optimize/jobs/${id}/cancel`,null,{timeout:10000})).data,
  },onProgress,undefined,{signal});
  const response = await api.post('/optimize', inputs);
  return response.data;
};

export const validateInputs = async (inputs) => {
  const response = await api.post('/data/validate', inputs, { params: { include_diagnostics: true } });
  return response.data;
};

export const optimizationCapabilities = async () => (await api.get('/optimize/capabilities')).data;

export const historicalCalendar = async (start_date,end_date,resolution_min) =>
  (await api.get('/prices/historical-calendar',{params:{start_date,end_date,resolution_min}})).data;
export const historicalDayPrices = async (date,resolution_min,signal,priceWindowMinutes=15) =>
  (await api.get('/prices/historical-day',{params:{date,resolution_min,price_window_minutes:priceWindowMinutes},signal})).data;

export const historicalPriceCoverage = async (first,last,resolution=15) =>
  (await api.get('/prices/historical-coverage',{params:{first,last,resolution}})).data;

export async function prepareHistoricalPrices(first,last,resolution=15,{signal,onProgress=()=>{},allowFallback=false,refresh=false}={}) {
  const {job_id}=(await api.post('/prices/historical-prepare',{first,last,resolution,allow_fallback:allowFallback,refresh},{signal})).data;
  for (;;) {
    const state=(await api.get(`/prices/historical-prepare/${job_id}`,{signal})).data;
    onProgress(state);
    if(state.status==='failed') throw new Error(`${state.error.code}: ${state.error.message}`);
    if(state.status==='completed') return state.result;
    await new Promise(resolve=>setTimeout(resolve,700));
    if(signal?.aborted) {const error=new Error('Price preparation wait cancelled.');error.code='OPTIMIZATION_CANCELLED';throw error;}
  }
}

export async function importSmardCsv(file,timezone) {
  const form=new FormData();form.append('file',file);form.append('timezone',timezone);
  return (await api.post('/prices/historical-smard-csv',form)).data;
}

export const fetchAWattarPrices = async (date) => {
  const response = await api.get(`/prices/awattar?date=${date}`);
  return response.data;
};

export const getPricesForOptimization = async (date, horizon, resolution,{source='smard',allowFallback=false,priceWindowMinutes=15,flatRateEnabled=false,flatRateEurKwh=null,signal,onProgress}={}) => {
  if(flatRateEnabled) return {...flatRateQuotes(date,horizon,resolution,flatRateEurKwh),request_selection:{source,allowFallback,priceWindowMinutes}};
  if(source==='smard') {
    const last=new Date(`${date}T00:00:00Z`);last.setUTCDate(last.getUTCDate()+Math.ceil(horizon/24)-1);
    await prepareHistoricalPrices(date,last.toISOString().slice(0,10),resolution,{signal,onProgress,allowFallback});
  }
  const response = await api.post('/prices/process-optimization-data',null,{params:{date,horizon_hours:horizon,resolution_min:resolution,source,price_window_minutes:priceWindowMinutes},signal});
  return {...response.data,request_selection:{source,allowFallback,priceWindowMinutes}};
};

export const exportExcel = async (results) => {
  const response = await api.post('/export/excel', results, {
    responseType: 'blob'
  });
  return response.data;
};

export default {
  preScanExcel,
  processExcel,
  runOptimization,
  validateInputs,
  fetchAWattarPrices,
  getPricesForOptimization,
  exportExcel,
};

export const historicalWeatherDay=async(date,options,signal)=>(await api.get('/weather/day',{params:{date,...options},signal})).data;
export const historicalWeatherCoverage=async(options,signal)=>(await api.get('/weather/coverage',{params:options,signal})).data;
export async function prepareHistoricalWeather(options,{signal,onProgress=()=>{}}={}) {
  try {
  const {job_id}=(await api.post('/weather/prepare',options,{signal})).data;
  for(;;) {
    const state=(await api.get(`/weather/prepare/${job_id}`,{signal})).data;onProgress(state);
    if(state.status==='completed') return state.result;
    if(state.status==='failed') throw new Error(`${state.error.code}: ${state.error.message}`);
    await new Promise(resolve=>setTimeout(resolve,700));
    if(signal?.aborted) {const error=new Error('Weather preparation wait cancelled.');error.code='OPTIMIZATION_CANCELLED';throw error;}
  }
  } catch(error) {checkOptimizationCancelled(signal);throw error;}
}
