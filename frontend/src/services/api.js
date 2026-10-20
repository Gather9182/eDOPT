import axios from 'axios';
import {optimizationJob} from '../utils/optimizationProgress';

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

export const historicalCalendar = async (start_date,end_date,resolution_min) =>
  (await api.get('/prices/historical-calendar',{params:{start_date,end_date,resolution_min}})).data;
export const historicalDayPrices = async (date,resolution_min) =>
  (await api.get('/prices/historical-day',{params:{date,resolution_min}})).data;

export const fetchAWattarPrices = async (date) => {
  const response = await api.get(`/prices/awattar?date=${date}`);
  return response.data;
};

export const getPricesForOptimization = async (date, horizon, resolution) => {
  const response = await api.post(`/prices/process-optimization-data?date=${date}&horizon_hours=${horizon}&resolution_min=${resolution}`);
  return response.data;
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
