export function chargingCurveInputs(settings = {}) {
  const saved = settings.charging_curve || {};
  const curve = {enabled:saved.enabled ?? false, power_basis:'site_charger_power',
    bands:(saved.bands || [{end_soc_fraction:.6,power_fraction:.9},{end_soc_fraction:.8,power_fraction:.65},
      {end_soc_fraction:.9,power_fraction:.35},{end_soc_fraction:1,power_fraction:.15}]).map(band => ({...band}))};
  // Turning the feature off must also work after an incomplete edit. Preserve
  // valid disabled settings, but send valid defaults for an invalid draft.
  if (!curve.enabled && curveMessages(curve).length) return chargingCurveInputs();
  return curve;
}

function curveMessages(curve) {
  const messages = [];
  const bands = curve.bands;
  if (!bands.length || bands.length > 8 || bands.at(-1)?.end_soc_fraction !== 1
      || bands.some((band,i) => !Number.isFinite(band.end_soc_fraction) || band.end_soc_fraction <= (bands[i-1]?.end_soc_fraction || 0) || band.end_soc_fraction > 1)) {
    messages.push('Charging curve needs 1–8 increasing SoC bands covering 0–100%.');
  }
  if (bands.some(band => !Number.isFinite(band.power_fraction) || band.power_fraction <= 0 || band.power_fraction > 1)) {
    messages.push('Each charging curve power percentage must be greater than 0% and at most 100%.');
  }
  return messages;
}

export function chargingCurveIssues(settings) {
  const curve = chargingCurveInputs(settings);
  if (!curve.enabled) return [];
  return curveMessages(curve).map(message => ({type:'ERROR',code:'CHARGING_CURVE_CONFIGURATION',category:'vehicle',message}));
}
