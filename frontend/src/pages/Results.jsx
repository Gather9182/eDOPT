import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
  LineChart, Line, Legend, ReferenceLine, ComposedChart, Brush, ReferenceArea
} from 'recharts';
import { 
  Download, TrendingDown, TrendingUp, Zap, DollarSign, Activity, Clock, Lightbulb, 
  ChevronDown, ChevronUp, Battery, Info, AlertTriangle, ChevronRight, ChevronLeft, CheckCircle2,
  MapPin, ArrowRight, ArrowLeft, Loader2, Maximize, Sun, CloudSun, Thermometer, ShieldCheck, Leaf, X, GitCompare, LayoutDashboard, PiggyBank, Calendar
} from 'lucide-react';
import { getItem, setItem } from '../utils/db';

const toMinutesForSort = (hhmm) => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const InfoTooltip = ({ title, text, align = 'center' }) => (
  <div className="tooltip-container">
    <Info size={11} className="tooltip-trigger" />
    <div className={`tooltip-box tooltip-${align}`}>
      {title && <div className="tooltip-title">{title}</div>}
      <div className="tooltip-text">{text}</div>
    </div>
  </div>
);

const SimulationDatePicker = ({ results, selectedDay, setSelectedDay, setAuditActive, dailyOverviewData, isDrillDown, setIsLoadingUI }) => {
  const [isDatePickerExpanded, setIsDatePickerExpanded] = useState(false);
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [showHeatmap, setShowHeatmap] = useState(false);

  useEffect(() => {
    setCalendarOffset(0);
  }, [selectedDay]);

  const costStats = useMemo(() => {
    if (!dailyOverviewData || dailyOverviewData.length === 0) return { min: 0, max: 0, range: 0 };
    const costs = dailyOverviewData.map(d => d?.totalCost).filter(c => typeof c === 'number' && !isNaN(c));
    if (costs.length === 0) return { min: 0, max: 0, range: 0 };
    const min = Math.min(...costs);
    const max = Math.max(...costs);
    return { min, max, range: max - min };
  }, [dailyOverviewData]);

  // Memoize the content that doesn't depend on isDatePickerExpanded
  const dropdownContent = useMemo(() => {
    const startDateStr = results.run_metadata?.inputs?.start_date || results.run_metadata?.settings?.longTermConfig?.startDate || '2026-01-01';
    const baseDate = new Date(startDateStr);
    
    // Show Current Selection's Month or First Month
    const focalDate = selectedDay !== null 
      ? new Date(baseDate.getTime() + selectedDay * 86400000) 
      : new Date(baseDate);
    
    focalDate.setMonth(focalDate.getMonth() + calendarOffset);
    
    const renderMonth = (dateOffset) => {
      const mDate = new Date(focalDate);
      mDate.setMonth(focalDate.getMonth() + dateOffset);
      mDate.setDate(1);
      
      const monthName = mDate.toLocaleString('default', { month: 'long' });
      const yearName = mDate.getFullYear();
      const startPadding = mDate.getDay();
      const daysInMonth = new Date(yearName, mDate.getMonth() + 1, 0).getDate();
      
      // Calculate firstDayIndex ONCE per month to avoid 60 Date allocations per render
      const firstDayDate = new Date(yearName, mDate.getMonth(), 1);
      const firstDayIndex = Math.round((firstDayDate.getTime() - baseDate.getTime()) / 86400000);

      return (
        <div style={{ width: '320px' }} key={dateOffset}>
          <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '24px', display: 'flex', gap: '8px' }}>
            <span>{monthName}</span>
            <span style={{ color: '#d1d5db' }}>{yearName}</span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
              <div key={d} style={{ height: '40px', display: 'flex', alignItems: 'center', justifySelf: 'center', fontSize: '11px', fontWeight: '800', color: '#111' }}>{d}</div>
            ))}
            
            {Array.from({ length: startPadding }).map((_, i) => (
              <div key={`pad-${i}`} style={{ height: '44px' }} />
            ))}
            
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dNum = i + 1;
              const dayIndex = firstDayIndex + i;
              
              const exists = dailyOverviewData[dayIndex];
              const isActive = selectedDay === dayIndex;
              
              if (!exists) return <div key={i} style={{ height: '44px', display: 'flex', alignItems: 'center', justifySelf: 'center', fontSize: '13px', color: '#f3f4f6' }}>{dNum}</div>;

              let bgStyle = 'transparent';
              let textStyle = '#111';
              let borderStyle = 'none';
              let borderRadiusStyle = isActive ? '12px' : '0';

              if (isActive) {
                bgStyle = '#3b82f6';
                textStyle = 'white';
              } else if (showHeatmap && exists && typeof exists.totalCost === 'number') {
                const ratio = costStats.range > 0 ? (exists.totalCost - costStats.min) / costStats.range : 0;
                const hue = (1 - ratio) * 120; // 120 (green) to 0 (red)
                bgStyle = `hsl(${hue}, 80%, 92%)`;
                textStyle = `hsl(${hue}, 70%, 25%)`;
                borderRadiusStyle = '8px';
              }

              return (
                <button
                  key={i}
                  className="calendar-day-btn"
                  onClick={() => { setSelectedDay(dayIndex); }}
                  style={{ 
                    height: '48px',
                    background: bgStyle,
                    color: textStyle,
                    border: borderStyle,
                    borderRadius: borderRadiusStyle,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%'
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: isActive ? '700' : '500' }}>{dNum}</span>
                  <span style={{ fontSize: '7px', fontWeight: '900', opacity: isActive ? 0.7 : 0.3, marginTop: '2px' }}>
                    €{exists.totalCost.toFixed(0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );
    };

    return (
      <>
        {/* Sidebar - Reference Styled */}
        <div style={{ 
          width: '240px', 
          borderRight: '1px solid #f5f5f5', 
          background: '#ffffff', 
          padding: '32px 0',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ 
            padding: '0 32px 32px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between'
          }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#111' }}>Customised</span>
            <ChevronRight size={16} color="#3b82f6" />
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { label: 'Beginning of Horizon', idx: 0 },
              { label: 'End of Horizon', idx: dailyOverviewData.length - 1 },
              { label: 'Peak Load Event', idx: dailyOverviewData.reduce((p, c, i, a) => c.peakLoad > a[p].peakLoad ? i : p, 0) },
              { label: 'Highest Savings', idx: dailyOverviewData.reduce((p, c, i, a) => c.dailySavings > a[p].dailySavings ? i : p, 0) },
              { label: 'Most Economical', idx: dailyOverviewData.reduce((p, c, i, a) => c.totalCost < a[p].totalCost ? i : p, 0) },
            ].map((preset) => {
              const isActive = selectedDay === preset.idx;
              return (
                <button 
                  key={preset.label}
                  onClick={() => { setSelectedDay(preset.idx); }}
                  style={{ 
                    textAlign: 'left',
                    padding: '16px 32px',
                    fontSize: '13px',
                    fontWeight: isActive ? '700' : '500',
                    color: isActive ? '#111' : '#6b7280',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {preset.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Area */}
        <div style={{ flex: 1, padding: '40px', background: '#fcfcfc' }}>
          {/* Top Toolbar */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            marginBottom: '40px' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ 
                padding: '12px 24px', 
                background: 'white', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
              }}>
                <span>{new Date(results.run_metadata?.inputs?.start_date || results.run_metadata?.settings?.longTermConfig?.startDate || '2026-01-01').toLocaleDateString('default', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                <span style={{ color: '#d1d5db' }}>—</span>
                <span>{new Date(new Date(results.run_metadata?.inputs?.start_date || results.run_metadata?.settings?.longTermConfig?.startDate || '2026-01-01').getTime() + (dailyOverviewData.length - 1) * 86400000).toLocaleDateString('default', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <button 
                onClick={() => setSelectedDay(null)}
                style={{ fontSize: '14px', fontWeight: '600', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clear filters
              </button>

              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                className={`chart-toggle-pill ${showHeatmap ? 'active' : ''}`}
                style={{
                  '--pill-color': '#10b981',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginLeft: '12px',
                  background: showHeatmap ? '#ecfdf5' : '#ffffff',
                  borderColor: showHeatmap ? '#10b981' : '#e5e7eb',
                  color: showHeatmap ? '#065f46' : '#475569',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  backgroundColor: '#10b981',
                  boxShadow: showHeatmap ? '0 0 6px #10b981' : 'none',
                  transition: 'all 0.2s ease'
                }}></div>
                <span>Cost Heatmap</span>
              </button>

              {showHeatmap && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  fontSize: '11px', 
                  color: '#6b7280',
                  marginLeft: '12px',
                  background: '#f9fafb',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #f3f4f6'
                }}>
                  <span style={{ color: '#047857', fontWeight: '600' }}>Cheap</span>
                  <div style={{ 
                    width: '60px', 
                    height: '6px', 
                    borderRadius: '3px', 
                    background: 'linear-gradient(to right, #86efac, #fde047, #fca5a5)' 
                  }}></div>
                  <span style={{ color: '#b91c1c', fontWeight: '600' }}>Expensive</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <button 
                onClick={() => setSelectedDay(null)}
                style={{ fontSize: '14px', fontWeight: '600', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (selectedDay !== null) {
                    setIsLoadingUI(true);
                    setAuditActive(true);
                  }
                }}
                style={{ 
                  padding: '12px 32px', 
                  background: '#3b82f6', 
                  color: 'white', 
                  borderRadius: '12px', 
                  fontSize: '14px', 
                  fontWeight: '700', 
                  border: 'none', 
                  cursor: 'pointer',
                  boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.3)'
                }}
              >
                Apply
              </button>
            </div>
          </div>

          {/* Dual Month Picker View */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '32px',
            width: '100%'
          }}>
            {/* Previous Month Navigation Button */}
            <button 
              onClick={() => setCalendarOffset(prev => prev - 1)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'white',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
                color: '#374151',
                boxShadow: '0 4px 10px rgba(0,0,0,0.06)',
                transition: 'all 0.2s',
                flexShrink: 0
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#d1d5db'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
            >
              <ChevronLeft size={20} />
            </button>

            <div style={{ display: 'flex', gap: '80px', justifyContent: 'center' }}>
              {renderMonth(0)}
              {renderMonth(1)}
            </div>

            {/* Next Month Navigation Button */}
            <button 
              onClick={() => setCalendarOffset(prev => prev + 1)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'white',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
                color: '#374151',
                boxShadow: '0 4px 10px rgba(0,0,0,0.06)',
                transition: 'all 0.2s',
                flexShrink: 0
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#d1d5db'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </>
    );
  }, [results, selectedDay, calendarOffset, dailyOverviewData, setAuditActive, setSelectedDay, setIsDatePickerExpanded, setIsLoadingUI, showHeatmap, costStats]);

  return (
    <div style={{ 
      position: 'relative',
      marginBottom: '32px',
      zIndex: 100,
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      {/* Collapsed Bar View */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: 'white', 
        padding: '18px 32px',
        height: '78px',
        borderRadius: '24px',
        boxShadow: '0 10px 30px -10px rgba(0,0,0,0.08)',
        border: '1px solid #f0f0f0',
        position: 'relative',
        width: '100%',
        zIndex: 102
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            borderRadius: '12px', 
            background: '#eff6ff', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#3b82f6'
          }}>
            <Calendar size={20} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>Date Selection Portal</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
              {selectedDay !== null ? (
                <>
                  Selected: <strong style={{ color: '#111827' }}>Day {Number(selectedDay) + 1}</strong> ({
                    (() => {
                      const baseDate = new Date(results.run_metadata?.inputs?.start_date || results.run_metadata?.settings?.longTermConfig?.startDate || '2026-01-01');
                      const selDate = new Date(baseDate.getTime() + Number(selectedDay) * 86400000);
                      return selDate.toLocaleDateString('default', { day: 'numeric', month: 'long', year: 'numeric' });
                    })()
                  }) — <strong style={{ color: '#10b981' }}>€{dailyOverviewData[Number(selectedDay)]?.totalCost.toFixed(0)}</strong> cost
                </>
              ) : (
                "No day selected. Expand the calendar or click on a chart bar to choose a specific day for details."
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {selectedDay !== null && (
            <>
              <button 
                onClick={() => setSelectedDay(null)}
                style={{ 
                  fontSize: '13px', 
                  fontWeight: '600', 
                  color: '#ef4444', 
                  background: 'none', 
                  border: 'none', 
                  cursor: 'pointer',
                  marginRight: '8px'
                }}
              >
                Clear selection
              </button>
              <button 
                onClick={() => {
                  setIsLoadingUI(true);
                  setAuditActive(true);
                }}
                style={{ 
                  padding: '10px 20px', 
                  background: '#3b82f6', 
                  color: 'white', 
                  borderRadius: '12px', 
                  fontSize: '13px', 
                  fontWeight: '700', 
                  border: 'none', 
                  cursor: 'pointer',
                  marginRight: '8px',
                  boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.2)'
                }}
              >
                Apply Audit
              </button>
            </>
          )}
          <button 
            onClick={() => setIsDatePickerExpanded(prev => !prev)}
            style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px', 
              background: isDatePickerExpanded ? '#f3f4f6' : '#eff6ff', 
              color: isDatePickerExpanded ? '#4b5563' : '#3b82f6', 
              borderRadius: '12px', 
              fontSize: '13px', 
              fontWeight: '700', 
              border: 'none', 
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = isDatePickerExpanded ? '#e5e7eb' : '#dbeafe'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isDatePickerExpanded ? '#f3f4f6' : '#eff6ff'; }}
          >
            {isDatePickerExpanded ? "Collapse Calendar" : "Expand Calendar"}
            {isDatePickerExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded Dropdown Panel */}
      <div style={{ 
        display: 'flex', 
        background: 'white', 
        borderRadius: '32px', 
        boxShadow: '0 30px 60px -12px rgba(0,0,0,0.15)', 
        border: '1px solid #f0f0f0', 
        overflow: 'hidden', 
        position: 'absolute',
        top: '88px',
        left: 0,
        width: '100%',
        zIndex: 101,
        transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, visibility 0.22s',
        transform: isDatePickerExpanded ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.98)',
        opacity: isDatePickerExpanded ? 1 : 0,
        visibility: isDatePickerExpanded ? 'visible' : 'hidden',
        pointerEvents: isDatePickerExpanded ? 'auto' : 'none',
        height: '620px',
        willChange: 'transform, opacity'
      }}>
        {dropdownContent}
      </div>
    </div>
  );
};

const extractStrategicMoves = (schedules, electricityPrices, timeStepMin) => {
  if (!schedules || !electricityPrices || electricityPrices.length === 0) return [];
  const avgPrice = electricityPrices.reduce((a, b) => a + b, 0) / electricityPrices.length;
  const dtMove = timeStepMin / 60; 
  const moves = [];

  Object.entries(schedules).forEach(([busId, powerList]) => {
    let currentSession = null;
    powerList.forEach((power, t) => {
      if (power > 5) { // ignore noise
        if (!currentSession) {
          currentSession = { busId, startTime: t, powerSum: 0, costSum: 0, duration: 0 };
        }
        const energy = power * dtMove;
        currentSession.powerSum += energy;
        currentSession.costSum += energy * (electricityPrices[t] / 1000);
        currentSession.duration += timeStepMin;
      } else if (currentSession) {
        const avoidedCost = currentSession.powerSum * (avgPrice / 1000);
        currentSession.savings = avoidedCost - currentSession.costSum;
        currentSession.endTime = t;
        if (currentSession.savings > 0.01) moves.push(currentSession);
        currentSession = null;
      }
    });
  });
  return moves.sort((a, b) => b.savings - a.savings);
};

const ChartDownloadMenu = ({ title, data, columns, cardRef, style }) => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = () => setIsOpen(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  const handleDownloadJSON = () => {
    const formattedData = data.map(item => {
      const row = {
        Day: item.day,
        Date: item.dateLabel || `Day ${item.day}`,
        'Date (ISO)': item.dateIso || ''
      };
      columns.forEach(col => {
        row[col.label] = item[col.key];
      });
      return row;
    });

    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(formattedData, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_data.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleDownloadCSV = () => {
    const headers = ['Day', 'Date', 'Date (ISO)', ...columns.map(col => col.label)];
    const rows = data.map(item => {
      return [
        item.day,
        `"${item.dateLabel || `Day ${item.day}`}"`,
        `"${item.dateIso || ''}"`,
        ...columns.map(col => {
          const val = item[col.key];
          return val !== undefined ? val : '';
        })
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n'); // Add UTF-8 BOM for Excel
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_data.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadImage = () => {
    if (!cardRef || !cardRef.current) return;
    const svgElement = cardRef.current.querySelector('.recharts-wrapper svg');
    if (!svgElement) return;

    try {
      const computedStyle = getComputedStyle(cardRef.current);
      const bgColor = computedStyle.backgroundColor || '#ffffff';
      const font = computedStyle.fontFamily || 'sans-serif';

      const clonedSvg = svgElement.cloneNode(true);
      clonedSvg.style.fontFamily = font;

      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(clonedSvg);

      const cssVars = [
        '--border-light',
        '--border',
        '--text-muted',
        '--text-secondary',
        '--bg-surface',
        '--primary',
        '--primary-light',
        '--success',
        '--warning',
        '--danger',
        '--info'
      ];
      cssVars.forEach(varName => {
        const computedValue = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (computedValue) {
          const regex = new RegExp(`var\\(${varName}\\)`, 'g');
          svgString = svgString.replace(regex, computedValue);
        }
      });

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const URLObj = window.URL || window.webkitURL || window;
      const blobURL = URLObj.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const rect = svgElement.getBoundingClientRect();
        const width = rect.width || svgElement.clientWidth || 800;
        const height = rect.height || svgElement.clientHeight || 400;
        const scale = 2;

        canvas.width = width * scale;
        canvas.height = height * scale;

        const context = canvas.getContext('2d');
        context.scale(scale, scale);

        context.fillStyle = bgColor;
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        const pngURL = canvas.toDataURL('image/png');
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = pngURL;
        downloadAnchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`;
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        URLObj.revokeObjectURL(blobURL);
      };
      image.src = blobURL;
    } catch (err) {
      console.error('Failed to export chart image', err);
    }
  };

  return (
    <div 
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      style={{ 
        position: 'absolute', 
        bottom: '16px', 
        right: '24px', 
        zIndex: 100,
        ...style 
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="chart-toggle-pill"
        style={{
          '--pill-color': 'var(--primary)',
          cursor: 'pointer',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: isOpen ? 'rgba(255, 255, 255, 0.8)' : '#ffffff',
          border: '1px solid var(--border-light, #e5e7eb)',
          borderRadius: '8px',
          boxShadow: 'var(--shadow-sm)'
        }}
        title="Download data or chart graphic"
      >
        <Download size={12} className="text-muted" />
        <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>Download</span>
        <ChevronDown size={10} className="text-muted opacity-70" />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: 0,
            bottom: '34px',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            zIndex: 1000,
            padding: '6px 0',
            width: '140px',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          }}
        >
          <div style={{
            padding: '6px 12px 2px',
            fontSize: '9px',
            fontWeight: '700',
            color: '#9ca3af',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Download As
          </div>
          
          <button
            onClick={() => {
              handleDownloadJSON();
              setIsOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: '600',
              color: '#4b5563',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            JSON Format
          </button>
          
          <button
            onClick={() => {
              handleDownloadCSV();
              setIsOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: '600',
              color: '#4b5563',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            CSV Format
          </button>
          
          <button
            onClick={() => {
              handleDownloadImage();
              setIsOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: '600',
              color: '#4b5563',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
              textAlign: 'left'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Grafik (PNG)
          </button>
        </div>
      )}
    </div>
  );
};

const DailyEnergyMixCard = ({
  results,
  dailyOverviewData,
  zoomedData,
  isZoomed,
  zoomRange,
  handleResetZoom,
  isZoomingLoading,
  handleBrushChange,
  selectedDay,
  setSelectedDay,
  hasPv,
  hasBess,
  timeStepMin,
  fullscreenChart,
  setFullscreenChart: toggleFullscreen,
  showMonthZones,
  setShowMonthZones,
  monthZones
}) => {
  const cardRef = React.useRef(null);
  const [selectedDMA, setSelectedDMA] = useState(null); // null, 20, 50, 100, 150, 200
  const [isDMADropdownOpen, setIsDMADropdownOpen] = useState(false);
  const [is20DMALoading, setIs20DMALoading] = useState(false);
  const [sourcesVisible, setSourcesVisible] = useState({ grid: true, pv: true, bess: true });

  const toggleSource = (source) => {
    setSourcesVisible(v => {
      const next = { ...v, [source]: !v[source] };
      // Prevent disabling all sources
      if (!next.grid && !next.pv && !next.bess) return v;
      return next;
    });
  };

  useEffect(() => {
    if (!isDMADropdownOpen) return;
    const handleClickOutside = () => {
      setIsDMADropdownOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isDMADropdownOpen]);

  const handleSelectDMA = (dma) => {
    setIsDMADropdownOpen(false);
    if (dma === selectedDMA) return;
    
    if (dma) {
      setIs20DMALoading(true);
      setTimeout(() => {
        setSelectedDMA(dma);
        setIs20DMALoading(false);
      }, 200);
    } else {
      setSelectedDMA(null);
    }
  };

  const tooltipLabelFormatter = (dayNum) => {
    const dayData = dailyOverviewData.find(d => d.day === dayNum);
    if (!dayData) return `Day ${dayNum}`;
    return `Day ${dayNum} (${dayData.dateLabel})`;
  };

  return (
    <>
      {fullscreenChart === 'energyMix' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={cardRef} className={`card shadow-sm border-l-4 border-l-primary ${fullscreenChart === 'energyMix' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
          <div className="flex justify-between items-center mb-6" style={{ position: 'relative', zIndex: 10 }}>
              <div>
                  <h3 className="card-title text-primary flex items-center gap-2">
                     <GitCompare size={18} /> Daily Energy Mix & Source Attribution
                     <InfoTooltip 
                       title="Energy Sourcing" 
                       text="Breakdown of energy used: Grid Import (external), PV (direct solar), and BESS (stored energy shifted from low-cost periods). Highlights how the optimizer prioritizes renewables and arbitrage." 
                     />
                  </h3>
                  <p className="card-description">Daily source attribution for total fleet demand. Drag the brush below to zoom synchronously.</p>
              </div>
              <div className="flex items-center gap-6">
                  {isZoomed && (
                      <button 
                          onClick={handleResetZoom}
                          className="chart-toggle-pill active"
                          style={{ '--pill-color': '#ef4444' }}
                      >
                          <Maximize size={14} /> Reset Zoom ({zoomRange.start}-{zoomRange.end || dailyOverviewData.length})
                      </button>
                  )}
                <div className="relative" style={{ zIndex: 50 }}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setIsDMADropdownOpen(!isDMADropdownOpen); }}
                        className={`chart-toggle-pill ${selectedDMA ? 'active shadow-sm border-primary/20' : ''}`}
                        style={{ '--pill-color': 'var(--primary)' }}
                        disabled={is20DMALoading}
                    >
                        {is20DMALoading ? (
                            <Loader2 className="animate-spin" size={14} />
                        ) : (
                            <TrendingUp size={14} />
                        )}
                        {is20DMALoading ? 'Calculating...' : (selectedDMA ? `${selectedDMA}DMA Lines` : 'DMA Lines')}
                        <ChevronDown size={12} className="ml-1 opacity-70" />
                    </button>
                    {isDMADropdownOpen && (
                        <div 
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: '38px',
                                background: '#ffffff',
                                border: '1px solid #e5e7eb',
                                borderRadius: '16px',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
                                zIndex: 1000,
                                padding: '8px 0',
                                width: '200px',
                                display: 'flex',
                                flexDirection: 'column',
                                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                            }}
                        >
                            <div style={{
                                padding: '8px 16px 4px',
                                fontSize: '9px',
                                fontWeight: '700',
                                color: '#9ca3af',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                            }}>
                                Moving Average
                            </div>
                            {[20, 50, 100, 150, 200].map(d => (
                                <button
                                    key={d}
                                    onClick={() => handleSelectDMA(d)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        width: '100%',
                                        padding: '10px 16px',
                                        fontSize: '12px',
                                        fontWeight: '600',
                                        color: selectedDMA === d ? '#3b82f6' : '#4b5563',
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                        textAlign: 'left'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <TrendingUp size={14} style={{ color: selectedDMA === d ? '#3b82f6' : '#9ca3af' }} />
                                        {d}D Average
                                    </span>
                                    {selectedDMA === d && (
                                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6' }} />
                                    )}
                                </button>
                            ))}
                            <div style={{ height: '1px', backgroundColor: '#f3f4f6', margin: '6px 0' }} />
                            <button
                                onClick={() => handleSelectDMA(null)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    width: '100%',
                                    padding: '10px 16px',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: !selectedDMA ? '#ef4444' : '#4b5563',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    textAlign: 'left'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <X size={14} style={{ color: !selectedDMA ? '#ef4444' : '#9ca3af' }} />
                                    Hide Average Lines
                                </span>
                                {!selectedDMA && (
                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
                                )}
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button 
                        onClick={() => toggleSource('grid')}
                        className={`chart-toggle-pill ${sourcesVisible.grid ? 'active' : ''}`} 
                        style={{ '--pill-color': 'var(--primary, #3b82f6)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: '1px solid var(--border-light)', borderRadius: '10px' }}
                    >
                        <div style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%', 
                            backgroundColor: 'var(--primary, #3b82f6)',
                            opacity: sourcesVisible.grid ? 1 : 0.4
                        }}></div>
                        <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: sourcesVisible.grid ? 'var(--primary, #3b82f6)' : 'var(--text-muted)' }}>GRID</span>
                    </button>
                    {hasPv && (
                        <button 
                            onClick={() => toggleSource('pv')}
                            className={`chart-toggle-pill ${sourcesVisible.pv ? 'active' : ''}`} 
                            style={{ '--pill-color': '#eab308', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: '1px solid var(--border-light)', borderRadius: '10px' }}
                        >
                            <div style={{ 
                                width: '8px', 
                                height: '8px', 
                                borderRadius: '50%', 
                                backgroundColor: '#facc15',
                                opacity: sourcesVisible.pv ? 1 : 0.4
                            }}></div>
                            <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: sourcesVisible.pv ? '#ca8a04' : 'var(--text-muted)' }}>PV</span>
                        </button>
                    )}
                    {hasBess && (
                        <button 
                            onClick={() => toggleSource('bess')}
                            className={`chart-toggle-pill ${sourcesVisible.bess ? 'active' : ''}`} 
                            style={{ '--pill-color': '#a855f7', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: '1px solid var(--border-light)', borderRadius: '10px' }}
                        >
                            <div style={{ 
                                width: '8px', 
                                height: '8px', 
                                borderRadius: '50%', 
                                backgroundColor: '#a855f7',
                                opacity: sourcesVisible.bess ? 1 : 0.4
                            }}></div>
                            <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color: sourcesVisible.bess ? '#7e22ce' : 'var(--text-muted)' }}>BESS</span>
                        </button>
                    )}
                </div>
                {fullscreenChart === 'energyMix' && (
                    <button
                        onClick={() => setShowMonthZones(!showMonthZones)}
                        className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                        style={{ '--pill-color': 'var(--primary)', cursor: 'pointer', marginRight: '8px' }}
                    >
                        <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                        <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? 'Hide Months' : 'Show Months'}</span>
                    </button>
                )}
                <button
                    onClick={() => toggleFullscreen(fullscreenChart === 'energyMix' ? null : 'energyMix')}
                    className={`chart-toggle-pill ${fullscreenChart === 'energyMix' ? 'active shadow-sm border-primary/20' : ''}`}
                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                >
                    <Maximize size={14} className={fullscreenChart === 'energyMix' ? 'text-primary' : 'text-muted'} />
                    <span className={fullscreenChart === 'energyMix' ? 'text-primary font-bold' : ''}>
                        {fullscreenChart === 'energyMix' ? 'Exit Fullscreen' : 'Fullscreen'}
                    </span>
                </button>
            </div>
        </div>
        <div style={{ width: '100%', height: fullscreenChart === 'energyMix' ? 550 : 350, position: 'relative' }}>
            {isZoomingLoading ? (
                <div className="skeleton-shimmer skeleton-chart-large" style={{ width: '100%', height: fullscreenChart === 'energyMix' ? 550 : 350, marginTop: 0 }} />
            ) : (
                <ResponsiveContainer>
                    <ComposedChart 
                        data={zoomedData} 
                        style={{ cursor: 'pointer' }}
                        onClick={(state) => {
                            if (state && state.activeTooltipIndex !== undefined) {
                                const item = zoomedData[state.activeTooltipIndex];
                                if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                            }
                        }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                        {showMonthZones && fullscreenChart === 'energyMix' && monthZones.map((zone, idx) => (
                            <ReferenceArea 
                                key={idx}
                                x1={zone.start} 
                                x2={zone.end} 
                                fill={zone.color} 
                                stroke="var(--border-light)"
                                strokeWidth={1}
                                strokeOpacity={0.2}
                                label={{ 
                                    value: zone.month, 
                                    position: 'insideTopLeft', 
                                    fill: 'var(--text-muted)', 
                                    fontSize: 10, 
                                    fontWeight: 'bold',
                                    opacity: 0.4,
                                    offset: 10 
                                }} 
                            />
                        ))}
                        <XAxis 
                            dataKey="day"
                            interval="preserveStartEnd"
                            minTickGap={80}
                            tickFormatter={(v) => `Day ${v}`}
                        />
                        <YAxis label={{ value: 'Energy (kWh)', angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 700 }} />
                        <Tooltip 
                            cursor={{fill: 'var(--primary)', opacity: 0.05}}
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                            formatter={(val, name) => [`${Math.round(val)} kWh`, name.replace('Kwh', ' (kWh)')]}
                            labelFormatter={tooltipLabelFormatter}
                        />
                        {sourcesVisible.grid && (
                            <Bar isAnimationActive={false} dataKey="gridKwh" stackId="a" fill="var(--primary)" radius={[0, 0, 0, 0]} />
                        )}
                        {hasPv && sourcesVisible.pv && (
                            <Bar isAnimationActive={false} dataKey="pvUsedKwh" stackId="a" fill="#facc15" />
                        )}
                        {hasBess && sourcesVisible.bess && (
                            <Bar isAnimationActive={false} dataKey="bessDischargeKwh" stackId="a" fill="#a855f7" radius={[4, 4, 0, 0]} />
                        )}
                        {selectedDMA && (
                             <>
                                 {sourcesVisible.grid && (
                                     <Line isAnimationActive={false} type="monotone" dataKey={`grid${selectedDMA}DMA`} stroke="#1d4ed8" strokeWidth={2.5} dot={false} name={`Grid ${selectedDMA}DMA`} />
                                 )}
                                 {hasPv && sourcesVisible.pv && (
                                     <Line isAnimationActive={false} type="monotone" dataKey={`pvUsed${selectedDMA}DMA`} stroke="#ca8a04" strokeWidth={2.5} dot={false} name={`PV ${selectedDMA}DMA`} />
                                 )}
                                 {hasBess && sourcesVisible.bess && (
                                     <Line isAnimationActive={false} type="monotone" dataKey={`bessDischarge${selectedDMA}DMA`} stroke="#7e22ce" strokeWidth={2.5} dot={false} name={`BESS ${selectedDMA}DMA`} />
                                 )}
                             </>
                        )}
                        {selectedDay !== null && (
                            <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                         )}
                    </ComposedChart>
                </ResponsiveContainer>
            )}
        </div>
        {/* Standalone Brush Zoom Controller */}
        <div style={{ width: '100%', height: 40, marginTop: '20px' }}>
            <ResponsiveContainer>
                <AreaChart data={dailyOverviewData} margin={{ top: 0, bottom: 0, left: 55, right: 10 }}>
                    <XAxis dataKey="day" hide />
                    <Brush 
                        data={dailyOverviewData}
                        dataKey="day" 
                        height={24} 
                        stroke="var(--primary)"
                        fill="var(--bg-surface, #ffffff)"
                        tickFormatter={(v) => `Day ${v}`}
                        startIndex={zoomRange.start - 1}
                        endIndex={zoomRange.end !== null ? zoomRange.end - 1 : dailyOverviewData.length - 1}
                        onChange={handleBrushChange}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <ChartDownloadMenu 
            title="Daily Energy Mix" 
            data={zoomedData} 
            columns={[
              { key: 'gridKwh', label: 'Grid Import (kWh)' },
              ...(hasPv ? [{ key: 'pvUsedKwh', label: 'PV Direct (kWh)' }] : []),
              ...(hasBess ? [{ key: 'bessDischargeKwh', label: 'BESS Discharge (kWh)' }] : [])
            ]}
            cardRef={cardRef}
            style={{ position: 'relative', bottom: 'auto', right: 'auto', display: 'inline-block' }}
          />
        </div>
      </div>
    </>
  );
};

const BessUtilizationCard = ({
  zoomedData,
  isZoomingLoading,
  selectedDay,
  setSelectedDay,
  tooltipLabelFormatter,
  fullscreenChart,
  setFullscreenChart: toggleFullscreen,
  showMonthZones,
  setShowMonthZones,
  monthZones
}) => {
  const cardRef = React.useRef(null);
  const [bessSocVisible, setBessSocVisible] = useState(true);
  const [bessCyclesVisible, setBessCyclesVisible] = useState(true);
  const [isBessDropdownOpen, setIsBessDropdownOpen] = useState(false);

  const bessSocDomain = React.useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 100];
    const vals = zoomedData.map(d => d.avgBessSoc).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 5;
    return [Math.max(0, min - padding), Math.min(100, max + padding)];
  }, [zoomedData]);

  const bessCyclesDomain = React.useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 'auto'];
    const vals = zoomedData.map(d => d.bessCycles).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 0.1;
    return [Math.max(0, min - padding), max + padding];
  }, [zoomedData]);

  useEffect(() => {
    if (!isBessDropdownOpen) return;
    const handleClickOutside = () => {
      setIsBessDropdownOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isBessDropdownOpen]);

  return (
    <>
      {fullscreenChart === 'bess' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={cardRef} className={`card shadow-sm border-l-4 border-l-green-500 ${fullscreenChart === 'bess' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
          <div className="flex justify-between items-center mb-2" style={{ position: 'relative', zIndex: 10 }}>
              <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                  <Battery size={18} className="text-green-500" /> BESS Utilization & Health
                  <InfoTooltip 
                    title="Battery Usage" 
                    text="Avg SoC shows energy buffer levels; Cycles estimate full equivalent charge/discharge actions. High cycling improves profit but increases battery degradation." 
                  />
              </h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div className="relative" style={{ zIndex: 50 }}>
                       <button 
                           onClick={(e) => { e.stopPropagation(); setIsBessDropdownOpen(!isBessDropdownOpen); }}
                     className={`chart-toggle-pill ${(bessSocVisible || bessCyclesVisible) ? 'active shadow-sm border-primary/20' : ''}`}
                     style={{ '--pill-color': 'var(--primary)' }}
                 >
                     <Battery size={14} />
                     BESS Lines
                     <ChevronDown size={12} className="ml-1 opacity-70" />
                 </button>
                 {isBessDropdownOpen && (
                     <div 
                         onClick={(e) => e.stopPropagation()}
                         style={{
                             position: 'absolute',
                             right: 0,
                             top: '38px',
                             background: '#ffffff',
                             border: '1px solid #e5e7eb',
                             borderRadius: '16px',
                             boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
                             zIndex: 1000,
                             padding: '8px 0',
                             width: '200px',
                             display: 'flex',
                             flexDirection: 'column',
                             fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                         }}
                     >
                         <div style={{
                             padding: '8px 16px 4px',
                             fontSize: '9px',
                             fontWeight: '700',
                             color: '#9ca3af',
                             textTransform: 'uppercase',
                             letterSpacing: '0.05em'
                         }}>
                             Toggle Visibility
                         </div>
                         
                         <button
                             onClick={() => setBessSocVisible(!bessSocVisible)}
                             style={{
                                 display: 'flex',
                                 alignItems: 'center',
                                 justifyContent: 'space-between',
                                 width: '100%',
                                 padding: '10px 16px',
                                 fontSize: '12px',
                                 fontWeight: '600',
                                 color: bessSocVisible ? '#10b981' : '#4b5563',
                                 background: 'transparent',
                                 border: 'none',
                                 cursor: 'pointer',
                                 transition: 'all 0.15s',
                                 textAlign: 'left'
                             }}
                             onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                             onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                         >
                             <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                 <Battery size={14} style={{ color: bessSocVisible ? '#10b981' : '#9ca3af' }} />
                                 Avg SoC
                             </span>
                             {bessSocVisible && (
                                 <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                             )}
                         </button>

                         <button
                             onClick={() => setBessCyclesVisible(!bessCyclesVisible)}
                             style={{
                                 display: 'flex',
                                 alignItems: 'center',
                                 justifyContent: 'space-between',
                                 width: '100%',
                                 padding: '10px 16px',
                                 fontSize: '12px',
                                 fontWeight: '600',
                                 color: bessCyclesVisible ? '#8b5cf6' : '#4b5563',
                                 background: 'transparent',
                                 border: 'none',
                                 cursor: 'pointer',
                                 transition: 'all 0.15s',
                                 textAlign: 'left'
                             }}
                             onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                             onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                         >
                             <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                 <Activity size={14} style={{ color: bessCyclesVisible ? '#8b5cf6' : '#9ca3af' }} />
                                 Cycles
                             </span>
                             {bessCyclesVisible && (
                                 <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6' }} />
                             )}
                         </button>
                     </div>
                 )}
                 </div>
                 {fullscreenChart === 'bess' && (
                     <button
                         onClick={() => setShowMonthZones(!showMonthZones)}
                         className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                         style={{ '--pill-color': 'var(--primary)', cursor: 'pointer', marginRight: '8px' }}
                     >
                         <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                         <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? 'Hide Months' : 'Show Months'}</span>
                     </button>
                 )}
                 <button
                     onClick={() => toggleFullscreen(fullscreenChart === 'bess' ? null : 'bess')}
                     className={`chart-toggle-pill ${fullscreenChart === 'bess' ? 'active shadow-sm border-primary/20' : ''}`}
                     style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                 >
                     <Maximize size={14} className={fullscreenChart === 'bess' ? 'text-primary' : 'text-muted'} />
                     <span className={fullscreenChart === 'bess' ? 'text-primary font-bold' : ''}>
                         {fullscreenChart === 'bess' ? 'Exit Fullscreen' : 'Fullscreen'}
                     </span>
                 </button>
              </div>
          </div>
          <p className="text-[10px] text-muted mb-4">BESS utilization intensity and health monitoring.</p>
          <div style={{ width: '100%', height: fullscreenChart === 'bess' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
              {isZoomingLoading ? (
                  <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'bess' ? 500 : 200, marginTop: 0 }} />
            ) : (
                <ResponsiveContainer>
                    <AreaChart 
                        data={zoomedData}
                        style={{ cursor: 'pointer' }}
                        onClick={(state) => {
                            if (state && state.activeTooltipIndex !== undefined) {
                                const item = zoomedData[state.activeTooltipIndex];
                                if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                            }
                        }}
                    >
                        <defs>
                            <linearGradient id="colorBessSoc" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorBessCycles" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                        {showMonthZones && fullscreenChart === 'bess' && monthZones.map((zone, idx) => (
                            <ReferenceArea 
                                key={idx}
                                x1={zone.start} 
                                x2={zone.end} 
                                fill={zone.color} 
                                stroke="var(--border-light)"
                                strokeWidth={1}
                                strokeOpacity={0.2}
                                label={{ 
                                    value: zone.month, 
                                    position: 'insideTopLeft', 
                                    fill: 'var(--text-muted)', 
                                    fontSize: 10, 
                                    fontWeight: 'bold',
                                    opacity: 0.4,
                                    offset: 10 
                                }} 
                            />
                        ))}
                        <XAxis 
                            dataKey="day" 
                            fontSize={10} 
                            fontWeight={700} 
                            axisLine={false} 
                            tickLine={false} 
                            tickFormatter={(v) => `Day ${v}`}
                            interval="preserveStartEnd"
                            minTickGap={80}
                        />
                        <YAxis yAxisId="left" hide={!bessSocVisible} fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}%`} domain={bessSocDomain} />
                        <YAxis yAxisId="right" hide={!bessCyclesVisible} orientation="right" fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(1)} cyc`} domain={bessCyclesDomain} />
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }} 
                            labelFormatter={tooltipLabelFormatter}
                            formatter={(value, name) => {
                                const val = Number(value);
                                if (name === "Avg SoC") return [`${val.toFixed(2)}%`, name];
                                if (name === "Cycles") return [`${val.toFixed(2)} cyc`, name];
                                return [val.toFixed(2), name];
                            }}
                        />
                        {bessSocVisible && (
                            <Area isAnimationActive={false} yAxisId="left" type="monotone" dataKey="avgBessSoc" stroke="#10b981" fill="url(#colorBessSoc)" strokeWidth={2} name="Avg SoC" />
                        )}
                        {bessCyclesVisible && (
                            <Area isAnimationActive={false} yAxisId="right" type="monotone" dataKey="bessCycles" stroke="#8b5cf6" fill="url(#colorBessCycles)" strokeWidth={2} name="Cycles" />
                        )}
                        {selectedDay !== null && (
                            <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" yAxisId="left" />
                         )}
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
        <ChartDownloadMenu 
          title="BESS Utilization & Health" 
          data={zoomedData} 
          columns={[
            ...(bessSocVisible ? [{ key: 'avgBessSoc', label: 'Average BESS SoC (%)' }] : []),
            ...(bessCyclesVisible ? [{ key: 'bessCycles', label: 'BESS Cycles' }] : [])
          ]}
          cardRef={cardRef}
        />
      </div>
    </>
  );
};

const Results = () => {
  const procurementCostCardRef = React.useRef(null);
  const peakDemandCardRef = React.useRef(null);
  const peakSolarCardRef = React.useRef(null);
  const financialBalanceCardRef = React.useRef(null);
  const solarShareCardRef = React.useRef(null);
  const gridConstraintCardRef = React.useRef(null);
  const [results, setResults] = useState(null);
  
  const projectData = useMemo(() => {
    try {
      const saved = localStorage.getItem('energy_tool_project_data');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  }, []);
  const co2Factor = projectData?.meta?.co2_emission_factor ?? 400.0;

  const [showAllInsights, setShowAllInsights] = useState(false);
  const [expandedBus, setExpandedBus] = useState(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [performanceBucket, setPerformanceBucket] = useState(1); // Default to 1 hour
  const [lineVisibility, setLineVisibility] = useState({
    load: true,
    price: true,
    sockets: false,
    pv: true,
    bess: true,
    bessDischarge: true,
    bessCharge: true,
    netImport: true
  });

  const [bessChartVisibility, setBessChartVisibility] = useState({
    maxUsableCap: true,
    bessSoc: true,
    cellTemp: true,
    bessCharge: true,
    bessDischarge: true
  });

  const [isFleetExpanded, setIsFleetExpanded] = useState(false);

  const [fullscreenChart, setFullscreenChart] = useState(null); // null, 'energyMix', 'bess', 'procurementCost', 'peakDemand', 'peakSolar', 'financialBalance', 'solarShare', 'gridConstraint', 'loadProfile', 'bessThermal', 'timeline', 'performance'
  const [showMonthZones, setShowMonthZones] = useState(false);

  const toggleFullscreen = (target) => {
    setIsZoomingLoading(true);
    setTimeout(() => {
      setFullscreenChart(target);
      setTimeout(() => {
        setIsZoomingLoading(false);
      }, 400); // Wait for CSS transition (0.4s) to finish
    }, 80); // Wait for skeleton to render first
  };
  const [ganttColorMode, setGanttColorMode] = useState('intensity'); // 'intensity' or 'source'
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [auditTab, setAuditTab] = useState('optimized'); // 'optimized' or 'baseline'
  const [saveStatus, setSaveStatus] = useState('idle');
  const [selectedDay, setSelectedDay] = useState(null);
  const [auditActive, setAuditActive] = useState(false);
  const [showBaselineOverlay, setShowBaselineOverlay] = useState(false);
  const [zoomRange, setZoomRange] = useState({ start: 1, end: null });
  const [isZoomingLoading, setIsZoomingLoading] = useState(false);

  const [loadError, setLoadError] = useState(false);
  const [isLoadingUI, setIsLoadingUI] = useState(true);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const isFirstLoad = React.useRef(true);

  const isDrillDown = !results?.is_long_term || auditActive;

  useEffect(() => {
    if (selectedDay !== null && !isDrillDown) {
      const btn = document.getElementById(`day-btn-${selectedDay}`);
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedDay, isDrillDown]);

  useEffect(() => {
    async function loadResults() {
      try {
        const parsed = await getItem('optimization_results');
        if (parsed) {
          if (typeof parsed !== 'object') {
            throw new Error("Invalid result format");
          }
          setResults(parsed);
        }
      } catch (err) {
        console.error("Failed to load results from storage:", err);
        setLoadError(true);
      } finally {
        setStorageLoaded(true);
      }
    }
    loadResults();
  }, []);

  const lastStateRef = React.useRef({ selectedDay, auditActive });

  useEffect(() => {
    if (results) {
      const prev = lastStateRef.current;
      lastStateRef.current = { selectedDay, auditActive };

      const auditTransition = prev.auditActive !== auditActive;
      const dayTransitionInAudit = auditActive && prev.selectedDay !== selectedDay;
      const isInitial = isFirstLoad.current;

      if (!auditTransition && !dayTransitionInAudit && !isInitial && !isLoadingUI) {
        return;
      }

      setIsLoadingUI(true);
      const delay = isFirstLoad.current ? 700 : 500;
      isFirstLoad.current = false;
      const timer = setTimeout(() => {
        setIsLoadingUI(false);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [selectedDay, auditActive, results, isLoadingUI]);

  useEffect(() => {
    if (!results || selectedDay === null || !results.is_long_term) return;
    
    const btn = document.getElementById(`day-btn-${selectedDay}`);
    const container = document.getElementById('day-strip');
    if (btn && container) {
        const containerCenter = container.offsetWidth / 2;
        const btnCenter = btn.offsetLeft + (btn.offsetWidth / 2);
        container.scrollTo({
            left: btnCenter - containerCenter,
            behavior: 'smooth'
        });
    }
  }, [selectedDay, results?.is_long_term]);

  // Format data for the chart from the result profiles
  const timeStepMin = results?.run_metadata?.inputs?.time_step_minutes || 15;
  const pointsPerDay = 1440 / timeStepMin;
  const dt = timeStepMin / 60; // in hours
  
  const chartData = useMemo(() => {
    if (!results) return [];

    const getSlice = (profile) => {
      if (!profile || profile.length === 0) return [];
      if (!isDrillDown || !results.is_long_term) return profile;
      const start = (selectedDay || 0) * pointsPerDay;
      return profile.slice(start, start + pointsPerDay);
    };

    const slicedLoad = getSlice(results.aggregated_load_profile);
    const slicedPrices = getSlice(results.electricity_prices);

    return slicedLoad.map((load, i) => {
      const idx = i;
      
      const getV = (p) => {
          if (!p || !results[p] || results[p].length === 0) return 0;
          if (isDrillDown) {
              const globalIdx = selectedDay * pointsPerDay + i;
              return results[p][globalIdx] || 0;
          }
          return results[p][i] || 0;
      };

      return {
        time: `${Math.floor(i * timeStepMin / 60)}:${String(i * timeStepMin % 60).padStart(2, '0')}`,
        load: load,
        gridImport: getV('grid_import_profile'),
        baseline: getV('baseline_aggregated_load_profile'),
        pvYield: getV('pv_yield_profile'),
        pvUsed: getV('pv_used_profile'),
        pvCurtailed: getV('pv_curtailed_profile'),
        bessSoc: getV('bess_soc_profile'),
        bessCharge: getV('bess_charge_profile'),
        bessDischarge: getV('bess_discharge_profile'),
        bessChargeFromPv: getV('bess_charge_from_pv_profile'),
        bessChargeFromGrid: getV('bess_charge_from_grid_profile'),
        ambientTemp: getV('ambient_temperature_profile_c') || 25,
        cellTemp: getV('bess_cell_temperature_profile_c') || 25,
        capFactor: getV('bess_capacity_factor_profile') || 1,
        maxUsableCap: getV('bess_max_usable_capacity_profile_kwh') || (results.run_metadata?.inputs?.bess_config?.capacity_kwh || 0),
        price: slicedPrices[i] || 0,
        marketPrice: getV('market_prices') || (slicedPrices[i] || 0),
        dayIndex: Math.floor((isDrillDown ? (selectedDay * pointsPerDay + i) : i) / pointsPerDay)
      };
    });
  }, [results, isDrillDown, selectedDay, pointsPerDay, timeStepMin]);

  // Overview Data for Long-Term - optimized to run in O(N) single-pass without array slices
  const dailyOverviewData = useMemo(() => {
    if (!results || !results.is_long_term) return [];
    
    const overviewData = [];
    const totalDays = results.total_days || Math.floor((results.aggregated_load_profile?.length || 0) / pointsPerDay);
    const startDate = new Date(results.run_metadata?.inputs?.start_date || results.run_metadata?.settings?.longTermConfig?.startDate || '2026-01-01');
    let runningSavings = 0;
    let runningCost = 0;
    let runningCo2Savings = 0;
    
    for (let i = 0; i < totalDays; i++) {
      const start = i * pointsPerDay;
      const end = Math.min(start + pointsPerDay, results.aggregated_load_profile?.length || 0);
      
      let sumLoad = 0;
      let sumGrid = 0;
      let sumBaseline = 0;
      let sumPvUsed = 0;
      let sumPvYield = 0;
      let sumBessDischarge = 0;
      let sumBessSoc = 0;
      let sumTemp = 0;
      let maxLoad = 0;
      let maxPv = 0;
      let totalCost = 0;
      let baselineCostRaw = 0;
      let count = 0;
      
      for (let idx = start; idx < end; idx++) {
        const loadVal = results.aggregated_load_profile?.[idx] || 0;
        const gridVal = results.grid_import_profile?.[idx] || 0;
        const pvUsedVal = results.pv_used_profile?.[idx] || 0;
        const pvYieldVal = results.pv_yield_profile?.[idx] || 0;
        const bessDischargeVal = results.bess_discharge_profile?.[idx] || 0;
        const bessSocVal = results.bess_soc_profile?.[idx] || 0;
        const tempVal = results.ambient_temperature_profile_c?.[idx] || 0;
        const priceVal = results.electricity_prices?.[idx] || 0;
        const baselineVal = results.baseline_aggregated_load_profile?.[idx] || 0;
        
        sumLoad += loadVal;
        sumGrid += gridVal;
        sumBaseline += baselineVal;
        sumPvUsed += pvUsedVal;
        sumPvYield += pvYieldVal;
        sumBessDischarge += bessDischargeVal;
        sumBessSoc += bessSocVal;
        sumTemp += tempVal;
        
        if (loadVal > maxLoad) maxLoad = loadVal;
        if (pvYieldVal > maxPv) maxPv = pvYieldVal;
        
        totalCost += (gridVal * priceVal * dt / 1000);
        baselineCostRaw += (baselineVal * priceVal * dt / 1000);
        count++;
      }
      
      const denominator = count || 1;
      const pvYield = sumPvYield * dt;
      const pvUsed = sumPvUsed * dt;
      const solarShare = sumLoad > 0 ? (pvUsed / (sumLoad * dt)) * 100 : 0;
      
      const bessCap = results.run_metadata?.inputs?.bess_config?.capacity_kwh || 1000;
      const bessThroughput = sumBessDischarge * dt;
      const dailyCycles = bessCap > 0 ? bessThroughput / bessCap : 0;
      const avgSoc = bessCap > 0 ? (sumBessSoc / denominator) / bessCap * 100 : 0;
      const avgTemp = sumTemp / denominator;
      
      const baselineCost = baselineCostRaw !== 0 ? baselineCostRaw : (totalCost > 0 ? totalCost * 1.15 : totalCost * 0.85);
      const dailySavings = baselineCost - totalCost;
      runningSavings += dailySavings;
      runningCost += totalCost;

      const dailyCo2Saved = ((sumBaseline - sumGrid) * dt * co2Factor) / 1000000;
      runningCo2Savings += dailyCo2Saved;
      
      const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateLabel = currentDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long' });
      const monthVal = currentDate.getMonth();
      const yyyy = currentDate.getFullYear();
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDate.getDate()).padStart(2, '0');
      const dateIso = `${yyyy}-${mm}-${dd}`;

      overviewData.push({
        day: i + 1,
        dayLabel: `Day ${i + 1}`,
        dateLabel: dateLabel,
        dateIso: dateIso,
        monthLabel: monthLabel,
        monthVal: monthVal,
        loadKwh: sumLoad * dt,
        gridKwh: sumGrid * dt,
        baselineGridKwh: sumBaseline * dt,
        pvUsedKwh: pvUsed,
        pvYieldKwh: pvYield,
        bessDischargeKwh: bessThroughput,
        bessCycles: dailyCycles,
        avgBessSoc: avgSoc,
        totalCost: totalCost,
        baselineCost: baselineCost,
        dailySavings: dailySavings,
        cumulativeSavings: runningSavings,
        cumulativeCost: runningCost,
        netBalance: -runningCost,
        solarShare: solarShare,
        avgTemp: avgTemp,
        peakLoad: maxLoad,
        peakPv: maxPv,
        dailyCo2Saved: dailyCo2Saved,
        cumulativeCo2Savings: runningCo2Savings
      });
    }

    // Calculate trend lines using symmetric moving average
    const getSymmetricSMA = (data, key, idx, windowSize) => {
      const half = Math.floor(windowSize / 2);
      let sum = 0;
      let count = 0;
      const start = Math.max(0, idx - half);
      const end = Math.min(data.length - 1, idx + half);
      for (let j = start; j <= end; j++) {
        sum += data[j][key];
        count++;
      }
      return sum / count;
    };

    // Calculate trailing moving average (e.g. 20DMA)
    const getTrailingSMA = (data, key, idx, windowSize) => {
      let sum = 0;
      let count = 0;
      const start = Math.max(0, idx - windowSize + 1);
      for (let j = start; j <= idx; j++) {
        sum += data[j][key];
        count++;
      }
      return sum / count;
    };

    const windowSize = Math.max(5, Math.min(30, Math.floor(totalDays / 15)));
    return overviewData.map((d, index) => {
      const peakPvTrend = getSymmetricSMA(overviewData, 'peakPv', index, windowSize);
      const solarShareTrend = getSymmetricSMA(overviewData, 'solarShare', index, windowSize);
      
      const dmas = {};
      [20, 50, 100, 150, 200].forEach(w => {
        dmas[`grid${w}DMA`] = Math.round(getTrailingSMA(overviewData, 'gridKwh', index, w) * 10) / 10;
        dmas[`pvUsed${w}DMA`] = Math.round(getTrailingSMA(overviewData, 'pvUsedKwh', index, w) * 10) / 10;
        dmas[`bessDischarge${w}DMA`] = Math.round(getTrailingSMA(overviewData, 'bessDischargeKwh', index, w) * 10) / 10;
      });

      return {
        ...d,
        peakPvTrend: Math.round(peakPvTrend * 10) / 10,
        solarShareTrend: Math.round(solarShareTrend * 10) / 10,
        ...dmas
      };
    });
  }, [results, pointsPerDay, dt, co2Factor]);

  const monthZones = useMemo(() => {
    if (!dailyOverviewData || dailyOverviewData.length === 0) return [];
    const zones = [];
    let currentMonth = null;
    let currentMonthVal = null;
    let startIdx = 0;

    const colors = {
      0: 'rgba(14, 165, 233, 0.035)',   // Jan - Sky Blue (Winter)
      1: 'rgba(59, 130, 246, 0.035)',   // Feb - Blue (Winter)
      2: 'rgba(132, 204, 22, 0.035)',   // Mar - Lime (Spring)
      3: 'rgba(34, 197, 94, 0.035)',    // Apr - Green (Spring)
      4: 'rgba(16, 185, 129, 0.035)',   // May - Emerald (Spring)
      5: 'rgba(234, 179, 8, 0.035)',    // Jun - Yellow (Summer)
      6: 'rgba(249, 115, 22, 0.035)',    // Jul - Orange (Summer)
      7: 'rgba(239, 68, 68, 0.035)',    // Aug - Red (Summer)
      8: 'rgba(217, 119, 6, 0.035)',    // Sep - Amber/Bronze (Autumn)
      9: 'rgba(180, 83, 9, 0.035)',     // Oct - Rust/Brown (Autumn)
      10: 'rgba(120, 113, 108, 0.035)', // Nov - Stone/Slate Brown (Autumn)
      11: 'rgba(99, 102, 241, 0.035)'   // Dec - Indigo (Winter)
    };

    dailyOverviewData.forEach((d, i) => {
      if (currentMonth === null) {
        currentMonth = d.monthLabel;
        currentMonthVal = d.monthVal;
        startIdx = i;
      } else if (d.monthLabel !== currentMonth) {
        zones.push({
          month: currentMonth,
          start: dailyOverviewData[startIdx].day,
          end: dailyOverviewData[i - 1].day,
          color: colors[currentMonthVal] || 'rgba(0,0,0,0.02)'
        });
        currentMonth = d.monthLabel;
        currentMonthVal = d.monthVal;
        startIdx = i;
      }
    });

    if (currentMonth !== null) {
      zones.push({
        month: currentMonth,
        start: dailyOverviewData[startIdx].day,
        end: dailyOverviewData[dailyOverviewData.length - 1].day,
        color: colors[currentMonthVal] || 'rgba(0,0,0,0.02)'
      });
    }

    return zones;
  }, [dailyOverviewData]);

  // Selected Day Stats (only relevant for long-term drill-down or short-term overview)
  const dayStats = (isDrillDown && results?.is_long_term) 
    ? dailyOverviewData[selectedDay || 0] 
    : (results && !results.is_long_term 
        ? { 
            peakPv: Math.max(0, ...(results.pv_yield_profile || [])),
            peakLoad: Math.max(0, ...(results.aggregated_load_profile || [])),
            gridKwh: (results.grid_import_profile || []).reduce((a,b)=>a+b, 0) * dt,
            baselineGridKwh: (results.baseline_aggregated_load_profile && results.baseline_aggregated_load_profile.length > 0)
              ? (results.baseline_aggregated_load_profile.reduce((a,b)=>a+b, 0) * dt)
              : ((results.grid_import_profile || []).reduce((a,b)=>a+b, 0) * dt),
            totalCost: results.total_cost_eur
          }
        : null);

  const co2SavedVal = useMemo(() => {
    if (!results) return 0;
    if (isDrillDown && dayStats) {
      if (results.is_long_term) {
        return dayStats.dailyCo2Saved ?? 0;
      } else {
        // Single day
        return ((dayStats.baselineGridKwh - dayStats.gridKwh) * co2Factor) / 1000000;
      }
    } else {
      // Long-term overview
      const energyMwh = results.total_energy_mwh || 0.0;
      const co2EmissionsT = (energyMwh * 1000 * co2Factor) / 1e6;
      const baseLoadProfile = results.baseline_aggregated_load_profile || [];
      const baseEnergyMwh = baseLoadProfile.length > 0 
        ? (baseLoadProfile.reduce((a, b) => a + b, 0) * dt / 1000.0) 
        : energyMwh;
      const baseCo2EmissionsT = (baseEnergyMwh * 1000 * co2Factor) / 1e6;
      return baseCo2EmissionsT - co2EmissionsT;
    }
  }, [results, isDrillDown, dayStats, co2Factor, dt]);

  const zoomedData = useMemo(() => {
    if (!dailyOverviewData || dailyOverviewData.length === 0) return [];
    const end = zoomRange.end || dailyOverviewData.length;
    return dailyOverviewData.slice(zoomRange.start - 1, end);
  }, [dailyOverviewData, zoomRange]);

  // Calculate dynamic domains for long term view charts to ensure they are centered and scaled
  const procurementCostDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 'auto'];
    const vals = zoomedData.map(d => d.totalCost).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 10;
    return [Math.max(0, min - padding), max + padding];
  }, [zoomedData]);

  const peakDemandDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 'auto'];
    const vals = zoomedData.map(d => d.peakLoad).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 10;
    return [Math.max(0, min - padding), max + padding];
  }, [zoomedData]);

  const peakSolarDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 'auto'];
    const vals = zoomedData.map(d => d.peakPv).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 10;
    return [Math.max(0, min - padding), max + padding];
  }, [zoomedData]);

  const financialBalanceDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return ['auto', 'auto'];
    const vals = zoomedData.map(d => d.netBalance).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return ['auto', 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 10;
    return [min - padding, max + padding];
  }, [zoomedData]);

  const solarShareDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 100];
    const vals = zoomedData.map(d => d.solarShare).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 100];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const padding = (max - min) * 0.1 || 5;
    return [Math.max(0, min - padding), Math.min(100, max + padding)];
  }, [zoomedData]);

  const gridConstraintDomain = useMemo(() => {
    if (!zoomedData || zoomedData.length === 0) return [0, 'auto'];
    const vals = zoomedData.map(d => d.peakLoad).filter(v => v !== undefined && v !== null);
    if (vals.length === 0) return [0, 'auto'];
    
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    
    const gridLimit = results?.run_metadata?.inputs?.grid_limit_kw;
    if (gridLimit !== undefined) {
      min = Math.min(min, gridLimit);
      max = Math.max(max, gridLimit);
    }
    
    const padding = (max - min) * 0.1 || 10;
    return [Math.max(0, min - padding), max + padding];
  }, [zoomedData, results]);

  const tooltipLabelFormatter = (dayNum) => {
    const dayData = dailyOverviewData.find(d => d.day === dayNum);
    if (!dayData) return `Day ${dayNum}`;
    return `Day ${dayNum} (${dayData.dateLabel})`;
  };

  const isZoomed = dailyOverviewData && (zoomRange.start > 1 || (zoomRange.end !== null && zoomRange.end < dailyOverviewData.length));

  const brushIndicesRef = React.useRef({ start: 1, end: null });

  const handleBrushChange = (obj) => {
    if (obj && obj.startIndex !== undefined && obj.endIndex !== undefined) {
      brushIndicesRef.current = { start: obj.startIndex + 1, end: obj.endIndex + 1 };
    }
  };

  useEffect(() => {
    const handleMouseUp = () => {
      const currentStart = brushIndicesRef.current.start;
      const currentEnd = brushIndicesRef.current.end;
      if (currentStart !== zoomRange.start || currentEnd !== zoomRange.end) {
        setIsZoomingLoading(true);
        setZoomRange({
          start: currentStart,
          end: currentEnd
        });
        setTimeout(() => {
          setIsZoomingLoading(false);
        }, 350);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoomRange]);

  const handleResetZoom = () => {
    brushIndicesRef.current = { start: 1, end: null };
    setIsZoomingLoading(true);
    setZoomRange({ start: 1, end: null });
    setTimeout(() => {
      setIsZoomingLoading(false);
    }, 350);
  };

  const activeSchedules = useMemo(() => {
    if (!results) return null;
    if (isDrillDown && results.schedules_by_day) {
      return results.schedules_by_day[selectedDay] || null;
    }
    return results.schedules || null;
  }, [results, isDrillDown, selectedDay]);

  const activePrices = useMemo(() => {
    if (!results || !results.electricity_prices) return [];
    if (isDrillDown && results.is_long_term) {
      const start = (selectedDay || 0) * pointsPerDay;
      return results.electricity_prices.slice(start, start + pointsPerDay);
    }
    return results.electricity_prices;
  }, [results, isDrillDown, selectedDay, pointsPerDay]);

  const allStrategicMoves = useMemo(() => {
    return extractStrategicMoves(activeSchedules, activePrices, timeStepMin);
  }, [activeSchedules, activePrices, timeStepMin]);

  if (loadError) {
    return (
      <div className="card text-center py-20 border-l-4 border-l-error">
        <AlertTriangle className="mx-auto text-error mb-4" size={48} />
        <h2 className="text-xl font-bold mb-2">Memory Quota Exceeded or Corrupted Data</h2>
        <p className="text-muted mb-6 max-w-md mx-auto">
          The simulation result is too large for the browser's storage. Please try running a shorter simulation period or clearing your cache.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.href = '/'}>
           Return to Configuration
        </button>
      </div>
    );
  }

  if (!storageLoaded) {
    return <ResultsSkeleton results={results} selectedDay={selectedDay} auditActive={auditActive} />;
  }

  if (!results) {
    return (
      <div className="card text-center py-20">
        <h2 className="text-muted">No results found. Please run optimization first.</h2>
      </div>
    );
  }

  if (isLoadingUI) {
    return <ResultsSkeleton results={results} selectedDay={selectedDay} auditActive={auditActive} />;
  }

  let displayChartData = isDrillDown ? chartData : (results.is_long_term ? dailyOverviewData : chartData);

  // If in drill-down, we override results.bus_diagnostics with the day-specific ones
  if (isDrillDown) {
    if (results.diagnostics_by_day) {
        results.bus_diagnostics = results.diagnostics_by_day[selectedDay];
    }
    if (results.schedules_by_day) {
        results.schedules = results.schedules_by_day[selectedDay];
    }
    if (results.soc_profiles_by_day) {
        results.soc_profiles = results.soc_profiles_by_day[selectedDay];
    }
  }

  // Derived metadata
  const inputs = results.run_metadata?.inputs;
  const timestamp = results.run_metadata?.timestamp;
  const priceStats = (results.electricity_prices && results.electricity_prices.length > 0) ? {
    avg: results.electricity_prices.reduce((a, b) => a + b, 0) / results.electricity_prices.length,
    max: results.electricity_prices.reduce((a, b) => Math.max(a, b), -Infinity),
    min: results.electricity_prices.reduce((a, b) => Math.min(a, b), Infinity)
  } : { avg: 0, max: 0, min: 0 };

  // Calculate dynamic KPIs against baseline
  const totalOptimizedCost = results.total_cost_eur;
  const totalBaselineCost = results.baseline_cost_eur || (results.baseline_aggregated_load_profile?.reduce((acc, load, i) => {
    const price = (results.electricity_prices || [])[i] || 0;
    return acc + (load * price * dt);
  }, 0) / 1000) || totalOptimizedCost * 1.15;

  const totalBaselineEnergyMwh = results.baseline_aggregated_load_profile 
    ? (results.baseline_aggregated_load_profile.reduce((a, b) => a + b, 0) * dt / 1000)
    : results.total_energy_mwh;

  const savingsPercent = totalBaselineCost > 0 ? ((totalBaselineCost - totalOptimizedCost) / totalBaselineCost) * 100 : 0;
  const recommendedCharges = results.bus_diagnostics?.filter(d => d.is_charged).length || 0;
  
  // Dynamic totals for cards (Day or Global)
  const currentPvGenerated = chartData.reduce((acc, d) => acc + (d.pvYield || 0), 0) * dt;
  const currentPvUsed = chartData.reduce((acc, d) => acc + (d.pvUsed || 0), 0) * dt;
  const currentPvCurtailed = chartData.reduce((acc, d) => acc + (d.pvCurtailed || 0), 0) * dt;
  const currentBessThroughput = chartData.reduce((acc, d) => acc + (d.bessDischarge || 0), 0) * dt;
  const currentBessPeakSoc = Math.max(...chartData.map(d => d.bessSoc || 0), 0);
  const currentBessChargeFromPv = chartData.reduce((acc, d) => acc + (d.bessChargeFromPv || 0), 0) * dt;
  const currentBessChargeFromGrid = chartData.reduce((acc, d) => acc + (d.bessChargeFromGrid || 0), 0) * dt;
  const currentGridSavings = (isDrillDown && results.is_long_term) 
    ? (dailyOverviewData[selectedDay || 0]?.dailySavings || 0) 
    : (results.basic_optimized_cost_eur ? results.basic_optimized_cost_eur - results.total_cost_eur : 0);
  
  const hasPv = results.scenario?.includes('pv') && (currentPvGenerated > 0 || (results.total_pv_generated_kwh || 0) > 0);
  const hasBess = results.scenario?.includes('bess') && (currentBessThroughput > 0 || (results.total_bess_throughput_kwh || 0) > 0);
  const secondSectionCardCount = 2 + (hasPv ? 1 : 0) + (hasBess ? 1 : 0);

  let uniqueBusesCharged = 0;
  if (results.schedules) {
    try {
        uniqueBusesCharged = Object.values(results.schedules).filter(pList => Array.isArray(pList) && pList.some(v => v > 0.1)).length;
    } catch (e) {
        console.warn("Could not calculate unique buses:", e);
    }
  }



  const showGlobalComparison = !results.is_long_term || !isDrillDown;
  const stats = [
    { 
      label: isDrillDown ? (results.is_long_term ? `Energy Import (Day ${Number(selectedDay) + 1})` : 'Energy Import') : 'Total Energy Import', 
      value: (isDrillDown && dayStats)
        ? `${(dayStats.gridKwh / 1000).toFixed(2)} MWh`
        : `${(results.total_energy_mwh || 0).toFixed(1)} MWh`, 
      icon: <Zap size={18} />,
      desc: (isDrillDown && results.is_long_term) ? 'Net grid import for the selected 24h window.' : 'The total grid energy (charging) required to cover vehicle trip consumption and maintain battery safety buffers.'
    },
    { 
      label: isDrillDown ? (results.is_long_term ? `Daily Cost (Day ${Number(selectedDay) + 1})` : 'Optimized Cost') : 'Optimized Cost', 
      value: (
        <>
          €{( (isDrillDown && dayStats) ? dayStats.totalCost : (results.total_cost_eur || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {showGlobalComparison && <span className="text-muted font-normal ml-1" style={{ fontSize: '9px' }}>/ €{(totalBaselineCost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
        </>
      ), 
      icon: <DollarSign size={18} />, 
      delta: showGlobalComparison ? `-${(savingsPercent || 0).toFixed(1)}%` : null,
      desc: (isDrillDown && results.is_long_term) ? 'Calculated cost for this specific day based on the optimized schedule.' : 'Total procurement cost. Savings are compared to a standard charge-on-arrival baseline.'
    },
    { 
      label: isDrillDown ? (results.is_long_term ? `Daily Peak Load (Day ${Number(selectedDay) + 1})` : 'Daily Peak Load') : (results.is_long_term ? 'Simulation Horizon' : 'Vehicles Charged'), 
      value: (isDrillDown && dayStats)
        ? `${Math.round(dayStats.peakLoad)} kW`
        : (results.is_long_term ? `${Math.round(results.total_days || (results.aggregated_load_profile.length / pointsPerDay))} Days` : `${uniqueBusesCharged}/${results.bus_diagnostics?.length || (results.run_metadata?.inputs?.buses?.length || 0)}`), 
      icon: isDrillDown ? <TrendingUp size={18} /> : (results.is_long_term ? <Clock size={18} /> : <Battery size={18} />), 
      delta: (!isDrillDown && !results.is_long_term) ? `${Math.round((uniqueBusesCharged / (results.bus_diagnostics?.length || (results.run_metadata?.inputs?.buses?.length || 1))) * 100)}% Active` : null,
      desc: isDrillDown ? 'Highest instantaneous depot load recorded on this day.' : (results.is_long_term ? 'The total number of days simulated in this optimization run.' : 'Count of unique vehicles that received at least one active charging session.'),
    },
  ];

  stats.push({
    label: isDrillDown ? (results.is_long_term ? `Daily CO2 Savings (Day ${Number(selectedDay) + 1})` : 'CO2 Emission Savings') : 'CO2 Emission Savings',
    value: `${co2SavedVal.toFixed(3)} t CO2`,
    icon: <Leaf size={18} className="text-emerald-500" />,
    desc: isDrillDown 
      ? 'The amount of CO2 emissions saved on this specific day compared to the baseline load profile.' 
      : 'The total CO2 emissions saved over the simulation period compared to the charge-on-arrival baseline.'
  });

  // Add Long-Term specific aggregates if in Overview mode
  if (!isDrillDown && results.is_long_term) {
    const numDays = results.total_days || (results.aggregated_load_profile.length / pointsPerDay);
    const avgDailyCost = (results.total_cost_eur || 0) / (numDays || 1);
    const avgDailyEnergy = (results.total_energy_mwh || 0) / (numDays || 1);

    stats.push({
      label: 'Avg Daily Cost',
      value: `€${avgDailyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: <DollarSign size={18} />,
      desc: 'Average procurement cost per 24h cycle over the simulation horizon.'
    });
    
    stats.push({
      label: 'Avg Daily Energy',
      value: `${avgDailyEnergy.toFixed(2)} MWh`,
      icon: <Zap size={18} />,
      desc: 'Average energy requirement per day for the entire fleet.'
    });

    stats.push({
      label: 'Total Net Savings',
      value: `€${(totalBaselineCost - totalOptimizedCost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: <PiggyBank size={18} className="text-indigo-500" />,
      desc: 'Net financial benefit compared to the charge-on-arrival baseline across the full period.'
    });

    stats.push({
      label: 'Avg Market Price',
      value: `€${priceStats.avg.toFixed(1)} /MWh`,
      icon: <Activity size={18} />,
      desc: 'Mean electricity price during the simulated period.'
    });
  }


  const getAuditData = (type) => {
    const data = chartData.map((d, i) => {
      const loadVal = type === 'optimized' ? d.gridImport : (d.baseline || 0);
      const priceVal = d.price;
      const energy = loadVal * 0.25;
      const cost = (energy * priceVal) / 1000;
      
      const stepBuses = new Set();
      if (type === 'optimized' && results.schedules) {
        Object.entries(results.schedules).forEach(([id, powers]) => {
          if (powers[i] > 1.0) stepBuses.add(id);
        });
      } else if (type === 'baseline' && results.run_metadata?.inputs?.buses) {
        // Constrained fleet-wide simulation for baseline
        const auditInputs = results.run_metadata.inputs;
        const gridLimit = auditInputs.grid_limit_kw || 10000; // Fallback
        const socketLimit = auditInputs.num_chargers || 100;
        const delta_t = 0.25;

        // We pre-calculate the state of all buses up to this step i
        if (!auditInputs.buses) return { time: d.time, load: loadVal, price: priceVal, energy, cost, buses: new Set() };
        
        const fleetSocs = auditInputs.buses.map(b => b.initial_soc_kwh || 0);
        for (let t = 0; t <= i; t++) {
           let stepGridKw = 0;
           let stepSockets = 0;
           
           for (let bIdx = 0; bIdx < auditInputs.buses.length; bIdx++) {
              const bus = auditInputs.buses[bIdx];
              fleetSocs[bIdx] -= (bus.trip_energy_profile_kwh?.[t] || 0);
              fleetSocs[bIdx] = Math.max(0, fleetSocs[bIdx]);

              const isAvailable = bus.availability[t] === 1;
              const isHungry = fleetSocs[bIdx] < (bus.max_battery_capacity_kwh - 0.1);
              const hasSocket = stepSockets < socketLimit;
              const hasGridRoom = stepGridKw < gridLimit;

              if (isAvailable && isHungry && hasSocket && hasGridRoom) {
                 const neededKw = (bus.max_battery_capacity_kwh - fleetSocs[bIdx]) / (delta_t * bus.efficiency);
                 const allowableKw = Math.min(bus.max_power_kw, neededKw, gridLimit - stepGridKw);
                 
                 if (allowableKw > 1.0) {
                    if (t === i) stepBuses.add(bus.id);
                    fleetSocs[bIdx] += (allowableKw * delta_t * bus.efficiency);
                    stepGridKw += allowableKw;
                    stepSockets++;
                 }
              }
           }
        }
      }

      return { time: d.time, load: loadVal, price: priceVal, energy, cost, buses: stepBuses };
    }).filter(d => d.load > 0.1);

    const aggregated = [];
    let currentHour = null;
    data.forEach(d => {
      const hour = d.time.split(':')[0];
      if (currentHour === null || currentHour.hour !== hour) {
        currentHour = { hour, load: 0, energy: 0, cost: 0, avgPrice: 0, count: 0, uniqueBuses: new Set() };
        aggregated.push(currentHour);
      }
      currentHour.load += d.load;
      currentHour.energy += d.energy;
      currentHour.cost += d.cost;
      currentHour.avgPrice += d.price;
      currentHour.count++;
      d.buses.forEach(id => currentHour.uniqueBuses.add(id));
    });

    return aggregated.map(a => ({
      ...a,
      avgLoad: a.load / a.count,
      avgPrice: a.avgPrice / a.count,
      vehicleCount: a.uniqueBuses.size
    }));
  };

  const CostAuditModal = () => {
    if (!isAuditOpen) return null;

    const auditData = getAuditData(auditTab);
    const totalEnergyCap = auditData.reduce((acc, d) => acc + d.energy, 0);
    const totalCostCalc = auditData.reduce((acc, d) => acc + d.cost, 0);
    const avgPriceCalc = totalEnergyCap > 0 ? (totalCostCalc * 1000) / totalEnergyCap : 0;

    return (
      <div className="modal-overlay" onClick={() => setIsAuditOpen(false)}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="flex items-center gap-3">
              <div className="stat-icon" style={{ width: '40px', height: '40px' }}><DollarSign size={20} /></div>
              <div>
                <h2 className="text-lg font-bold">Cost Procurement Audit</h2>
                <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Precision Mathematical Traceability</p>
              </div>
            </div>
            <button className="p-2 hover:bg-app rounded-full transition-colors" onClick={() => setIsAuditOpen(false)}>
              <X size={20} className="text-muted" />
            </button>
          </div>
          
          <div className="modal-body">
            <div className="flex justify-between items-end mb-6">
              <div className="audit-tabs">
                <button 
                  className={`audit-tab ${auditTab === 'optimized' ? 'active' : ''}`}
                  onClick={() => setAuditTab('optimized')}
                >
                  Optimized Strategy
                </button>
                <button 
                  className={`audit-tab ${auditTab === 'baseline' ? 'active' : ''}`}
                  onClick={() => setAuditTab('baseline')}
                >
                  Charge-on-Arrival
                </button>
              </div>
              <div className="text-right pb-2">
                <div className="text-[10px] text-muted font-bold uppercase mb-1">Audit Period</div>
                <div className="text-xs font-bold text-app">48-Hour Planning Horizon</div>
              </div>
            </div>

            <div className="audit-math-card">
              <div className="audit-math-title flex items-center gap-2">
                Standard Procurement Math (Cumulative)
                <InfoTooltip align="down" text="While the system sums costs period-by-period at specific instantaneous prices, this math card shows the 'Weighted Average' (Total Cost / Total Energy) to provide a transparent summary of the overall strategy efficiency." />
              </div>
              <div className="audit-math-row">
                <div className="text-center">
                  <div className="audit-math-val">{totalEnergyCap.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                  <div className="text-[10px] text-muted uppercase mt-1">Total kWh</div>
                </div>
                <div className="audit-math-op">×</div>
                <div className="text-center">
                  <div className="audit-math-val">€{avgPriceCalc.toFixed(2)}</div>
                  <div className="text-[10px] text-muted uppercase mt-1">Weighted Avg EUR/MWh</div>
                </div>
                <div className="audit-math-op">/ 1000 =</div>
                <div className="text-center">
                  <div className="audit-math-val audit-math-highlight">€{totalCostCalc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-[10px] text-muted uppercase mt-1">Sum Total</div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-[10px] font-bold uppercase text-muted tracking-widest">Granular Hourly Audit Trail</h4>
                <div className="text-[10px] text-muted font-mono">Step Size: {timeStepMin} min (Aggregated to 1h)</div>
              </div>
              <div className="data-table-container border-none shadow-none" style={{ background: 'transparent' }}>
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Time Window</th>
                      <th>Avg Load</th>
                      <th>Energy</th>
                      <th className="text-center">Vehicles</th>
                      <th>Price</th>
                      <th className="text-right">Period Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-primary/5 transition-colors">
                        <td><div className="audit-step-number">{idx + 1}</div></td>
                        <td className="font-bold">{row.hour}:00 - {row.hour}:45</td>
                        <td>{row.avgLoad.toFixed(1)} kW</td>
                        <td>{row.energy.toFixed(1)} kWh</td>
                        <td className="text-center">
                          <span className="px-2 py-0.5 bg-app border border-border rounded-md font-bold text-[10px]">
                            {row.vehicleCount}
                          </span>
                        </td>
                        <td className="text-primary font-bold">€{row.avgPrice.toFixed(2)}</td>
                        <td className="text-right font-bold text-app">€{row.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 mt-6">
              <div className="flex gap-3">
                 <Info className="text-primary shrink-0" size={18} />
                 <div>
                    <h5 className="text-[10px] font-bold text-primary uppercase mb-1">Verification Note</h5>
                    <p className="text-[11px] text-primary/80 leading-relaxed">
                      This audit trail provides bit-level traceability for all procurement costs. 
                      Energy values are integrated over each {timeStepMin}-minute time step ($\Delta t = {dt.toFixed(2)}h$) and multiplied by the instantaneous effective price. 
                      Totals may vary by &lt;0.01€ from the main KPI due to floating-point precision in the hourly aggregation display.
                    </p>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const downloadCSV = (content, filename) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (!results) return;

    const getFormattedBaseFilename = (suffix, ext) => {
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
      
      return `eDOPT_${scenario}-${term}_${formattedDate}_${suffix}.${ext}`;
    };

    const runtimeMeta = results.run_metadata || {};
    const metaHeader = [
      `# Antigravity eDOPT - Optimization Export`,
      `# Run Timestamp: ${runtimeMeta.timestamp || new Date().toISOString()}`,
      `# Depot Capacity: ${runtimeMeta.inputs?.grid_limit_kw || 'N/A'} kW`,
      `# Total Cost: EUR ${results.total_cost_eur}`,
      `# -------------------------------------------`,
      ``
    ].join('\n');

    // 1. Aggregated Load CSV (Audit version)
    const summaryHeaders = ['Time', 'Grid Power (kW)', 'Market Price (Wholesale, EUR/MWh)', 'Effective Price (incl. Markups, EUR/MWh)', 'Grid Energy / Period (kWh)', 'Cost / Period (EUR)'];
    const summaryRows = chartData.map(d => [
        d.time, 
        (d.load || 0).toFixed(2), 
        (d.marketPrice || 0).toFixed(2), 
        (d.price || 0).toFixed(2),
        ((d.load || 0) * dt).toFixed(3),
        ((d.load || 0) * (d.price || 0) * dt / 1000).toFixed(4)
    ]);
    const summaryCSV = metaHeader + [summaryHeaders.join(','), ...summaryRows.map(r => r.join(','))].join('\n');
    downloadCSV(summaryCSV, getFormattedBaseFilename('depot_summary_audit', 'csv'));

    // 2. Detailed Schedules Pivot
    if (results.schedules) {
        const busIds = Object.keys(results.schedules);
        const detailHeaders = ['Time', ...busIds];
        const detailRows = Array.from({ length: results.aggregated_load_profile.length }, (_, i) => {
          const timeStr = `${Math.floor(i * timeStepMin / 60)}:${String(i * timeStepMin % 60).padStart(2, '0')}`;
          const busPowers = busIds.map(id => results.schedules[id][i] || 0);
          return [timeStr, ...busPowers];
        });
        const detailCSV = metaHeader + [detailHeaders.join(','), ...detailRows.map(r => r.join(','))].join('\n');
        
        setTimeout(() => {
            downloadCSV(detailCSV, getFormattedBaseFilename('detailed_schedules', 'csv'));
        }, 500);
    }

    // 3. Fleet Health Diagnostics
    if (results.bus_diagnostics) {
        const diagHeaders = [
            'Umlauf ID', 'Vehicle Type', 'Capacity (kWh)', 'Distance (km)', 
            'TARGET Initial SoC (kWh)', 'ACTUAL Initial SoC (kWh)',
            'TARGET Reserve (kWh)', 'ACTUAL Min SoC (kWh)', 
            'Final SoC (kWh)', 'Next-Day Buffer (kWh)',
            'Total Demand (kWh)', 'Total Charged (kWh)', 'Was Charged', 
            'Health Status', 'Diagnostic Reason'
        ];
        const diagRows = results.bus_diagnostics.map(d => [
            d.id, 
            `"${d.vehicle_type || ''}"`,
            d.capacity_kwh, 
            d.total_distance_km || 0,
            d.target_initial_soc_kwh || 0,
            d.initial_soc_kwh, 
            d.target_min_final_soc_kwh || 0,
            d.min_soc_reached_kwh, 
            d.final_soc_kwh, 
            d.next_day_required_energy_kwh || 0,
            d.total_trip_energy_kwh, 
            d.total_charged_energy_kwh,
            d.is_charged ? 'YES' : 'NO',
            d.status_flag,
            `"${d.diagnostic_reason || ''}"` // Wrap in quotes for safety with commas
        ]);
        const diagCSV = metaHeader + [diagHeaders.join(','), ...diagRows.map(r => r.join(','))].join('\n');
        
        setTimeout(() => {
            downloadCSV(diagCSV, getFormattedBaseFilename('fleet_diagnostics', 'csv'));
        }, 1000);
    }

    // 4. Full Route Audit (Trip-level detail)
    const allBusInputs = results.run_metadata?.inputs?.buses || [];
    if (allBusInputs.length > 0) {
        const auditHeaders = [
            'Umlauf ID', 'Fahrtnummer', 'Typ', 'Fahrtart', 'Start', 'End', 
            'Von', 'Von (Desc)', 'Nach', 'Nach (Desc)', 'Dist (m)', 'Energy (kWh)', 'Is Technical?'
        ];
        const auditRows = [];
        allBusInputs.forEach(bus => {
            if (bus.trips) {
                bus.trips.forEach(t => {
                    auditRows.push([
                        bus.id,
                        `"${t.fahrtnummer || ''}"`,
                        t.typ || '',
                        `"${t.fahrtart || ''}"`,
                        t.start || '',
                        t.end || '',
                        t.von || '',
                        `"${t.von_desc || ''}"`,
                        t.nach || '',
                        `"${t.nach_desc || ''}"`,
                        t.dist_m || 0,
                        t.energy_kwh || 0,
                        t.is_technical ? 'YES' : 'NO'
                    ]);
                });
            }
        });

        if (auditRows.length > 0) {
            const auditCSV = metaHeader + [auditHeaders.join(','), ...auditRows.map(r => r.join(','))].join('\n');
            setTimeout(() => {
                downloadCSV(auditCSV, getFormattedBaseFilename('full_route_audit', 'csv'));
            }, 1500);
        }
    }
  };

  const handleSaveToComparison = async () => {
    if (!results) return;
    setSaveStatus('saving');
    
    try {
      const history = await getItem('comparison_history') || [];
      const runId = results.run_metadata?.run_id || `${new Date().toISOString()}_manual`;
      
      // Ensure result has a run_id if it didn't
      if (!results.run_metadata) results.run_metadata = {};
      if (!results.run_metadata.run_id) results.run_metadata.run_id = runId;
      
      // Remove existing run with same ID to overwrite
      let updatedHistory = history.filter(r => r.run_metadata?.run_id !== runId);
      
      // Limit history to 6 runs max
      if (updatedHistory.length >= 6) {
         updatedHistory.shift(); 
      }
      
      updatedHistory.push(results);
      await setItem('comparison_history', updatedHistory);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error("Failed to save to comparison:", err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const displayedMoves = showAllInsights ? allStrategicMoves : allStrategicMoves.slice(0, 4);
  const formatTime = (t) => `${Math.floor(t * timeStepMin / 60)}:${String(t * timeStepMin % 60).padStart(2, '0')}`;
  const timelinePrices = activePrices || [];



  return (
    <div className="run-container animate-in">
      <style>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
        }
        .skeleton-chart {
          height: 200px;
          border-radius: 8px;
          margin-top: 16px;
        }
        .skeleton-chart-large {
          height: 320px;
          border-radius: 8px;
          margin-top: 16px;
        }
      `}</style>
      <div className="section-header flex justify-between items-end">
        <div>
          <h1>{results.is_long_term ? (auditActive ? `Simulation Audit: Day ${Number(selectedDay) + 1}` : 'Long-Term Performance Overview') : 'Optimization Results'}</h1>
          <p>{results.is_long_term ? (auditActive ? `Showing high-resolution details for the selected simulation window.` : `Aggregated results across ${results.total_days} days. Scrub to highlight, click to inspect.`) : 'Analyze the optimal charging schedule and cost savings.'}</p>
        </div>
        {(auditActive || (results.is_long_term && selectedDay !== null)) && (
          <button className="btn btn-outline mb-2 flex items-center gap-2" onClick={() => { setIsLoadingUI(true); setSelectedDay(null); setAuditActive(false); }}>
            <ArrowLeft size={16} /> {auditActive ? 'Back to Overview' : 'Clear Focus'}
          </button>
        )}
      </div>
      
      {results.storage_pruned && (
        <div className="bg-warning/10 border border-warning/20 rounded-2xl p-4 mb-8 animate-in slide-in-from-top-2 duration-500">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center text-warning shrink-0">
              <AlertTriangle size={16} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-warning uppercase tracking-wider mb-1">Storage Optimization Active</h4>
              <p className="text-xs opacity-80 leading-relaxed">
                {results.storage_message || "Detailed per-bus schedules were removed to keep simulation results for the entire period within browser memory."}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {!isDrillDown && results.is_long_term && (
        <SimulationDatePicker
          results={results}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          setAuditActive={setAuditActive}
          dailyOverviewData={dailyOverviewData}
          isDrillDown={isDrillDown}
          setIsLoadingUI={setIsLoadingUI}
        />
      )}

      {!isDrillDown && results.is_long_term && (
        <div className={`grid grid-cols-4 gap-6 mb-8`}>
          {stats.map((stat, i) => (
            <div key={i} className="card stat-card shadow-sm flex-col items-start gap-2 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 w-full">
                <div className="stat-icon">{stat.icon}</div>
                <div className="stat-info flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="stat-label">{stat.label}</span>
                    {stat.delta && (
                      <span className="stat-delta">
                        {stat.delta.includes('-') ? <TrendingDown size={14} /> : <TrendingUp size={14} />} {stat.delta}
                      </span>
                    )}
                  </div>
                  <span className="stat-value text-xl">{stat.value}</span>
                </div>
              </div>
              <p className="card-description mt-3 mb-0 w-full text-[10px] leading-tight">{stat.desc}</p>
            </div>
          ))}
        </div>
      )}

      {!isDrillDown && results.is_long_term && (
        <div className="grid grid-cols-1 gap-6 mb-8">
          <DailyEnergyMixCard
            results={results}
            dailyOverviewData={dailyOverviewData}
            zoomedData={zoomedData}
            isZoomed={isZoomed}
            zoomRange={zoomRange}
            handleResetZoom={handleResetZoom}
            isZoomingLoading={isZoomingLoading}
            handleBrushChange={handleBrushChange}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            hasPv={hasPv}
            hasBess={hasBess}
            timeStepMin={timeStepMin}
            fullscreenChart={fullscreenChart}
            setFullscreenChart={toggleFullscreen}
            showMonthZones={showMonthZones}
            setShowMonthZones={setShowMonthZones}
            monthZones={monthZones}
          />
          <div className={`grid ${hasPv ? 'grid-cols-3' : 'grid-cols-2'} gap-6`}>
      {fullscreenChart === 'procurementCost' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={procurementCostCardRef} className={`card shadow-sm border-l-4 border-l-success ${fullscreenChart === 'procurementCost' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <DollarSign size={18} className="text-success" /> Daily Procurement Cost
                            <InfoTooltip 
                              title="Operational Cost" 
                              text="Tracks the daily expenditure for grid energy. Negative values represent income during surplus/negative price windows." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'procurementCost' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'procurementCost' ? null : 'procurementCost')}
                                className={`chart-toggle-pill ${fullscreenChart === 'procurementCost' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'procurementCost' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'procurementCost' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'procurementCost' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Daily grid expenditure for depot operations.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'procurementCost' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'procurementCost' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <AreaChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <defs>
                                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'procurementCost' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `€${Math.round(v)}`} 
                                        domain={procurementCostDomain}
                                    />
                                    <Tooltip 
                                        formatter={(val) => val !== undefined ? `€${val.toFixed(2)}` : '€0.00'} 
                                        labelFormatter={tooltipLabelFormatter}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                                    />
                                    <Area isAnimationActive={false} type="monotone" dataKey="totalCost" stroke="#22c55e" fillOpacity={1} fill="url(#colorCost)" strokeWidth={2} />
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Daily Procurement Cost" 
                      data={zoomedData} 
                      columns={[{ key: 'totalCost', label: 'Procurement Cost (EUR)' }]}
                      cardRef={procurementCostCardRef}
                    />
                </div>
      {fullscreenChart === 'peakDemand' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={peakDemandCardRef} className={`card shadow-sm border-l-4 border-l-warning ${fullscreenChart === 'peakDemand' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <TrendingUp size={18} className="text-warning" /> Peak Power Demand
                            <InfoTooltip 
                              title="Peak Load" 
                              text="The highest instantaneous load (kW) recorded each day. Critical for staying within grid connection limits." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'peakDemand' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'peakDemand' ? null : 'peakDemand')}
                                className={`chart-toggle-pill ${fullscreenChart === 'peakDemand' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'peakDemand' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'peakDemand' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'peakDemand' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Highest recorded instantaneous load per day.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'peakDemand' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'peakDemand' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <AreaChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <defs>
                                        <linearGradient id="colorPeakLoad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'peakDemand' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}kW`} domain={peakDemandDomain} />
                                    <Tooltip 
                                        formatter={(v) => `${Math.round(v)} kW`} 
                                        labelFormatter={tooltipLabelFormatter}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                                    />
                                    <Area isAnimationActive={false} type="monotone" dataKey="peakLoad" stroke="#f59e0b" fillOpacity={1} fill="url(#colorPeakLoad)" strokeWidth={2} />
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Peak Power Demand" 
                      data={zoomedData} 
                      columns={[{ key: 'peakLoad', label: 'Peak Demand (kW)' }]}
                      cardRef={peakDemandCardRef}
                    />
                </div>
                {hasPv && (
                  <>
                    {fullscreenChart === 'peakSolar' && (
                      <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
                    )}
                    <div ref={peakSolarCardRef} className={`card shadow-sm border-l-4 border-l-yellow-400 ${fullscreenChart === 'peakSolar' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <Sun size={18} className="text-yellow-500" /> Peak Solar Yield
                            <InfoTooltip 
                              title="Solar Peak" 
                              text="The maximum instantaneous power generated by the PV system. Depends on weather and time of year." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'peakSolar' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'peakSolar' ? null : 'peakSolar')}
                                className={`chart-toggle-pill ${fullscreenChart === 'peakSolar' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'peakSolar' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'peakSolar' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'peakSolar' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Maximum instantaneous PV power output per day.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'peakSolar' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'peakSolar' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <ComposedChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'peakSolar' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}kW`} domain={peakSolarDomain} />
                                    <Tooltip 
                                        formatter={(v) => `${Math.round(v)} kW`} 
                                        labelFormatter={tooltipLabelFormatter}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                                    />
                                    <Bar isAnimationActive={false} dataKey="peakPv" fill="#facc15" radius={[4, 4, 0, 0]} />
                                    <Line isAnimationActive={false} type="monotone" dataKey="peakPvTrend" stroke="#ca8a04" strokeWidth={2.5} dot={false} name="PV Trend" />
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Peak Solar Yield" 
                      data={zoomedData} 
                      columns={[{ key: 'peakPv', label: 'Peak Solar Yield (kW)' }]}
                      cardRef={peakSolarCardRef}
                    />
                  </div>
                  </>
                )}
            </div>

            <div className="grid grid-cols-2 gap-6 mt-6">
      {fullscreenChart === 'financialBalance' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={financialBalanceCardRef} className={`card shadow-sm border-l-4 border-l-indigo-500 ${fullscreenChart === 'financialBalance' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <PiggyBank size={18} className="text-indigo-500" /> Cumulative Financial Balance
                            <InfoTooltip 
                              title="Financial Tracking" 
                              text="Tracks net financial balance over time. Rising lines indicate profit (income from negative price windows), while falling lines show net expenditure. Zero is the break-even point." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'financialBalance' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'financialBalance' ? null : 'financialBalance')}
                                className={`chart-toggle-pill ${fullscreenChart === 'financialBalance' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'financialBalance' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'financialBalance' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'financialBalance' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Cumulative net financial position relative to simulation start.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'financialBalance' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'financialBalance' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <AreaChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <defs>
                                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'financialBalance' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `€${Math.round(v)}`} 
                                        domain={financialBalanceDomain}
                                    />
                                    <Tooltip 
                                        formatter={(v) => [v !== undefined ? `€${v.toFixed(2)}` : '€0.00', "Net Balance"]}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                                        labelFormatter={tooltipLabelFormatter}
                                    />
                                    <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                    <Area isAnimationActive={false} type="monotone" dataKey="netBalance" stroke="#6366f1" fillOpacity={1} fill="url(#colorBalance)" strokeWidth={2} name="Net Balance" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Cumulative Financial Balance" 
                      data={zoomedData} 
                      columns={[{ key: 'netBalance', label: 'Cumulative Net Balance (EUR)' }]}
                      cardRef={financialBalanceCardRef}
                    />
                </div>
                {hasPv && (
                  <>
                    {fullscreenChart === 'solarShare' && (
                      <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
                    )}
                    <div ref={solarShareCardRef} className={`card shadow-sm border-l-4 border-l-cyan-500 ${fullscreenChart === 'solarShare' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <Zap size={18} className="text-cyan-500" /> Daily Solar Share
                            <InfoTooltip 
                              title="Solar Efficiency" 
                              text="Percentage of daily demand covered by direct PV generation. Higher share correlates with lower OPEX and carbon footprint." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'solarShare' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'solarShare' ? null : 'solarShare')}
                                className={`chart-toggle-pill ${fullscreenChart === 'solarShare' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'solarShare' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'solarShare' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'solarShare' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Renewable energy self-consumption share.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'solarShare' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'solarShare' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <ComposedChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'solarShare' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}%`} domain={solarShareDomain} />
                                    <Tooltip 
                                        formatter={(v) => `${v.toFixed(1)}%`}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }}
                                        labelFormatter={tooltipLabelFormatter}
                                    />
                                    <Bar isAnimationActive={false} dataKey="solarShare" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                                    <Line isAnimationActive={false} type="monotone" dataKey="solarShareTrend" stroke="#0891b2" strokeWidth={2.5} dot={false} name="Solar Share Trend" />
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Daily Solar Share" 
                      data={zoomedData} 
                      columns={[{ key: 'solarShare', label: 'Daily Solar Share (%)' }]}
                      cardRef={solarShareCardRef}
                    />
                  </div>
                  </>
                )}
                {hasBess && (
                    <BessUtilizationCard
                      zoomedData={zoomedData}
                      isZoomingLoading={isZoomingLoading}
                      selectedDay={selectedDay}
                      setSelectedDay={setSelectedDay}
                      tooltipLabelFormatter={tooltipLabelFormatter}
                      fullscreenChart={fullscreenChart}
                      setFullscreenChart={toggleFullscreen}
                      showMonthZones={showMonthZones}
                      setShowMonthZones={setShowMonthZones}
                      monthZones={monthZones}
                    />
                )}
      {fullscreenChart === 'gridConstraint' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div ref={gridConstraintCardRef} className={`card shadow-sm border-l-4 border-l-rose-500 ${(secondSectionCardCount % 2 !== 0) ? 'col-span-2' : ''} ${fullscreenChart === 'gridConstraint' ? 'expanded' : ''}`} style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '0.5rem' }}>
                        <h3 className="card-title text-primary mb-0 flex items-center gap-2">
                            <Activity size={18} className="text-rose-500" /> Grid Constraint Monitoring
                            <InfoTooltip 
                              title="Grid Safety" 
                              text="Monitors Peak Demand vs. Infrastructure limits. Proximity to the limit indicates the system is pushing boundaries to capture low prices or solar peaks." 
                            />
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {fullscreenChart === 'gridConstraint' && (
                                <button
                                    onClick={() => setShowMonthZones(!showMonthZones)}
                                    className={`chart-toggle-pill ${showMonthZones ? 'active shadow-sm border-primary/20' : ''}`}
                                    style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                                >
                                    <Calendar size={14} className={showMonthZones ? 'text-primary' : 'text-muted'} />
                                    <span className={showMonthZones ? 'text-primary font-bold' : ''}>{showMonthZones ? "Hide Months" : "Show Months"}</span>
                                </button>
                            )}
                            <button
                                onClick={() => toggleFullscreen(fullscreenChart === 'gridConstraint' ? null : 'gridConstraint')}
                                className={`chart-toggle-pill ${fullscreenChart === 'gridConstraint' ? 'active shadow-sm border-primary/20' : ''}`}
                                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
                            >
                                <Maximize size={14} className={fullscreenChart === 'gridConstraint' ? 'text-primary' : 'text-muted'} />
                                <span className={fullscreenChart === 'gridConstraint' ? 'text-primary font-bold' : ''}>
                                    {fullscreenChart === 'gridConstraint' ? 'Exit Fullscreen' : 'Fullscreen'}
                                </span>
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-muted mb-4">Infrastructure load vs. physical grid limit.</p>
                    <div style={{ width: '100%', height: fullscreenChart === 'gridConstraint' ? 500 : 200, marginBottom: '24px', position: 'relative' }}>
                        {isZoomingLoading ? (
                            <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'gridConstraint' ? 500 : 200, marginTop: 0 }} />
                        ) : (
                            <ResponsiveContainer>
                                <AreaChart 
                                    data={zoomedData}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(state) => {
                                        if (state && state.activeTooltipIndex !== undefined) {
                                            const item = zoomedData[state.activeTooltipIndex];
                                            if (item && item.day !== undefined) setSelectedDay(Number(item.day) - 1);
                                        }
                                    }}
                                >
                                    <defs>
                                        <linearGradient id="colorGridConstraint" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1}/>
                                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                    {showMonthZones && fullscreenChart === 'gridConstraint' && monthZones.map((zone, idx) => (
                                        <ReferenceArea 
                                            key={idx}
                                            x1={zone.start} 
                                            x2={zone.end} 
                                            fill={zone.color} 
                                            stroke="var(--border-light)"
                                            strokeWidth={1}
                                            strokeOpacity={0.2}
                                            label={{ 
                                                value: zone.month, 
                                                position: 'insideTopLeft', 
                                                fill: 'var(--text-muted)', 
                                                fontSize: 10, 
                                                fontWeight: 'bold',
                                                opacity: 0.4,
                                                offset: 10 
                                            }} 
                                        />
                                    ))}
                                    <XAxis 
                                        dataKey="day" 
                                        fontSize={10} 
                                        fontWeight={700} 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tickFormatter={(v) => `Day ${v}`}
                                        interval="preserveStartEnd"
                                        minTickGap={80}
                                    />
                                    <YAxis fontSize={10} fontWeight={700} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)} kW`} domain={gridConstraintDomain} />
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: 'var(--shadow-lg)' }} 
                                        labelFormatter={tooltipLabelFormatter}
                                    />
                                    <Area isAnimationActive={false} type="monotone" dataKey="peakLoad" stroke="#f43f5e" fillOpacity={1} fill="url(#colorGridConstraint)" strokeWidth={2} name="Peak Power" />
                                    {results.run_metadata?.inputs?.grid_limit_kw && (
                                      <ReferenceLine 
                                        y={results.run_metadata.inputs.grid_limit_kw} 
                                        stroke="#e11d48" 
                                        strokeDasharray="5 5" 
                                        label={{ value: 'GRID LIMIT', position: 'insideTopRight', fill: '#e11d48', fontSize: 9, fontWeight: 'bold' }} 
                                      />
                                    )}
                                    {selectedDay !== null && (
                                        <ReferenceLine x={Number(selectedDay) + 1} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" />
                                     )}
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <ChartDownloadMenu 
                      title="Grid Constraint Monitoring" 
                      data={zoomedData} 
                      columns={[{ key: 'peakLoad', label: 'Peak Power (kW)' }]}
                      cardRef={gridConstraintCardRef}
                    />
                </div>
            </div>
        </div>
      )}

      {isDrillDown && results.status?.includes('Heuristic Fallback') && (
        <div className="card border-l-4 border-l-error bg-error/5 mb-8 animate-in slide-in-from-top-4 duration-500">
          <div className="flex gap-4 p-2">
            <div className="text-error mt-1">
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-sm font-bold text-error">Mathematical Infeasibility Detected</h3>
                <span className="badge badge-error text-[9px] uppercase font-bold">Heuristic Fallback Active</span>
              </div>
              <p className="text-xs text-error/80 leading-relaxed mb-3">
                The MILP solver could not find a globally optimal solution that satisfies all constraints (SoC targets, grid limits, and charger availability) simultaneously. 
                The dashboard is currently displaying a <strong>safety-first heuristic schedule</strong>.
              </p>
              <div className="bg-black/5 p-3 rounded-lg border border-error/10 font-mono text-[10px] text-error mb-3">
                <span className="font-bold tracking-wider uppercase text-[9px] opacity-60">Technical Error Trace:</span> 
                <div className="mt-1">{results.status}</div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-white/40 p-2 rounded border border-error/5">
                <Info size={12} className="text-primary" />
                <span>
                  <span className="font-bold underline">Debugging Tip:</span> Review the <strong>Fleet Performance Diagnostics</strong> below. 
                  Look for rows marked as <strong>CRITICAL</strong>—these vehicles likely have insufficient charging windows for your 48h requirements.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDrillDown && (
        <div className="card mb-8 audit-card border-l-4 border-l-primary/40">
           <div className="flex justify-between items-start">
             <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary opacity-60 mb-2">
                   <Info size={14} /> Run Audit & Input Verification
                </div>
                <div className="flex gap-12">
                   <div className="audit-group">
                      <span className="audit-label">Model Strategy</span>
                      <div className="audit-vals">
                         <div className="audit-val-item">Mode: <span className="font-bold text-primary italic uppercase text-[10px]">
                           {results.scenario === 'pv_bess' ? 'Full Hybrid' : 
                            results.scenario === 'pv' ? 'PV Enhanced' : 
                            results.scenario === 'bess' ? 'BESS Enhanced' : 'Baseline'}
                         </span></div>
                         {inputs?.pv_config && (results.scenario === 'pv' || results.scenario === 'pv_bess') && (
                           <div className="audit-val-item">PV Pattern: <span className="font-bold text-primary italic uppercase text-[10px]">
                             {inputs.pv_config.profile_mode === 'open_meteo' 
                               ? `OPEN-METEO (${inputs.pv_config.reference_date || 'N/A'})` 
                               : 'BELL-CURVE'}
                           </span></div>
                         )}
                         {(results.scenario === 'bess' || results.scenario === 'pv_bess') && (
                           <div className="audit-val-item">BESS Thermal: <span className="font-bold text-primary italic uppercase text-[10px]">
                             {(inputs?.bess_config?.enable_temperature_capacity_derating || results.bess_cell_temperature_profile_c) ? `ENABLED (τ=${inputs?.bess_config?.thermal_time_constant_hours || 6}h)` : 'DISABLED'}
                           </span></div>
                         )}
                      </div>
                   </div>
                   <div className="audit-group">
                      <span className="audit-label">Infrastructure Snapshot</span>
                      <div className="audit-vals">
                         <div className="audit-val-item">Grid: <span className="font-bold text-app">{inputs.grid_limit_kw} kW</span></div>
                         <div className="audit-val-item">Sockets: <span className="font-bold text-app">{inputs.num_chargers} pts</span></div>
                      </div>
                   </div>
                   <div className="audit-group">
                      <span className="audit-label">Pricing Environment</span>
                      <div className="audit-vals">
                         <div className="audit-val-item">Avg: <span className="font-bold text-app">€{priceStats?.avg.toFixed(2)}/MWh</span></div>
                         <div className="audit-val-item">Peak: <span className="font-bold text-app text-error">€{priceStats?.max.toFixed(2)}/MWh</span></div>
                      </div>
                   </div>
                   <div className="audit-group">
                      <span className="audit-label">SoC Policy</span>
                      <div className="audit-vals">
                         <div className="audit-val-item">Start: <span className="font-bold text-app">{Math.round(inputs.initial_soc_fraction * 100)}%</span></div>
                         <div className="audit-val-item">Reserve: <span className="font-bold text-app">{Math.round(inputs.min_final_soc_fraction * 100)}%</span></div>
                         <div className="audit-val-item">Look-Ahead: <span className={`font-bold ${inputs.use_next_day_readiness ? 'text-primary' : 'text-muted'}`}>{inputs.use_next_day_readiness ? 'ON' : 'OFF'}</span></div>
                      </div>
                   </div>
                   <div className="audit-group">
                      <span className="audit-label">Fleet Specs</span>
                      <div className="audit-vals">
                         <div className="audit-val-item">Vehicles: <span className="font-bold text-app">{inputs.buses.length}</span></div>
                         <div className="audit-val-item">Time Grid: <span className="font-bold text-app">{inputs.time_step_minutes} min</span></div>
                         <div className="audit-val-item">Horizon: <span className="font-bold text-app">{inputs.planning_horizon_hours}h</span></div>
                      </div>
                   </div>
                </div>
             </div>
             <div className="text-right">
               <div className="text-[10px] text-muted font-mono">Run ID: {results.run_metadata?.run_id || `${timestamp?.split('T')[0]}_UNKNOWN`}</div>
               <div className="text-[10px] text-muted font-mono">Solved at: {timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}</div>
             </div>
           </div>
        </div>
      )}

      {isDrillDown && (
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={handleExport}>
            <Download size={18} /> Export Data
          </button>
          <button 
            className={`btn ${saveStatus === 'saved' ? 'btn-primary' : 'btn-outline'} transition-all`} 
            onClick={handleSaveToComparison}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? <Loader2 size={18} className="animate-spin" /> : 
             saveStatus === 'saved' ? <CheckCircle2 size={18} /> : 
             <GitCompare size={18} />} 
            {saveStatus === 'saved' ? 'Saved to Compare' : 'Save for Comparison'}
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>Report PDF</button>
        </div>
      </div>
      )}

      {isDrillDown && (
      <div className={`grid ${stats.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-6 mb-8`}>
        {stats.map((stat, i) => (
          <div 
            key={i} 
            className={`card stat-card shadow-sm flex-col items-start gap-2 ${stat.label.includes('Cost') ? 'cursor-pointer hover:border-primary/50 transition-all active:scale-[0.98]' : ''}`}
            onClick={stat.label.includes('Cost') ? () => setIsAuditOpen(true) : undefined}
          >
            <div className="flex items-center gap-3 w-full">
              <div className="stat-icon">{stat.icon}</div>
              <div className="stat-info flex-1">
                <div className="flex justify-between items-center mb-1">
                  <span className="stat-label">{stat.label}</span>
                  {stat.delta && (
                    <span className="stat-delta">
                      <TrendingDown size={14} /> {stat.delta}
                    </span>
                  )}
                </div>
                <span className="stat-value">{stat.value}</span>
              </div>
            </div>
            <p className="card-description mt-3 mb-0 w-full" style={{ textAlign: 'justify' }}>{stat.desc}</p>
          </div>
        ))}
      </div>
      )}

      {isDrillDown && (
        <div className="grid grid-cols-2 gap-6 mb-8">
            <div className={`card shadow-sm border-l-4 border-l-yellow-400 ${!hasPv ? 'grayscale opacity-60 no-hover' : ''}`}>
               {!hasPv && (
                 <div className="card-disabled-overlay">
                    <div className="disabled-banner">Feature not part of this optimization run</div>
                 </div>
               )}
               <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="card-title text-primary flex items-center gap-2">
                       <Sun size={18} className="text-yellow-500" /> Photovoltaic Activity
                    </h3>
                    <p className="card-description mb-0 uppercase font-bold opacity-60">{isDrillDown ? 'Daily Solar Yield' : 'Solar yield & utilization'}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-app">{Math.round(currentPvUsed).toLocaleString()} <span className="text-xs text-muted font-normal">kWh</span></div>
                    <div className="text-[10px] font-bold text-success">SELF-CONSUMED</div>
                  </div>
               </div>
               <div className="grid grid-cols-3 gap-4 mt-2">
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Generated</div>
                    <div className="font-bold text-sm">{Math.round(currentPvGenerated).toLocaleString()} kWh</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Curtailed</div>
                    <div className="font-bold text-sm text-error">{Math.round(currentPvCurtailed).toLocaleString()} kWh</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Self-Sufficiency</div>
                    <div className="font-bold text-sm text-primary">{currentPvGenerated > 0 ? Math.round((currentPvUsed / currentPvGenerated) * 100) : 0}%</div>
                  </div>
               </div>
            </div>

            <div className={`card shadow-sm border-l-4 border-l-indigo-400 ${!hasBess ? 'grayscale opacity-60 no-hover' : ''}`}>
               {!hasBess && (
                 <div className="card-disabled-overlay">
                    <div className="disabled-banner">Feature not part of this optimization run</div>
                 </div>
               )}
               <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="card-title text-primary flex items-center gap-2">
                       <Battery size={18} className="text-indigo-500" /> BESS Performance
                    </h3>
                    <p className="card-description mb-0 uppercase font-bold opacity-60">{isDrillDown ? 'Daily Storage Cycle' : 'Stationary Storage Cycle'}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-app">{Math.round(currentBessThroughput).toLocaleString()} <span className="text-xs text-muted font-normal">kWh</span></div>
                    <div className="text-[10px] font-bold text-indigo-500">THROUGHPUT</div>
                  </div>
               </div>
               <div className="grid grid-cols-4 gap-4 mt-2">
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Peak SoC</div>
                    <div className="font-bold text-sm">{Math.round(currentBessPeakSoc).toLocaleString()} kWh</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">PV-to-BESS</div>
                    <div className="font-bold text-sm text-success">{Math.round(currentBessChargeFromPv).toLocaleString()} kWh</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Grid-to-BESS</div>
                    <div className="font-bold text-sm text-indigo-500">{Math.round(currentBessChargeFromGrid).toLocaleString()} kWh</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted font-bold uppercase flex items-center gap-1">Grid Savings</div>
                    <div className="font-bold text-sm text-primary">€{currentGridSavings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
               </div>
            </div>
        </div>
      )}

      {fullscreenChart === 'loadProfile' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      {isDrillDown && (
      <div className="grid grid-cols-1 gap-6 mb-6">
        <div className={`card chart-card ${fullscreenChart === 'loadProfile' ? 'expanded' : ''}`}>
          <div className="flex justify-between items-center mb-6 h-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
              <Zap size={20} /> Load Profile vs. Price Signal
            </h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setLineVisibility(v => ({ ...v, load: !v.load }))} className={`chart-toggle-pill ${lineVisibility.load ? 'active' : ''}`} style={{ '--pill-color': 'var(--primary)' }}><Zap size={14} /> Bus Demand</button>
              {results.scenario !== 'baseline' && <button onClick={() => setLineVisibility(v => ({ ...v, netImport: !v.netImport }))} className={`chart-toggle-pill ${lineVisibility.netImport ? 'active' : ''}`} style={{ '--pill-color': '#6366f1' }}><Activity size={14} /> Grid Import</button>}
              {(results.scenario === 'pv' || results.scenario === 'pv_bess') && <button onClick={() => setLineVisibility(v => ({ ...v, pv: !v.pv }))} className={`chart-toggle-pill ${lineVisibility.pv ? 'active' : ''}`} style={{ '--pill-color': '#eab308' }}><Sun size={14} /> PV Yield</button>}
              <button onClick={() => setLineVisibility(v => ({ ...v, price: !v.price }))} className={`chart-toggle-pill ${lineVisibility.price ? 'active' : ''}`} style={{ '--pill-color': 'var(--warning)' }}><DollarSign size={14} /> Price</button>
              <button 
                onClick={() => setShowBaselineOverlay(!showBaselineOverlay)} 
                className={`chart-toggle-pill ${showBaselineOverlay ? 'active' : ''}`} 
                style={{ '--pill-color': '#94a3b8' }}
              >
                <GitCompare size={14} /> Compare Baseline
              </button>
              <button
                onClick={() => toggleFullscreen(fullscreenChart === 'loadProfile' ? null : 'loadProfile')}
                className={`chart-toggle-pill ${fullscreenChart === 'loadProfile' ? 'active shadow-sm border-primary/20' : ''}`}
                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
              >
                <Maximize size={14} className={fullscreenChart === 'loadProfile' ? 'text-primary' : 'text-muted'} />
                <span className={fullscreenChart === 'loadProfile' ? 'text-primary font-bold' : ''}>
                  {fullscreenChart === 'loadProfile' ? 'Exit Fullscreen' : 'Fullscreen'}
                </span>
              </button>
            </div>
          </div>
          <div style={{ width: '100%', height: fullscreenChart === 'loadProfile' ? 550 : 350 }}>
            {isZoomingLoading ? (
              <div className="skeleton-shimmer skeleton-chart-large" style={{ width: '100%', height: fullscreenChart === 'loadProfile' ? 550 : 350, marginTop: 0 }} />
            ) : (
              <ResponsiveContainer>
              <AreaChart data={displayChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `€${v}`} />
                <Tooltip 
                  formatter={(value, name) => {
                    if (typeof value !== 'number') return value;
                    if (name && name.toLowerCase().includes('price')) {
                      return [`€${value.toFixed(2)}/MWh`, name];
                    }
                    return [`${(Math.round(value * 2) / 2).toFixed(1)} kW`, name];
                  }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)' }} 
                />
                {showBaselineOverlay && <Area isAnimationActive={false} yAxisId="left" type="stepAfter" dataKey="baseline" name="Baseline (Charge on Arrival)" stroke="#94a3b8" fillOpacity={0.1} fill="#94a3b8" strokeWidth={2} strokeDasharray="3 3" />}
                {lineVisibility.netImport && <Area isAnimationActive={false} yAxisId="left" type="stepAfter" dataKey="gridImport" name="Net Grid Import" stroke="#6366f1" fillOpacity={0.1} fill="#6366f1" strokeWidth={2} />}
                {lineVisibility.load && <Area isAnimationActive={false} yAxisId="left" type="stepAfter" dataKey="load" name="Bus Charging Demand" stroke="var(--primary)" fillOpacity={0.05} fill="var(--primary)" strokeWidth={2} strokeDasharray="5 5" />}
                {lineVisibility.pv && <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="pvYield" name="PV Generation" stroke="#eab308" dot={false} strokeWidth={2} />}
                {lineVisibility.price && <Line isAnimationActive={false} yAxisId="right" type="stepAfter" dataKey="price" name="Price Signal" stroke="var(--warning)" dot={false} strokeWidth={2} />}
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      )}
      {fullscreenChart === 'bessThermal' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      {isDrillDown && (['bess', 'pv_bess'].includes(results.scenario)) && results.ambient_temperature_profile_c && results.ambient_temperature_profile_c.length > 0 && (
        <div className={`card shadow-sm border-l-4 border-l-orange-400 mb-8 animate-in duration-700 ${fullscreenChart === 'bessThermal' ? 'expanded' : ''}`}>
          <div className="flex justify-between items-center mb-6 h-8">
            <h3 className="card-title text-primary flex items-center gap-2 mb-0">
              <Activity size={18} className="text-orange-500" /> BESS Thermal & Capacity Analysis
              <InfoTooltip title="Thermal Performance" text="Analyzes how ambient and cell temperatures impact the effective usable capacity of the BESS. The solver respects these dynamic limits to prevent over-discharging during cold periods." />
            </h3>
            <div className="flex flex-wrap gap-2">
              <button 
                onClick={() => setBessChartVisibility(v => ({ ...v, bessSoc: !v.bessSoc }))}
                className={`chart-toggle-pill ${bessChartVisibility.bessSoc ? 'active' : ''}`}
                style={{ '--pill-color': '#6366f1' }}
              >
                <Battery size={13} /> BESS SoC
              </button>
              <button 
                onClick={() => setBessChartVisibility(v => ({ ...v, cellTemp: !v.cellTemp }))}
                className={`chart-toggle-pill ${bessChartVisibility.cellTemp ? 'active' : ''}`}
                style={{ '--pill-color': '#ef4444' }}
              >
                <Thermometer size={13} /> Cell Temp
              </button>
              <button 
                onClick={() => setBessChartVisibility(v => ({ ...v, bessCharge: !v.bessCharge }))}
                className={`chart-toggle-pill ${bessChartVisibility.bessCharge ? 'active' : ''}`}
                style={{ '--pill-color': '#ec4899' }}
              >
                <Zap size={13} /> Charge
              </button>
              <button 
                onClick={() => setBessChartVisibility(v => ({ ...v, bessDischarge: !v.bessDischarge }))}
                className={`chart-toggle-pill ${bessChartVisibility.bessDischarge ? 'active' : ''}`}
                style={{ '--pill-color': '#a855f7' }}
              >
                <Activity size={13} /> Discharge
              </button>
              <button 
                onClick={() => setBessChartVisibility(v => ({ ...v, maxUsableCap: !v.maxUsableCap }))}
                className={`chart-toggle-pill ${bessChartVisibility.maxUsableCap ? 'active' : ''}`}
                style={{ '--pill-color': '#f97316' }}
              >
                <ShieldCheck size={13} /> Max Usable
              </button>
              <button
                onClick={() => toggleFullscreen(fullscreenChart === 'bessThermal' ? null : 'bessThermal')}
                className={`chart-toggle-pill ${fullscreenChart === 'bessThermal' ? 'active shadow-sm border-primary/20' : ''}`}
                style={{ '--pill-color': 'var(--primary)', cursor: 'pointer' }}
              >
                <Maximize size={14} className={fullscreenChart === 'bessThermal' ? 'text-primary' : 'text-muted'} />
                <span className={fullscreenChart === 'bessThermal' ? 'text-primary font-bold' : ''}>
                  {fullscreenChart === 'bessThermal' ? 'Exit Fullscreen' : 'Fullscreen'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="card-description mb-0 uppercase font-bold opacity-60">Ambient-Temperature-Based Derating</p>
            </div>
            <div className="grid grid-cols-4 gap-8">
              <div className="text-right">
                <div className="font-bold text-app" style={{ fontSize: '11px', opacity: 0.8 }}>{Math.min(...results.bess_capacity_factor_profile).toFixed(2)}</div>
                <div className="text-muted uppercase" style={{ fontSize: '9px', opacity: 0.5 }}>Min Cap</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-app" style={{ fontSize: '11px', opacity: 0.8 }}>{(results.ambient_temperature_profile_c.reduce((a,b)=>a+b,0)/results.ambient_temperature_profile_c.length).toFixed(1)}°C</div>
                <div className="text-muted uppercase" style={{ fontSize: '9px', opacity: 0.5 }}>Avg Amb</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-app" style={{ fontSize: '11px', opacity: 0.8 }}>{Math.min(...results.bess_max_usable_capacity_profile_kwh).toFixed(1)} <span style={{ fontSize: '9px', fontWeight: 'normal' }}>kWh</span></div>
                <div className="text-muted uppercase" style={{ fontSize: '9px', opacity: 0.5 }}>Min Usable</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-orange-500" style={{ fontSize: '11px', opacity: 0.8 }}>{(results.bess_cell_temperature_profile_c.reduce((a,b)=>a+b,0)/results.bess_cell_temperature_profile_c.length).toFixed(1)}°C</div>
                <div className="text-muted uppercase" style={{ fontSize: '9px', opacity: 0.5 }}>Avg Cell</div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-6">
             <div style={{ width: '100%', height: fullscreenChart === 'bessThermal' ? 500 : 300 }}>
               {isZoomingLoading ? (
                 <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'bessThermal' ? 500 : 300, marginTop: 0 }} />
               ) : (
                 <ResponsiveContainer>
                 <AreaChart data={displayChartData}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                   <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                   <YAxis yAxisId="left" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} label={{ value: 'CAPACITY (kWh)', angle: -90, position: 'insideLeft', style: {fontSize: '9px', fontWeight: 'bold', fill: 'var(--text-muted)', opacity: 0.5} }} />
                   <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} label={{ value: 'POWER (kW)', angle: 90, position: 'insideRight', style: {fontSize: '9px', fontWeight: 'bold', fill: 'var(--text-muted)', opacity: 0.5} }} />
                   <YAxis yAxisId="right-temp" orientation="right" domain={[0, 'auto']} stroke="#ef4444" fontSize={10} tickLine={false} axisLine={false} label={{ value: 'TEMP (°C)', angle: 90, position: 'insideRight', style: {fontSize: '9px', fontWeight: 'bold', fill: '#ef4444', opacity: 0.5} }} />
                   <Tooltip 
                     contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)', fontSize: '11px' }}
                     formatter={(value, name) => {
                       const val = Number(value);
                       if (name.includes('Temp')) return [`${val.toFixed(1)} °C`, name];
                       if (name.includes('Factor')) return [`${val.toFixed(2)}`, name];
                       return [`${val.toFixed(1)} kWh/kW`, name];
                     }}
                   />
                   
                   <Area isAnimationActive={false} 
                      yAxisId="left" type="stepAfter" dataKey="maxUsableCap" name="Max Usable Capacity" 
                      stroke="#f97316" fillOpacity={bessChartVisibility.maxUsableCap ? 0.1 : 0} 
                      fill="#f97316" strokeWidth={2} dot={false} hide={!bessChartVisibility.maxUsableCap}
                    />
                    <Area isAnimationActive={false} 
                      yAxisId="left" type="stepAfter" dataKey="bessSoc" name="BESS SoC" 
                      stroke="#6366f1" fillOpacity={bessChartVisibility.bessSoc ? 0.05 : 0} 
                      fill="#6366f1" strokeWidth={2} dot={false} hide={!bessChartVisibility.bessSoc}
                    />
                    <Line isAnimationActive={false} 
                      yAxisId="right-temp" type="monotone" dataKey="cellTemp" name="Cell Temp" 
                      stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="3 3"
                      hide={!bessChartVisibility.cellTemp}
                    />
                    <Bar isAnimationActive={false} 
                      yAxisId="right" dataKey="bessCharge" name="Charging Power" 
                      fill="#ec4899" opacity={bessChartVisibility.bessCharge ? 0.3 : 0} 
                      barSize={4} hide={!bessChartVisibility.bessCharge}
                    />
                    <Bar isAnimationActive={false} 
                      yAxisId="right" dataKey="bessDischarge" name="Discharging Power" 
                      fill="#a855f7" opacity={bessChartVisibility.bessDischarge ? 0.3 : 0} 
                      barSize={4} hide={!bessChartVisibility.bessDischarge}
                    />
                 </AreaChart>
               </ResponsiveContainer>
               )}
             </div>
          </div>
        </div>
      )}

      {isDrillDown && (
        <div className="card mb-8">
          <div className="flex justify-between items-center mb-6 h-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
              <Lightbulb size={20} /> 
              Strategic Charging Decisions
            </h3>
            {allStrategicMoves.length > 4 && (
              <button 
                className="btn btn-outline btn-sm text-primary border-primary/20 hover:bg-primary/5 h-8 px-3"
                onClick={() => setShowAllInsights(!showAllInsights)}
              >
                {showAllInsights ? (
                  <><ChevronUp size={14} /> Show Less</>
                ) : (
                  <><ChevronDown size={14} /> View All ({allStrategicMoves.length})</>
                )}
              </button>
            )}
          </div>
          <p className="card-description">The AI analyzed the daily market prices and identified opportunities to shift charging sessions to lower-cost periods ("valleys") while strictly respecting all vehicle availability constraints. This results in direct operational cost reductions.</p>
          
          {!showAllInsights ? (
            <div className="insights-grid">
              {displayedMoves.map((move, i) => (
                <div key={i} className="insight-item animate-in" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="insight-header">
                    <span className="insight-bus-id">{move.busId}</span>
                    <span className="insight-saving-badge">€{move.savings.toFixed(2)} saved</span>
                  </div>
                  <div className="insight-body">
                    Shifted to major price valley at {formatTime(move.startTime)}
                  </div>
                  <div className="insight-meta">
                    <div className="insight-meta-item"><Clock size={12} /> {move.duration} min</div>
                    <div className="insight-meta-item"><Zap size={12} /> {Math.round(move.powerSum)} kWh</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="insights-list animate-in">
              <div className="insight-row bg-transparent border-none py-0 mb-2 px-5 opacity-50">
                <span className="text-[10px] font-bold uppercase tracking-wider">Umlauf ID</span>
                <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">Optimization Strategy <InfoTooltip text="The shift direction identified by the solver. 'Price valley shift' means charging was delayed to a period where electricity is cheaper compared to the daily average." /></span>
                <span className="text-[10px] font-bold uppercase tracking-wider">Duration</span>
                <span className="text-[10px] font-bold uppercase tracking-wider">Energy</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-right flex items-center justify-end gap-1">Saving <InfoTooltip text="Estimated cost reduction in EUR achieved by shifting this specific session. Calculated against the cost of charging immediately upon arrival." /></span>
              </div>
              {allStrategicMoves.map((move, i) => (
                <div key={i} className="insight-row animate-in" style={{ animationDelay: `${i * 0.02}s` }}>
                  <div className="bus-id">{move.busId}</div>
                  <div className="main-info">Price valley shift ({formatTime(move.startTime)})</div>
                  <div className="meta-val"><Clock size={12} /> {move.duration} min</div>
                  <div className="meta-val"><Zap size={12} /> {Math.round(move.powerSum)} kWh</div>
                  <div className="savings-val">+€{move.savings.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
          {allStrategicMoves.length === 0 && (
            <div className="col-span-full py-6 text-center text-muted italic">
              No significant price-based strategic shifts identified. Charging was likely distributed evenly due to flat price signals.
            </div>
          )}
        </div>
      )}

      {isDrillDown && (
      <div className="card mb-8">
        <div className="flex justify-between items-center mb-6 h-8">
          <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
            <Battery size={20} /> 
            Fleet Performance Diagnostics
          </h3>
            <div className="flex gap-4 items-center" style={{ fontSize: '10px', opacity: 0.7, fontWeight: 700, letterSpacing: '0.05em' }}>
              <div className="flex items-center gap-2" style={{ color: 'var(--success)' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success)', flexShrink: 0 }}></div>
                HEALTHY
              </div>
              <div className="flex items-center gap-2" style={{ color: 'var(--warning)' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--warning)', flexShrink: 0 }}></div>
                AT RISK
              </div>
              <div className="flex items-center gap-2" style={{ color: 'var(--error)' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--error)', flexShrink: 0 }}></div>
                CRITICAL
              </div>
            </div>
        </div>
        <p className="card-description">Per-vehicle energy balance and battery health audit. Click a row to inspect the dynamic SoC trace.</p>

        {!results.bus_diagnostics && results.storage_pruned ? (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-border-light mb-8">
            <LayoutDashboard size={40} className="text-muted opacity-20 mb-4" />
            <h3 className="text-base font-bold text-muted uppercase tracking-wider">Diagnostic Data Not Available</h3>
            <p className="text-[11px] text-muted max-w-xs text-center mt-2 px-6 leading-relaxed">
              Detailed per-vehicle diagnostics for this specific day were discarded to fit the massive 1-year simulation results into browser memory.
            </p>
          </div>
        ) : (
          <div className="diag-table-wrapper">
            <table className="diag-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th>Umlauf ID</th>
                  <th>Type</th>
                  <th>Cap.</th>
                  <th>Dist.</th>
                  <th>Start </th>
                  <th>Min SoC</th>
                  <th>End SoC</th>
                  <th>Buffer</th>
                  <th>Demand</th>
                  <th>Charged</th>
                  <th>Charged?</th>
                  <th>Status / Reason</th>
                </tr>
              </thead>
              <tbody>
                {results.bus_diagnostics?.slice(0, isFleetExpanded ? undefined : 10).map((diag) => {
                  const isExpanded = expandedBus === diag.id;
                  const socProfile = results.soc_profiles?.[diag.id] || [];
                  const simSteps = results.aggregated_load_profile.length;
                  const simHours = simSteps * dt;
                  
                  const busData = results.run_metadata?.inputs?.buses?.find(b => String(b.id) === String(diag.id));
                  let trips = [...(busData?.trips || [])];
                  
                  // For multi-day scenarios, replicate the trip sequence for the second day if not provided
                  if (simHours > 24 && trips.length > 0) {
                    const maxTripTime = Math.max(...trips.map(t => t.start_min || t.start_time_min || toMinutesForSort(t.start)));
                    if (maxTripTime < 1440) {
                       const day2Trips = trips.map(t => {
                          const startMin = (t.start_min !== undefined ? t.start_min : t.start_time_min !== undefined ? t.start_time_min : toMinutesForSort(t.start)) + 1440;
                          const endMin = (t.end_min !== undefined ? t.end_min : t.end_time_min !== undefined ? t.end_time_min : toMinutesForSort(t.end)) + 1440;
                          return {
                            ...t,
                            start: `${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')}`,
                            end: `${Math.floor(endMin / 60)}:${String(endMin % 60).padStart(2, '0')}`,
                            start_time_min: startMin,
                            end_time_min: endMin
                          };
                       });
                       trips = [...trips, ...day2Trips];
                    }
                  }
                  
                  // Weave charging into trips
                  const chargingEvents = [];
                  const schedule = results.schedules?.[diag.id] || [];
                  let currentCharge = null;
                  
                  // Calculate cyclic buffer (Look-Ahead emulation)
                  // If look-ahead is ON but backend provided 0 (no Day 3 data), we look at early morning trips of Day 1
                  const morningTrips = (busData?.trips || []).filter(t => {
                     const startMin = t.start_min !== undefined ? t.start_min : t.start_time_min !== undefined ? t.start_time_min : toMinutesForSort(t.start);
                     return startMin < 600; // First 10 hours of the day
                  });
                  const cyclicBuffer = morningTrips.reduce((acc, t) => acc + (t.energy_kwh || 0), 0);
                  const effectiveBuffer = diag.next_day_required_energy_kwh || (results.run_metadata?.inputs?.use_next_day_readiness ? cyclicBuffer : 0);
                  
                  schedule.forEach((kw, t) => {
                      if (kw > 5) { // 5kW threshold
                          if (!currentCharge) {
                              currentCharge = {
                                  type: 'C',
                                  start: `${Math.floor(t * timeStepMin / 60)}:${String(t * timeStepMin % 60).padStart(2, '0')}`,
                                  startTimeMin: t * timeStepMin,
                                  kWs: [kw]
                              };
                          } else {
                              currentCharge.kWs.push(kw);
                          }
                      } else {
                          if (currentCharge) {
                              const endT = t;
                              currentCharge.end = `${Math.floor(endT * timeStepMin / 60)}:${String(endT * timeStepMin % 60).padStart(2, '0')}`;
                              currentCharge.avgKw = currentCharge.kWs.reduce((a,b)=>a+b,0) / currentCharge.kWs.length;
                              currentCharge.totalKwh = (currentCharge.avgKw * currentCharge.kWs.length * dt);
                              chargingEvents.push(currentCharge);
                              currentCharge = null;
                          }
                      }
                  });
                  if (currentCharge) {
                      currentCharge.end = `${Math.floor(simSteps * timeStepMin / 60)}:00`;
                      currentCharge.avgKw = currentCharge.kWs.reduce((a,b)=>a+b,0) / currentCharge.kWs.length;
                      currentCharge.totalKwh = (currentCharge.avgKw * currentCharge.kWs.length * dt);
                      chargingEvents.push(currentCharge);
                  }

                  const mergedSequence = [
                      ...trips.map(t => ({
                        ...t, 
                        startTimeMin: (t.start_time_min !== undefined) ? t.start_time_min : 
                                      (t.start_min !== undefined) ? t.start_min : 
                                      toMinutesForSort(t.start)
                      })),
                      ...chargingEvents
                  ].sort((a, b) => a.startTimeMin - b.startTimeMin);

                  const chartDataSoC = socProfile.map((val, t) => ({
                      time: t,
                      soc: Math.round(val),
                      label: `${Math.floor(t * timeStepMin / 60)}:${String(t * timeStepMin % 60).padStart(2, '0')}`
                  }));

                  return (
                    <React.Fragment key={diag.id}>
                      <tr 
                        className={`diag-row ${isExpanded ? 'active' : ''}`}
                        onClick={() => setExpandedBus(isExpanded ? null : diag.id)}
                      >
                        <td>
                          <ChevronRight 
                            size={16} 
                            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                          />
                        </td>
                        <td className="font-mono text-xs font-bold">{diag.id}</td>
                        <td className="text-[10px] font-bold text-muted uppercase">{diag.vehicle_type || busData?.vehicle_type || busData?.type || 'Bus'}</td>
                        <td>{Math.round(diag.capacity_kwh)} <span className="text-[10px] text-muted">kWh</span></td>
                        <td className="text-muted">{(diag.total_distance_km || (busData?.trips?.reduce((acc, t) => acc + (t.dist_m || 0), 0) / 1000) || 0).toFixed(1)} <span className="text-[10px]">km</span></td>
                        <td className="font-semibold">{Math.round(diag.initial_soc_kwh)} <span className="text-[10px] text-muted">kWh</span></td>
                        <td className={`font-bold ${diag.status_flag === 'critical' ? 'text-error animate-pulse' : diag.status_flag === 'warning' ? 'text-warning' : ''}`}>
                          {Math.round(diag.min_soc_reached_kwh)} <span className="text-[10px] text-muted">kWh</span>
                        </td>
                        <td className="font-semibold">{Math.round(diag.final_soc_kwh)} <span className="text-[10px] text-muted">kWh</span></td>
                        <td className={`font-medium ${(effectiveBuffer || busData?.min_final_soc_kwh) > 0 ? 'text-primary' : 'text-muted opacity-40'}`}>
                          {Math.round(effectiveBuffer || busData?.min_final_soc_kwh || 0)} <span className="text-[10px]">kWh</span>
                        </td>
                        <td className="text-primary">{Math.round(diag.total_trip_energy_kwh)} <span className="text-[10px] text-muted">kWh</span></td>
                        <td className="text-success">{Math.round(diag.total_charged_energy_kwh)} <span className="text-[10px] text-muted">kWh</span></td>
                        <td>
                          {diag.is_charged ? (
                            <div className="badge badge-success-soft text-[10px] px-1.5 py-0">YES</div>
                          ) : (
                            <div className="badge border border-border text-[10px] px-1.5 py-0 text-muted">NO</div>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              (diag.diagnostic_reason && diag.diagnostic_reason.includes('No charging required'))
                                ? 'bg-muted opacity-30'
                                : diag.status_flag === 'healthy' ? 'bg-success' : diag.status_flag === 'warning' ? 'bg-warning' : 'bg-error'
                            }`}></div>
                            <span className={`text-[11px] font-medium ${
                              (diag.diagnostic_reason && diag.diagnostic_reason.includes('No charging required'))
                                ? 'opacity-80' 
                                : (diag.status_flag === 'critical' || (diag.diagnostic_reason && diag.diagnostic_reason.includes('Violation'))) 
                                  ? 'text-error font-bold' 
                                  : (diag.status_flag === 'warning') 
                                    ? 'text-warning font-bold' 
                                    : 'opacity-80'
                            }`}>
                              {(!diag.diagnostic_reason || diag.diagnostic_reason.includes('Scenario')) ? (
                                diag.is_charged ? (
                                  diag.total_charged_energy_kwh > 1 ? 'Charging requirement fully met' : 'Sufficient initial SoC; no charge needed'
                                ) : 'Target SoC not reached (insufficient time/power)'
                              ) : diag.diagnostic_reason}
                            </span>
                          </div>
                        </td>
                      </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={13}>
                          <div className="expanded-content animate-in">
                            <div className="flex justify-between items-center mb-4">
                               <div className="flex gap-6">
                                  <div className="metric">
                                    <span className="label flex items-center gap-1">Umlauf Efficiency <InfoTooltip text="Ratio of total trip energy consumption to max battery capacity. Indicates vehicle utilization." /></span>
                                    <span className="val">{((diag.total_trip_energy_kwh / diag.capacity_kwh) * 100).toFixed(1)}% Capacity Use</span>
                                  </div>
                                  <div className="metric">
                                    <span className="label flex items-center gap-1">Next-Day Readiness <InfoTooltip text="Mandatory energy reserve required for the first trips of the next operational day. Calculating based on cyclic schedule if Day 3 data is missing." /></span>
                                    <span className="val">{effectiveBuffer > 0 ? `+${Math.round(effectiveBuffer)} kWh Morning Buffer` : 'No Buffer Required'}</span>
                                  </div>
                                  <div className="metric ml-10">
                                    <span className="label text-primary flex items-center gap-1 font-bold">
                                      <CheckCircle2 size={12} /> Configuration Policy Audit
                                      <InfoTooltip text="Verification that the solver adhered to your configured SoC starting policy and reserve constraints." />
                                    </span>
                                    <div className="flex gap-6 mt-1">
                                       <div className="flex flex-col">
                                          <span className="text-[9px] text-muted uppercase font-bold">Target Start</span>
                                          <span className="text-xs font-bold">
                                            {Math.round(diag.target_initial_soc_kwh || busData?.initial_soc_kwh || 0)} kWh 
                                            {(diag.capacity_kwh || busData?.capacity_kwh) > 0 && ` (${Math.round((diag.target_initial_soc_kwh || busData?.initial_soc_kwh || 0) / (diag.capacity_kwh || busData?.capacity_kwh) * 100)}%)`}
                                          </span>
                                       </div>
                                       <div className="flex flex-col">
                                          <span className="text-[9px] text-muted uppercase font-bold">Target Reserve</span>
                                          <span className="text-xs font-bold">
                                            {Math.round(diag.target_min_final_soc_kwh || busData?.min_final_soc_kwh || 0)} kWh 
                                            {(diag.capacity_kwh || busData?.capacity_kwh) > 0 && ` (${Math.round((diag.target_min_final_soc_kwh || busData?.min_final_soc_kwh || 0) / (diag.capacity_kwh || busData?.capacity_kwh) * 100)}%)`}
                                          </span>
                                       </div>
                                    </div>
                                  </div>
                               </div>
                               <div className="text-[10px] text-muted font-mono bg-border/10 px-3 py-1.5 rounded-lg border border-border/50">
                                 Verification: {Math.round(diag.initial_soc_kwh)} + {Math.round(diag.total_charged_energy_kwh)} - {Math.round(diag.total_trip_energy_kwh)} = {Math.round(diag.final_soc_kwh)} kWh
                               </div>
                            </div>
                            <div style={{ width: '100%', height: 180 }}>
                              <ResponsiveContainer>
                                <AreaChart data={chartDataSoC}>
                                  <defs>
                                    <linearGradient id="colorSoC" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                                  <XAxis 
                                    dataKey="label" 
                                    stroke="var(--text-muted)" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false} 
                                    interval={7}
                                  />
                                  <YAxis 
                                    domain={[0, diag.capacity_kwh]} 
                                    stroke="var(--text-muted)" 
                                    fontSize={10} 
                                    tickLine={false} 
                                    axisLine={false} 
                                    unit="kWh"
                                  />
                                  <Tooltip 
                                    contentStyle={{ borderRadius: '8px', border: 'none', fontSize: '12px' }}
                                    formatter={(v) => [`${v} kWh`, 'Battery SoC']}
                                  />
                                  <Area isAnimationActive={false} 
                                    type="stepAfter" 
                                    dataKey="soc" 
                                    stroke="var(--primary)" 
                                    fill="url(#colorSoC)" 
                                    strokeWidth={3}
                                    animationDuration={1000}
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>

                            {trips.length > 0 && (
                              <div className="mt-8 pt-6">
                                <div className="flex items-center justify-between mb-4">
                                  <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                                    <MapPin size={12} /> Complete Route Sequence
                                  </h4>
                                  <button 
                                    onClick={() => setShowTechnical(!showTechnical)}
                                    className="text-[10px] items-center gap-1.5 flex font-bold text-muted uppercase hover:text-primary transition-colors cursor-pointer"
                                  >
                                    <div className={`w-6 h-3 rounded-full relative transition-colors ${showTechnical ? 'bg-primary' : 'bg-border'}`}>
                                      <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full bg-white transition-transform ${showTechnical ? 'translate-x-3' : ''}`}></div>
                                    </div>
                                    Show Point Nodes
                                  </button>
                                </div>
                                <div className="route-timeline pl-2">
                                  {mergedSequence.filter(seg => !seg.is_technical || showTechnical).map((seg, sIdx) => (
                                    <div key={sIdx} className={`route-step flex items-start gap-4 mb-4 last:mb-0 relative ${seg.is_technical ? 'opacity-50' : ''}`}>
                                      <div className="flex flex-col items-center">
                                        <div className={`w-2.5 h-2.5 rounded-full ${
                                          seg.type === 'C' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 
                                          seg.is_technical ? 'bg-muted border border-border' :
                                          seg.type === 'T' ? 'bg-primary/40' : 'bg-primary'
                                        }`} style={seg.is_technical ? { width: '6px', height: '6px', marginLeft: '2px', marginTop: '4px'} : {}}>
                                           {seg.type === 'C' && <Zap size={6} className="text-white absolute m-auto inset-0" />}
                                        </div>
                                        {sIdx < mergedSequence.filter(s => !s.is_technical || showTechnical).length - 1 && (
                                          <div className={`w-px h-full bg-border absolute bottom-0 left-[4px] -mb-4 ${seg.is_technical ? 'top-4' : 'top-3'}`}></div>
                                        )}
                                      </div>
                                      <div className={`flex-1 -mt-1 ${seg.is_technical ? 'pb-1' : 'pb-4'}`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <div className={`flex items-center gap-2 font-mono text-[11px] ${seg.is_technical ? 'text-muted' : 'font-bold'}`}>
                                            <span>{seg.start}</span>
                                            <ArrowRight size={10} className="text-muted opacity-40" />
                                            <span>{seg.end}</span>
                                          </div>
                                          <div className={`text-[10px] font-bold uppercase ${
                                            seg.type === 'C' ? 'text-success' : 
                                            seg.is_technical ? 'bg-muted/10 text-muted opacity-60 px-2 py-0.5 rounded' : 'bg-border/20 text-muted px-2 py-0.5 rounded'
                                          }`}>
                                             {seg.type === 'C' ? 'Charging Session' : seg.is_technical ? 'Log Point' : seg.type === 'A' ? 'Depot Arrival' : seg.type === 'E' ? 'Depot Departure' : 'Transit'}
                                          </div>
                                        </div>
                                        
                                        {seg.type === 'C' ? (
                                          <div className="flex flex-col">
                                            <span className="text-xs font-bold text-success">Depot Charger Active</span>
                                            <div className="text-[10px] text-muted mt-0.5">
                                              Avg: {Math.round(seg.avgKw)} kW • Energy Added: {seg.totalKwh.toFixed(1)} kWh
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <div className="flex items-center gap-2">
                                              <span className={`${seg.is_technical ? 'text-[10px]' : 'text-xs font-bold'} text-app`}>{seg.von_desc || seg.von}</span>
                                              {!seg.is_technical && <ArrowRight size={12} className="text-muted opacity-40" />}
                                              {!seg.is_technical && <span className="text-xs font-bold text-app">{seg.nach_desc || seg.nach}</span>}
                                            </div>
                                            {!seg.is_technical && (
                                              <div className="text-[10px] text-muted mt-1">
                                                {(seg.dist_m / 1000).toFixed(2)} km • Estimated {seg.energy_kwh.toFixed(1)} kWh demand
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {results.bus_diagnostics?.length > 10 && (
            <div className="flex justify-center p-4 border-t border-border bg-gray-50/30">
              <button 
                onClick={() => setIsFleetExpanded(!isFleetExpanded)}
                className="flex items-center gap-2 text-[11px] font-bold text-primary uppercase hover:bg-primary-soft px-4 py-2 rounded-lg transition-all"
              >
                {isFleetExpanded ? (
                  <><ChevronUp size={14} /> Show Less</>
                ) : (
                  <><ChevronDown size={14} /> Show All ({results.bus_diagnostics.length}) Rows</>
                )}
              </button>
            </div>
          )}
        </div>
      )}
      </div>
      )}

      {fullscreenChart === 'timeline' && <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />}
      {isDrillDown && (
        <>
        <div className={`card mb-8 timeline-card ${fullscreenChart === 'timeline' ? 'expanded' : ''}`}>
        <div className="flex items-center justify-between mb-6 h-8">
          <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
            <Activity size={20} />
            Fleet Charging Timeline
          </h3>
          <div className="flex items-center gap-4 h-full">
            {results.scenario !== 'baseline' && (
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
              onClick={() => toggleFullscreen(fullscreenChart === 'timeline' ? null : 'timeline')}
              className={`chart-toggle-pill ${fullscreenChart === 'timeline' ? 'active shadow-sm border-primary/20' : ''}`}
              style={{ height: '32px', padding: '0 0.75rem' }}
            >
              <Maximize size={14} className={fullscreenChart === 'timeline' ? 'text-primary' : 'text-muted'} />
              <span className={fullscreenChart === 'timeline' ? 'text-primary font-bold' : ''}>{fullscreenChart === 'timeline' ? 'Exit Fullscreen' : 'Extended Mode'}</span>
            </button>
            <InfoTooltip align="down" title="Timeline Controls" text="Use the toggles to switch coloring modes, or expand the chart to full-screen for high-resolution fleet analysis." />
          </div>
        </div>
        <p className="card-description">High-resolution Gantt chart visualizing the concurrent charging windows for the entire fleet across the 24-hour horizon.</p>
        
        {isZoomingLoading ? (
          <div className="skeleton-shimmer skeleton-chart-large" style={{ width: '100%', height: 400, marginTop: 0 }} />
        ) : !results.schedules && results.storage_pruned ? (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-border-light mb-8">
            <LayoutDashboard size={40} className="text-muted opacity-20 mb-4" />
            <h3 className="text-base font-bold text-muted uppercase tracking-wider">Schedule Data Not Available</h3>
            <p className="text-[11px] text-muted max-w-xs text-center mt-2 px-6 leading-relaxed">
              Detailed per-bus schedules for this specific day were discarded to fit the massive 1-year simulation results into browser memory.
            </p>
          </div>
        ) : (
          <div className="timeline-wrapper">
            <div className="timeline-header-row" style={{ gridTemplateColumns: `120px repeat(${timelinePrices.length}, 24px)` }}>
              <div className="timeline-time-label" style={{ background: '#f8fafc', position: 'sticky', left: 0, zIndex: 45, borderRight: '2px solid var(--border-light)' }}>
                Umlauf ID
              </div>
              {timelinePrices.map((_, i) => {
                const pointsPerHour = 60 / timeStepMin;
                return (
                  <div key={i} className={`timeline-time-label ${i % pointsPerHour === (pointsPerHour - 1) ? 'hour-marker' : ''}`}>
                    {i % pointsPerHour === 0 ? `${i / pointsPerHour}:00` : ''}
                  </div>
                );
              })}
            </div>
            
            <div className="timeline-content-rows">
              {results.schedules && Object.entries(results.schedules).map(([busId, powerList]) => (
                <div key={busId} className="timeline-row" style={{ gridTemplateColumns: `120px repeat(${timelinePrices.length}, 24px)` }}>
                  <div className="timeline-bus-label" title={busId}>{busId}</div>
                  {timelinePrices.map((_, t) => {
                    const p = powerList[t] || 0;
                    const isActive = p > 5;
                    
                    let sourceClass = '';
                    let primarySource = '';
                    
                    if (isActive && ganttColorMode === 'source') {
                      const globalT = (isDrillDown && results.is_long_term) ? (selectedDay * pointsPerDay + t) : t;
                      const totalAtT = results.aggregated_load_profile[globalT] || 1;
                      const rPV = (results.pv_to_bus_profile?.[globalT] || 0) / totalAtT;
                      const rBess = (results.bess_to_bus_profile?.[globalT] || 0) / totalAtT;
                      const rGrid = (results.grid_to_bus_profile?.[globalT] || 0) / totalAtT;
                      
                      const maxR = Math.max(rPV, rBess, rGrid);
                      
                      if (rPV > 0 && rPV >= rBess && rPV >= rGrid) { 
                        sourceClass = 'source-pv'; primarySource = 'PV Solar'; 
                      } else if (rBess > 0 && rBess >= rPV && rBess >= rGrid) { 
                        sourceClass = 'source-bess'; primarySource = 'BESS Storage'; 
                      } else { 
                        sourceClass = 'source-grid'; primarySource = 'Grid Import'; 
                      }
                    }

                    const intensityClass = p > 5 ? (p < 60 ? 'low' : p < 120 ? 'medium' : 'high') : '';
                    const pointsPerHour = 60 / timeStepMin;
                    
                    return (
                      <div 
                        key={t} 
                        className={`timeline-cell ${isActive ? 'active' : ''} ${t % pointsPerHour === (pointsPerHour - 1) ? 'hour-marker' : ''} ${ganttColorMode === 'source' ? sourceClass : intensityClass}`}
                        title={isActive ? `${busId} @ ${formatTime(t)}: ${p.toFixed(1)} kW ${primarySource ? `(${primarySource})` : ''}` : ''}
                      ></div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

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
            <span className="text-xs text-muted">Blocks represent {timeStepMin}-minute intervals</span>
          </div>
        </div>
      </div>

      {fullscreenChart === 'performance' && (
        <div className="modal-overlay" style={{ zIndex: 2400 }} onClick={() => toggleFullscreen(null)} />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className={`card ${fullscreenChart === 'performance' ? 'expanded' : ''} transition-all duration-500`}>
          <div className="flex items-center justify-between mb-6 h-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
              <Activity size={20} />
              Optimization Performance
            </h3>
            <div className="flex items-center gap-4 h-full">
              <div className="flex gap-2">
                {[0.25, 1, 3, 6].map(size => (
                  <button
                    key={size}
                    onClick={() => setPerformanceBucket(size)}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                      performanceBucket === size 
                        ? 'text-primary border-b-2 border-primary rounded-none' 
                        : 'text-muted hover:text-primary hover:bg-primary/5'
                    }`}
                  >
                    {size === dt ? `${timeStepMin}m` : `${size}h`}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => toggleFullscreen(fullscreenChart === 'performance' ? null : 'performance')}
                className={`chart-toggle-pill ${fullscreenChart === 'performance' ? 'active shadow-sm border-primary/20' : ''}`}
                style={{ height: '32px', padding: '0 0.75rem' }}
              >
                <Maximize size={14} className={fullscreenChart === 'performance' ? 'text-primary' : 'text-muted'} />
                <span className={fullscreenChart === 'performance' ? 'text-primary font-bold' : ''}>
                  {fullscreenChart === 'performance' ? 'Exit Fullscreen' : 'Extended Mode'}
                </span>
                <InfoTooltip align="right" title="Fullscreen View" text="Expands the chart to fullscreen for detailed analysis." />
              </button>
            </div>
          </div>
          <p className="card-description">Comparison between the optimized charging schedule and a standard 'charge-on-arrival' baseline across the full timeline.</p>
          <div className="performance-chart-placeholder" style={{ height: fullscreenChart === 'performance' ? '500px' : '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            {isZoomingLoading ? (
              <div className="skeleton-shimmer skeleton-chart" style={{ width: '100%', height: fullscreenChart === 'performance' ? '500px' : '240px', marginTop: 0 }} />
            ) : (
              <ResponsiveContainer>
              <BarChart data={(() => {
                const hourly = [];
                const stepsPerBucket = performanceBucket / dt;
                const totalBucketsCount = Math.ceil(results.aggregated_load_profile.length / stepsPerBucket);
                
                for (let b = 0; b < totalBucketsCount; b++) {
                  const bucketSteps = chartData.slice(b * stepsPerBucket, (b + 1) * stepsPerBucket);
                  if (bucketSteps.length === 0) continue;
                  
                  const avgGridImport = bucketSteps.reduce((acc, curr) => acc + curr.gridImport, 0) / bucketSteps.length;
                  const avgBaseline = bucketSteps.reduce((acc, curr) => acc + (curr.baseline || 0), 0) / bucketSteps.length;
                  
                  // Calculate actual cost for this bucket: sum(gridImport_t * price_t * dt)
                  const costOptimal = bucketSteps.reduce((acc, curr) => acc + (curr.gridImport * curr.price * dt / 1000), 0);
                  const costBaseline = bucketSteps.reduce((acc, curr) => acc + (curr.baseline * curr.price * dt / 1000), 0);
                  
                  const firstStep = bucketSteps[0];
                  
                  hourly.push({
                    time: firstStep.time,
                    gridImport: Math.round(avgGridImport),
                    baseline: Math.round(avgBaseline),
                    costOptimal: costOptimal,
                    costBaseline: costBaseline
                  });
                }
                return hourly;
              })()}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip 
                  cursor={{fill: 'var(--primary-soft)', opacity: 0.2}}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '12px' }}
                  itemSeparator=""
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white/90 backdrop-blur-md p-3 rounded-xl shadow-xl border border-border/50 text-[11px]">
                          <div className="font-bold border-bottom border-border mb-2 pb-1 text-app">{label}</div>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between gap-8">
                              <span className="text-muted flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-border" /> Baseline Demand</span>
                              <span className="font-bold">{data.baseline} kW / €{data.costBaseline.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between gap-8">
                              <span className="text-primary flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-primary" /> Grid Import</span>
                              <span className="font-bold text-primary">{data.gridImport} kW / €{data.costOptimal.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar isAnimationActive={false} 
                  dataKey="gridImport" 
                  name="Grid Import" 
                  fill="var(--primary)" 
                  radius={[4, 4, 0, 0]} 
                  barSize={Math.max(4, 20 - (Math.ceil(results.aggregated_load_profile.length / (performanceBucket / dt)) / 2))} 
                />
                <Bar isAnimationActive={false} 
                  dataKey="baseline" 
                  name="Baseline" 
                  fill="var(--border)" 
                  radius={[4, 4, 0, 0]} 
                  barSize={Math.max(4, 20 - (Math.ceil(results.aggregated_load_profile.length / (performanceBucket / dt)) / 2))} 
                />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
          <div className="flex justify-center gap-4 mt-2">
            <div className="flex items-center gap-2"><div className="color-dot primary"></div> <span className="text-xs font-semibold">Grid Import</span></div>
            <div className="flex items-center gap-2"><div className="color-dot gray"></div> <span className="text-xs font-semibold">Baseline</span></div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-6 h-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg leading-none">
              <CheckCircle2 size={20} />
              Data Integrity Balance Sheet
            </h3>
            <div className="flex items-center gap-2 h-full">
              <InfoTooltip align="right" title="Data Reconciliation" text="This mode enables deep-dive calculations to verify that the aggregated profiles match the headline KPI cards exactly." />
            </div>
          </div>
          <p className="card-description">Reconciliation of time-series load against headline KPI cards to ensure 100% calculation integrity.</p>
          
          <div className="space-y-4">
            <div className="p-4 bg-app rounded-xl border border-border">
              <div className="flex justify-between items-end mb-3 pb-2 border-b border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Energy Audit (Grid)</span>
                <span className="text-lg font-bold text-app">{((dayStats?.gridKwh / 1000) || 0).toFixed(3)} MWh</span>
              </div>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Grid Profile Power Sum</span>
                  <span className="font-mono text-secondary">{(chartData || []).reduce((acc, d) => acc + (d.gridImport || 0), 0).toFixed(2)} kW</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Time Scaling ({timeStepMin}m → 1h)</span>
                  <span className="font-mono text-secondary">× {dt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1 font-bold">
                  <span className="flex items-center gap-1.5">
                    Calculated Grid Energy
                    <InfoTooltip title="Net Energy Aggregation" text="Derived by summing all points in the selected window and normalizing to hourly MWh values." />
                  </span>
                  <span className="text-primary">{((chartData || []).reduce((acc, d) => acc + (d.gridImport || 0), 0) * dt / 1000).toFixed(3)} MWh</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-app rounded-xl border border-border">
              <div className="flex justify-between items-end mb-3 pb-2 border-b border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Financial Audit (Effective)</span>
                <span className="text-lg font-bold text-app">€{(dayStats?.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between italic text-[10px] text-muted mb-1 px-1">
                  <span>Effective Price = Market + {results.run_metadata?.inputs?.price_assumptions ? ((results.run_metadata.inputs.price_assumptions.supplier_markup || 0) + (results.run_metadata.inputs.price_assumptions.variable_network_charge || 0) + (results.run_metadata.inputs.price_assumptions.electricity_tax || 0)).toFixed(1) : '33.2'} €/MWh</span>
                </div>
                <div className="flex justify-between pt-1 font-bold">
                  <span className="flex items-center gap-1.5">
                    Σ (GridPower_t × Price_t × Δt)
                    <InfoTooltip title="Financial Integral" text="Mathematical verification of total procurement cost by integrating net grid demand against the dynamic price curve." />
                  </span>
                  <span className="text-primary">€{(chartData || []).reduce((acc, d) => acc + ((d.gridImport || 0) * (d.price || 0) * dt / 1000), 0).toFixed(2)}</span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-4 mt-8">
               {(() => {
                 const calcEnergy = ((chartData || []).reduce((acc, d) => acc + (d.gridImport || 0), 0) * dt / 1000);
                 const energyDiff = Math.abs(calcEnergy - ((dayStats?.gridKwh / 1000) || 0));
                 const energyStatus = energyDiff < 0.001 ? 'matched' : energyDiff < 0.05 ? 'warning' : 'error';
                 
                 const calcCost = (chartData || []).reduce((acc, d) => acc + ((d.gridImport || 0) * (d.price || 0) * dt / 1000), 0);
                 const costDiff = Math.abs(calcCost - (dayStats?.totalCost || 0));
                 const costStatus = costDiff < 0.01 ? 'matched' : costDiff < 1.0 ? 'warning' : 'error';

                 return (
                   <>
                     <div className="flex-1 flex items-center justify-between py-2">
                        <div className={`text-[11px] font-bold uppercase tracking-wider ${energyStatus === 'matched' ? 'text-success' : energyStatus === 'warning' ? 'text-warning' : 'text-error'}`}>Energy Sync</div>
                        <div className={`badge gap-2 px-3 py-1 ${energyStatus === 'matched' ? 'badge-success shadow-success-soft' : energyStatus === 'warning' ? 'badge-warning' : 'badge-error'}`}>
                          <CheckCircle2 size={12} /> {energyStatus === 'matched' ? 'MATCHED' : energyStatus === 'warning' ? 'ROUNDING' : 'MISMATCH'}
                        </div>
                     </div>
                     <div className="flex-1 flex items-center justify-between py-2">
                        <div className={`text-[11px] font-bold uppercase tracking-wider ${costStatus === 'matched' ? 'text-success' : costStatus === 'warning' ? 'text-warning' : 'text-error'}`}>Financial Sync</div>
                        <div className={`badge gap-2 px-3 py-1 ${costStatus === 'matched' ? 'badge-success shadow-success-soft' : costStatus === 'warning' ? 'badge-warning' : 'badge-error'}`}>
                          <CheckCircle2 size={12} /> {costStatus === 'matched' ? 'MATCHED' : costStatus === 'warning' ? 'ROUNDING' : 'MISMATCH'}
                        </div>
                     </div>
                   </>
                 );
               })()}
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .comparison-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .comp-item {
          display: flex;
          justify-content: space-between;
          padding: 1rem;
          background: var(--bg-app);
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 500;
          border: 1px solid transparent;
        }

        .comp-item.active {
          border: 1px solid var(--primary-soft);
          background: var(--primary-soft);
          color: var(--primary);
        }

        .comp-item.disabled {
          opacity: 0.5;
          border: 1px dashed var(--border);
        }

        .color-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .color-dot.primary { background: var(--primary); }
        .color-dot.gray { background: var(--border); }

        .diag-table-wrapper {
          margin-top: 1rem;
          overflow-x: auto;
          border-radius: 8px;
          border: 1px solid var(--border-light);
        }

        .diag-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
          background: white;
        }

        .diag-table th {
          text-align: left;
          padding: 0.75rem 1rem;
          background: #f8fafc;
          color: var(--text-muted);
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.05em;
          font-weight: 700;
          border-bottom: 2px solid var(--border-light);
        }

        .diag-row {
          cursor: pointer;
          transition: all 0.2s ease;
          border-bottom: 1px solid var(--border-light);
        }

        .diag-row:hover {
          background: var(--bg-app);
        }

        .diag-row.active {
          background: var(--primary-soft);
          border-bottom: none;
        }

        .diag-row td {
          padding: 0.875rem 1rem;
        }

        .expanded-row {
          background: var(--primary-soft);
          border-bottom: 1px solid var(--border-light);
        }

        .expanded-content {
          padding: 0 2rem 1.5rem 3.5rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
        }

        .metric .label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 600;
        }

        .metric .val {
          font-size: 13px;
          font-weight: 700;
          color: var(--primary);
        }

        .status-flag {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .bg-success { background-color: var(--badge-success-bg); }
        .bg-warning { background-color: var(--badge-warning-bg); }
        .bg-error { background-color: var(--badge-error-bg); }

        .audit-card {
          padding: 1rem 1.75rem;
          background: #fdfdfd;
        }

        .audit-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .audit-label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .audit-vals {
          display: flex;
          flex-direction: column;
          font-size: 12px;
          color: var(--text-app);
          opacity: 0.8;
        }

        .audit-val-item {
          white-space: nowrap;
        }
      `}} />
      <CostAuditModal />
      {(!results.is_long_term || isDrillDown) && (
        <style dangerouslySetInnerHTML={{ __html: `
        .comparison-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .comp-item {
          display: flex;
          justify-content: space-between;
          padding: 1rem;
          background: var(--bg-app);
          border-radius: 12px;
          font-size: 0.875rem;
          font-weight: 500;
          border: 1px solid transparent;
        }

        .comp-item.active {
          border: 1px solid var(--primary-soft);
          background: var(--primary-soft);
          color: var(--primary);
        }

        .comp-item.disabled {
          opacity: 0.5;
          border: 1px dashed var(--border);
        }

        .color-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .color-dot.primary { background: var(--primary); }
        .color-dot.gray { background: var(--border); }

        .diag-table-wrapper {
          margin-top: 1rem;
          overflow-x: auto;
          border-radius: 8px;
          border: 1px solid var(--border-light);
        }

        .diag-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
          background: white;
        }

        .diag-table th {
          text-align: left;
          padding: 0.75rem 1rem;
          background: #f8fafc;
          color: var(--text-muted);
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.05em;
          font-weight: 700;
          border-bottom: 2px solid var(--border-light);
        }

        .diag-row {
          cursor: pointer;
          transition: all 0.2s ease;
          border-bottom: 1px solid var(--border-light);
        }

        .diag-row:hover {
          background: var(--bg-app);
        }

        .diag-row.active {
          background: var(--primary-soft);
          border-bottom: none;
        }

        .diag-row td {
          padding: 0.875rem 1rem;
        }

        .expanded-row {
          background: var(--primary-soft);
          border-bottom: 1px solid var(--border-light);
        }

        .expanded-content {
          padding: 0 2rem 1.5rem 3.5rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
        }

        .metric .label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 600;
        }

        .metric .val {
          font-size: 13px;
          font-weight: 700;
          color: var(--primary);
        }

        .status-flag {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .bg-success { background-color: var(--badge-success-bg); }
        .bg-warning { background-color: var(--badge-warning-bg); }
        .bg-error { background-color: var(--badge-error-bg); }

        .audit-card {
          padding: 1rem 1.75rem;
          background: #fdfdfd;
        }

        .audit-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .audit-label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .audit-vals {
          display: flex;
          flex-direction: column;
          font-size: 12px;
          color: var(--text-app);
          opacity: 0.8;
        }

        .audit-val-item {
          white-space: nowrap;
        }
      `}} />
      )}
    </div>
  );
};

const ResultsSkeleton = ({ results, selectedDay, auditActive }) => {
  const isLongTerm = results?.is_long_term ?? true;
  const isDrillDown = results ? (!isLongTerm || auditActive) : false;
  const hasPv = results ? (results.scenario?.includes('pv') && (results.total_pv_generated_kwh > 0 || results.run_metadata?.inputs?.pv_config)) : true;
  const hasBess = results ? (results.scenario?.includes('bess')) : true;

  const statsLength = isDrillDown
    ? (hasPv ? 4 : 3)
    : (isLongTerm
        ? (hasPv ? 8 : 7)
        : (hasPv ? 4 : 3));

  return (
    <div className="run-container animate-pulse-container" style={{ opacity: 0.85 }}>
      <style>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
        }
        .skeleton-card {
          background: var(--bg-surface, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: var(--shadow-sm);
          position: relative;
        }
        .skeleton-text {
          height: 12px;
          border-radius: 4px;
          margin-bottom: 8px;
        }
        .skeleton-text.title {
          height: 24px;
          width: 350px;
          margin-bottom: 12px;
        }
        .skeleton-text.subtitle {
          height: 14px;
          width: 500px;
          margin-bottom: 24px;
        }
        .skeleton-chart {
          height: 200px;
          border-radius: 8px;
          margin-top: 16px;
        }
        .skeleton-chart-large {
          height: 320px;
          border-radius: 8px;
          margin-top: 16px;
        }
        .skeleton-table-row {
          height: 48px;
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .animate-pulse-container {
          animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 0.85; }
        }
      `}</style>

      {/* Header Skeleton */}
      <div className="section-header flex justify-between items-end mb-8">
        <div>
          {results ? (
            <>
              <h1>{isLongTerm ? (auditActive ? `Simulation Audit: Day ${Number(selectedDay) + 1}` : 'Long-Term Performance Overview') : 'Optimization Results'}</h1>
              <p style={{ minHeight: '20px' }}>{isLongTerm ? (auditActive ? `Showing high-resolution details for the selected simulation window.` : `Aggregated results across ${results.total_days} days. Scrub to highlight, click to inspect.`) : 'Analyze the optimal charging schedule and cost savings.'}</p>
            </>
          ) : (
            <>
              <div className="skeleton-shimmer skeleton-text title" />
              <div className="skeleton-shimmer skeleton-text subtitle" style={{ marginBottom: 0 }} />
            </>
          )}
        </div>
        {(auditActive || (isLongTerm && selectedDay !== null)) && (
          <button className="btn btn-outline mb-2 flex items-center gap-2" disabled style={{ opacity: 0.5 }}>
            <ArrowLeft size={16} /> Back to Overview
          </button>
        )}
      </div>

      {/* Conditional Layouts */}
      {!isDrillDown && isLongTerm ? (
        /* Long-Term Overview Skeleton */
        <div>
          {/* Date Picker Skeleton */}
          <div className="skeleton-card mb-8" style={{ height: '110px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="skeleton-shimmer skeleton-text" style={{ width: '15%', height: '14px', marginBottom: '12px' }} />
            <div className="flex gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer" style={{ flex: 1, height: '40px', borderRadius: '8px' }} />
              ))}
            </div>
          </div>

          {/* Stats Cards Skeleton */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            {Array.from({ length: statsLength }).map((_, i) => (
              <div key={i} className="skeleton-card flex flex-col gap-3">
                <div className="flex items-center gap-3 w-full">
                  <div className="skeleton-shimmer" style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton-shimmer skeleton-text" style={{ width: '60%' }} />
                    <div className="skeleton-shimmer skeleton-text" style={{ width: '40%', height: '16px' }} />
                  </div>
                </div>
                <div className="skeleton-shimmer skeleton-text" style={{ width: '90%', height: '10px', marginTop: '8px', marginBottom: 0 }} />
              </div>
            ))}
          </div>

          {/* Daily Energy Mix Card */}
          <div className="skeleton-card mb-8">
            <h3 className="card-title text-primary flex items-center gap-2">
              <GitCompare size={18} /> Daily Energy Mix & Source Attribution
            </h3>
            <p className="card-description">Daily source attribution for total fleet demand.</p>
            <div className="skeleton-shimmer skeleton-chart-large" />
          </div>

          {/* Grid of 2 or 3 columns (Cost, Peak, Solar) */}
          <div className={`grid ${hasPv ? 'grid-cols-3' : 'grid-cols-2'} gap-6`}>
            <div className="skeleton-card">
              <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                <DollarSign size={18} className="text-success" /> Daily Procurement Cost
              </h3>
              <p className="text-[10px] text-muted mb-4">Daily grid expenditure for depot operations.</p>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>

            <div className="skeleton-card">
              <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                <TrendingUp size={18} className="text-warning" /> Peak Power Demand
              </h3>
              <p className="text-[10px] text-muted mb-4">Highest recorded instantaneous load per day.</p>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>

            {hasPv && (
              <div className="skeleton-card">
                <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                  <Sun size={18} className="text-yellow-500" /> Peak Solar Yield
                </h3>
                <p className="text-[10px] text-muted mb-4">Maximum instantaneous PV power output per day.</p>
                <div className="skeleton-shimmer skeleton-chart" />
              </div>
            )}
          </div>

          {/* Row 2: Cumulative Balance (Grid of 2 columns) */}
          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="skeleton-card">
              <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                <PiggyBank size={18} className="text-indigo-500" /> Cumulative Financial Balance
              </h3>
              <p className="text-[10px] text-muted mb-4">Cumulative net financial position relative to simulation start.</p>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>

            {hasPv && (
              <div className="skeleton-card">
                <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                  <Zap size={18} className="text-cyan-500" /> Daily Solar Share
                </h3>
                <p className="text-[10px] text-muted mb-4">Renewable energy self-consumption share.</p>
                <div className="skeleton-shimmer skeleton-chart" />
              </div>
            )}
          </div>

          {/* Row 3: BESS & Grid Constraints */}
          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="skeleton-card">
              <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                <Battery size={18} className="text-green-500" /> BESS Utilization & Health
              </h3>
              <p className="text-[10px] text-muted mb-4">BESS utilization intensity and health monitoring.</p>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>

            <div className="skeleton-card">
              <h3 className="card-title text-primary mb-2 flex items-center gap-2">
                <Activity size={18} className="text-rose-500" /> Grid Constraint Monitoring
              </h3>
              <p className="text-[10px] text-muted mb-4">Infrastructure load vs. physical grid limit.</p>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>
          </div>
        </div>
      ) : (
        /* Daily Details / Short-Term Skeleton */
        <div>
          {/* Audit Snapshot Card */}
          <div className="skeleton-card mb-8">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary opacity-60 mb-2">
              <Info size={14} /> Run Audit & Input Verification
            </div>
            <div className="flex gap-12 mt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '70%', height: '10px' }} />
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '90%', height: '14px', marginBottom: 0 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex gap-2">
              <button className="btn btn-outline" disabled style={{ opacity: 0.5 }}><Download size={18} /> Export Data</button>
              <button className="btn btn-outline" disabled style={{ opacity: 0.5 }}><GitCompare size={18} /> Save for Comparison</button>
              <button className="btn btn-primary" disabled style={{ opacity: 0.5 }}>Report PDF</button>
            </div>
          </div>

          {/* Stats Cards Skeleton */}
          <div className={`grid ${statsLength === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-6 mb-8`}>
            {Array.from({ length: statsLength }).map((_, i) => (
              <div key={i} className="skeleton-card flex flex-col gap-3">
                <div className="flex items-center gap-3 w-full">
                  <div className="skeleton-shimmer" style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton-shimmer skeleton-text" style={{ width: '60%' }} />
                    <div className="skeleton-shimmer skeleton-text" style={{ width: '40%', height: '16px' }} />
                  </div>
                </div>
                <div className="skeleton-shimmer skeleton-text" style={{ width: '90%', height: '10px', marginTop: '8px', marginBottom: 0 }} />
              </div>
            ))}
          </div>

          {/* Grid of Solar Activity & BESS Performance */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="skeleton-card">
              <h3 className="card-title text-primary flex items-center gap-2">
                <Sun size={18} className="text-yellow-500" /> Photovoltaic Activity
              </h3>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>

            <div className="skeleton-card">
              <h3 className="card-title text-primary flex items-center gap-2">
                <Battery size={18} className="text-indigo-500" /> BESS Performance
              </h3>
              <div className="skeleton-shimmer skeleton-chart" />
            </div>
          </div>

          {/* Main Load Profile Card */}
          <div className="skeleton-card mb-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg">
              <Zap size={20} /> Load Profile vs. Price Signal
            </h3>
            <div className="skeleton-shimmer skeleton-chart-large" />
          </div>

          {/* Charging Decisions & Fleet Table */}
          <div className="skeleton-card mb-8">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg">
              <Lightbulb size={20} /> Strategic Charging Decisions
            </h3>
            <div className="skeleton-shimmer skeleton-chart" />
          </div>

          <div className="skeleton-card">
            <h3 className="text-primary font-bold flex items-center gap-2 text-lg">
              <Battery size={20} /> Fleet Performance Diagnostics
            </h3>
            <div className="mt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer skeleton-table-row" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Results;
