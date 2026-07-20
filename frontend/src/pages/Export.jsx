import React, { useState, useEffect } from 'react';
import { 
  Download, FileText, Table as TableIcon, Share2, 
  AlertCircle, ChevronRight, Play, Loader2, Sparkles, CheckCircle2, ShieldAlert, Palette
} from 'lucide-react';
import { getItem } from '../utils/db';
import { exportExcel } from '../services/api';
import { BRANDING } from '../components/PrintReportTemplate';

const getFormattedFilename = (results, ext) => {
  if (!results) return `eDOPT_baseline-Shortterm_010126.${ext}`;
  
  let scenario = results.scenario || 'baseline';
  if (scenario === 'depot') scenario = 'baseline';
  if (scenario === 'pv_bess') scenario = 'pvbess';
  
  const term = results.is_long_term ? 'Longterm' : 'Shortterm';
  
  let dateStr = results.run_metadata?.inputs?.start_date || 
                results.run_metadata?.settings?.longTermConfig?.startDate || 
                results.run_metadata?.inputs?.pv_config?.reference_date ||
                results.run_metadata?.inputs?.reference_date ||
                results.run_metadata?.timestamp;
                
  if (!dateStr) {
    dateStr = new Date().toISOString();
  }
  
  let formattedDate = '010126';
  try {
    const dateObj = new Date(dateStr);
    if (!isNaN(dateObj.getTime())) {
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = String(dateObj.getFullYear()).slice(-2);
      formattedDate = `${day}${month}${year}`;
    }
  } catch (e) {
    console.error("Error formatting date for filename:", e);
  }
  
  return `eDOPT_${scenario}-${term}_${formattedDate}.${ext}`;
};

const Export = ({ projectData }) => {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null); // 'excel', 'csv', 'json', 'pdf'
  const [downloadSuccess, setDownloadSuccess] = useState(null);

  useEffect(() => {
    const loadResults = async () => {
      setLoading(true);
      try {
        const storedResults = await getItem('optimization_results');
        setResults(storedResults);
      } catch (err) {
        console.error("Failed to load results:", err);
      } finally {
        setLoading(false);
      }
    };
    loadResults();
  }, []);

  const triggerSuccessAlert = (type) => {
    setDownloadSuccess(type);
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  const handleDownloadExcel = async () => {
    if (!results) return;
    setDownloading('excel');
    try {
      // Append co2 factor dynamically from projectData config if not stored in metadata
      const payload = { ...results };
      if (!payload.run_metadata) payload.run_metadata = {};
      if (!payload.run_metadata.inputs) payload.run_metadata.inputs = {};
      payload.run_metadata.inputs.co2_emission_factor = projectData.meta?.co2_emission_factor ?? 400.0;
      
      const blob = await exportExcel(payload);
      
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      
      link.setAttribute('download', getFormattedFilename(results, 'xlsx'));
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      triggerSuccessAlert('excel');
    } catch (err) {
      console.error("Excel download failed:", err);
      alert("Failed to export Excel file. Please ensure the backend server is running.");
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadCSV = () => {
    if (!results) return;
    setDownloading('csv');
    try {
      const prices = results.electricity_prices || [];
      const mPrices = results.market_prices || [];
      const load = results.aggregated_load_profile || [];
      const baseLoad = results.baseline_aggregated_load_profile || [];
      const gridImport = results.grid_import_profile || [];
      const pvYield = results.pv_yield_profile || [];
      const bessSoc = results.bess_soc_profile || [];
      const cellTemp = results.bess_cell_temperature_profile_c || [];
      const ambientTemp = results.ambient_temperature_profile_c || [];

      // Generate Headers
      let headers = ['Period_Index', 'Price_EUR_MWh', 'Optimized_Grid_Load_kW'];
      if (mPrices.length > 0) headers.push('Market_Price_EUR_MWh');
      if (baseLoad.length > 0) headers.push('Baseline_Load_kW');
      if (gridImport.length > 0) headers.push('Net_Grid_Import_kW');
      if (pvYield.length > 0) headers.push('PV_Generation_kW');
      if (bessSoc.length > 0) headers.push('BESS_SoC_kWh');
      if (ambientTemp.length > 0) headers.push('Ambient_Temp_C');
      if (cellTemp.length > 0) headers.push('BESS_Cell_Temp_C');

      const csvRows = [headers.join(',')];

      for (let t = 0; t < prices.length; t++) {
        const row = [t + 1, prices[t], load[t] || 0];
        if (mPrices.length > 0) row.push(mPrices[t] || 0);
        if (baseLoad.length > 0) row.push(baseLoad[t] || 0);
        if (gridImport.length > 0) row.push(gridImport[t] || 0);
        if (pvYield.length > 0) row.push(pvYield[t] || 0);
        if (bessSoc.length > 0) row.push(bessSoc[t] || 0);
        if (ambientTemp.length > 0) row.push(ambientTemp[t] || 0);
        if (cellTemp.length > 0) row.push(cellTemp[t] || 0);
        
        csvRows.push(row.join(','));
      }

      const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", getFormattedFilename(results, 'csv'));
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      triggerSuccessAlert('csv');
    } catch (err) {
      console.error("CSV download failed:", err);
      alert("Failed to export CSV timeseries.");
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadJSON = () => {
    if (!results) return;
    setDownloading('json');
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      
      downloadAnchor.setAttribute("download", getFormattedFilename(results, 'json'));
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      triggerSuccessAlert('json');
    } catch (err) {
      console.error("JSON download failed:", err);
      alert("Failed to export JSON.");
    } finally {
      setDownloading(null);
    }
  };



  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-primary" size={40} />
        <p className="text-secondary text-sm font-medium">Reading simulation databases...</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="export-container animate-in max-w-3xl mx-auto py-12">
        <div className="card border-dashed border-2 flex flex-col items-center text-center p-12 bg-app/50 backdrop-blur">
          <div className="w-16 h-16 rounded-full bg-primary-soft flex items-center justify-center text-primary mb-6">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-bold text-primary mb-2">No Simulation Results Found</h2>
          <p className="text-secondary text-sm max-w-md mb-8 leading-relaxed">
            The optimization engine has not been run yet, or previous results were cleared. Run a single-horizon optimization or long-term simulation to export styled reports and datasets.
          </p>
          <a href="#run" className="btn btn-primary px-8 py-3 shadow-lg flex items-center gap-2 group">
            Go to Optimization Run <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    );
  }

  // Active run stats
  const scenario = results.scenario || 'baseline';
  const isLongTerm = results.is_long_term || false;
  const cost = results.total_cost_eur || 0.0;
  const baseCost = results.baseline_cost_eur || 0.0;
  const savings = baseCost - cost;
  const savingsPct = baseCost > 0 ? (savings / baseCost) * 100 : 0.0;
  const peak = results.peak_load_kw || 0.0;
  
  const co2Factor = projectData.meta?.co2_emission_factor ?? 400.0;
  const energyMwh = results.total_energy_mwh || 0.0;
  const co2EmissionsT = (energyMwh * 1000 * co2Factor) / 1e6;
  const baseLoadProfile = results.baseline_aggregated_load_profile || [];
  const resolution = results.run_metadata?.inputs?.time_step_minutes || projectData.meta?.time_resolution || 15;
  const dt = (resolution / 60.0);
  const baseEnergyMwh = baseLoadProfile.length > 0 ? (baseLoadProfile.reduce((a, b) => a + b, 0) * dt / 1000.0) : energyMwh;
  const baseCo2EmissionsT = (baseEnergyMwh * 1000 * co2Factor) / 1e6;
  const co2SavedT = baseCo2EmissionsT - co2EmissionsT;

  const exportOptions = [
    { 
      id: 'excel',
      title: 'Formatted Excel Spreadsheet', 
      format: 'XLSX', 
      icon: <TableIcon size={24} />, 
      desc: 'Multi-tab spreadsheet featuring summary charts, colored diagnostic health columns, specific individual bus charging schedules, and numerical calculations.',
      action: handleDownloadExcel
    },
    { 
      id: 'csv',
      title: 'Flat Timeseries Dataset', 
      format: 'CSV', 
      icon: <TableIcon size={24} />, 
      desc: 'Standard comma-separated matrix detailing electricity price profiles, local grid import load, PV gen, and BESS variables per time step.',
      action: handleDownloadCSV
    },
    { 
      id: 'json',
      title: 'Raw Technical JSON Payload', 
      format: 'JSON', 
      icon: <Share2 size={24} />, 
      desc: 'Raw JSON database file including all simulation inputs, solver gaps, timestamps, and profiles for custom mathematical processing.',
      action: handleDownloadJSON
    },
  ];

  return (
    <div className="export-container animate-in pb-12 max-w-6xl mx-auto">
      <div className="section-header mb-8">
        <h1>Export & Reports</h1>
        <p>Download structured optimization results and formatted tables for further calculations.</p>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Active Simulation Summary Info */}
        <div className="card col-span-2 shadow-sm border-l-4 border-l-primary flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="card-title text-primary flex items-center gap-2">
                <Sparkles size={18} /> Active Dataset Metadata
              </h3>
              <span className="badge badge-primary uppercase font-bold text-[10px]">
                {isLongTerm ? `${results.total_days} Days Simulation` : 'Single Day (24h)'}
              </span>
            </div>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="metadata-label">Scenario</span>
                <span className="metadata-value capitalize">{scenario.replace('_', ' ')}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Total Savings</span>
                <span className="metadata-value success">
                  €{savings.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({savingsPct.toFixed(1)}%)
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">CO2 Reductions</span>
                <span className="metadata-value success">
                  {co2SavedT.toFixed(3)} t CO2
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Peak Load</span>
                <span className="metadata-value">{peak.toFixed(1)} kW</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Energy Import</span>
                <span className="metadata-value">{energyMwh.toFixed(2)} MWh</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">CO2 Factor</span>
                <span className="metadata-value">{co2Factor} g/kWh</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-secondary bg-app/50 p-3 rounded-lg border border-border mt-4">
            <CheckCircle2 size={16} className="text-success flex-shrink-0" />
            <span>This dataset matches the parameters configured in the <b>Model Parameters</b> dashboard.</span>
          </div>
        </div>

        {/* Branding Configurations - Interchangeability Panel */}
        <div className="card shadow-sm border-l-4 border-l-[#a855f7] flex flex-col justify-between">
          <div>
            <h3 className="card-title text-[#a855f7] flex items-center gap-2 mb-3">
              <Palette size={18} /> Interchangeable Branding
            </h3>
            <p className="text-xs text-secondary leading-relaxed mb-4">
              The report configuration supports dynamic style definitions. System variables can be adjusted inside the template code to modify color schemes, fonts, and labels.
            </p>
            <div className="flex flex-col gap-2 font-mono text-[10px] bg-app p-3 rounded-lg border border-border">
              <div className="flex justify-between">
                <span className="text-muted">primaryColor:</span>
                <span className="font-bold text-text-primary" style={{ color: BRANDING.primaryColor }}>{BRANDING.primaryColor}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">secondaryColor:</span>
                <span className="font-bold text-text-primary" style={{ color: BRANDING.secondaryColor }}>{BRANDING.secondaryColor}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">logoText:</span>
                <span className="font-bold text-text-primary">"{BRANDING.logoText}"</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">fontFamily:</span>
                <span className="font-bold text-text-primary">Calibri / Inter</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted italic flex items-center gap-1.5 mt-2">
            <span>Branding parameters ready for integration.</span>
          </div>
        </div>
      </div>

      {/* Grid of Export Options */}
      <div className="grid grid-cols-3 gap-6">
        {exportOptions.map((opt) => {
          const isDownloadingThis = downloading === opt.id;
          const isSuccessThis = downloadSuccess === opt.id;
          
          return (
            <div key={opt.id} className="card export-card group flex flex-col justify-between">
              <div className="flex gap-6 mb-6">
                <div className="export-icon-bg transition-transform group-hover:scale-105">
                  {opt.icon}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-base font-bold text-text-primary">{opt.title}</h3>
                    <span className="badge badge-outline text-[10px] font-bold px-2 py-0.5">{opt.format}</span>
                  </div>
                  <p className="text-secondary text-xs leading-relaxed">{opt.desc}</p>
                </div>
              </div>
              
              <button 
                onClick={opt.action}
                disabled={downloading !== null}
                className={`btn ${isSuccessThis ? 'btn-success' : 'btn-outline'} btn-sm w-full py-2.5 flex items-center justify-center gap-2 transition-all`}
              >
                {isDownloadingThis ? (
                  <>
                    <Loader2 className="animate-spin" size={16} /> Compiling File...
                  </>
                ) : isSuccessThis ? (
                  <>
                    <CheckCircle2 size={16} /> File Exported
                  </>
                ) : (
                  <>
                    <Download size={15} /> Export {opt.format}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .col-span-2 {
          grid-column: span 2;
        }

        .metadata-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px 20px;
          margin-bottom: 8px;
          margin-top: 8px;
        }

        .metadata-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .metadata-label {
          font-size: 10px;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--text-muted, #6b7280);
          letter-spacing: 0.05em;
        }

        .metadata-value {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary, #111827);
        }

        .metadata-value.success {
          color: var(--success, #10b981);
        }

        .export-icon-bg {
          width: 56px;
          height: 56px;
          background: var(--bg-app);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
          flex-shrink: 0;
          border: 1px solid var(--border-light);
        }

        .export-card {
          transition: all 0.3s ease;
          min-height: 190px;
        }

        .export-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
          border-color: var(--primary-soft);
        }
        
        .btn-success {
          background-color: var(--success, #10b981) !important;
          color: white !important;
          border-color: var(--success, #10b981) !important;
        }
      `}} />
    </div>
  );
};

export default Export;
