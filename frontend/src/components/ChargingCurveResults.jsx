import React from 'react';
import ResultInfoCard from './ResultInfoCard';

export default function ChargingCurveResults({curve}) {
  if (!curve?.enabled) return null;
  const legacy = curve.power_basis !== 'site_charger_power' && Number.isFinite(curve.nominal_power_kw);
  return <ResultInfoCard title="SoC-dependent charging power" status="Enabled"
    summary={`${legacy ? `${curve.nominal_power_kw} kW reference (historical run)` : 'Percentage of charger power at each location'} · ${curve.bands.length} SoC bands`}>
    <p className="result-info-note">{legacy ? 'This historical run used a fixed reference power. Run optimization again to use percentages of each location’s charger power.' : 'Percentages apply to the connected location’s charger power; without locations, the bus maximum charging power is used. Lower bus and location limits still apply.'} Power is before bus charging losses. Charts show interval averages.</p>
    <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>SoC range</th><th className="numeric">Charger power (%)</th>{legacy && <th className="numeric">Historical curve power (kW)</th>}</tr></thead><tbody>
      {curve.bands.map((band,i) => <tr key={i}><td>{Number(((curve.bands[i-1]?.end_soc_fraction || 0)*100).toFixed(4))}–{Number((band.end_soc_fraction*100).toFixed(4))}%</td><td className="numeric">{Number((band.power_fraction*100).toFixed(4))}%</td>{legacy && <td className="numeric">{(curve.nominal_power_kw*band.power_fraction).toFixed(1)}</td>}</tr>)}
    </tbody></table></div>
  </ResultInfoCard>;
}
