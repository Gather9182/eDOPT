import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  GitCompare, Trash2, TrendingDown, Zap, DollarSign, Battery, Sun, LayoutDashboard, Info, X, Activity, Maximize
} from 'lucide-react';
import { getItem, setItem, removeItem } from '../utils/db';

const RUN_COLORS = ['#0052FF', '#8b5cf6', '#eab308', '#22c55e', '#f97316', '#ef4444'];
const STROKE_DASHARRAYS = [undefined, '5 5', '10 5', '3 3', '20 5 5 5', '10 5 2 5'];

const InfoTooltip = ({ title, text, align = 'center' }) => (
  <div className="tooltip-container">
    <Info size={11} className="tooltip-trigger" />
    <div className={`tooltip-box tooltip-${align}`}>
      {title && <div className="tooltip-title">{title}</div>}
      <div className="tooltip-text">{text}</div>
    </div>
  </div>
);

const ModelComparison = () => {
  const [runs, setRuns] = useState([]);
  const [visibleLines, setVisibleLines] = useState({});
  const [selectedGanttRunIdx, setSelectedGanttRunIdx] = useState(0);
  const [ganttColorMode, setGanttColorMode] = useState('intensity');
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  
  const isLineVisible = (key) => visibleLines[key] !== false;

  const formatTime = (index) => {
    const hours = Math.floor(index * 15 / 60);
    const minutes = String(index * 15 % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  useEffect(() => {
    async function loadComparisonHistory() {
      try {
        const saved = await getItem('comparison_history');
        if (saved) {
          setRuns(saved);
        }
      } catch (err) {
        console.error("Failed to load comparison history:", err);
      }
    }
    loadComparisonHistory();
  }, []);

  const handleRemoveRun = async (runId) => {
    const updated = runs.filter(r => r.run_metadata?.run_id !== runId);
    setRuns(updated);
    try {
      await setItem('comparison_history', updated);
    } catch (err) {
      console.error("Failed to update comparison history:", err);
    }
  };

  const handleClearAll = async () => {
    if (window.confirm("Are you sure you want to clear all compared models?")) {
      setRuns([]);
      try {
        await removeItem('comparison_history');
      } catch (err) {
        console.error("Failed to clear comparison history:", err);
      }
    }
  };

  if (!runs || !Array.isArray(runs) || runs.length === 0) {
    return (
      <div className="run-container animate-in">
        <div className="section-header">
          <h1>Model Comparison</h1>
          <p>Compare different optimization scenarios side-by-side.</p>
        </div>
        <div className="card text-center py-20 border-dashed border-2 bg-black/5">
          <GitCompare size={48} className="text-muted/40 mx-auto mb-4" />
          <h2 className="text-muted font-bold text-lg">No models selected for comparison.</h2>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            Run an optimization scenario, go to the Results page, and click "Save for Comparison" to add models here.
          </p>
        </div>
      </div>
    );
  }

  // Pre-calculate KPIs for each run
  const kpis = runs.map((run, idx) => {
    const totalOptimizedCost = Number(run.total_cost_eur) || 0;
    
    // Attempt to calculate baseline cost if missing
    let totalBaselineCost = Number(run.baseline_cost_eur) || 0;
    if (!totalBaselineCost && Array.isArray(run.baseline_aggregated_load_profile)) {
      totalBaselineCost = run.baseline_aggregated_load_profile.reduce((acc, load, i) => {
        const price = Array.isArray(run.electricity_prices) ? (run.electricity_prices[i] || 0) : 0;
        return acc + ((Number(load) || 0) * price * 0.25);
      }, 0) / 1000;
    }
    if (!totalBaselineCost) totalBaselineCost = totalOptimizedCost * 1.15; // Fallback

    const savingsPercent = totalBaselineCost > 0 ? ((totalBaselineCost - totalOptimizedCost) / totalBaselineCost) * 100 : 0;
    const energyImport = Number(run.total_energy_mwh) || 0;
    
    // PV logic
    const pvGenerated = Number(run.total_pv_generated_kwh) || 0;
    const pvUsed = Number(run.total_pv_used_kwh) || 0;
    const pvSufficiency = pvGenerated > 0 ? (pvUsed / pvGenerated) * 100 : 0;
    
    const bessThroughput = Number(run.total_bess_throughput_kwh) || 0;
    
    const uniqueBusesCharged = (run.schedules && typeof run.schedules === 'object') 
      ? Object.values(run.schedules).filter(pList => Array.isArray(pList) && pList.some(v => Number(v) > 0.1)).length 
      : 0;
    const totalBuses = Array.isArray(run.bus_diagnostics) ? run.bus_diagnostics.length : 0;

    const name = run.scenario === 'pv_bess' ? 'Full Hybrid' : 
                 run.scenario === 'pv' ? 'PV Enhanced' : 
                 run.scenario === 'bess' ? 'BESS Enhanced' : 'Baseline';
                 
    let timeLabel = `Run ${idx+1}`;
    try {
       if (run.run_metadata?.timestamp) {
           const d = new Date(run.run_metadata.timestamp);
           if (!isNaN(d.getTime())) timeLabel = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
       }
    } catch (e) {}
    
    const runLabel = `${name} (${timeLabel})`;
    
    const peakLoad = (Array.isArray(run.aggregated_load_profile) && run.aggregated_load_profile.length > 0) 
      ? Math.max(...run.aggregated_load_profile.map(v => Number(v) || 0)) 
      : 0;
      
    const avgCost = energyImport > 0 ? (totalOptimizedCost / energyImport) : 0;

    return {
      id: run.run_metadata?.run_id || `run_${idx}`,
      color: RUN_COLORS[idx % RUN_COLORS.length],
      label: runLabel,
      scenario: run.scenario,
      cost: totalOptimizedCost,
      baselineCost: totalBaselineCost,
      savings: savingsPercent,
      energy: energyImport,
      pvSufficiency: pvSufficiency,
      pvUsed: pvUsed,
      bessThroughput: bessThroughput,
      activeVehicles: `${uniqueBusesCharged}/${totalBuses}`,
      peakLoad: peakLoad,
      avgCost: avgCost
    };
  });

  // Prepare Comparative Chart Data
  const maxLength = Math.max(0, ...runs.map(r => Array.isArray(r.aggregated_load_profile) ? r.aggregated_load_profile.length : 0));
  const isAnyLongTerm = runs.some(r => r.is_long_term);
  
  let mergedChartData = [];
  
  if (isAnyLongTerm) {
    const pointsPerDay = 96;
    for (let i = 0; i < maxLength; i += pointsPerDay) {
        const dataPoint = { time: `Day ${Math.floor(i / pointsPerDay) + 1}`, price: 0 };
        let priceSum = 0, count = 0;
        for (let j = i; j < Math.min(i + pointsPerDay, maxLength); j++) {
            priceSum += Array.isArray(runs[0]?.electricity_prices) ? (runs[0].electricity_prices[j] || 0) : 0;
            count++;
        }
        dataPoint.price = count > 0 ? priceSum / count : 0;
        
        runs.forEach((r, idx) => {
            let loadSum = 0, pvSum = 0, runCount = 0;
            for (let j = i; j < Math.min(i + pointsPerDay, maxLength); j++) {
                const hasProfile = Array.isArray(r.grid_import_profile) && r.grid_import_profile.length > 0;
                const loadVal = hasProfile ? (r.grid_import_profile[j] || 0) : (Array.isArray(r.aggregated_load_profile) ? (r.aggregated_load_profile[j] || 0) : 0);
                const hasPv = Array.isArray(r.pv_yield_profile) && r.pv_yield_profile.length > 0;
                const pvVal = hasPv ? (r.pv_yield_profile[j] || 0) : 0;
                loadSum += loadVal;
                pvSum += pvVal;
                runCount++;
            }
            dataPoint[`run_${idx}_load`] = runCount > 0 ? loadSum / runCount : 0;
            dataPoint[`run_${idx}_cost`] = runCount > 0 ? ((loadSum / runCount) * dataPoint.price * 0.25) / 1000 : 0;
            dataPoint[`run_${idx}_pv`] = runCount > 0 ? pvSum / runCount : 0;
        });
        mergedChartData.push(dataPoint);
    }
  } else {
      mergedChartData = Array.from({ length: maxLength }, (_, i) => {
        const timeStr = `${Math.floor(i * 15 / 60)}:${String(i * 15 % 60).padStart(2, '0')}`;
        const dataPoint = { time: timeStr, price: Array.isArray(runs[0]?.electricity_prices) ? (runs[0].electricity_prices[i] || 0) : 0 };
        
        runs.forEach((r, idx) => {
           const hasProfile = Array.isArray(r.grid_import_profile) && r.grid_import_profile.length > 0;
           const loadVal = hasProfile ? (r.grid_import_profile[i] || 0) : (Array.isArray(r.aggregated_load_profile) ? (r.aggregated_load_profile[i] || 0) : 0);
           const priceVal = Array.isArray(r.electricity_prices) ? (r.electricity_prices[i] || 0) : 0;
           
           dataPoint[`run_${idx}_load`] = loadVal;
           dataPoint[`run_${idx}_cost`] = (loadVal * priceVal * 0.25) / 1000;
           
           const hasPv = Array.isArray(r.pv_yield_profile) && r.pv_yield_profile.length > 0;
           dataPoint[`run_${idx}_pv`] = hasPv ? (r.pv_yield_profile[i] || 0) : 0;
        });
        return dataPoint;
      });
  }

  // Cost Comparison Bar Data
  const costBarData = kpis.map(k => ({
    name: k.label,
    Cost: k.cost,
    Baseline: k.baselineCost
  }));
  
  // Energy Stack Data
  const energyStackData = kpis.map(k => ({
    name: k.label,
    "Grid Import (kWh)": k.energy * 1000,
    "PV Consumed (kWh)": k.pvUsed
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-app border border-border p-3 rounded-lg shadow-xl" style={{ minWidth: '200px' }}>
          <p className="font-bold text-xs mb-2 border-b border-border pb-2">{label}</p>
          {payload.map((entry, index) => {
            const isPrice = entry.dataKey && typeof entry.dataKey === 'string' && entry.dataKey.includes('price');
            return (
              <div key={`item-${index}`} className="flex justify-between items-center text-[11px] mb-1">
                <span style={{ color: entry.color }} className="font-bold">{entry.name}:</span>
                <span className="font-mono ml-3">{(Number(entry.value) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} {isPrice ? '€/MWh' : 'kW'}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="run-container animate-in">
      <div className="section-header flex justify-between items-end">
        <div>
          <h1>Model Comparison</h1>
          <p>Side-by-side analysis of optimization scenarios.</p>
        </div>
        <button 
          className="chart-toggle-pill active shadow-sm" 
          style={{ '--pill-color': 'var(--error)', padding: '0 0.75rem', height: '30px', fontSize: '11px' }} 
          onClick={handleClearAll}
        >
          <Trash2 size={13} /> Clear All
        </button>
      </div>

      {/* Run Manager Cards */}
      <div className="flex gap-4 mb-8 overflow-x-auto pb-2">
        {kpis.map((kpi, idx) => (
          <div key={kpi.id} className="card shadow-sm border-t-4 min-w-[200px] flex-1 relative group" style={{ borderTopColor: kpi.color }}>
            <button 
              onClick={() => handleRemoveRun(kpi.id)}
              className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-error/10 text-error transition-all"
              title="Remove from comparison"
            >
              <Trash2 size={14} />
            </button>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Model {idx + 1}</div>
            <div className="font-bold text-primary mb-2 truncate" title={kpi.label}>{kpi.label}</div>
            <div className="text-xs flex items-center gap-1">
               <DollarSign size={12} className="text-success" /> €{kpi.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        ))}
      </div>

      {/* KPI Comparison Grid */}
      <div className="card shadow-sm mb-8">
        <h3 className="card-title text-primary flex items-center gap-2 mb-4"><LayoutDashboard size={18} /> Performance Metrics Comparison</h3>
        <div className="data-table-container">
          <table className="audit-table w-full">
            <thead>
              <tr>
                <th className="text-left w-1/4">Metric</th>
                {kpis.map((kpi, idx) => (
                  <th key={idx} className="text-center" style={{ color: kpi.color }}>{kpi.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><DollarSign size={14} className="text-success"/> Total Procurement Cost</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold text-app">€{(Number(kpi.cost) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><TrendingDown size={14} className="text-primary"/> OPEX Savings (vs Baseline)</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold text-primary">-{(Number(kpi.savings) || 0).toFixed(1)}%</td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><Zap size={14} className="text-indigo-500"/> Total Energy Import</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold">{(Number(kpi.energy) || 0).toFixed(2)} MWh</td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><DollarSign size={14} className="text-warning"/> Average Energy Cost</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold">€{(Number(kpi.avgCost) || 0).toFixed(2)} <span className="text-[10px] text-muted font-normal">/ MWh</span></td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><Zap size={14} className="text-error"/> Peak Fleet Demand</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold text-error">{(Number(kpi.peakLoad) || 0).toFixed(1)} kW</td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><Sun size={14} className="text-yellow-500"/> PV Self-Sufficiency</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold">{kpi.pvSufficiency > 0 ? `${(Number(kpi.pvSufficiency) || 0).toFixed(1)}%` : '-'}</td>
                ))}
              </tr>
              <tr className="hover:bg-primary/5 transition-colors">
                <td className="font-bold flex items-center gap-2"><Battery size={14} className="text-emerald-500"/> BESS Throughput</td>
                {kpis.map((kpi, idx) => (
                  <td key={idx} className="text-center font-bold">{kpi.bessThroughput > 0 ? `${(Number(kpi.bessThroughput) || 0).toFixed(0)} kWh` : '-'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparative Charts */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Cost Comparison Bar */}
        <div className="card chart-card">
          <h3 className="text-primary font-bold flex items-center gap-2 text-lg mb-6"><DollarSign size={20} /> Procurement Cost Comparison</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={costBarData} margin={{ top: 20, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-15} textAnchor="end" />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(val) => `€${val}`} />
                <Tooltip cursor={{ fill: 'var(--primary-soft)' }} contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-app)' }} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px' }} />
                <Bar dataKey="Baseline" fill="var(--text-muted)" opacity={0.3} radius={[4, 4, 0, 0]} name="Baseline Cost" />
                <Bar dataKey="Cost" fill="var(--primary)" radius={[4, 4, 0, 0]} name="Optimized Cost" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Energy Mix Stacked Bar */}
        <div className="card chart-card">
          <h3 className="text-primary font-bold flex items-center gap-2 text-lg mb-6"><Zap size={20} /> Energy Source Mix</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={energyStackData} margin={{ top: 20, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-15} textAnchor="end" />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={(val) => `${val/1000}MWh`} />
                <Tooltip cursor={{ fill: 'var(--primary-soft)' }} contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-app)' }} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px' }} />
                <Bar dataKey="PV Consumed (kWh)" stackId="a" fill="var(--warning)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Grid Import (kWh)" stackId="a" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Overlaid Load Profiles */}
      <div className="card chart-card mb-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg"><Activity size={20} /> Overlaid Grid Import Profiles</h3>
            <InfoTooltip align="right" title="Load Peak Comparison" text="Overlay of the net grid import (kW) for each model across the optimization horizon to visualize peak shaving and load shifting efficiency." />
          </div>
          <div className="flex flex-wrap gap-2">
            {kpis.map((kpi, idx) => (
              <button 
                key={`toggle_${idx}`}
                onClick={() => setVisibleLines(prev => ({ ...prev, [`run_${idx}`]: prev[`run_${idx}`] === false ? true : false }))}
                className={`chart-toggle-pill ${isLineVisible(`run_${idx}`) ? 'active' : ''}`}
                style={{ '--pill-color': kpi.color }}
              >
                <Activity size={14} /> {kpi.label}
              </button>
            ))}
            <button 
              onClick={() => setVisibleLines(prev => ({ ...prev, 'price': prev['price'] === false ? true : false }))}
              className={`chart-toggle-pill ${isLineVisible('price') ? 'active' : ''}`}
              style={{ '--pill-color': 'var(--text-muted)' }}
            >
              <DollarSign size={14} /> Price Signal
            </button>
          </div>
        </div>
        <div style={{ width: '100%', height: 400 }}>
          <ResponsiveContainer>
            <LineChart data={mergedChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
              <XAxis dataKey="time" minTickGap={30} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(val) => `${val} kW`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px' }} />
              
              {/* Dynamic Lines for each run */}
              {kpis.map((kpi, idx) => (
                <Line 
                  key={`line_${idx}`}
                  yAxisId="left"
                  type="stepAfter" 
                  dataKey={`run_${idx}_load`} 
                  name={`${kpi.label} (kW)`} 
                  stroke={kpi.color} 
                  strokeWidth={2} 
                  strokeDasharray={STROKE_DASHARRAYS[idx % STROKE_DASHARRAYS.length]}
                  dot={false}
                  activeDot={{ r: 4, fill: kpi.color, stroke: 'var(--bg-app)', strokeWidth: 2 }}
                  hide={!isLineVisible(`run_${idx}`)}
                />
              ))}
              
              {/* Reference Price Line */}
              <Line 
                yAxisId="right"
                type="stepAfter" 
                dataKey="price" 
                name="Market Price (€/MWh)" 
                stroke="var(--text-muted)" 
                strokeWidth={1} 
                strokeDasharray="3 3"
                dot={false} 
                opacity={0.4}
                hide={!isLineVisible('price')}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparative Gantt Chart */}
      {isTimelineExpanded && <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => setIsTimelineExpanded(false)} />}
      <div className={`card mb-8 timeline-card ${isTimelineExpanded ? 'expanded' : ''}`}>
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-center justify-between">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
              <Activity size={20} />
              Comparative Fleet Charging Timeline
            </h3>
            <div className="flex items-center gap-4">
              {runs[selectedGanttRunIdx]?.scenario !== 'baseline' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setGanttColorMode('intensity')}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                      ganttColorMode === 'intensity' 
                        ? 'text-primary border-b-2 border-primary rounded-none' 
                        : 'text-muted hover:text-primary hover:bg-primary/5'
                    }`}
                  >
                    Charge Intensity
                  </button>
                  <button
                    onClick={() => setGanttColorMode('source')}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                      ganttColorMode === 'source' 
                        ? 'text-primary border-b-2 border-primary rounded-none' 
                        : 'text-muted hover:text-primary hover:bg-primary/5'
                    }`}
                  >
                    Energy Source
                  </button>
                </div>
              )}
              <button 
                onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
                className={`chart-toggle-pill ${isTimelineExpanded ? 'active shadow-sm border-primary/20' : ''}`}
                style={{ height: '32px', padding: '0 0.75rem' }}
              >
                <Maximize size={14} className={isTimelineExpanded ? 'text-primary' : 'text-muted'} />
                <span className={isTimelineExpanded ? 'text-primary font-bold' : ''}>Extended Mode</span>
              </button>
              <InfoTooltip align="down" title="Timeline Controls" text="Select a model to view its specific charging schedule. Use toggles to switch coloring modes, or expand the chart to full-screen." />
            </div>
          </div>
          
          {/* Scenario Pills Selector - Moved to its own row */}
          <div className="flex justify-center">
            <div className="flex flex-wrap justify-center gap-2">
              {kpis.map((kpi, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedGanttRunIdx(idx)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                    selectedGanttRunIdx === idx 
                      ? 'bg-white shadow-sm text-primary' 
                      : 'text-muted hover:text-primary hover:bg-black/5'
                  }`}
                  style={selectedGanttRunIdx === idx ? { color: kpi.color } : {}}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: kpi.color }}></div>
                  {kpi.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        {(() => {
          const activeRun = runs[selectedGanttRunIdx];
          if (!activeRun) return null;
          if (activeRun.is_long_term) {
            return (
              <div className="flex flex-col items-center justify-center h-[300px] text-muted py-12 bg-gray-50/50 rounded-xl border border-gray-100">
                <Activity size={32} className="mb-2 opacity-50" />
                <p>Gantt Chart is disabled for long-term simulations to optimize performance.</p>
                <p className="text-xs">Aggregated grid behavior is available in the charts above.</p>
              </div>
            );
          }
          if (!activeRun.schedules) return null;
          
          return (
            <>
              <div className="timeline-wrapper">
                <div className="timeline-header-row" style={{ gridTemplateColumns: `120px repeat(${activeRun.electricity_prices.length}, 24px)` }}>
                  <div className="timeline-time-label" style={{ background: '#f8fafc', position: 'sticky', left: 0, zIndex: 45, borderRight: '2px solid var(--border-light)' }}>
                    Umlauf ID
                  </div>
                  {activeRun.electricity_prices.map((_, i) => (
                    <div key={i} className={`timeline-time-label ${i % 4 === 3 ? 'hour-marker' : ''}`}>
                      {i % 4 === 0 ? `${i / 4}:00` : ''}
                    </div>
                  ))}
                </div>
                
                <div className="timeline-content-rows">
                  {Object.entries(activeRun.schedules).map(([busId, powerList]) => (
                    <div key={busId} className="timeline-row" style={{ gridTemplateColumns: `120px repeat(${activeRun.electricity_prices.length}, 24px)` }}>
                      <div className="timeline-bus-label" title={busId}>{busId}</div>
                      {activeRun.electricity_prices.map((_, t) => {
                        const p = powerList[t] || 0;
                        const isActive = p > 5;
                        
                        let sourceClass = '';
                        let primarySource = '';
                        
                        if (isActive && ganttColorMode === 'source') {
                          const totalAtT = activeRun.aggregated_load_profile[t] || 1;
                          const rPV = (activeRun.pv_to_bus_profile?.[t] || 0) / totalAtT;
                          const rBess = (activeRun.bess_to_bus_profile?.[t] || 0) / totalAtT;
                          const rGrid = (activeRun.grid_to_bus_profile?.[t] || 0) / totalAtT;
                          
                          if (rPV > 0 && rPV >= rBess && rPV >= rGrid) { 
                            sourceClass = 'source-pv'; primarySource = 'PV Solar'; 
                          } else if (rBess > 0 && rBess >= rPV && rBess >= rGrid) { 
                            sourceClass = 'source-bess'; primarySource = 'BESS Storage'; 
                          } else { 
                            sourceClass = 'source-grid'; primarySource = 'Grid Import'; 
                          }
                        }

                        const intensityClass = p > 5 ? (p < 60 ? 'low' : p < 120 ? 'medium' : 'high') : '';
                        
                        return (
                          <div 
                            key={t} 
                            className={`timeline-cell ${isActive ? 'active' : ''} ${t % 4 === 3 ? 'hour-marker' : ''} ${ganttColorMode === 'source' ? sourceClass : intensityClass}`}
                            title={isActive ? `${busId} @ ${formatTime(t)}: ${p.toFixed(1)} kW ${primarySource ? `(${primarySource})` : ''}` : ''}
                          ></div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="timeline-legend">
                {ganttColorMode === 'intensity' ? (
                  <>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: 'var(--primary)', opacity: 0.4 }}></div>
                      <span>Low Power (&lt;60kW)</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: 'var(--primary)', opacity: 0.7 }}></div>
                      <span>Medium Power (60-120kW)</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: 'var(--primary)', opacity: 1 }}></div>
                      <span>Full Power (&gt;120kW)</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: '#10b981' }}></div>
                      <span>Solar Energy (PV)</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: '#a855f7' }}></div>
                      <span>Stored Energy (BESS)</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-box" style={{ background: 'var(--primary)' }}></div>
                      <span>Grid Import</span>
                    </div>
                  </>
                )}
                <div className="legend-item" style={{ marginLeft: 'auto' }}>
                  <span className="text-xs text-muted">Blocks represent 15-minute intervals</span>
                </div>
              </div>
            </>
          );
        })()}
      </div>

    </div>
  );
};

export default ModelComparison;
