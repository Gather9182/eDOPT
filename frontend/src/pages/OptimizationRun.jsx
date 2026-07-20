import React, { useState, useEffect, useRef } from 'react';
import { Play, Zap, Terminal, Battery, Clock, CheckCircle, AlertCircle, Loader2, Table as TableIcon, Info, Save, ChevronDown, ChevronUp, Sun, Layers, LayoutDashboard, Activity, Sliders, MapPin, Navigation } from 'lucide-react';
import { runOptimization as callOptimizeApi, validateInputs } from '../services/api';
import { generateDefaultPrices } from '../utils/dataMapping';
import { getItem, setItem, removeItem } from '../utils/db';

const InfoTooltip = ({ title, text, align = 'center' }) => (
  <div className="tooltip-container">
    <Info size={14} className="tooltip-trigger" />
    <div className={`tooltip-box tooltip-${align}`}>
      {title && <div className="tooltip-title">{title}</div>}
      <div className="tooltip-text">{text}</div>
    </div>
  </div>
);

const OptimizationRun = ({ projectData, setProjectData, onComplete }) => {
  const [status, setStatus] = useState('ready'); // ready, running, success
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [runStartTime, setRunStartTime] = useState(null);
  const [timeLeftText, setTimeLeftText] = useState('');
  const targetEndTimeRef = useRef(null);
  const [scenario, setScenario] = useState(projectData.meta.scenario || 'baseline');
  const [pvConfig, setPvConfig] = useState(projectData.constraints?.pv_config || {
    capacity_kw: 0,
    allow_curtailment: true,
    profile_mode: 'bell_curve',
    reference_date: new Date().toISOString().split('T')[0]
  });
  const [weatherDate, setWeatherDate] = useState(pvConfig.reference_date || new Date().toISOString().split('T')[0]);
  const [bessConfig, setBessConfig] = useState(projectData.constraints?.bess_config || {
    capacity_kwh: 0,
    max_charge_power_kw: 0,
    max_discharge_power_kw: 0,
    efficiency: 0.95,
    initial_soc_kwh: 0,
    min_soc_kwh: 0,
    max_soc_kwh: 0,
    enable_temperature_capacity_derating: false,
    thermal_time_constant_hours: 6.0,
    reference_temperature_c: 25.0,
    min_capacity_factor: 0.65,
    capacity_factor_at_minus_10c: 0.85,
    full_capacity_temperature_c: 25.0,
    min_modeled_cell_temperature_c: -20.0,
    initial_cell_temperature_c: null,
    thermal_heating_coefficient: 0.02,
    temperature_source: 'open_meteo'
  });
  const [showAdvancedBess, setShowAdvancedBess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showGeographicSettings, setShowGeographicSettings] = useState(false);
  const [localSettings, setLocalSettings] = useState({
    charger_capacity_kw: projectData.constraints?.charger_capacity_kw || 1200,
    grid_limit_kw: projectData.constraints?.grid_limit_kw || 800,
    efficiency: projectData.constraints?.efficiency || 0.92,
    max_power_per_bus: projectData.constraints?.max_power_per_bus || 150,
    consumption_wh_m: projectData.constraints?.consumption_wh_m || 1.5,
    planning_horizon: projectData.meta?.planning_horizon || 24,
    time_resolution: projectData.meta?.time_resolution || 15,
    num_chargers: projectData.constraints?.num_chargers || 50,
    use_next_day_readiness: projectData.constraints?.use_next_day_readiness ?? true
  });
  const [validationResult, setValidationResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle, saved
  const [showInputData, setShowInputData] = useState(false);
  const [showCompareAllToast, setShowCompareAllToast] = useState(false);

  // New states for Long-Term Simulation
  const [simulationMode, setSimulationMode] = useState('single'); // 'single', 'long_term'
  const [longTermConfig, setLongTermConfig] = useState(() => {
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    return {
      startDate: sevenDaysAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
      chunkSizeHours: 24
    };
  });

  // Sync to project meta when it changes (e.g. after Excel import)
  useEffect(() => {
    if (projectData.meta.data_source === 'uploaded') {
      setLocalSettings(prev => ({
        ...prev,
        planning_horizon: projectData.meta.planning_horizon || 24,
        time_resolution: projectData.meta.time_resolution || 15,
        charger_capacity_kw: projectData.constraints.charger_capacity_kw,
        grid_limit_kw: projectData.constraints.grid_limit_kw,
        num_chargers: projectData.constraints.num_chargers || 50
      }));
    }
  }, [projectData.meta.data_source, projectData.meta.planning_horizon, projectData.meta.time_resolution, projectData.constraints]);

  const handleGetCurrentLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setProjectData(prev => ({
          ...prev,
          meta: {
            ...prev.meta,
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6))
          }
        }));
      }, (error) => {
        console.error("Geolocation error:", error);
        alert("Failed to get current location. Please ensure location permissions are granted.");
      });
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  };

  const handleSearchLocation = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchQuery)}&count=5&language=en&format=json`);
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        setSearchResults(data.results);
      } else {
        alert("No locations found for this query.");
      }
    } catch (err) {
      console.error("Geocoding error:", err);
      alert("Error searching for location. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const selectLocation = (loc) => {
    setProjectData(prev => ({
      ...prev,
      meta: {
        ...prev.meta,
        latitude: Number(loc.latitude.toFixed(6)),
        longitude: Number(loc.longitude.toFixed(6))
      }
    }));
    setSearchQuery(`${loc.name}, ${loc.country || ''}`);
    setSearchResults([]);
  };

  const logWindowRef = useRef(null);

  useEffect(() => {
    if (logWindowRef.current) {
      logWindowRef.current.scrollTop = logWindowRef.current.scrollHeight;
    }
  }, [logs]);

  // Update targetEndTime when progress changes
  useEffect(() => {
    if (status === 'running' && runStartTime && progress > 5 && progress < 100) {
      const elapsed = Date.now() - runStartTime;
      const estimatedTotal = (elapsed / progress) * 100;
      targetEndTimeRef.current = runStartTime + estimatedTotal;
    } else {
      targetEndTimeRef.current = null;
    }
  }, [progress, status, runStartTime]);

  // Timer to update timeLeftText every second
  useEffect(() => {
    if (status !== 'running') {
      setTimeLeftText('');
      return;
    }

    const updateTimer = () => {
      if (!targetEndTimeRef.current) {
        setTimeLeftText('Estimating remaining time...');
        return;
      }
      const diff = targetEndTimeRef.current - Date.now();
      if (diff <= 0) {
        setTimeLeftText('Finishing up...');
        return;
      }
      const totalSeconds = Math.round(diff / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (minutes > 0) {
        setTimeLeftText(`Estimated time left: ${minutes}m ${seconds}s`);
      } else {
        setTimeLeftText(`Estimated time left: ${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const addLog = (msg) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  };

  const tileVector = (source, targetLength) => {
    if (!source || source.length === 0) return Array(targetLength).fill(0);
    if (source.length === targetLength) return source;
    return Array.from({ length: targetLength }, (_, i) => source[i % source.length]);
  };

  const runOptimization = async () => {
    setStatus('running');
    setRunStartTime(Date.now());
    setProgress(5);
    setLogs([]);

    const isRealData = projectData.buses && projectData.buses.length > 0;
    const numPeriods = isRealData ? ((localSettings.planning_horizon * 60) / localSettings.time_resolution) : 96;

    let finalPrices = [];
    if (isRealData) {
      addLog(`Using uploaded data for ${projectData.buses.length} buses.`);
      const priceAssumptions = projectData.meta.price_assumptions || {
        supplier_markup: 10,
        variable_network_charge: 15,
        other_variable_levies: 0,
        electricity_tax: 8.2,
        use_vat: false,
        pricing_mode: 'effective'
      };
      
      finalPrices = projectData.pricing;
      if (priceAssumptions.pricing_mode === 'effective') {
        const fixedAdditions = (priceAssumptions.supplier_markup || 0) + 
                              (priceAssumptions.variable_network_charge || 0) + 
                              (priceAssumptions.other_variable_levies || 0) + 
                              (priceAssumptions.electricity_tax || 0);
        const vatMultiplier = priceAssumptions.use_vat ? 1.2 : 1.0;
        finalPrices = projectData.pricing.map(p => (p + fixedAdditions) * vatMultiplier);
        addLog(`Pricing Mode: EFFECTIVE (${priceAssumptions.use_vat ? 'Incl. 20% VAT' : 'Excl. VAT'})`);
      } else {
        addLog('Pricing Mode: SPOT (Wholesale only)');
      }
      
      if (projectData.pricing.length > 0 && projectData.pricing.length < numPeriods) {
        addLog('Note: Price data is shorter than horizon. Repeating price pattern.');
      }
    } else {
      addLog('No uploaded data found. Using mock baseline depot (42 buses).');
      finalPrices = generateDefaultPrices(numPeriods);
    }

    const buildInputsForScenario = (targetScenario) => {
      if (isRealData) {
        return {
          scenario: targetScenario,
          planning_horizon_hours: localSettings.planning_horizon,
          time_step_minutes: localSettings.time_resolution,
          buses: projectData.buses.map(bus => {
            const initFrac = projectData.meta.initial_soc_fraction || 1.0;
            const reserveFrac = projectData.meta.min_final_soc_fraction || 0.2;
            const battery = bus.max_battery_capacity_kwh || projectData.constraints.max_battery_capacity_kwh || 350;
            return {
              ...bus,
              initial_soc_kwh: battery * initFrac,
              min_final_soc_kwh: battery * reserveFrac,
              efficiency: bus.efficiency || localSettings.efficiency,
              max_power_kw: bus.max_power_kw || localSettings.max_power_per_bus,
              availability: tileVector(bus.availability, numPeriods),
              trip_energy_profile_kwh: tileVector(bus.trip_energy_profile_kwh, numPeriods)
            };
          }),
          electricity_prices: tileVector(finalPrices, numPeriods),
          market_prices: tileVector(projectData.pricing, numPeriods),
          charger_capacity_kw: localSettings.charger_capacity_kw,
          grid_limit_kw: localSettings.grid_limit_kw,
          initial_soc_fraction: projectData.meta.initial_soc_fraction || 1.0,
          min_final_soc_fraction: projectData.meta.min_final_soc_fraction || 0.2,
          num_chargers: localSettings.num_chargers || 50,
          use_next_day_readiness: localSettings.use_next_day_readiness,
          pv_config: (targetScenario === 'pv' || targetScenario === 'pv_bess') ? {
            ...pvConfig,
            latitude: projectData.meta.latitude,
            longitude: projectData.meta.longitude,
            reference_date: weatherDate
          } : null,
          bess_config: (targetScenario === 'bess' || targetScenario === 'pv_bess') ? {
            ...bessConfig,
            reference_date: weatherDate
          } : null
        };
      } else {
        return {
          scenario: targetScenario,
          planning_horizon_hours: 24,
          time_step_minutes: 15,
          buses: Array.from({ length: 42 }, (_, i) => ({
            id: `Bus_${String(i+1).padStart(3, '0')}`,
            max_power_kw: 150,
            efficiency: 0.92,
            max_battery_capacity_kwh: 350,
            initial_soc_kwh: 350,
            min_final_soc_kwh: 0,
            trip_energy_profile_kwh: Array.from({ length: numPeriods }, () => Math.random() > 0.8 ? 5 + Math.random() * 5 : 0),
            availability: Array.from({ length: 96 }, () => Math.random() > 0.4 ? 1 : 0)
          })),
          electricity_prices: finalPrices,
          charger_capacity_kw: 1200,
          grid_limit_kw: 800,
          pv_config: (targetScenario === 'pv' || targetScenario === 'pv_bess') ? {
            ...pvConfig,
            latitude: projectData.meta.latitude,
            longitude: projectData.meta.longitude
          } : null,
          bess_config: (targetScenario === 'bess' || targetScenario === 'pv_bess') ? bessConfig : null
        };
      }
    };

    try {
      if (scenario === 'compare_all') {
        const scenariosToRun = ['baseline', 'pv', 'bess', 'pv_bess'];
        const batchResults = [];
        
        for (let i = 0; i < scenariosToRun.length; i++) {
          const s = scenariosToRun[i];
          addLog(`[${i+1}/4] Initializing ${s.toUpperCase()} optimization...`);
          setProgress(10 + (i * 20));
          
          const inputs = buildInputsForScenario(s);
          const result = await callOptimizeApi(inputs);
          
          if (result.solver_logs && result.solver_logs.length > 0) {
            result.solver_logs.forEach(logMsg => addLog(`[${s}] ${logMsg}`));
          }
          
          const snapshot = {
            ...result,
            run_metadata: {
              inputs: JSON.parse(JSON.stringify(inputs)),
              timestamp: new Date().toISOString(),
              run_id: `${new Date().toISOString().split('T')[0]}_BATCH_${s.toUpperCase()}`
            }
          };
          batchResults.push(snapshot);
        }
        
        addLog('All scenarios complete. Saving to comparison history...');
        setProgress(100);
        setStatus('success');
        
        // Save the batch directly to comparison history
        await setItem('comparison_history', batchResults);
        
        // Go straight to compare tab
        onComplete('compare');
        
      } else {
        addLog(`Initializing ${scenario.toUpperCase()} optimization engine...`);
        setProgress(30);
        
        const inputs = buildInputsForScenario(scenario);
        const result = await callOptimizeApi(inputs);
        
        if (result.solver_logs && result.solver_logs.length > 0) {
          result.solver_logs.forEach(logMsg => {
            addLog(logMsg);
          });
        }
        
        addLog('Solver logic complete. Processing metrics...');
        setProgress(100);
        setStatus('success');
        
        const snapshot = {
          ...result,
          run_metadata: {
            inputs: JSON.parse(JSON.stringify(inputs)),
            timestamp: new Date().toISOString(),
            run_id: `${new Date().toISOString().split('T')[0]}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`
          }
        };
        
        await setItem('optimization_results', snapshot);
        onComplete('results');
      }
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus('ready');
      alert(`Optimization failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  const executeSimulation = async () => {
    if (simulationMode === 'single') {
      await runOptimization();
    } else {
      await runLongTermSimulation();
    }
  };

  const runLongTermSimulation = async () => {
    setStatus('running');
    setRunStartTime(Date.now());
    setProgress(2);
    setLogs([]);
    addLog(`Starting Long-Term Simulation from ${longTermConfig.startDate} to ${longTermConfig.endDate}`);

    try {
      // 1. Fetch Historical Context
      addLog('Fetching historical weather and price data...');
      const contextRes = await fetch(`http://${window.location.hostname}:8000/api/data/historical-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: longTermConfig.startDate,
          end_date: longTermConfig.endDate,
          latitude: projectData.meta.latitude || 48.2,
          longitude: projectData.meta.longitude || 16.3,
          pv_capacity_kw: (scenario === 'pv' || scenario === 'pv_bess') ? pvConfig.capacity_kw : 0,
          resolution_min: localSettings.time_resolution
        })
      });

      if (!contextRes.ok) throw new Error('Failed to fetch historical context data.');
      const contextData = await contextRes.json();
      setProgress(10);
      const startDt = new Date(longTermConfig.startDate);
      const endDt = new Date(longTermConfig.endDate);
      const totalDays = Math.round((endDt - startDt) / (1000 * 60 * 60 * 24)) + 1;
      const chunks = Math.ceil((totalDays * 24) / longTermConfig.chunkSizeHours);
      const periodsPerChunk = (longTermConfig.chunkSizeHours * 60) / localSettings.time_resolution;
      const periodsPerDay = 1440 / localSettings.time_resolution;

      addLog(`Historical data fetched: ${contextData.prices?.length || 0} price points, ${contextData.pv_yield?.length || 0} PV points.`);
      
      if (contextData.prices.length < (chunks * periodsPerChunk) && chunks > 1) {
          addLog(`Warning: Historical data is shorter than requested horizon (${contextData.prices.length} vs ${chunks * periodsPerChunk} points). Padding data...`);
      }

      // 2. Setup Loop Variables (No clearing needed for IndexedDB storage)
      
      let currentBessSoc = bessConfig.initial_soc_kwh;
      let currentBusSocs = {};
      if (projectData.buses) {
         projectData.buses.forEach(b => {
             const initFrac = projectData.meta.initial_soc_fraction || 1.0;
             const battery = b.max_battery_capacity_kwh || projectData.constraints.max_battery_capacity_kwh || 350;
             currentBusSocs[b.id] = battery * initFrac;
         });
      }

      // Arrays to accumulate results
      let agg_load = [];
      let agg_grid_import = [];
      let agg_baseline_load = [];
      let agg_bess_charge = [];
      let agg_bess_discharge = [];
      let agg_bess_soc = [];
      let agg_bess_charge_from_pv = [];
      let agg_bess_charge_from_grid = [];
      let agg_pv_yield = [];
      let agg_pv_used = [];
      let agg_pv_curtailed = [];
      let agg_pv_to_bus = [];
      let agg_grid_to_bus = [];
      let agg_bess_to_bus = [];
      let agg_prices = [];
      let agg_market_prices = [];
      let agg_temp = [];
      let agg_cell_temp = [];
      let agg_cap_factor = [];
      let agg_max_cap = [];
      let agg_diagnostics = [];
      let agg_schedules = [];
      let agg_soc_profiles = [];
      let totalCost = 0;
      let totalBaselineCost = 0;
      let totalBasicOptimizedCost = 0;
      let totalEnergyMwh = 0;
      let peakLoadKw = 0;
      let totalPvGeneratedKwh = 0;
      let totalPvUsedKwh = 0;
      let totalPvCurtailedKwh = 0;
      let totalBessThroughputKwh = 0;

      // 3. Loop over chunks
      for (let i = 0; i < chunks; i++) {
        const startIdx = i * periodsPerChunk;
        const endIdx = (i + 1) * periodsPerChunk;
        
        // Ensure data availability for this chunk, pad with last values if needed
        const getPaddedSlice = (arr, start, end) => {
            if (!arr || arr.length === 0) return new Array(end - start).fill(0);
            const slice = arr.slice(start, end);
            if (slice.length === (end - start)) return slice;
            
            // Pad if short
            const padded = [...slice];
            while (padded.length < (end - start)) {
                // Cyclical fallback for prices/pv if possible, otherwise use last value
                const fallbackIdx = padded.length % periodsPerDay;
                padded.push(arr[fallbackIdx] || padded[padded.length - 1] || 0);
            }
            return padded;
        };

        const progressPercent = 10 + Math.floor((i / chunks) * 80);
        setProgress(progressPercent);
        addLog(`Optimizing Chunk ${i + 1}/${chunks} (Day ${Math.floor(startIdx/periodsPerDay) + 1})...`);

        // Slice data with padding
        const chunkPrices = getPaddedSlice(contextData.prices, startIdx, endIdx);
        const chunkPv = getPaddedSlice(contextData.pv_yield, startIdx, endIdx);
        const chunkTemp = getPaddedSlice(contextData.temperatures, startIdx, endIdx);

        // Prepare Inputs
        const buildInputs = () => {
          return {
            scenario: scenario,
            planning_horizon_hours: longTermConfig.chunkSizeHours,
            time_step_minutes: localSettings.time_resolution,
            buses: (projectData.buses || []).map(bus => {
              const reserveFrac = projectData.meta.min_final_soc_fraction || 0.2;
              const battery = bus.max_battery_capacity_kwh || projectData.constraints.max_battery_capacity_kwh || 350;
              return {
                ...bus,
                initial_soc_kwh: currentBusSocs[bus.id] !== undefined ? currentBusSocs[bus.id] : battery,
                min_final_soc_kwh: battery * reserveFrac,
                efficiency: bus.efficiency || localSettings.efficiency,
                max_power_kw: bus.max_power_kw || localSettings.max_power_per_bus,
                availability: tileVector(bus.availability, periodsPerChunk),
                trip_energy_profile_kwh: tileVector(bus.trip_energy_profile_kwh, periodsPerChunk)
              };
            }),
            electricity_prices: chunkPrices,
            market_prices: chunkPrices,
            charger_capacity_kw: localSettings.charger_capacity_kw,
            grid_limit_kw: localSettings.grid_limit_kw,
            initial_soc_fraction: 1.0,
            min_final_soc_fraction: 0.2,
            num_chargers: localSettings.num_chargers || 50,
            use_next_day_readiness: localSettings.use_next_day_readiness,
            pv_config: (scenario === 'pv' || scenario === 'pv_bess') ? {
              ...pvConfig,
              profile_kwh: chunkPv,
              latitude: projectData.meta.latitude,
              longitude: projectData.meta.longitude,
            } : null,
            bess_config: (scenario === 'bess' || scenario === 'pv_bess') ? {
              ...bessConfig,
              initial_soc_kwh: currentBessSoc,
              ambient_temperature_profile: chunkTemp
            } : null
          };
        };

        const res = await callOptimizeApi(buildInputs());
        
        // Extract states for next chunk
        if (res.bess_soc_profile && res.bess_soc_profile.length > 0) {
            currentBessSoc = res.bess_soc_profile[res.bess_soc_profile.length - 1];
        }
        if (res.soc_profiles) {
            Object.keys(res.soc_profiles).forEach(busId => {
                const arr = res.soc_profiles[busId];
                if (arr && arr.length > 0) currentBusSocs[busId] = arr[arr.length - 1];
            });
        }

        // Aggregate
        agg_load.push(...(res.aggregated_load_profile || []));
        agg_grid_import.push(...(res.grid_import_profile || []));
        agg_baseline_load.push(...(res.baseline_aggregated_load_profile || []));
        agg_bess_charge.push(...(res.bess_charge_profile || []));
        agg_bess_discharge.push(...(res.bess_discharge_profile || []));
        agg_bess_soc.push(...(res.bess_soc_profile || []).slice(0, periodsPerChunk)); // Drop the N+1 element
        agg_bess_charge_from_pv.push(...(res.bess_charge_from_pv_profile || []));
        agg_bess_charge_from_grid.push(...(res.bess_charge_from_grid_profile || []));
        agg_pv_yield.push(...(res.pv_yield_profile || []));
        agg_pv_used.push(...(res.pv_used_profile || []));
        agg_pv_curtailed.push(...(res.pv_curtailed_profile || []));
        agg_pv_to_bus.push(...(res.pv_to_bus_profile || []));
        agg_grid_to_bus.push(...(res.grid_to_bus_profile || []));
        agg_bess_to_bus.push(...(res.bess_to_bus_profile || []));
        agg_prices.push(...chunkPrices);
        agg_market_prices.push(...(res.market_prices || chunkPrices));
        agg_temp.push(...chunkTemp);
        agg_cell_temp.push(...(res.bess_cell_temperature_profile_c || []));
        agg_cap_factor.push(...(res.bess_capacity_factor_profile || []));
        agg_max_cap.push(...(res.bess_max_usable_capacity_profile_kwh || []));
        // Daily breakdown of schedules, diagnostics and SoC profiles
        const daysPerChunk = longTermConfig.chunkSizeHours / 24;
        const daysInThisChunk = Math.min(daysPerChunk, totalDays - (i * daysPerChunk));
        const dt = localSettings.time_resolution / 60;
        
        for (let d = 0; d < daysInThisChunk; d++) {
          const chunkStartPeriod = d * periodsPerDay;
          const chunkEndPeriod = (d + 1) * periodsPerDay;

          // 1. Slice daily schedules
          const dailySchedule = {};
          if (res.schedules) {
            Object.keys(res.schedules).forEach(busId => {
              const profile = res.schedules[busId] || [];
              dailySchedule[busId] = profile.slice(chunkStartPeriod, chunkEndPeriod);
            });
          }
          agg_schedules.push(dailySchedule);

          // 2. Slice daily SoC profiles
          const dailySoc = {};
          if (res.soc_profiles) {
            Object.keys(res.soc_profiles).forEach(busId => {
              const profile = res.soc_profiles[busId] || [];
              dailySoc[busId] = profile.slice(chunkStartPeriod, chunkEndPeriod + 1);
            });
          }
          agg_soc_profiles.push(dailySoc);

          // 3. Slice daily diagnostics
          const dailyDiags = [];
          if (res.bus_diagnostics) {
            res.bus_diagnostics.forEach(diag => {
              const busId = diag.id;
              const busSoc = dailySoc[busId] || [];
              const busSch = dailySchedule[busId] || [];
              
              const busInput = (projectData.buses || []).find(b => String(b.id) === String(busId));
              const battery = busInput?.max_battery_capacity_kwh || projectData.constraints?.max_battery_capacity_kwh || 350;
              const efficiency = busInput?.efficiency || localSettings.efficiency || 0.92;
              
              const initial_soc_kwh = busSoc[0] !== undefined ? busSoc[0] : diag.initial_soc_kwh;
              const final_soc_kwh = busSoc[busSoc.length - 1] !== undefined ? busSoc[busSoc.length - 1] : diag.final_soc_kwh;
              const min_soc_reached_kwh = busSoc.length > 0 ? Math.min(...busSoc) : diag.min_soc_reached_kwh;
              const total_charged_energy_kwh = busSch.reduce((sum, p) => sum + p, 0) * dt * efficiency;
              
              const tripsForDay = busInput?.trips || [];
              const total_trip_energy_kwh = tripsForDay.reduce((sum, t) => sum + (t.energy_kwh || 0), 0);
              
              let status_flag = diag.status_flag || 'healthy';
              let diagnostic_reason = diag.diagnostic_reason || 'Charging requirement met.';
              
              const final_threshold = (busInput?.min_final_soc_kwh !== undefined ? busInput.min_final_soc_kwh : battery * (projectData.meta?.min_final_soc_fraction || 0.2)) + 
                                     (d === daysInThisChunk - 1 ? (busInput?.next_day_required_energy_kwh || 0) : 0);
              
              if (busSoc.some(v => v < -0.01)) {
                status_flag = 'critical';
                diagnostic_reason = 'Critical: Vehicle ran out of energy during transit.';
              } else if (final_soc_kwh < final_threshold - 0.5) {
                status_flag = 'critical';
                diagnostic_reason = 'Constraint Violation: Insufficient final SoC.';
              } else if (status_flag !== 'critical') {
                if (total_charged_energy_kwh < 0.1) {
                  status_flag = 'healthy';
                  diagnostic_reason = 'No charging required: Initial SoC sufficient.';
                } else if (min_soc_reached_kwh < 20) {
                  status_flag = 'warning';
                  diagnostic_reason = 'Charging requirement met (Low min SoC).';
                }
              }
              
              dailyDiags.push({
                id: busId,
                capacity_kwh: battery,
                initial_soc_kwh,
                final_soc_kwh,
                min_soc_reached_kwh,
                total_trip_energy_kwh,
                total_charged_energy_kwh,
                is_charged: total_charged_energy_kwh > 0.1,
                total_distance_km: diag.total_distance_km || 0,
                vehicle_type: diag.vehicle_type || busInput?.vehicle_type || 'Bus',
                status_flag,
                diagnostic_reason
              });
            });
          }
          agg_diagnostics.push(dailyDiags);
        }
        
        totalCost += res.total_cost_eur;
        totalBaselineCost += (res.baseline_cost_eur || 0);
        totalBasicOptimizedCost += (res.basic_optimized_cost_eur || 0);
        totalEnergyMwh += res.total_energy_mwh;
        peakLoadKw = Math.max(peakLoadKw, res.peak_load_kw);
        totalPvGeneratedKwh += (res.total_pv_generated_kwh || 0);
        totalPvUsedKwh += (res.total_pv_used_kwh || 0);
        totalPvCurtailedKwh += (res.total_pv_curtailed_kwh || 0);
        totalBessThroughputKwh += (res.total_bess_throughput_kwh || 0);
      }

      setProgress(100);
      addLog('Long-Term Simulation completed successfully.');
      setStatus('success');

      // 4. Construct flat payload matching standard format
      const finalPayload = {
        scenario: scenario,
        total_cost_eur: totalCost,
        baseline_cost_eur: totalBaselineCost,
        basic_optimized_cost_eur: totalBasicOptimizedCost,
        total_energy_mwh: totalEnergyMwh,
        peak_load_kw: peakLoadKw,
        aggregated_load_profile: agg_load,
        grid_import_profile: agg_grid_import,
        baseline_aggregated_load_profile: agg_baseline_load,
        bess_charge_profile: agg_bess_charge,
        bess_discharge_profile: agg_bess_discharge,
        bess_soc_profile: agg_bess_soc,
        bess_charge_from_pv_profile: agg_bess_charge_from_pv,
        bess_charge_from_grid_profile: agg_bess_charge_from_grid,
        pv_yield_profile: agg_pv_yield,
        pv_used_profile: agg_pv_used,
        pv_curtailed_profile: agg_pv_curtailed,
        pv_to_bus_profile: agg_pv_to_bus,
        grid_to_bus_profile: agg_grid_to_bus,
        bess_to_bus_profile: agg_bess_to_bus,
        total_pv_generated_kwh: totalPvGeneratedKwh,
        total_pv_used_kwh: totalPvUsedKwh,
        total_pv_curtailed_kwh: totalPvCurtailedKwh,
        total_bess_throughput_kwh: totalBessThroughputKwh,
        electricity_prices: agg_prices,
        market_prices: agg_market_prices,
        ambient_temperature_profile_c: agg_temp,
        bess_cell_temperature_profile_c: agg_cell_temp,
        bess_capacity_factor_profile: agg_cap_factor,
        bess_max_usable_capacity_profile_kwh: agg_max_cap,
        diagnostics_by_day: agg_diagnostics,
        schedules_by_day: agg_schedules,
        soc_profiles_by_day: agg_soc_profiles,
        is_long_term: true,
        total_days: totalDays,
        run_metadata: {
            timestamp: new Date().toISOString(),
            scenario: scenario,
            is_long_term: true,
            duration_days: totalDays,
            settings: { ...localSettings, longTermConfig },
            inputs: {
                grid_limit_kw: localSettings.grid_limit_kw,
                num_chargers: localSettings.num_chargers,
                initial_soc_fraction: 1.0,
                min_final_soc_fraction: 0.2,
                time_step_minutes: localSettings.time_resolution,
                buses: projectData.buses || [],
                pv_config: pvConfig,
                bess_config: bessConfig,
                start_date: longTermConfig.startDate,
                end_date: longTermConfig.endDate
            }
        }
      };

      setTimeout(async () => {
        try {
          addLog('Finalizing and saving results...');
          await setItem('optimization_results', finalPayload);
          addLog('Results successfully saved.');
          onComplete('results');
        } catch (error) {
          addLog(`Finalization Error: ${error.message}`);
          console.error("Storage failed:", error);
          
          // True fallback: if IndexedDB completely failed, try pruned localStorage save
          try {
            addLog('IndexedDB failed. Trying pruned localStorage fallback...');
            const prunedPayload = {
              ...finalPayload,
              schedules_by_day: null,
              diagnostics_by_day: null,
              soc_profiles_by_day: null,
              storage_pruned: true,
              storage_message: "Detailed per-bus schedules were removed to fit simulation results in browser memory due to database failure."
            };
            localStorage.setItem('optimization_results', JSON.stringify(prunedPayload));
            addLog('Successfully saved pruned version to localStorage.');
            onComplete('results');
          } catch (e3) {
            addLog('Critical Error: Could not save results. Storage failed.');
          }
        }
      }, 1000);

    } catch (error) {
      addLog(`Long-Term Error: ${error.message}`);
      setStatus('ready');
      setProgress(0);
    }
  };

  const handleValidation = async () => {
    setIsValidating(true);
    addLog('Starting plausibility check...');
    
    const numPeriods = (localSettings.planning_horizon * 60) / localSettings.time_resolution;
    const inputs = {
      scenario: scenario,
      planning_horizon_hours: localSettings.planning_horizon,
      time_step_minutes: localSettings.time_resolution,
      buses: projectData.buses.length > 0 ? projectData.buses.map(bus => {
          const initFrac = projectData.meta.initial_soc_fraction || 1.0;
          const reserveFrac = projectData.meta.min_final_soc_fraction || 0.2;
          const battery = bus.max_battery_capacity_kwh || projectData.constraints.max_battery_capacity_kwh || 350;
          
          return {
            ...bus,
            initial_soc_kwh: battery * initFrac,
            min_final_soc_kwh: battery * reserveFrac,
            efficiency: bus.efficiency || localSettings.efficiency,
            max_power_kw: bus.max_power_kw || localSettings.max_power_per_bus,
            consumption_wh_m: bus.consumption_wh_m || localSettings.consumption_wh_m,
            availability: tileVector(bus.availability, numPeriods),
            trip_energy_profile_kwh: tileVector(bus.trip_energy_profile_kwh, numPeriods)
          };
      }) : [],
      electricity_prices: tileVector(projectData.pricing, numPeriods),
      charger_capacity_kw: localSettings.charger_capacity_kw,
      grid_limit_kw: localSettings.grid_limit_kw,
      use_next_day_readiness: localSettings.use_next_day_readiness,
      pv_config: (scenario !== 'baseline') ? {
        ...pvConfig,
        latitude: projectData.meta.latitude,
        longitude: projectData.meta.longitude,
        reference_date: weatherDate
      } : null,
      bess_config: (scenario === 'bess' || scenario === 'pv_bess') ? {
        ...bessConfig,
        reference_date: weatherDate
      } : null
    };

    try {
      const result = await validateInputs(inputs);
      setValidationResult(result);
      if (result.status === 'valid') {
        addLog('Plausibility check passed: Data is consistent.');
      } else {
        addLog(`Plausibility check found ${result.issues.length} issues.`);
      }
    } catch (err) {
      addLog(`Validation Error: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      setProjectData(prev => ({
        ...prev,
        constraints: {
          ...prev.constraints,
          ...localSettings,
          pv_config: pvConfig,
          bess_config: bessConfig
        },
        meta: {
          ...prev.meta,
          planning_horizon: localSettings.planning_horizon,
          time_resolution: localSettings.time_resolution,
          scenario: scenario,
          default_consumption_wh_m: localSettings.consumption_wh_m
        }
      }));
      
      setSaveStatus('saved');
      addLog('Project configuration saved successfully.');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      addLog(`Save Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="run-container animate-in">
      <div className="section-header">
        <h1>Optimization Engine</h1>
        <p>Configure parameters and run the cost-minimization solver.</p>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          {status === 'ready' && (
            <>
               <div className={`badge ${projectData.meta.data_source === 'uploaded' ? 'badge-primary' : 'badge-warning'}`}>
                 {projectData.meta.data_source === 'uploaded' ? 'DATA: UPLOADED' : 'DATA: MOCK'}
               </div>
               <button 
                 className="btn btn-outline btn-sm"
                 onClick={() => setShowInputData(!showInputData)}
               >
                 <TableIcon size={14} /> {showInputData ? 'Hide Summary' : 'Show Summary'}
               </button>
            </>
          )}
        </div>
      </div>

      {status === 'ready' && (
        <div className="animate-in">
          <div className="grid grid-cols-4 gap-6 mb-8">
            <div className="card stat-card shadow-sm">
               <div className="stat-info w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">System Status</span>
                    <InfoTooltip 
                      title="Engine Readiness" 
                      text="Indicates if the optimization engine has successfully validated all mandatory system inputs (schedules, prices, and constraints) and is currently ready for mathematical solving." 
                      align="right"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-primary font-bold text-base">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                    READY
                  </div>
               </div>
            </div>

            <div className="card stat-card shadow-sm">
               <div className="stat-info w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">Fleet Size</span>
                    <InfoTooltip 
                      title="Computational Scale" 
                      text="The total volume of unique vehicle schedules (Umläufe) identified in the current project data. This parameter directly influences the complexity and resolution time of the MILP solver." 
                      align="right"
                    />
                  </div>
                  <div className="stat-value text-primary">{projectData.buses.length || 0} <span className="text-xs text-muted font-normal ml-1">Umläufe</span></div>
               </div>
            </div>

            <div className="card stat-card shadow-sm">
               <div className="stat-info w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">Energy Sum</span>
                    <InfoTooltip 
                      title="Gross Demand Forecast" 
                      text="The aggregate electrical energy (kWh) required to fulfill all scheduled vehicle trips over the planning horizon, including safety buffers and operational SoC reserves." 
                      align="right"
                    />
                  </div>
                  <div className="stat-value text-primary">
                    {Math.round(projectData.buses.reduce((acc, b) => acc + (b.energy_demand_kwh || 0), 0)).toLocaleString()} <span className="text-xs text-muted font-normal ml-1">kWh</span>
                  </div>
               </div>
            </div>

            <div className="card stat-card shadow-sm">
               <div className="stat-info w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">Strategy</span>
                    <InfoTooltip 
                      title="Pricing Paradigm" 
                      text="The economic framework used for optimization. 'DYNAMIC' strategy actively shifts charging sessions to low-price market windows to maximize operational expenditure (OPEX) savings." 
                      align="right"
                    />
                  </div>
                  <div className="text-sm font-bold text-primary truncate">
                    {projectData.pricing.length > 0 ? "DYNAMIC" : "FIXED RATE"}
                  </div>
               </div>
            </div>
          </div>

          <div className="card shadow-sm mb-8">
            <h3 className="card-title text-primary mb-4 flex items-center gap-2">
              <TableIcon size={18} className="text-primary" /> 
              Select Scenario Mode
            </h3>
            <div className="flex gap-4">
              {[
                { id: 'baseline', label: 'Baseline', icon: <Battery /> },
                { id: 'pv', label: 'Baseline + PV', icon: <Sun /> },
                { id: 'bess', label: 'Baseline + BESS', icon: <Layers /> },
                { id: 'pv_bess', label: 'Full PV + BESS', icon: <Zap /> },
                { id: 'compare_all', label: 'Compare All', icon: <LayoutDashboard /> }
              ].map(opt => {
                const isCompareAllDisabled = opt.id === 'compare_all' && simulationMode === 'long_term';
                return (
                  <div
                    key={opt.id}
                    className="flex-1 relative"
                    style={isCompareAllDisabled ? { userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none', pointerEvents: 'none' } : {}}
                  >
                    <button
                      disabled={isCompareAllDisabled}
                      onClick={() => setScenario(opt.id)}
                      className={`w-full flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                        scenario === opt.id 
                        ? 'border-primary bg-primary/5 text-primary' 
                        : 'border-border hover:border-primary/30 text-muted'
                      }`}
                    >
                      <div className="p-2 transition-colors">
                        {React.cloneElement(opt.icon, { size: 24, className: scenario === opt.id ? 'text-primary' : 'text-muted/40' })}
                      </div>
                      <span className="font-bold text-xs">{opt.label}</span>
                    </button>
                    {isCompareAllDisabled && (
                      <div 
                        className="card-disabled-overlay" 
                        style={{ 
                          position: 'absolute',
                          top: '-4px',
                          bottom: '-4px',
                          left: '-4px',
                          right: '-4px',
                          borderRadius: '12px', 
                          zIndex: 5,
                          background: 'rgba(248, 250, 252, 0.6)',
                          backdropFilter: 'blur(5px)',
                          WebkitBackdropFilter: 'blur(5px)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '4px',
                        }}
                      >
                        <div className="disabled-banner text-[8px] uppercase tracking-wider font-bold" style={{ padding: '0.25rem 0.5rem', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)', textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word', width: '90%' }}>
                          Disabled in long term
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8">
            {/* Geographic Site Context */}
            <div className="card shadow-sm">
              <div 
                className="flex justify-between items-center cursor-pointer"
                onClick={() => setShowGeographicSettings(!showGeographicSettings)}
              >
                <h3 className="card-title text-primary font-bold flex items-center gap-2 m-0 p-0" style={{ margin: 0, padding: 0 }}>
                  <MapPin size={18} className="text-primary" /> Geographic Site Context
                </h3>
                <span className="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 select-none">
                  {showGeographicSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showGeographicSettings ? "Hide Options" : "Show Options"}
                </span>
              </div>
              
              {showGeographicSettings && (
                <div className="mt-6 animate-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <p className="text-muted text-xs m-0 p-0">
                      Define coordinates to enable realistic weather-based PV generation and regional price forecasting. Default set to <b>Wels, Austria</b>.
                    </p>
                    <button 
                      className="btn btn-outline btn-sm h-8 shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 shrink-0"
                      style={{ margin: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGetCurrentLocation();
                      }}
                    >
                      <Navigation size={12} className="text-primary" /> Use Current Location
                    </button>
                  </div>

                  <div className="form-group mb-4 relative">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Search Location by Name</label>
                      <InfoTooltip title="Geocoding" text="Search for a specific location to automatically pull latitude and longitude coordinates." />
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1 group">
                        <input 
                          type="text"
                          className="form-input text-xs h-9 w-full px-3 transition-all focus:ring-2 focus:ring-primary/20"
                          placeholder="e.g. Vienna, Austria..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchLocation()}
                        />
                      </div>
                      <button 
                        className="btn btn-primary px-4 h-9 flex items-center justify-center font-bold text-xs"
                        onClick={handleSearchLocation}
                        disabled={isSearching}
                      >
                        {isSearching ? <Loader2 size={16} className="animate-spin" /> : 'SEARCH'}
                      </button>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white rounded-lg shadow-xl overflow-hidden border border-border animate-in fade-in slide-in-from-top-1">
                        {searchResults.map((loc, i) => (
                          <button
                            key={i}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary/5 transition-colors flex items-center justify-between group"
                            onClick={() => selectLocation(loc)}
                          >
                            <div>
                              <span className="font-bold text-text-primary">{loc.name},</span>
                              <span className="text-muted ml-2 text-xs">{loc.admin1 ? `${loc.admin1}, ` : ''}{loc.country}</span>
                            </div>
                            <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity font-bold">Select Coords</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
                    <div className="form-group mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Latitude (°N)</label>
                        <InfoTooltip title="Site Location" text="Geographic latitude coordinate of the charging depot." />
                      </div>
                      <input 
                        type="number" step="0.0001"
                        className="form-input text-xs h-9"
                        value={projectData.meta.latitude || ''}
                        onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, latitude: Number(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Longitude (°E)</label>
                        <InfoTooltip title="Site Location" text="Geographic longitude coordinate of the charging depot." />
                      </div>
                      <input 
                        type="number" step="0.0001"
                        className="form-input text-xs h-9"
                        value={projectData.meta.longitude || ''}
                        onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, longitude: Number(e.target.value) } }))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Advanced & Solver Settings */}
            <div className="card shadow-sm">
              <div 
                className="flex justify-between items-center cursor-pointer"
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              >
                <h3 className="card-title text-primary flex items-center gap-2 m-0 p-0" style={{ margin: 0, padding: 0 }}>
                  <Sliders size={18} className="text-primary" /> Advanced & Solver Settings
                </h3>
                <span className="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 select-none">
                  {showAdvancedSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showAdvancedSettings ? "Hide Options" : "Show Options"}
                </span>
              </div>
              
              {showAdvancedSettings && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Scenario Name</label>
                      <InfoTooltip title="Scenario ID" text="Identification label for this optimization scenario." />
                    </div>
                    <input 
                      className="form-input text-xs h-9" 
                      value={projectData.meta.scenario_name || ''} 
                      onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, scenario_name: e.target.value } }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Default Battery Usage (Wh/m)</label>
                      <InfoTooltip title="Consumption" text="The fleet-wide baseline energy consumption. Used when no vehicle-specific consumption is defined." />
                    </div>
                    <input 
                      className="form-input text-xs h-9" 
                      type="number" 
                      step="0.01"
                      value={localSettings.consumption_wh_m} 
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, consumption_wh_m: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Solver Time Limit (s)</label>
                      <InfoTooltip title="Timeout" text="Hard limit for the solver duration on the server side." />
                    </div>
                    <input 
                      className="form-input text-xs h-9" 
                      type="number" 
                      value={projectData.meta.time_limit || 60} 
                      onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, time_limit: Number(e.target.value) } }))}
                    />
                  </div>
                  
                  <div />
                </div>
              )}
            </div>

            {/* Time Grid & Policy */}
            <div className="card shadow-sm col-span-2">
              <h3 className="card-title text-primary flex items-center gap-2"><Clock size={16} className="text-primary" /> Time Grid & Policy</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
                <div 
                  className="form-group mb-0 relative"
                  style={simulationMode === 'long_term' ? { userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none', pointerEvents: 'none' } : {}}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Planning Horizon (h)</label>
                      <InfoTooltip title="Total Duration" text="Optimization timeframe." />
                    </div>
                    <input 
                      type="number"
                      className="form-input h-9 text-xs"
                      value={localSettings.planning_horizon}
                      disabled={simulationMode === 'long_term'}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, planning_horizon: Number(e.target.value) }))}
                    />
                  </div>
                  {simulationMode === 'long_term' && (
                    <div 
                      className="card-disabled-overlay" 
                      style={{ 
                        position: 'absolute',
                        top: '-8px',
                        bottom: '-8px',
                        left: '-24px',
                        width: 'calc(100% + 48px)',
                        borderRadius: '8px', 
                        zIndex: 5,
                        background: 'rgba(248, 250, 252, 0.6)',
                        backdropFilter: 'blur(5px)',
                        WebkitBackdropFilter: 'blur(5px)',
                        maskImage: 'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
                        WebkitMaskImage: 'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
                      }}
                    >
                      <div className="disabled-banner text-[8px] uppercase tracking-wider font-bold" style={{ padding: '0.25rem 0.6rem', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)' }}>
                        Disabled in long term view
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Time Resolution (min)</label>
                    <InfoTooltip title="Optimization Step" text="Interval length for discrete steps." />
                  </div>
                  <select 
                    className={`form-input h-9 text-xs ${projectData.meta.data_source === 'uploaded' ? 'bg-muted/5 cursor-not-allowed opacity-60' : ''}`}
                    value={localSettings.time_resolution}
                    disabled={projectData.meta.data_source === 'uploaded'}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, time_resolution: Number(e.target.value) }))}
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Optimality Gap (%)</label>
                    <InfoTooltip title="Solver Precision" text="Tolerance for the optimization gap." />
                  </div>
                  <input 
                    type="number" step="0.01"
                    className="form-input h-9 text-xs"
                    value={projectData.meta.optimality_gap || 0.1}
                    onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, optimality_gap: Number(e.target.value) } }))}
                  />
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Operational Policy</label>
                    <InfoTooltip title="Fleet Readiness" text="Prioritize next-day early mobility." />
                  </div>
                  <div className="flex h-9 items-center">
                    <button 
                      onClick={() => setLocalSettings(prev => ({ ...prev, use_next_day_readiness: !prev.use_next_day_readiness }))}
                      className={`chart-toggle-pill ${localSettings.use_next_day_readiness ? 'active' : ''}`}
                      style={{ '--pill-color': 'var(--primary)', width: 'full', height: '36px', padding: '0 12px', flex: 1 }}
                    >
                      <CheckCircle size={14} /> Next-Day Readiness
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xxs text-muted opacity-40 uppercase tracking-tight mt-1 px-1">
                Guarantees charge for tomorrow's first shifts.
              </p>
            </div>

            <div className="card shadow-sm">
              <h3 className="card-title text-primary flex items-center gap-2"><Battery size={18} className="text-primary" /> Vehicle Parameters</h3>
              <div className="grid grid-cols-3 gap-x-4 gap-y-4 mt-4">
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Efficiency (η)</label>
                    <InfoTooltip title="Charging Efficiency" text="Round-trip charging efficiency of the vehicle battery." />
                  </div>
                  <input 
                    type="number" step="0.01" min="0" max="1"
                    className="form-input text-xs h-9" 
                    value={localSettings.efficiency}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, efficiency: Number(e.target.value) }))}
                  />
                </div>
                
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Bus Max Power (kW)</label>
                    <InfoTooltip title="Charging Speed" text="Maximum charging speed per individual vehicle." />
                  </div>
                  <input 
                    type="number"
                    className="form-input text-xs h-9"
                    value={localSettings.max_power_per_bus}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, max_power_per_bus: Number(e.target.value) }))}
                  />
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Max Capacity (kWh)</label>
                    <InfoTooltip title="Default Battery Size" text="Default battery capacity fallback per bus if not specified in dataset." />
                  </div>
                  <input 
                    type="number"
                    className="form-input text-xs h-9"
                    value={projectData.constraints.max_battery_capacity_kwh || 350} 
                    onChange={(e) => setProjectData(prev => ({ 
                      ...prev, 
                      constraints: { ...prev.constraints, max_battery_capacity_kwh: Number(e.target.value) } 
                    }))}
                  />
                </div>
              </div>
            </div>

            <div className="card shadow-sm">
              <h3 className="card-title text-primary flex items-center gap-2"><Zap size={18} className="text-primary" /> Depot Infrastructure</h3>
              <div className="grid grid-cols-3 gap-x-4 gap-y-4 mt-4">
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Charger Cap (kW)</label>
                    <InfoTooltip title="Depot Capacity" text="Aggregate power limit of all depot charging stations." />
                  </div>
                  <input 
                    type="number"
                    className="form-input text-xs h-9" 
                    value={localSettings.charger_capacity_kw}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, charger_capacity_kw: Number(e.target.value) }))}
                  />
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Grid Limit (kW)</label>
                    <InfoTooltip title="Utility Limit" text="Max power available from the utility grid." />
                  </div>
                  <input 
                    type="number"
                    className="form-input text-xs h-9"
                    value={localSettings.grid_limit_kw}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, grid_limit_kw: Number(e.target.value) }))}
                  />
                </div>

                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">CO2 Intensity (g/kWh)</label>
                    <InfoTooltip title="Emissions Factor" text="Local grid CO2 intensity used for calculating report carbon offsets." />
                  </div>
                  <input 
                    type="number"
                    className="form-input text-xs h-9"
                    value={projectData.meta.co2_emission_factor ?? 400.0} 
                    onChange={(e) => setProjectData(prev => ({ ...prev, meta: { ...prev.meta, co2_emission_factor: Number(e.target.value) } }))}
                  />
                </div>
              </div>
            </div>

            {(scenario === 'pv' || scenario === 'pv_bess' || scenario === 'compare_all') && (
              <div className="card shadow-sm border-primary/20 bg-primary/2">
                <h3 className="card-title text-primary"><Zap size={18} /> Photovoltaic (PV) Configuration</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Peak Power (kWp)</label>
                      <InfoTooltip title="PV Peak" text="Total peak power output of the array under standard conditions." />
                    </div>
                    <input 
                      type="number"
                      className="form-input h-9 text-xs"
                      value={pvConfig.capacity_kw}
                      onChange={(e) => setPvConfig(prev => ({ ...prev, capacity_kw: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">PV Profile Mode</label>
                      <InfoTooltip title="Generation Model" text="Diurnal curve or irradiation data profile." />
                    </div>
                    <select 
                      className="form-input h-9 text-xs"
                      value={pvConfig.profile_mode}
                      onChange={(e) => setPvConfig(prev => ({ ...prev, profile_mode: e.target.value }))}
                    >
                      <option value="bell_curve">Standard Bell-Curve (Auto)</option>
                      <option value="open_meteo">Open-Meteo Calculation</option>
                      <option disabled>Custom Upload (CSV)</option>
                    </select>
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Curtailment Policy</label>
                      <InfoTooltip align="right" title="Curtailment" text="Allows the solver to waste excess PV energy if storage is full." />
                    </div>
                    <div className="flex h-9 items-center">
                      <button 
                        onClick={() => setPvConfig(prev => ({ ...prev, allow_curtailment: !prev.allow_curtailment }))}
                        className={`chart-toggle-pill ${pvConfig.allow_curtailment ? 'active' : ''}`}
                        style={{ '--pill-color': 'var(--primary)', width: 'fit-content', height: '36px', padding: '0 12px' }}
                      >
                        Permit Curtailment
                      </button>
                    </div>
                  </div>

                  {pvConfig.profile_mode === 'open_meteo' ? (
                    <div className="form-group mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Reference Date</label>
                        <InfoTooltip title="Historical/Forecast Date" text="The date used to pull weather data from Open-Meteo." />
                      </div>
                      <input 
                        type="date"
                        className="form-input h-9 text-xs"
                        value={weatherDate}
                        onChange={(e) => {
                          setWeatherDate(e.target.value);
                          setPvConfig(prev => ({ ...prev, reference_date: e.target.value }));
                        }}
                      />
                    </div>
                  ) : <div />}
                </div>
              </div>
            )}

            {(scenario === 'bess' || scenario === 'pv_bess' || scenario === 'compare_all') && (
              <div className="card shadow-sm border-primary/20 bg-primary/2">
                <h3 className="card-title text-primary"><Battery size={18} /> BESS Configuration (Stationary Storage)</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Capacity (kWh)</label>
                      <InfoTooltip title="Storage Size" text="Total energy storage capacity." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={bessConfig.capacity_kwh}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, capacity_kwh: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Max Charge (kW)</label>
                      <InfoTooltip title="Charging Power" text="Peak electrical power the BESS can absorb." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={bessConfig.max_charge_power_kw}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, max_charge_power_kw: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Max Discharge (kW)</label>
                      <InfoTooltip title="Discharge Power" text="Peak electrical power the BESS can provide." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={bessConfig.max_discharge_power_kw}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, max_discharge_power_kw: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Efficiency (η)</label>
                      <InfoTooltip title="BESS Efficiency" text="Round-trip storage efficiency." />
                    </div>
                    <input 
                      type="number" step="0.01" className="form-input h-9 text-xs"
                      value={bessConfig.efficiency}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, efficiency: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Initial SoC (kWh)</label>
                      <InfoTooltip title="Starting Energy" text="Energy level at the start of simulation." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={bessConfig.initial_soc_kwh}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, initial_soc_kwh: Number(e.target.value) }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Min SoC (%)</label>
                      <InfoTooltip title="Low Bound" text="Safety boundary for discharge." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={Math.round((bessConfig.min_soc_kwh / (bessConfig.capacity_kwh || 1)) * 100)}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, min_soc_kwh: (Number(e.target.value) / 100) * prev.capacity_kwh }))}
                    />
                  </div>

                  <div className="form-group mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Max SoC (%)</label>
                      <InfoTooltip title="High Bound" text="Safety boundary for charging." />
                    </div>
                    <input 
                      type="number" className="form-input h-9 text-xs"
                      value={Math.round((bessConfig.max_soc_kwh / (bessConfig.capacity_kwh || 1)) * 100)}
                      onChange={(e) => setBessConfig(prev => ({ ...prev, max_soc_kwh: (Number(e.target.value) / 100) * prev.capacity_kwh }))}
                    />
                  </div>
                  
                  <div />
                </div>

                {/* Temperature Derating Toggle & Advanced Section */}
                <div className="mt-6 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setBessConfig(prev => ({ ...prev, enable_temperature_capacity_derating: !prev.enable_temperature_capacity_derating }))}
                        className={`chart-toggle-pill ${bessConfig.enable_temperature_capacity_derating ? 'active' : ''}`}
                        style={{ '--pill-color': 'var(--primary)', width: 'fit-content', height: '36px', padding: '0 12px' }}
                      >
                        {bessConfig.enable_temperature_capacity_derating ? <CheckCircle size={14} /> : <Zap size={14} />}
                        Ambient Temperature Derating
                      </button>
                      <InfoTooltip title="Thermal Derating" text="Dynamically adjusts BESS capacity based on ambient temperature and estimated cell thermal state." />
                    </div>
                    
                    {bessConfig.enable_temperature_capacity_derating && (
                      <button 
                        onClick={() => setShowAdvancedBess(!showAdvancedBess)}
                        className="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 hover:opacity-70 transition-opacity"
                      >
                        {showAdvancedBess ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {showAdvancedBess ? "Hide Advanced" : "Advanced Settings"}
                      </button>
                    )}
                  </div>

                  {bessConfig.enable_temperature_capacity_derating && showAdvancedBess && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-6 p-4 rounded-lg bg-black/5 animate-in slide-in-from-top-2 duration-300">
                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Min Op Temp (°C)</label>
                          <InfoTooltip title="Safety Cutoff" text="The safety cutoff temperature. Below this limit, the BESS is blocked from discharging or charging to prevent cell damage. Typical: -10°C to -20°C." />
                        </div>
                        <input 
                          type="number" className="form-input h-9 text-xs"
                          value={bessConfig.min_modeled_cell_temperature_c}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, min_modeled_cell_temperature_c: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Tau (Hours)</label>
                          <InfoTooltip title="Thermal Decay" text="Thermal time constant representing how long it takes for the battery to reach ~63% of ambient temperature. Typical: 10 to 24 hours." />
                        </div>
                        <input 
                          type="number" step="0.1" className="form-input h-9 text-xs"
                          value={bessConfig.thermal_time_constant_hours}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, thermal_time_constant_hours: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Weather Date</label>
                          <InfoTooltip title="Reference Date" text="The historical or forecast date used to pull realistic hourly ambient temperature profiles from the Open-Meteo API." />
                        </div>
                        <input 
                          type="date"
                          className="form-input h-9 text-xs"
                          value={weatherDate}
                          onChange={(e) => {
                            setWeatherDate(e.target.value);
                            setPvConfig(prev => ({ ...prev, reference_date: e.target.value }));
                          }}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Init Cell Temp (°C)</label>
                          <InfoTooltip title="Initial State" text="The starting temperature of the battery cells. If set to 'Auto' (empty), it defaults to the ambient temperature at T=0. Typical: 15°C to 25°C." />
                        </div>
                        <input 
                          type="number" step="0.1" 
                          className="form-input h-9 text-xs"
                          placeholder="Auto"
                          value={bessConfig.initial_cell_temperature_c ?? ''}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, initial_cell_temperature_c: e.target.value === '' ? null : Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Heat Gain (°C/kWh)</label>
                          <InfoTooltip title="Internal Heating" text="Internal heating coefficient. Defines the temperature increase (°C) for every kilowatt-hour of energy processed. Typical: 0.05 to 0.2 °C/kWh." />
                        </div>
                        <input 
                          type="number" step="0.001" 
                          className="form-input h-9 text-xs"
                          value={bessConfig.thermal_heating_coefficient}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, thermal_heating_coefficient: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Full Cap Temp (°C)</label>
                          <InfoTooltip title="Efficiency Anchor" text="The optimal temperature at which the BESS can access 100% of its nominal capacity. Typical: 25°C to 30°C." />
                        </div>
                        <input 
                          type="number" step="1" 
                          className="form-input h-9 text-xs"
                          value={bessConfig.full_capacity_temperature_c}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, full_capacity_temperature_c: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Floor Factor</label>
                          <InfoTooltip title="Capacity Floor" text="The absolute lower boundary for battery capacity. Even at extreme sub-zero temperatures, this fraction remains available. Typical: 0.7 to 0.8." />
                        </div>
                        <input 
                          type="number" step="0.01" className="form-input h-9 text-xs"
                          value={bessConfig.min_capacity_factor}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, min_capacity_factor: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Ref Temp (°C)</label>
                          <InfoTooltip title="Rating Standard" text="The standard temperature (usually 25°C) at which the battery's nominal capacity was rated by the manufacturer. Typical: 25°C." />
                        </div>
                        <input 
                          type="number" step="1" className="form-input h-9 text-xs"
                          value={bessConfig.reference_temperature_c}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, reference_temperature_c: Number(e.target.value) }))}
                        />
                      </div>

                      <div className="form-group mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Input Source</label>
                          <InfoTooltip title="Data Origin" text="Determine if temperatures are fetched dynamically from weather APIs, manual profiles, or a static constant value." />
                        </div>
                        <select 
                          className="form-input h-9 text-xs"
                          value={bessConfig.temperature_source}
                          onChange={(e) => setBessConfig(prev => ({ ...prev, temperature_source: e.target.value }))}
                        >
                          <option value="open_meteo">Open-Meteo AI</option>
                          <option value="manual">Manual Override</option>
                          <option value="constant">Static Constant</option>
                        </select>
                      </div>
                      
                      <div />
                    </div>
                  )}
                </div>
              </div>
            )}




          </div>

          <div className="card shadow-sm mb-8">
            <h3 className="card-title text-primary mb-4 flex items-center gap-2">
              <Layers size={18} /> 
              Simulation Mode
              <InfoTooltip 
                text="Choose between a standard short-term optimization or a multi-day long-term simulation using a rolling-horizon approach."
              />
            </h3>
            
            <div className="flex gap-4 mb-2">
              {[
                { id: 'single', label: 'Short-Term', icon: <Zap size={14} /> },
                { id: 'long_term', label: 'Long-Term', icon: <Clock size={14} /> }
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => {
                    setSimulationMode(mode.id);
                    if (mode.id === 'long_term' && scenario === 'compare_all') {
                      setScenario('baseline');
                      setShowCompareAllToast(true);
                      setTimeout(() => {
                        setShowCompareAllToast(false);
                      }, 6000);
                    }
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 transition-all font-bold text-xs ${
                    simulationMode === mode.id 
                    ? 'border-primary bg-primary/5 text-primary' 
                    : 'border-border hover:border-primary/20 text-muted'
                  }`}
                >
                  {mode.icon}
                  {mode.label}
                </button>
              ))}
            </div>

            {simulationMode === 'long_term' && (
              <div className="grid grid-cols-3 gap-x-4 gap-y-4 mt-4 animate-in slide-in-from-top-2 duration-300">
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Start Date</label>
                    <InfoTooltip title="Range Start" text="The first day of the simulation period." />
                  </div>
                  <input 
                    type="date"
                    value={longTermConfig.startDate}
                    onChange={(e) => setLongTermConfig({...longTermConfig, startDate: e.target.value})}
                    className="form-input h-9 text-xs"
                  />
                </div>
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">End Date</label>
                    <InfoTooltip title="Range End" text="The last day of the simulation period." />
                  </div>
                  <input 
                    type="date"
                    value={longTermConfig.endDate}
                    onChange={(e) => setLongTermConfig({...longTermConfig, endDate: e.target.value})}
                    className="form-input h-9 text-xs"
                  />
                </div>
                <div className="form-group mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <label className="form-label text-[10px] uppercase font-bold text-muted mb-0">Chunk Horizon</label>
                    <InfoTooltip title="MPC Window" text="Resolution of individual optimization chunks. Larger windows allow better look-ahead but increase solve time." />
                  </div>
                  <select
                    value={longTermConfig.chunkSizeHours}
                    onChange={(e) => setLongTermConfig({...longTermConfig, chunkSizeHours: parseInt(e.target.value)})}
                    className="form-input h-9 text-xs"
                  >
                    <option value={24}>24 Hours</option>
                    <option value={48}>48 Hours</option>
                    <option value={72}>72 Hours</option>
                  </select>
                </div>
              </div>
            )}
            
            {simulationMode === 'long_term' && longTermConfig.startDate && longTermConfig.endDate && (
              (() => {
                const totalDays = Math.round((new Date(longTermConfig.endDate) - new Date(longTermConfig.startDate)) / (1000 * 60 * 60 * 24)) + 1;
                if (totalDays > 90) {
                  return (
                    <div className="mt-4 p-4 bg-success/5 rounded-2xl border border-success/20 flex items-start gap-3 animate-in slide-in-from-top-2">
                       <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center text-success shrink-0">
                          <CheckCircle size={20} className="text-success animate-pulse" />
                       </div>
                       <div>
                          <h4 className="text-xs font-bold text-success uppercase tracking-widest mb-1">Heavy Simulation Database Storage ({totalDays} Days)</h4>
                          <p className="text-[11px] text-muted leading-relaxed">
                            Simulations exceeding 90 days generate massive datasets. High-capacity local database storage (IndexedDB) is active, ensuring that 
                            <strong> all high-resolution per-bus diagnostics and daily details are fully preserved</strong> and inspectable.
                          </p>
                       </div>
                    </div>
                  );
                }
                return null;
              })()
            )}
          </div>

          <div className="card shadow-lg p-6 flex flex-col items-center">
            {validationResult && (
              <div className={`w-full p-4 rounded-xl border mb-6 ${
                validationResult.status === 'valid' ? 'bg-success/5 border-success/20' : 
                'bg-warning/5 border-warning/20 text-warning'
              }`}>
                <div className="flex items-center gap-2 mb-2 font-bold text-sm">
                  {validationResult.status === 'valid' ? <CheckCircle size={18} className="text-success" /> : <AlertCircle size={18} />}
                  System Status: {validationResult.status.toUpperCase()}
                </div>
                {validationResult.issues.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {validationResult.issues.map((issue, i) => (
                      <li key={i}>• {issue.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            
            <div className="flex items-center gap-4">
              <button 
                className={`btn btn-outline px-6 h-11 ${isValidating ? 'opacity-50' : ''}`}
                onClick={handleValidation}
                disabled={isValidating}
              >
                {isValidating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Run Check
              </button>

              <button 
                className={`btn btn-outline px-6 h-11 transition-all ${saveStatus === 'saved' ? 'border-success text-success' : ''}`}
                onClick={handleSave}
                disabled={isSaving}
              >
                {saveStatus === 'saved' ? <CheckCircle size={16} /> : <Save size={16} />}
                {saveStatus === 'saved' ? 'Saved!' : 'Save Config'}
              </button>

                <button 
                className={`btn btn-primary px-8 h-11 shadow-md ${(!validationResult || validationResult.status === 'invalid') ? 'opacity-50 grayscale' : ''}`}
                onClick={executeSimulation}
                disabled={!validationResult || validationResult.status === 'invalid'}
              >
                <Zap size={18} /> {simulationMode === 'long_term' ? 'Run Simulation' : 'Run Optimization'}
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'running' && (
        <div className="running-state">
          <div className="running-spinner-pulse-wrapper">
            <Loader2 size={48} className="running-spinner" />
          </div>
          <h2 className="text-xl font-bold">Optimizing Schedule...</h2>
          <p className="text-secondary">Solving MILP for cost minimization</p>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          </div>
          <span className="progress-text">{progress}%</span>
          {timeLeftText && (
            <div className="time-left-text" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px', fontWeight: '650', letterSpacing: '0.02em' }}>
              {timeLeftText}
            </div>
          )}
        </div>
      )}

      {status === 'success' && (
        <div className="success-state text-center py-10">
          <div className="run-icon-bg success mb-4">
            <CheckCircle size={40} className="text-success" />
          </div>
          <h2 className="text-xl font-bold">Optimization Successful</h2>
          <p className="text-secondary mb-6">Optimal charging schedule has been generated.</p>
          <button className="btn btn-primary" onClick={onComplete}>
            View Results
          </button>
        </div>
      )}

      <div className="card log-card mt-8">
        <div className="flex items-center gap-2 mb-4 border-b pb-2">
          <Terminal size={18} className="text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Solver Logs</h3>
        </div>
        <div className="log-window" ref={logWindowRef}>
          {logs.length === 0 && <p className="text-muted italic">Engine idle...</p>}
          {logs.map((log, i) => (
            <div key={i} className="log-entry">
              <span className="log-time">[{log.time}]</span>
              <span className="log-msg">{log.msg}</span>
            </div>
          ))}
          {status === 'running' && <div className="log-cursor"></div>}
        </div>
      </div>

      {showCompareAllToast && (
        <div 
          className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-white/10 flex items-center gap-3 animate-in"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            backgroundColor: '#0f172a',
            color: '#ffffff',
            padding: '12px 16px',
            borderRadius: '12px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '11px',
            maxWidth: '320px',
            pointerEvents: 'auto',
          }}
        >
          <Info size={16} className="text-primary shrink-0" />
          <div style={{ flex: 1 }}>
            <div className="font-bold mb-0.5 text-primary text-xs">Scenario Mode Reset</div>
            <div className="text-slate-300 leading-normal">"Compare All" is unavailable in Long-Term view to prevent excessive solve times. Baseline mode has been automatically selected.</div>
          </div>
          <button 
            onClick={() => setShowCompareAllToast(false)}
            className="text-slate-400 hover:text-white ml-2 font-bold text-xs"
            style={{ cursor: 'pointer', padding: '4px' }}
          >
            ✕
          </button>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .form-input.h-9 { padding-top: 0; padding-bottom: 0; }
        
        .running-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 2.5rem 0;
          width: 100%;
        }

        .running-state h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 0.5rem;
          text-align: center;
        }

        .running-state p {
          color: var(--text-secondary);
          margin-bottom: 1.5rem;
          text-align: center;
        }

        .progress-text {
          font-weight: 700;
          margin-top: 0.75rem;
          display: inline-block;
          color: var(--text-primary);
          text-align: center;
        }

        @keyframes premium-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes premium-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.9;
            filter: drop-shadow(0 0 2px rgba(14, 165, 233, 0.2));
          }
          50% {
            transform: scale(1.06);
            opacity: 1;
            filter: drop-shadow(0 0 10px rgba(14, 165, 233, 0.6));
          }
        }

        .running-spinner-pulse-wrapper {
          animation: premium-pulse 2s ease-in-out infinite;
          margin-bottom: 1.5rem;
          display: inline-block;
        }

        .running-spinner {
          animation: premium-spin 1.2s linear infinite;
          color: var(--primary);
          display: block;
        }

        .run-icon-bg {
          width: 80px;
          height: 80px;
          background: var(--primary-soft);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto;
        }

        .run-icon-bg.success {
          background: var(--badge-success-bg);
        }

        .progress-bar-container {
          width: 100%;
          max-width: 400px;
          height: 8px;
          background: var(--border-light);
          border-radius: 4px;
          margin: 0 auto;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: var(--primary);
          transition: width 0.2s ease;
        }

        .log-window {
          background: #1e293b;
          color: #e2e8f0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 1rem;
          border-radius: 8px;
          height: 250px;
          overflow-y: auto;
          font-size: 0.8125rem;
          line-height: 1.6;
        }

        .log-entry {
          display: flex;
          gap: 0.75rem;
        }

        .log-time {
          color: #94a3b8;
          flex-shrink: 0;
        }

        .log-cursor {
          width: 8px;
          height: 1.25rem;
          background: #38bdf8;
          display: inline-block;
          animation: blink 0.8s infinite;
          margin-top: 4px;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .h-9 { height: 36px; }
        .h-11 { height: 44px; }
        .gap-x-4 { column-gap: 1rem !important; }
        .gap-y-2 { row-gap: 0.5rem !important; }
        .gap-y-4 { row-gap: 1rem !important; }
        .col-span-2 { grid-column: span 2 / span 2; }
        .config-label {
          display: flex !important;
          align-items: flex-end;
          padding-bottom: 4px;
          margin: 0 !important;
          height: 100%;
        }
      `}} />
    </div>
  );
};

export default OptimizationRun;
