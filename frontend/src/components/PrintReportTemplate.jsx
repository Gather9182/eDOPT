import React from 'react';

// Easily customizable corporate branding config
export const BRANDING = {
  primaryColor: '#1e3a8a', // Deep Blue
  secondaryColor: '#0052FF', // Accent Electric Blue
  textColor: '#1f2937', // Charcoal
  borderColor: '#e5e7eb', // Light border
  greenColor: '#10b981', // Success green
  redColor: '#ef4444', // Danger red
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  logoText: 'eDOPT',
  logoSubText: 'Depot Optimizer',
};

const PrintReportTemplate = ({ results, projectData }) => {
  if (!results) return null;

  const scenario = results.scenario?.toUpperCase() || 'BASELINE';
  const meta = results.run_metadata || {};
  const inputs = meta.inputs || {};
  const isLongTerm = results.is_long_term || false;
  
  // Extract inputs or meta variables
  const co2Factor = inputs.co2_emission_factor || projectData.meta?.co2_emission_factor || 400.0;
  const horizon = inputs.planning_horizon_hours || projectData.meta?.planning_horizon || 24;
  const resolution = inputs.time_step_minutes || projectData.meta?.time_resolution || 15;
  const numBuses = inputs.buses?.length || projectData.buses?.length || 0;
  
  // Financial calculation
  const cost = results.total_cost_eur || 0.0;
  const baseCost = results.baseline_cost_eur || 0.0;
  const savings = baseCost > 0 ? baseCost - cost : 0.0;
  const savingsPct = baseCost > 0 ? (savings / baseCost) * 100 : 0.0;
  
  // CO2 calculation
  const energyMwh = results.total_energy_mwh || 0.0;
  const co2EmissionsT = (energyMwh * 1000 * co2Factor) / 1e6;
  const dt = (resolution / 60.0);
  const baseLoadProfile = results.baseline_aggregated_load_profile || [];
  const baseEnergyMwh = baseLoadProfile.length > 0 ? (baseLoadProfile.reduce((a, b) => a + b, 0) * dt / 1000.0) : energyMwh;
  const baseCo2EmissionsT = (baseEnergyMwh * 1000 * co2Factor) / 1e6;
  const co2SavedT = baseCo2EmissionsT - co2EmissionsT;

  // Custom Inline SVG Sparkline / Chart Renderer for Print-Safety
  // (Standard charting libraries often fail to render or scale properly in print views)
  const renderSvgAreaChart = (optimizedData, baselineData, title, yUnit) => {
    if (!optimizedData || optimizedData.length === 0) return null;
    
    const width = 600;
    const height = 150;
    const padding = 20;
    
    const maxVal = Math.max(
      ...optimizedData,
      ...(baselineData || []),
      10.0
    ) * 1.1;
    
    const getX = (index) => padding + (index / (optimizedData.length - 1)) * (width - 2 * padding);
    const getY = (val) => height - padding - (val / maxVal) * (height - 2 * padding);

    // Optimized Area Path
    let optPath = `M ${getX(0)} ${height - padding}`;
    optimizedData.forEach((val, idx) => {
      optPath += ` L ${getX(idx)} ${getY(val)}`;
    });
    optPath += ` L ${getX(optimizedData.length - 1)} ${height - padding} Z`;

    // Optimized Stroke Path
    let optStroke = `M ${getX(0)} ${getY(optimizedData[0])}`;
    optimizedData.forEach((val, idx) => {
      optStroke += ` L ${getX(idx)} ${getY(val)}`;
    });

    // Baseline Stroke Path
    let baseStroke = '';
    if (baselineData && baselineData.length > 0) {
      baseStroke = `M ${getX(0)} ${getY(baselineData[0])}`;
      baselineData.forEach((val, idx) => {
        baseStroke += ` L ${getX(idx)} ${getY(val)}`;
      });
    }

    return (
      <div className="print-chart-box">
        <h4 className="chart-title-text">{title}</h4>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#fcfcfc', border: '1px solid #f0f0f0', borderRadius: '8px' }}>
          {/* Y Axis Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
            const val = maxVal * ratio;
            const y = getY(val);
            return (
              <g key={ratio}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#f0f0f0" strokeDasharray="3,3" />
                <text x={padding - 5} y={y + 4} textAnchor="end" fontSize="8" fill="#9ca3af">{val.toFixed(0)}</text>
              </g>
            );
          })}
          
          {/* Optimized Area */}
          <path d={optPath} fill={`${BRANDING.secondaryColor}22`} />
          <path d={optStroke} fill="none" stroke={BRANDING.secondaryColor} strokeWidth="2" />
          
          {/* Baseline Stroke */}
          {baseStroke && (
            <path d={baseStroke} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4,4" />
          )}

          {/* Bottom axis line */}
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#d1d5db" />
          
          {/* Legend */}
          <g transform={`translate(${width - 150}, 15)`} fontSize="8">
            <rect x="0" y="0" width="8" height="8" fill={BRANDING.secondaryColor} />
            <text x="12" y="7" fill="#4b5563">Optimised ({yUnit})</text>
            
            {baselineData && (
              <g transform="translate(0, 12)">
                <line x1="0" y1="4" x2="8" y2="4" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="2,2" />
                <text x="12" y="7" fill="#4b5563">Baseline ({yUnit})</text>
              </g>
            )}
          </g>
        </svg>
      </div>
    );
  };

  return (
    <div className="print-report" style={{ fontFamily: BRANDING.fontFamily, color: BRANDING.textColor, lineHeight: 1.5 }}>
      {/* Cover Header */}
      <div className="print-header" style={{ borderBottom: `3px solid ${BRANDING.primaryColor}`, paddingBottom: '20px', marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ color: BRANDING.primaryColor, margin: 0, fontSize: '28px', fontWeight: 800 }}>{BRANDING.logoText}</h1>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b7280', fontWeight: 700 }}>{BRANDING.logoSubText}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: BRANDING.primaryColor }}>Executive Optimization Report</h2>
            <span style={{ fontSize: '12px', color: '#4b5563' }}>Generated on {new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Overview Block */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
        <div>
          <h3 style={{ borderBottom: `1px solid ${BRANDING.borderColor}`, paddingBottom: '6px', fontSize: '14px', color: BRANDING.primaryColor }}>SIMULATION METADATA</h3>
          <table className="print-meta-table" style={{ width: '100%', fontSize: '12px' }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 'bold', padding: '6px 0' }}>Active Scenario:</td>
                <td>{scenario}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', padding: '6px 0' }}>Simulation Horizon:</td>
                <td>{isLongTerm ? `${results.total_days} Days` : `${horizon} Hours`}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', padding: '6px 0' }}>Time Step Resolution:</td>
                <td>{resolution} minutes</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', padding: '6px 0' }}>Total Vehicles:</td>
                <td>{numBuses} buses</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', padding: '6px 0' }}>CO2 Emission Intensity:</td>
                <td>{co2Factor} g CO2/kWh</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h3 style={{ borderBottom: `1px solid ${BRANDING.borderColor}`, paddingBottom: '6px', fontSize: '14px', color: BRANDING.primaryColor }}>ENVIRONMENTAL & SAVINGS SUMMARY</h3>
          <div className="print-kpi-grid">
            <div className="print-kpi-card-el">
              <span className="lbl">Optimized Cost</span>
              <span className="val" style={{ color: BRANDING.primaryColor }}>€{cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="print-kpi-card-el">
              <span className="lbl">Baseline Cost</span>
              <span className="val" style={{ color: '#6b7280' }}>€{baseCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="print-kpi-card-el">
              <span className="lbl">Financial Savings</span>
              <span className="val" style={{ color: BRANDING.greenColor }}>€{savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({savingsPct.toFixed(1)}%)</span>
            </div>
            <div className="print-kpi-card-el">
              <span className="lbl">CO2 Emissions Saved</span>
              <span className="val" style={{ color: BRANDING.greenColor }}>{co2SavedT.toFixed(3)} Tons</span>
            </div>
          </div>
        </div>
      </div>

      {/* Page Break for charts/tables to prevent cutting */}
      <div className="page-break" />

      {/* Charts Section */}
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ borderBottom: `1px solid ${BRANDING.borderColor}`, paddingBottom: '6px', fontSize: '14px', color: BRANDING.primaryColor, marginBottom: '20px' }}>LOAD PROFILE & GENERATION CHARTS</h3>
        
        {/* Load Profile Area Chart */}
        {renderSvgAreaChart(
          results.aggregated_load_profile,
          results.baseline_aggregated_load_profile,
          "Aggregate Depot Grid Load Profile (kW) vs Baseline (Charge-on-Arrival)",
          "kW"
        )}

        {/* PV Production / BESS SoC Chart (if present) */}
        {results.pv_yield_profile && results.pv_yield_profile.reduce((a, b) => a + b, 0) > 0 && (
          <div style={{ marginTop: '20px' }}>
            {renderSvgAreaChart(
              results.pv_yield_profile,
              null,
              "Solar Photovoltaic (PV) Generation Profile (kW)",
              "kW"
            )}
          </div>
        )}

        {results.bess_soc_profile && results.bess_soc_profile.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            {renderSvgAreaChart(
              results.bess_soc_profile.slice(0, results.aggregated_load_profile?.length || 96),
              null,
              "Battery Energy Storage System (BESS) State of Charge (kWh)",
              "kWh"
            )}
          </div>
        )}
      </div>

      <div className="page-break" />

      {/* Diagnostics / Fleet health table */}
      <div>
        <h3 style={{ borderBottom: `1px solid ${BRANDING.borderColor}`, paddingBottom: '6px', fontSize: '14px', color: BRANDING.primaryColor }}>FLEET PERFORMANCE & DIAGNOSTICS</h3>
        
        {!isLongTerm ? (
          <table className="print-data-table" style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', borderBottom: `2px solid ${BRANDING.primaryColor}` }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Bus ID</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Type</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Battery (kWh)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Trip Energy (kWh)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Charged (kWh)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Final SoC</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Diagnostic Reason</th>
              </tr>
            </thead>
            <tbody>
              {(results.bus_diagnostics || []).slice(0, 40).map((diag, idx) => {
                const isHealthy = diag.status_flag === 'healthy';
                const isWarning = diag.status_flag === 'warning';
                const statusColor = isHealthy ? BRANDING.greenColor : (isWarning ? '#d97706' : BRANDING.redColor);
                
                return (
                  <tr key={diag.id} style={{ borderBottom: `1px solid ${BRANDING.borderColor}` }}>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{diag.id}</td>
                    <td style={{ padding: '8px' }}>{diag.vehicle_type || 'Bus'}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{diag.capacity_kwh?.toFixed(0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{diag.total_trip_energy_kwh?.toFixed(1)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{diag.total_charged_energy_kwh?.toFixed(1)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{diag.final_soc_kwh?.toFixed(1)} kWh</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: statusColor }}>
                      {diag.status_flag?.toUpperCase()}
                    </td>
                    <td style={{ padding: '8px', color: '#4b5563' }}>{diag.diagnostic_reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="print-data-table" style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', borderBottom: `2px solid ${BRANDING.primaryColor}` }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Date</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Grid Import (MWh)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Peak Load (kW)</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Optimized Cost</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Baseline Cost</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Financial Savings</th>
              </tr>
            </thead>
            <tbody>
              {/* Daily breakdown summary */}
              {(() => {
                const dates = [];
                const baseDate = new Date(inputs.start_date || projectData.meta?.longTermConfig?.startDate || '2026-01-01');
                const prices = results.electricity_prices || [];
                const stepsPerDay = prices.length / results.total_days;
                const gridImport = results.grid_import_profile || [];
                const baselineLoad = results.baseline_aggregated_load_profile || [];
                const dtFactor = (resolution / 60.0);

                for (let day = 0; day < Math.min(results.total_days, 30); day++) {
                  const label = new Date(baseDate.getTime() + day * 86400000).toLocaleDateString();
                  const start = day * stepsPerDay;
                  const end = (day + 1) * stepsPerDay;
                  
                  const dGrid = gridImport.slice(start, end);
                  const dBase = baselineLoad.slice(start, end);
                  const dPrices = prices.slice(start, end);

                  const dCost = dGrid.reduce((sum, g, i) => sum + g * (dPrices[i] / 1000) * dtFactor, 0);
                  const dBaseCost = dBase.reduce((sum, b, i) => sum + b * (dPrices[i] / 1000) * dtFactor, 0);
                  const dSavings = dBaseCost - dCost;
                  const dPeak = Math.max(...dGrid, 0);
                  const dEnergy = dGrid.reduce((a, b) => a + b, 0) * dtFactor / 1000;

                  dates.push({ label, energy: dEnergy, peak: dPeak, cost: dCost, baseCost: dBaseCost, savings: dSavings });
                }

                return dates.map((d, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid ${BRANDING.borderColor}` }}>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{d.label}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{d.energy.toFixed(3)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{d.peak.toFixed(1)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>€{d.cost.toFixed(2)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>€{d.baseCost.toFixed(2)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: BRANDING.greenColor }}>€{d.savings.toFixed(2)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media screen {
          .print-report {
            display: none; /* Only visible in print mode */
          }
        }
        
        @media print {
          body * {
            visibility: hidden;
          }
          .print-report, .print-report * {
            visibility: visible;
          }
          .print-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: block !important;
            padding: 20px;
          }
          .page-break {
            page-break-before: always;
            height: 0;
            margin: 0;
            border: 0;
          }
          .print-meta-table td {
            border-bottom: 1px solid #f3f4f6;
          }
        }

        .print-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 10px;
        }

        .print-kpi-card-el {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          padding: 10px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
        }

        .print-kpi-card-el .lbl {
          font-size: 8px;
          font-weight: 700;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .print-kpi-card-el .val {
          font-size: 14px;
          font-weight: 800;
          margin-top: 4px;
        }

        .print-chart-box {
          margin-bottom: 25px;
          page-break-inside: avoid;
        }

        .chart-title-text {
          font-size: 11px;
          font-weight: 700;
          color: #4b5563;
          margin: 0 0 8px 0;
          text-transform: uppercase;
        }

        .print-data-table th {
          font-weight: 700;
          text-transform: uppercase;
          font-size: 9px;
          color: #374151;
        }
      `}} />
    </div>
  );
};

export default PrintReportTemplate;
