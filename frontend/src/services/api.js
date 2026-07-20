import axios from 'axios';

const API_BASE = `http://${window.location.hostname}:8000/api`;

const api = axios.create({
  baseURL: API_BASE,
});

export const preScanExcel = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
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

export const runOptimization = async (inputs) => {
  const response = await api.post('/optimize', inputs);
  return response.data;
};

export const validateInputs = async (inputs) => {
  const response = await api.post('/data/validate', inputs);
  return response.data;
};

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
