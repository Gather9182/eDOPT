import React from 'react';

export default function ChargingCurveSettings({curve, onChange}) {
  const updateBand = (index, patch) => onChange({...curve,bands:curve.bands.map((band,i) => i === index ? {...band,...patch} : band)});
  const removeBand = index => {
    const bands = curve.bands.filter((_,i) => i !== index).map(band => ({...band}));
    bands[bands.length-1].end_soc_fraction = 1;
    onChange({...curve,bands});
  };
  const addBand = () => {
    const bands = curve.bands.map(band => ({...band}));
    const last = bands.at(-1);
    bands.splice(bands.length-1,0,{...last,end_soc_fraction:((bands.at(-2)?.end_soc_fraction || 0)+1)/2});
    onChange({...curve,bands});
  };
  return <div className="card shadow-sm">
    <h3 className="card-title text-primary">SoC-dependent charging power</h3>
    <label className="flex items-center gap-2"><input type="checkbox" checked={curve.enabled} onChange={e => onChange({...curve,enabled:e.target.checked})} /> Enable charging curve</label>
    <p className="text-sm text-muted mt-2">{curve.enabled ? 'Percentages apply to the charging point power configured at each location. Bus and location limits still apply. Settings are saved automatically.' : 'Disabled: constant charging power limits apply. Enable to configure SoC bands and power percentages.'}</p>
    {curve.enabled && <fieldset style={{border:0,padding:0,margin:'16px 0 0',minWidth:0}}>
      <div className="result-info-table-scroll"><table className="data-table result-info-table"><thead><tr><th>SoC from (%)</th><th>SoC to (%)</th><th>Charger power (%)</th><th><span className="text-muted">Edit</span></th></tr></thead><tbody>
        {curve.bands.map((band,i) => <tr key={i}><td>{Number(((curve.bands[i-1]?.end_soc_fraction || 0)*100).toFixed(4))}</td>
          <td><input aria-label={`Band ${i+1} end SoC (%)`} className="form-input" style={{minWidth:75}} type="number" min="0.1" max="100" step="1" disabled={i === curve.bands.length-1} value={Number((band.end_soc_fraction*100).toFixed(4))} onChange={e => updateBand(i,{end_soc_fraction:Number(e.target.value)/100})} /></td>
          <td><input aria-label={`Band ${i+1} charging power (%)`} className="form-input" style={{minWidth:75}} type="number" min="0.1" max="100" step="1" value={Number((band.power_fraction*100).toFixed(4))} onChange={e => updateBand(i,{power_fraction:Number(e.target.value)/100})} /></td>
          <td><button className="btn btn-outline btn-sm" type="button" disabled={curve.bands.length <= 1} onClick={() => removeBand(i)} aria-label={`Remove charging curve band ${i+1}`}>Remove</button></td></tr>)}
      </tbody></table></div>
      <button className="btn btn-outline btn-sm mt-3" type="button" disabled={curve.bands.length >= 8} onClick={addBand}>Add SoC band</button>
      <p className="text-sm text-muted mt-3">Example: 90% gives 135 kW at a 150 kW charger and 45 kW at a 50 kW charger, before bus charging losses. Lower bus and location limits are applied afterwards. Without configured locations, the bus maximum charging power is the reference. Bands cover 0–100% without gaps. Band crossings are integrated within each time step; charts show interval averages.</p>
    </fieldset>}
  </div>;
}
