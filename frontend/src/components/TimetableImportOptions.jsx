import React from 'react';

export default function TimetableImportOptions({ scan, options, onChange, onSheetChange, disabled, vehicleTypes, initialSoc, setInitialSoc, minFinalSoc, setMinFinalSoc }) {
  if (!scan) return null;
  const update = patch => onChange({ ...options, ...patch });
  const firstPart = type => type.split('/', 1)[0].trim();
  const choices = options.useFirstVehicleType ? [...new Set(vehicleTypes.flatMap(type => [type, firstPart(type)]).filter(Boolean))] : vehicleTypes;
  return <div className="card p-5 mb-4">
    <h3 className="font-bold mb-3">Importeinstellungen</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
      <label>Tabellenblatt<select aria-label="Tabellenblatt" className="form-input w-full" disabled={disabled} value={options.sheet} onChange={e => onSheetChange(e.target.value)}>{scan.sheet_names.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Entfernungsregel<select aria-label="Entfernungsregel" className="form-input w-full" value={options.distanceUnit} onChange={e => update({ distanceUnit: e.target.value })}>
        <option value="legacy">Bisherige Erkennung</option><option value="m">Alle Werte in Metern</option><option value="km">Alle Werte in Kilometern</option><option value="mixed">Gemischter Export mit Größengrenze</option>
      </select></label>
      {options.distanceUnit === 'mixed' && <label>Ganzzahlige Werte unter dieser Grenze sind km<input aria-label="Kilometergrenze" className="form-input w-full" type="number" min="0.001" step="1" value={options.mixedThreshold} onChange={e => update({ mixedThreshold: Number(e.target.value) })} /></label>}
    </div>
    <div className="flex gap-4 mt-3">
      <label>Initial SoC (%)<input aria-label="Initial SoC (%)" className="form-input" type="number" min="0" max="100" value={initialSoc} onChange={e => setInitialSoc(Number(e.target.value))} /></label>
      <label>Reserve (%)<input aria-label="Reserve (%)" className="form-input" type="number" min="0" max="100" value={minFinalSoc} onChange={e => setMinFinalSoc(Number(e.target.value))} /></label>
    </div>
    <p className="text-sm text-muted mt-2">Bisherige Erkennung: 21 → 21 m, 21,5 → 21.500 m. Gemischter Export: Dezimalwerte sind km; ganze Zahlen unter der Grenze sind km, ab der Grenze Meter. Bei Grenze 50: 21 → 21.000 m, 94 → 94 m, 86,16 → 86.160 m. Wähle die Regel passend zur Exportkonvention.</p>
    <div className="mt-3"><label className="flex items-center gap-2"><input type="checkbox" checked={options.days.length === 0} onChange={e => update({ days: e.target.checked ? [] : [...scan.operating_days] })} /> Alle Zeilen des ausgewählten Blatts (bereits nach Betriebstag vorbereitet)</label>
      <div className="flex gap-4 mt-2">{scan.operating_days.map(day => <label key={day} className="flex items-center gap-2"><input type="checkbox" checked={options.days.includes(day)} onChange={e => update({ days: e.target.checked ? [...options.days, day] : options.days.filter(d => d !== day) })} />{day}</label>)}</div>
    </div>
    <label className="flex items-center gap-2 mt-3"><input type="checkbox" checked={Boolean(options.useFirstVehicleType)} onChange={e => update({ useFirstVehicleType: e.target.checked })} /> Bei Fahrzeugtyp-Angaben mit Schrägstrich nur den ersten Teil verwenden</label>
    <p className="text-sm text-muted mt-1">Beispiel: NGB/RB12 wird zu NGB. Verbrauch und Batterie werden anhand dieses Typs bestimmt. Eine manuelle Auswahl je Umlauf hat Vorrang.</p>
    <details className="mt-3"><summary>Fahrzeugtyp je Umlauf festlegen</summary><p className="text-sm text-muted mb-2">Eine explizite Auswahl gilt für alle Fahrten des Umlaufs. Verbrauch und Batterie werden unter Constraints eingestellt.</p>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>{scan.umlaeufe.map(bus => <label key={bus.id} className="flex gap-3 items-center mb-2"><span style={{ minWidth: 110 }}>{bus.id}</span><select aria-label={`Fahrzeugtyp ${bus.id}`} className="form-input" value={options.vehicleOverrides[bus.id] || ''} onChange={e => update({ vehicleOverrides: { ...options.vehicleOverrides, [bus.id]: e.target.value } })}><option value="">Aus Datei: {(options.useFirstVehicleType ? [...new Set(bus.vehicle_types.map(firstPart))] : bus.vehicle_types).join(', ')}</option>{choices.map(type => <option key={type}>{type}</option>)}</select></label>)}</div>
    </details>
  </div>;
}
