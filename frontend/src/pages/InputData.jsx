import React, { useState } from 'react';
import { Upload, Table as TableIcon, Plus, Save, AlertCircle, Loader2, FileSpreadsheet, Check, Zap, Download, Clock, TrendingUp, Info, Circle, Settings, Battery, MapPin, ArrowRight } from 'lucide-react';
import { preScanExcel, processExcel, fetchAWattarPrices, getPricesForOptimization } from '../services/api';
import { mapExcelToBuses } from '../utils/dataMapping';
import PriceChart from '../components/PriceChart';

const InfoTooltip = ({ title, text, align = 'center' }) => (
  <div className="tooltip-container">
    <Info size={11} className="tooltip-trigger" />
    <div className={`tooltip-box tooltip-${align}`}>
      {title && <div className="tooltip-title">{title}</div>}
      <div className="tooltip-text">{text}</div>
    </div>
  </div>
);

const InputData = ({ projectData, setProjectData, setActiveTab }) => {
  const [activeSubTab, setActiveSubTab] = useState('umlaufplan');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState('trips');
  const [currentExcelResult, setCurrentExcelResult] = useState(null);
  const [roundWindows, setRoundWindows] = useState(false);
  const [defaultEnergy, setDefaultEnergy] = useState(projectData.meta.default_energy_demand || 180);
  const [initialSoc, setInitialSoc] = useState(projectData.meta.initial_soc_fraction * 100 || 100);
  const [minFinalSoc, setMinFinalSoc] = useState(projectData.meta.min_final_soc_fraction * 100 || 20);

  const [uploadedFile, setUploadedFile] = useState(null);
  const [suggestedDepots, setSuggestedDepots] = useState([]);
  const [selectedDepots, setSelectedDepots] = useState([]);
  const [allNodes, setAllNodes] = useState([]);
  const [showDepotConfig, setShowDepotConfig] = useState(false);

  const tabs = [
    { id: 'umlaufplan', label: 'Umlaufplan' },
    { id: 'constraints', label: 'Constraints' },
    { id: 'pricing', label: 'Electricity Pricing' },
  ];

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadedFile(file);
    setIsProcessing(true);
    try {
      const scanResult = await preScanExcel(file);
      setSuggestedDepots(scanResult.suggested_depot_nodes || []);
      setSelectedDepots(scanResult.suggested_depot_nodes || []);
      setAllNodes(scanResult.all_nodes || []);
      setShowDepotConfig(true);
    } catch (err) {
      console.error(err);
      alert('Error reading Excel file. Please check format.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessClick = async () => {
    if (!uploadedFile) return;
    setIsProcessing(true);
    try {
      const specs = {};
      const typeConfigs = projectData.meta.vehicle_types_config || {};
      
      Object.keys(typeConfigs).forEach(type => {
        const config = typeConfigs[type];
        if (typeof config === 'object') {
          specs[type] = {
            consumption_wh_per_m: config.consumption,
            battery_capacity_kwh: config.battery
          };
        } else {
          specs[type] = {
            consumption_wh_per_m: Number(config),
            battery_capacity_kwh: projectData.constraints.max_battery_capacity_kwh
          };
        }
      });

      const settings = {
        VEHICLE_TYPE_SPECS: specs,
        DEFAULT_CONSUMPTION_WH_PER_M: projectData.meta.default_consumption_wh_m,
        DEFAULT_BATTERY_CAPACITY_KWH: projectData.constraints.max_battery_capacity_kwh,
        INITIAL_SOC_FRACTION: initialSoc / 100,
        MIN_FINAL_SOC_FRACTION: minFinalSoc / 100,
        DEPOT_NODES: selectedDepots
      };

      const data = await processExcel(uploadedFile, roundWindows, settings);
      setCurrentExcelResult(data);
      setActiveResultTab('trips');
    } catch (err) {
      console.error(err);
      alert('Error processing Excel file. Please ensure the backend is running and the file format is correct.');
    } finally {
      setIsProcessing(false);
    }
  };

  const applyToProject = () => {
    if (!currentExcelResult || !currentExcelResult.bus_inputs) return;

    // Use the pre-calculated bus inputs from the backend, 
    // adding global constraints for power and efficiency
    const mappedBuses = currentExcelResult.bus_inputs.map(bus => ({
      ...bus,
      max_power_kw: Number(projectData.constraints.max_power_per_bus),
      efficiency: Number(projectData.constraints.efficiency),
      // Ensure IDs are strings
      id: String(bus.id)
    }));

    setProjectData(prev => ({
      ...prev,
      buses: mappedBuses,
      constraints: {
        ...prev.constraints,
        max_power_per_bus: projectData.constraints.max_power_per_bus,
        max_battery_capacity_kwh: projectData.constraints.max_battery_capacity_kwh,
        efficiency: projectData.constraints.efficiency
      },
      meta: {
        ...prev.meta,
        last_upload: new Date().toISOString(),
        charger_capacity_kw: projectData.constraints.charger_capacity_kw,
        grid_limit_kw: projectData.constraints.grid_limit_kw,
        initial_soc_fraction: initialSoc / 100,
        min_final_soc_fraction: minFinalSoc / 100,
        num_chargers: projectData.constraints.num_chargers,
        planning_horizon: 24,
        time_resolution: 15
      }
    }));

    alert('Data successfully integrated with SoC profiles! You can now run the optimization.');
  };

  return (
    <div className="input-container animate-in">
      <div className="section-header flex justify-between items-center">
        <div>
          <h1>Input Data Management</h1>
          <p>Upload your Umlaufplan and synchronize with electricity market prices.</p>
        </div>
        <button 
          className="btn btn-primary px-6 py-2 shadow-lg flex items-center gap-2 group"
          onClick={() => setActiveTab('run')}
        >
          <span className="font-bold text-sm">Continue to Settings</span>
          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="tab-header mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeSubTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeSubTab === 'umlaufplan' && (
          <UmlaufplanTab
            isProcessing={isProcessing}
            processedData={currentExcelResult}
            setProcessedData={setCurrentExcelResult}
            handleFileUpload={handleFileUpload}
            activeResultTab={activeResultTab}
            setActiveResultTab={setActiveResultTab}
            defaultEnergy={defaultEnergy}
            setDefaultEnergy={setDefaultEnergy}
            applyToProject={applyToProject}
            projectStatus={projectData.meta.data_source}
            roundWindows={roundWindows}
            setRoundWindows={setRoundWindows}
            initialSoc={initialSoc}
            setInitialSoc={setInitialSoc}
            minFinalSoc={minFinalSoc}
            setMinFinalSoc={setMinFinalSoc}
            showDepotConfig={showDepotConfig}
            setShowDepotConfig={setShowDepotConfig}
            suggestedDepots={suggestedDepots}
            selectedDepots={selectedDepots}
            setSelectedDepots={setSelectedDepots}
            allNodes={allNodes}
            uploadedFile={uploadedFile}
            handleProcessClick={handleProcessClick}
          />
        )}
        {activeSubTab === 'constraints' && (
          <ConstraintsTab
            projectData={projectData}
            setProjectData={setProjectData}
            activeExcelData={currentExcelResult}
          />
        )}
        {activeSubTab === 'pricing' && (
          <PricingTab
            projectData={projectData}
            setProjectData={setProjectData}
          />
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .tab-header {
          display: flex;
          gap: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .tab-btn {
          padding: 1rem 1.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-muted);
          position: relative;
          transition: all 0.2s;
        }

        .tab-btn:hover {
          color: var(--text-primary);
        }

        .tab-btn.active {
          color: var(--primary);
        }

        .tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary);
        }

        .upload-area {
          border: 2px dashed var(--border);
          border-radius: 12px;
          padding: 3rem 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
          background: var(--bg-surface);
          transition: all 0.2s;
          cursor: pointer;
          position: relative;
          text-align: center;
        }

        .upload-area:hover {
          border-color: var(--primary);
          background: var(--primary-soft);
        }

        .upload-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .result-tabs {
          display: flex;
          gap: 0.25rem;
          padding: 0.25rem;
          background: var(--bg-app);
          border-radius: 10px;
          width: fit-content;
        }

        .result-tab-btn {
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 8px;
          transition: all 0.2s;
          color: var(--text-muted);
        }

        .result-tab-btn.active {
          background: var(--bg-surface);
          color: var(--primary);
          box-shadow: var(--shadow-sm);
        }

        .depot-config-card {
          background: var(--bg-surface);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid var(--border);
          margin-bottom: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .depot-config-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--primary);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .depot-config-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .depot-section-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
          display: block;
        }

        .depot-pill-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .depot-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 1rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 9999px;
          border: 1px solid var(--border);
          background: var(--bg-app);
          color: var(--text-secondary);
          transition: all 0.2s;
          cursor: pointer;
        }

        .depot-pill:hover {
          border-color: var(--primary);
          color: var(--primary);
        }

        .depot-pill.active {
          background: var(--primary-soft);
          border-color: var(--primary);
          color: var(--primary);
        }

        .depot-pill .check-icon {
          color: var(--primary);
        }

        .depot-select {
          width: 100%;
          background: var(--bg-app);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 0.75rem;
          padding: 0.5rem;
          height: 120px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.2s;
        }

        .depot-select:focus {
          border-color: var(--primary);
        }

        .depot-footer {
          display: flex;
          justify-content: flex-end;
          padding-top: 1rem;
          border-top: 1px solid var(--border-light);
        }
      `}} />
    </div>
  );
};

const UmlaufplanTab = ({
  isProcessing,
  processedData,
  setProcessedData,
  handleFileUpload,
  activeResultTab,
  setActiveResultTab,
  defaultEnergy,
  setDefaultEnergy,
  applyToProject,
  projectStatus,
  roundWindows,
  setRoundWindows,
  initialSoc,
  setInitialSoc,
  minFinalSoc,
  setMinFinalSoc,
  showDepotConfig,
  setShowDepotConfig,
  suggestedDepots,
  selectedDepots,
  setSelectedDepots,
  allNodes,
  uploadedFile,
  handleProcessClick
}) => {
  const [debugUmlaufId, setDebugUmlaufId] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);
  const [tableWidth, setTableWidth] = React.useState(0);
  const tableRef = React.useRef(null);
  const topScrollRef = React.useRef(null);
  const tableContainerRef = React.useRef(null);

  // Sync scroll positions
  const handleTopScroll = (e) => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleTableScroll = (e) => {
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  // Observe table width changes to update dummy scrollbar
  React.useEffect(() => {
    if (tableRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          setTableWidth(entry.contentRect.width);
        }
      });
      resizeObserver.observe(tableRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [processedData, activeResultTab, showAll]);

  const handleEnergyChange = (index, value) => {
    const newData = { ...processedData };
    newData.cleaned_trips[index].energy_demand = Number(value);
    setProcessedData(newData);
  };

  const handleExport = () => {
    if (!processedData) return;

    let csvContent = "";
    let filename = "";

    if (activeResultTab === 'trips') {
      const data = processedData.cleaned_trips;
      const headers = Object.keys(data[0]);
      csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => `"${(row[h] ?? "").toString().replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      filename = "cleaned_trips.csv";
    } else if (activeResultTab === 'windows') {
      const data = processedData.charging_windows;
      if (data.length === 0) return alert("No windows to export");
      const headers = Object.keys(data[0]);
      csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => `"${(row[h] ?? "").toString().replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      filename = "charging_windows.csv";
    } else if (activeResultTab === 'matrix') {
      const { index, columns, data } = processedData.availability_matrix;
      csvContent = [
        ['Umlauf', ...columns].join(','),
        ...index.map((label, i) => [label, ...data[i]].join(','))
      ].join('\n');
      filename = "availability_matrix.csv";
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Helper to build a chronological timeline for a specific Umlauf
  const getTimelineData = (umlaufId) => {
    if (!processedData || !umlaufId) return [];

    // Use loose equality (==) as Umlauf IDs can be string or number from Excel
    const trips = (processedData.cleaned_trips || [])
      .filter(t => t.Umlauf == umlaufId)
      .map(t => ({ ...t, eventType: 'trip', time: Number(t.start_min || 0) }));

    const windows = (processedData.charging_windows || [])
      .filter(w => w.Umlauf == umlaufId)
      .map(w => ({ ...w, eventType: 'window', time: Number(w.window_start_min || 0) }));

    const sorted = [...trips, ...windows].sort((a, b) => a.time - b.time);
    
    let runningDist = 0;
    let runningEnergy = 0;
    
    return sorted.map(event => {
      if (event.eventType === 'window') {
        runningDist = 0;
        runningEnergy = 0;
        return event;
      }
      runningDist += Number(event.Meter || 0);
      runningEnergy += Number(event.trip_energy_kwh || 0);
      return { ...event, runningDist, runningEnergy };
    });
  };

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="card-title text-primary"><TableIcon size={18} /> Umlaufplan Management</h3>
        {projectStatus === 'uploaded' && (
          <div className="flex items-center gap-2 text-success font-bold text-sm">
            <Check size={16} /> Data Active for Optimization
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6 p-4 bg-app rounded-xl border border-dashed border-primary/20">
        <input
          type="checkbox"
          id="round-toggle"
          className="form-checkbox h-5 w-5 text-primary rounded border-border"
          checked={roundWindows}
          onChange={(e) => setRoundWindows(e.target.checked)}
        />
        <label htmlFor="round-toggle" className="text-sm font-semibold cursor-pointer text-secondary">
          Round Charging Windows to next 30-min interval (Start UP / End DOWN)
        </label>
      </div>

      <div className="upload-area mb-6">
        {isProcessing ? (
          <>
            <Loader2 size={32} className="animate-spin" color="var(--primary)" />
            <p className="font-semibold">Processing Excel data...</p>
          </>
        ) : (
          <>
            <FileSpreadsheet size={32} color={uploadedFile ? "var(--success)" : "var(--primary)"} />
            <div className="text-center">
              {uploadedFile ? (
                <>
                  <p className="font-semibold text-success">File Selected: {uploadedFile.name}</p>
                  <p className="text-muted text-sm">Configure your depot nodes below, then click "Process timetable"</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Click or drag Excel (.xlsx) file here</p>
                  <p className="text-muted text-sm">Will generate Cleaned Trips, Charging Windows and Availability Matrix</p>
                </>
              )}
            </div>
            <input type="file" className="upload-input" accept=".xlsx" onChange={handleFileUpload} />
          </>
        )}
      </div>

      {showDepotConfig && (
        <div className="depot-config-card">
          <div className="depot-config-title">
            <MapPin size={16} /> Configure Depot Charging Nodes
          </div>
          <div className="depot-config-desc">
            Opportunity/depot charging will only be allowed when a vehicle is at these nodes.
          </div>
          
          <div>
            <span className="depot-section-label">SUGGESTED DEPOTS (From A/E trips):</span>
            {suggestedDepots.length > 0 ? (
              <div className="depot-pill-container">
                {suggestedDepots.map(node => {
                  const isChecked = selectedDepots.includes(node);
                  return (
                    <button
                      key={node}
                      type="button"
                      onClick={() => {
                        if (isChecked) {
                          setSelectedDepots(selectedDepots.filter(n => n !== node));
                        } else {
                          setSelectedDepots([...selectedDepots, node]);
                        }
                      }}
                      className={`depot-pill ${isChecked ? 'active' : ''}`}
                    >
                      {node}
                      {isChecked && <Check size={12} className="check-icon" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-xs text-muted italic">No depot nodes automatically detected.</span>
            )}
          </div>
          
          <div>
            <span className="depot-section-label">ALL TIMETABLE NODES:</span>
            <select
              multiple
              className="depot-select"
              value={selectedDepots}
              onChange={(e) => {
                const vals = Array.from(e.target.selectedOptions, option => option.value);
                setSelectedDepots(vals);
              }}
            >
              {allNodes.map(node => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
            <span className="text-[10px] text-muted block mt-1">
              Hold Ctrl (Windows) or Cmd (Mac) to select multiple custom nodes.
            </span>
          </div>

          <div className="depot-footer">
            {uploadedFile && (
              <button
                onClick={handleProcessClick}
                disabled={isProcessing}
                className="btn btn-primary text-xs py-2 px-4 flex items-center gap-2 font-bold shadow-md hover:shadow-lg transition-all"
              >
                <Zap size={14} /> Process timetable
              </button>
            )}
          </div>
        </div>
      )}

      {processedData && processedData.validation_results && processedData.validation_results.warnings.length > 0 && (
        <div className="mb-4">
          <div className="p-4 bg-warning-soft border border-warning/20 rounded-t-lg">
            <div className="flex items-center gap-2 mb-2 font-bold text-warning">
              <AlertCircle size={18} />
              Potential Data Quality Issues Identified:
            </div>
            <ul className="text-xs space-y-2 text-secondary">
              {processedData.validation_results.warnings.map((warning, i) => (
                <li key={i} className="flex items-center justify-between gap-4">
                  <span>• {warning.message}</span>
                  {warning.umlauf && (
                    <button 
                      onClick={() => setDebugUmlaufId(debugUmlaufId === warning.umlauf ? null : warning.umlauf)}
                      className={`btn btn-sm py-1 px-3 h-auto text-[10px] font-bold uppercase tracking-wider ${debugUmlaufId === warning.umlauf ? 'btn-primary' : 'btn-outline'}`}
                    >
                      {debugUmlaufId === warning.umlauf ? 'Close Diagnostic' : 'Inspect Timeline'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          
          {debugUmlaufId && (
            <div className="p-6 bg-surface border-x border-b border-warning/20 rounded-b-lg animate-in">
              <div className="flex items-center justify-between mb-6">
                <h4 className="text-sm font-bold text-secondary">Diagnostic Timeline: Umlauf {debugUmlaufId}</h4>
                <div className="flex gap-4 text-[10px] font-bold uppercase text-muted">
                  <div className="flex items-center gap-1"><Circle size={8} fill="var(--primary)" stroke="none" /> Normal Trip</div>
                  <div className="flex items-center gap-1"><Circle size={8} fill="var(--success)" stroke="none" /> Depot Window</div>
                  <div className="flex items-center gap-1"><Circle size={8} fill="var(--error)" stroke="none" /> Overlap/Conflict</div>
                </div>
              </div>
              
              <div className="space-y-3 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border/60">
                {getTimelineData(debugUmlaufId).map((event, idx, arr) => {
                  const isOverlap = event.eventType === 'trip' && idx < arr.length - 1 && event.end_min > arr[idx+1].time;
                  const isEnergyExceeded = event.eventType === 'trip' && event.runningEnergy > (event.battery_capacity_kwh || 500);

                  return (
                    <div key={idx} className="flex gap-4 items-start relative z-10">
                      <div className={`mt-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 bg-surface flex-shrink-0 ${
                        isOverlap || isEnergyExceeded ? 'border-error text-error' : 
                        event.eventType === 'trip' ? 'border-primary text-primary' : 'border-success text-success'
                      }`}>
                        {event.eventType === 'trip' ? <MapPin size={10} /> : <Zap size={10} />}
                      </div>
                      
                      <div className={`flex-1 p-3 rounded-xl border ${
                        isOverlap || isEnergyExceeded ? 'bg-error-soft border-error/20' : 'bg-app/30 border-border/40'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs font-bold text-secondary">
                            {event.eventType === 'trip' ? `${event.start_hhmm} - ${event.end_hhmm}` : `${event.window_start_hhmm} - ${event.window_end_hhmm}`}
                          </span>
                          <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
                            isOverlap || isEnergyExceeded ? 'bg-error text-white' : 
                            event.eventType === 'trip' ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success'
                          }`}>
                            {event.eventType === 'trip' ? 'Service Trip' : 'Charging Window'}
                          </span>
                        </div>
                        
                        <div className="text-xs text-secondary font-medium">
                          {event.eventType === 'trip' ? (
                            <div className="flex justify-between items-start gap-4">
                               <div className="flex-1">
                                 Route: <span className="text-muted">{event.von}</span> → <span className="text-muted">{event.nach}</span>
                               </div>
                               <div className="text-[10px] text-right space-y-0.5 whitespace-nowrap">
                                 <div className="text-muted">Dist: <span className="text-secondary">{(event.Meter/1000).toFixed(1)} km</span> (Block: <span className="text-primary-dark font-bold">{(event.runningDist/1000).toFixed(1)} km</span>)</div>
                                 <div className="text-muted">Usage: <span className="text-secondary">{event.trip_energy_kwh?.toFixed(1)} kWh</span> (Block: <span className={`${isEnergyExceeded ? 'text-error animate-pulse' : 'text-primary-dark'} font-bold`}>{event.runningEnergy?.toFixed(1)} kWh</span>)</div>
                               </div>
                            </div>
                          ) : (
                            <>Depot Stay: <span className="text-muted">{event.duration_min} min</span></>
                          )}
                        </div>
                        
                        {isOverlap && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-error">
                            <AlertCircle size={12} />
                            CONFLICT: Ends after next event starts ({arr[idx+1].eventType === 'trip' ? arr[idx+1].start_hhmm : arr[idx+1].window_start_hhmm})
                          </div>
                        )}

                        {isEnergyExceeded && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-error">
                            <Battery size={12} />
                            CAPACITY EXCEEDED: Block energy ({event.runningEnergy.toFixed(1)} kWh) exceeds battery limit ({event.battery_capacity_kwh} kWh)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {processedData && (
        <div className="processed-results-section animate-in">
          <div className="settings-strip mb-8 p-6 bg-app/50 rounded-xl border border-border/60">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-8">
                <div className="form-group mb-0">
                  <label className="form-label text-xs uppercase tracking-wider font-bold text-muted">Default Energy Demand (kWh)</label>
                  <input
                    type="number"
                    className="form-input py-2 px-4 shadow-sm"
                    style={{ width: '80px' }}
                    value={defaultEnergy}
                    onChange={(e) => setDefaultEnergy(e.target.value)}
                  />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label text-[10px] uppercase tracking-wider font-bold text-muted">Initial SoC (%)</label>
                  <input
                    type="number"
                    className="form-input py-2 px-4 shadow-sm"
                    style={{ width: '70px' }}
                    value={initialSoc}
                    onChange={(e) => setInitialSoc(e.target.value)}
                  />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label text-[10px] uppercase tracking-wider font-bold text-muted">Reserve (%)</label>
                  <input
                    type="number"
                    className="form-input py-2 px-4 shadow-sm"
                    style={{ width: '70px' }}
                    value={minFinalSoc}
                    onChange={(e) => setMinFinalSoc(e.target.value)}
                  />
                </div>
                <div className="text-muted text-sm border-l border-border pl-8">
                  Mapping <strong className="text-primary">{processedData.availability_matrix.index.length}</strong> buses.
                </div>
              </div>
              <button className="btn btn-primary px-6 py-2 shadow-md" onClick={applyToProject}>
                <Zap size={18} /> Use This Data for Optimization
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center mb-4">
            <div className="result-tabs">
              <button
                className={`result-tab-btn ${activeResultTab === 'trips' ? 'active' : ''}`}
                onClick={() => setActiveResultTab('trips')}
              >
                Cleaned Trips ({processedData.cleaned_trips.length})
              </button>
              <button
                className={`result-tab-btn ${activeResultTab === 'windows' ? 'active' : ''}`}
                onClick={() => setActiveResultTab('windows')}
              >
                Charging Windows ({processedData.charging_windows.length})
              </button>
              <button
                className={`result-tab-btn ${activeResultTab === 'matrix' ? 'active' : ''}`}
                onClick={() => setActiveResultTab('matrix')}
              >
                Availability Matrix
              </button>
            </div>
            <button
              className="btn btn-outline btn-sm flex items-center gap-2"
              onClick={handleExport}
              title="Download current data as CSV"
            >
              <Download size={14} /> Export as CSV
            </button>
          </div>

          <div className="flex flex-col">
            {/* Top Scrollbar Sync */}
            {(activeResultTab === 'trips' || activeResultTab === 'matrix') && (
              <div
                ref={topScrollRef}
                onScroll={handleTopScroll}
                className="overflow-x-auto w-full border-b border-app mb-1"
                style={{ overflowY: 'hidden', height: '12px' }}
              >
                <div style={{ width: tableWidth || '100%', height: '12px' }}></div>
              </div>
            )}

            <div
              className="data-table-container"
              ref={tableContainerRef}
              onScroll={handleTableScroll}
            >
              {activeResultTab === 'trips' && (
                <table className="data-table" ref={tableRef}>
                  <thead>
                    <tr>
                      <th>Umlauf</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Dur.</th>
                      <th>von</th>
                      <th>Start Name</th>
                      <th>nach</th>
                      <th>End Name</th>
                      <th>Assigned Type</th>
                      <th>Dist (m)</th>
                      <th>Energy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.cleaned_trips.slice(0, showAll ? undefined : 10).map((row, i) => (
                      <tr key={i}>
                        <td>{row.Umlauf}</td>
                        <td>{row.start_hhmm}</td>
                        <td>{row.end_hhmm}</td>
                        <td>{row.dur_min?.toFixed(1)}m</td>
                        <td>{row.von}</td>
                        <td><span className="text-xs text-muted truncate max-w-[100px] inline-block">{row['von (Beschreibung)']}</span></td>
                        <td>{row.nach}</td>
                        <td><span className="text-xs text-muted truncate max-w-[100px] inline-block">{row['nach (Beschreibung)']}</span></td>
                        <td><span className="text-xs font-bold text-secondary">{row.vehicle_type}</span></td>
                        <td><span className="text-xs">{row.Meter}</span></td>
                        <td>
                          <input
                          type="number"
                          className="form-input py-0 px-2 text-xs"
                          style={{ width: '80px' }}
                          value={row.energy_demand || defaultEnergy}
                          onChange={(e) => handleEnergyChange(i, e.target.value)}
                        />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeResultTab === 'windows' && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Umlauf</th>
                      <th>Window Start</th>
                      <th>Window End</th>
                      <th>Duration (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.charging_windows.map((row, i) => (
                      <tr key={i}>
                        <td>{row.Umlauf}</td>
                        <td>{row.window_start_hhmm}</td>
                        <td>{row.window_end_hhmm}</td>
                        <td>{(row.duration_min || 0).toFixed(1)}m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {activeResultTab === 'matrix' && (
                <table className="data-table border-collapse" ref={tableRef}>
                  <thead>
                    <tr>
                      <th className="sticky-col">Umlauf ID</th>
                      {processedData.availability_matrix.columns.map((col, i) => (
                        <th key={i} className="text-[10px] font-mono whitespace-nowrap px-1">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {processedData.availability_matrix.index.map((rowLabel, i) => (
                      <tr key={i}>
                        <td className="font-bold sticky-col">{rowLabel}</td>
                        {processedData.availability_matrix.data[i].map((val, j) => (
                          <td key={j} style={{ background: val === 1 ? 'var(--primary-soft)' : 'transparent', textAlign: 'center' }}>
                            {val === 1 ? '●' : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {activeResultTab === 'trips' && processedData.cleaned_trips.length > 10 && (
            <div className="mt-4 flex flex-col items-center gap-2">
              {!showAll && (
                <p style={{ fontSize: '11px' }} className="text-muted flex items-center gap-2 mb-1">
                  <Info size={12} className="text-primary" />
                  Showing initial 10 entries for performance.
                </p>
              )}
              <button
                className="btn btn-outline btn-sm text-xs font-bold border-dashed border-2 px-8 py-3 bg-app/20 hover:bg-app/40 transition-all text-secondary"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? 'Show Fewer (Collapse)' : `View All ${processedData.cleaned_trips.length} Entries`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ConstraintsTab = ({ projectData, setProjectData, activeExcelData }) => {
  const handleChange = (field, value) => {
    setProjectData(prev => ({
      ...prev,
      constraints: {
        ...prev.constraints,
        [field]: Number(value)
      }
    }));
  };

  const handleTypeConfigUpdate = (type, field, value) => {
    const currentConfig = projectData.meta.vehicle_types_config?.[type];
    let newConfig;
    
    if (typeof currentConfig === 'object' && currentConfig !== null) {
      newConfig = { ...currentConfig };
    } else {
      // Migrate from old format (number) or create new
      newConfig = { 
        consumption: Number(currentConfig) || projectData.meta.default_consumption_wh_m, 
        battery: projectData.constraints.max_battery_capacity_kwh 
      };
    }
    
    newConfig[field] = Number(value);
    
    setProjectData(prev => ({
      ...prev,
      meta: {
        ...prev.meta,
        vehicle_types_config: {
          ...prev.meta.vehicle_types_config,
          [type]: newConfig
        }
      }
    }));
  };

  // Extract unique vehicle types from active excel data
  const uniqueTypes = activeExcelData
    ? [...new Set(activeExcelData.cleaned_trips.map(t => t.vehicle_type).filter(Boolean))]
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6 items-stretch">
        <div className="card shadow-sm p-6 flex flex-col">
          <h3 className="card-title text-primary flex items-center gap-2 mb-6">
            <Settings size={18} />
            Depot Infrastructure
          </h3>
          
          <div className="space-y-6 flex-1">
            <div className="form-group mb-0">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Charger Capacity (kW)</label>
                <InfoTooltip title="Depot Power" text="The total simultaneous charging power available across all physical charging points at the depot." />
              </div>
              <input 
                className="form-input" 
                type="number" 
                style={{ width: '150px' }}
                value={projectData.constraints.charger_capacity_kw} 
                onChange={(e) => handleChange('charger_capacity_kw', e.target.value)}
              />
            </div>
            <div className="form-group mb-0">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Grid Limit (kW)</label>
                <InfoTooltip title="Utility Constraint" text="The maximum power draw allowed from the utility grid. Acts as a hard constraint to prevent peak-shaving penalties." />
              </div>
              <input 
                className="form-input" 
                type="number" 
                style={{ width: '150px' }}
                value={projectData.constraints.grid_limit_kw} 
                onChange={(e) => handleChange('grid_limit_kw', e.target.value)}
              />
            </div>
            <div className="form-group mb-0">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Charging Sockets (Count)</label>
                <InfoTooltip title="Physical Sockets" text="The maximum number of vehicles that can be physically plugged in and charging at the same time." />
              </div>
              <input 
                className="form-input" 
                type="number" 
                style={{ width: '150px' }}
                value={projectData.constraints.num_chargers || 50} 
                onChange={(e) => handleChange('num_chargers', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card shadow-sm p-6 flex flex-col">
          <h3 className="card-title text-primary flex items-center gap-2 mb-6">
            <Battery size={18} />
            Vehicle Properties (Global)
          </h3>
          <p className="card-description mb-6">Set global default values. You can override these per type below.</p>
          
          <div className="space-y-6 flex-1">
            <div className="form-group mb-0">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Max Battery Capacity (kWh)</label>
                <InfoTooltip title="Storage Limit" text="The physical storage limit of the vehicle batteries. The solver ensures state-of-charge never exceeds this value." />
              </div>
              <input 
                className="form-input" 
                type="number" 
                style={{ width: '150px' }}
                value={projectData.constraints.max_battery_capacity_kwh} 
                onChange={(e) => handleChange('max_battery_capacity_kwh', e.target.value)}
              />
              <p style={{ fontSize: '10px' }} className="text-muted mt-1 italic">Note: Physical limit for energy storage per vehicle.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Efficiency</label>
                  <InfoTooltip title="Charging Loss" text="The round-trip efficiency of the charging process (converters + storage losses)." />
                </div>
                <input
                  className="form-input"
                  type="number"
                  value={projectData.constraints.efficiency}
                  onChange={(e) => handleChange('efficiency', e.target.value)}
                  step="0.01"
                />
              </div>
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Max Power (kW)</label>
                  <InfoTooltip title="Power Limit" text="The peak charging power an individual vehicle can receive." />
                </div>
                <input
                  className="form-input"
                  type="number"
                  value={projectData.constraints.max_power_per_bus}
                  onChange={(e) => handleChange('max_power_per_bus', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm p-6">
        <h3 className="card-title text-primary flex items-center gap-2 mb-6">
          <TrendingUp size={18} />
          Vehicle Type Specifications
        </h3>
        <p className="card-description">Customize energy usage and battery size for specific vehicle models detected in the data.</p>
        
        {uniqueTypes.length === 0 ? (
          <div className="p-8 bg-app rounded-xl border border-dashed border-border text-center">
            <p className="text-muted text-sm">No vehicle types detected. Please upload an Excel file first.</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-1/3">Detected Vehicle Type</th>
                  <th>Consumption (Wh/m)</th>
                  <th>Battery Capacity (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {uniqueTypes.map(type => {
                  const config = projectData.meta.vehicle_types_config?.[type];
                  const consumptionValue = (typeof config === 'object' && config !== null) 
                    ? config.consumption 
                    : (Number(config) || projectData.meta.default_consumption_wh_m);
                  
                  const batteryValue = (typeof config === 'object' && config !== null) 
                    ? config.battery 
                    : projectData.constraints.max_battery_capacity_kwh;

                  return (
                    <tr key={type}>
                      <td className="font-semibold text-secondary">{type}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            step="0.01"
                            style={{ width: '100px' }}
                            className="form-input py-1 px-3"
                            value={consumptionValue}
                            onChange={(e) => handleTypeConfigUpdate(type, 'consumption', e.target.value)}
                          />
                          {!projectData.meta.vehicle_types_config?.[type] && (
                            <span className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Default</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            style={{ width: '100px' }}
                            className="form-input py-1 px-3"
                            value={batteryValue}
                            onChange={(e) => handleTypeConfigUpdate(type, 'battery', e.target.value)}
                          />
                          {(!projectData.meta.vehicle_types_config?.[type] || !projectData.meta.vehicle_types_config[type].battery) && (
                            <span className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Default</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const PricingTab = ({ projectData, setProjectData }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [priceData, setPriceData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  
  const [assumptions, setAssumptions] = useState(projectData.meta.price_assumptions || {
    supplier_markup: 10.0,
    variable_network_charge: 15.0,
    other_variable_levies: 0.0,
    electricity_tax: 8.2,
    use_vat: false,
    pricing_mode: 'effective'
  });

  const handleAssumptionChange = (key, value) => {
    setAssumptions(prev => ({ ...prev, [key]: value }));
  };

  const handleFetchAWattar = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAWattarPrices(selectedDate);
      setPriceData(data.prices);
    } catch (err) {
      console.error(err);
      alert('Error fetching aWATTar prices. Please try another date or check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyToProject = async () => {
    if (!priceData) return;
    setIsApplying(true);
    try {
      const result = await getPricesForOptimization(
        selectedDate,
        projectData.meta.planning_horizon || 24,
        projectData.meta.time_resolution || 15
      );

      // We apply the raw spot prices to 'pricing' but store assumptions in meta
      // The actual transformation happens during the run logic to preserve the raw series
      setProjectData(prev => ({
        ...prev,
        pricing: result.prices,
        meta: {
          ...prev.meta,
          price_date: selectedDate,
          price_unit: 'EUR/MWh',
          price_source: 'awattar',
          price_assumptions: assumptions
        }
      }));
      alert('Electricity prices successfully applied to the project!');
    } catch (err) {
      console.error(err);
      alert('Error processing prices for optimization.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCsvUpload = (e) => {
    alert('Manual CSV upload logic would go here. For now, please use the aWATTar API.');
  };

  return (
    <div className="pricing-tab animate-in">
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column: Configuration & Actions */}
        <div className="space-y-6">
          <div className="card shadow-sm p-6 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            
            <h3 className="card-title text-primary flex items-center gap-2 mb-6">
              <Settings size={18} />
              1. Market Data Sync
            </h3>

            <div className="form-group mb-6">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-0">Market Forecast Date</label>
                <InfoTooltip title="Market Date" text="Select the target date for price forecasting. Data is pulled from the Austrian day-ahead market." />
              </div>
              <input
                type="date"
                className="form-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
              <p style={{ fontSize: '10px' }} className="text-muted mt-1 italic px-0.5">
                Austrian EPEX Spot Day-Ahead prices (aWATTar)
              </p>
            </div>

            <div className="mt-8">
              <label className="form-label text-xs font-bold uppercase tracking-wider text-muted mb-4 block">Model Synchronization</label>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] mb-0">Planning Horizon</label>
                    <InfoTooltip title="Look-ahead" text="The total time window for which the charging strategy is being calculated. Usually matches your project settings." />
                  </div>
                  <input className="form-input bg-app text-sm" value={`${projectData.meta?.planning_horizon || 24} Hours`} disabled />
                </div>
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] mb-0">Time Step</label>
                    <InfoTooltip title="Resolution" text="The temporal resolution of the optimization. Forecasts and charging actions are discrete at this interval." />
                  </div>
                  <input className="form-input bg-app text-sm" value={`${projectData.meta?.time_resolution || 15} Minutes`} disabled />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  className="btn btn-primary flex-1 py-3 flex items-center justify-center gap-2 shadow-lg"
                  onClick={handleFetchAWattar}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  Fetch aWATTar
                </button>

                <button
                  className="btn btn-primary flex-1 py-3 shadow-lg flex items-center justify-center gap-2"
                  disabled={!priceData || isApplying}
                  onClick={handleApplyToProject}
                >
                  {isApplying ? <Loader2 size={20} className="animate-spin" /> : <Zap size={18} />}
                  Apply Sync
                </button>
              </div>
            </div>
          </div>

          <div className="card shadow-sm p-6">
            <h3 className="card-title text-primary flex items-center gap-2 mb-6">
              <TrendingUp size={18} />
              2. Price Assumptions
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Supplier Markup (€/MWh)</label>
                  <InfoTooltip title="Provider Fee" text="Additional fee charged by the energy provider on top of the market spot price." />
                </div>
                <input 
                  type="number" 
                  className="form-input h-9 text-sm" 
                  value={assumptions.supplier_markup} 
                  onChange={(e) => handleAssumptionChange('supplier_markup', Number(e.target.value))}
                />
              </div>
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Grid Charge (€/MWh)</label>
                  <InfoTooltip title="Network Fees" text="Usage-dependent fees for transport through the utility grid. Usually calculated per megawatt-hour." />
                </div>
                <input 
                  type="number" 
                  className="form-input h-9 text-sm" 
                  value={assumptions.variable_network_charge} 
                  onChange={(e) => handleAssumptionChange('variable_network_charge', Number(e.target.value))}
                />
              </div>
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Elect. Tax (€/MWh)</label>
                  <InfoTooltip title="Austria Tax" text="Standard government tax on electricity consumption in Austria (Elektrizitätsabgabe)." />
                </div>
                <input 
                  type="number" 
                  className="form-input h-9 text-sm" 
                  value={assumptions.electricity_tax} 
                  onChange={(e) => handleAssumptionChange('electricity_tax', Number(e.target.value))}
                />
              </div>
              <div className="form-group mb-0">
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Other Levies (€/MWh)</label>
                  <InfoTooltip title="Surcharges" text="Sum of miscellaneous variable surcharges such as renewables support or energy efficiency contributions." />
                </div>
                <input 
                  type="number" 
                  className="form-input h-9 text-sm" 
                  value={assumptions.other_variable_levies} 
                  onChange={(e) => handleAssumptionChange('other_variable_levies', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div 
                className="flex items-center justify-between cursor-pointer group"
                onClick={() => handleAssumptionChange('use_vat', !assumptions.use_vat)}
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-secondary group-hover:text-primary transition-colors">Apply 20% Austrian VAT</span>
                    <InfoTooltip title="Value Added Tax" text="Value Added Tax applicable for Austrian consumers. Applied as a percentage of the total effective price." />
                  </div>
                  <span className="text-[10px] text-muted">Applied to full effective price</span>
                </div>
                <div className="relative inline-flex items-center">
                  <input type="checkbox" className="sr-only peer" checked={assumptions.use_vat} readOnly />
                  <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-secondary">Pricing Mode</span>
                    <InfoTooltip title="Basis" text="Toggle between optimization based on raw market prices (Spot Only) or calculations including all surcharges (Effective)." />
                  </div>
                  <span className="text-[10px] text-muted">Basis for optimization</span>
                </div>
                <div className="flex bg-app p-1 rounded-lg border border-border">
                  <button 
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${assumptions.pricing_mode === 'spot' ? 'bg-white shadow-sm text-primary' : 'text-muted hover:text-secondary'}`}
                    onClick={() => handleAssumptionChange('pricing_mode', 'spot')}
                  >
                    SPOT ONLY
                  </button>
                  <button 
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${assumptions.pricing_mode === 'effective' ? 'bg-white shadow-sm text-primary' : 'text-muted hover:text-secondary'}`}
                    onClick={() => handleAssumptionChange('pricing_mode', 'effective')}
                  >
                    EFFECTIVE
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card shadow-sm border-dashed border-border/80 bg-slate-50/30 p-6">
            <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-4">Manual Fallback</h4>
            <div className="flex items-center justify-between group">
              <div className="text-xs text-secondary leading-relaxed max-w-[240px] flex items-center gap-2">
                Import a local benchmark CSV if market data is unavailable.
                <InfoTooltip title="CSV Import" text="Allows providing a custom hourly price profile if the aWATTar API is unavailable or for testing historical scenarios." />
              </div>
              <label className="btn btn-outline btn-sm bg-surface shadow-sm hover:border-primary transition-all cursor-pointer">
                <Upload size={14} />
                <span className="ml-2">Select File</span>
                <input type="file" style={{ display: 'none' }} accept=".csv" onChange={handleCsvUpload} />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Visualization Preview */}
        <div className="flex flex-col h-full">
          <div className="card shadow-sm p-0 overflow-hidden flex-1 flex flex-col">
            <div className="p-4 border-b bg-app/50 flex justify-between items-center">
              <h3 className="card-title text-primary mb-0">
                <TrendingUp size={18} />
                Market Data Preview
              </h3>
              <span className="text-[10px] font-bold text-muted uppercase">EPEX SPOT Austria</span>
            </div>

            <div className="p-6 flex-1 min-h-500">
              <PriceChart data={priceData} assumptions={assumptions} />
            </div>

            <div className="p-4 bg-app/30 border-t">
              <p className="text-[10px] text-muted leading-relaxed flex items-start gap-2">
                <Info size={14} className="shrink-0 mt-0.5" />
                The preview curve shows the raw hourly market data. Applying the sync will interpolate this data to your project's 15-minute resolution.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Removed Redundant Local Styles */}
    </div>
  );
};

export default InputData;
