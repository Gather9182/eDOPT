/**
 * Utility to map Excel processing results to Optimization engine inputs.
 */

export const mapExcelToBuses = ({
  availabilityMatrix, 
  defaultEnergyDemand = 180, 
  energyOverrides = {}, 
  batteryOverrides = {},
  defaultMaxPower = 150, 
  defaultMaxBattery = 350,
  defaultEfficiency = 0.92, 
  chargingWindows = []
}) => {
  if (!availabilityMatrix || !availabilityMatrix.index) return [];

  const { index, data } = availabilityMatrix;
  
  // Group windows by Umlauf for easier lookup
  const windowsByUmlauf = {};
  if (chargingWindows) {
    chargingWindows.forEach(win => {
      if (!windowsByUmlauf[win.Umlauf]) windowsByUmlauf[win.Umlauf] = [];
      windowsByUmlauf[win.Umlauf].push(`${win.window_start_hhmm}-${win.window_end_hhmm}`);
    });
  }
  
  return index.map((umlaufId, i) => ({
    id: umlaufId,
    energy_demand_kwh: Number(energyOverrides[umlaufId] || defaultEnergyDemand),
    max_power_kw: Number(defaultMaxPower),
    max_battery_capacity_kwh: Number(batteryOverrides[umlaufId] || defaultMaxBattery),
    efficiency: Number(defaultEfficiency),
    availability: data[i],
    charging_windows: windowsByUmlauf[umlaufId] || []
  }));
};

/**
 * Generate a default price profile (96 periods for 24h at 15min steps)
 */
export const generateDefaultPrices = (length = 96) => {
  return Array.from({ length }, (_, i) => 40 + Math.sin(i / 10) * 20);
};

export default {
  mapExcelToBuses,
  generateDefaultPrices,
};
