import {chargingInputs,locationProfilesForHorizon} from './charging.js';
import {socPolicyInputs} from './socPolicy.js';

export const repeatProfile = (values,length) => Array.from({length},(_,i) => values?.length ? values[i%values.length] : 0);

export function effectivePrices(market,assumptions) {
  const config = assumptions || {supplier_markup:10,variable_network_charge:15,other_variable_levies:0,electricity_tax:8.2,use_vat:false,pricing_mode:'effective'};
  if (!market.every(Number.isFinite)) throw new Error('Price series contains missing or invalid values.');
  if (config.pricing_mode !== 'effective') return [...market];
  const fees = ['supplier_markup','variable_network_charge','other_variable_levies','electricity_tax'].reduce((sum,key) => sum+Number(config[key] ?? 0),0);
  const factor = config.use_vat ? 1+Number(config.vat_rate ?? .2) : 1;
  if (!Number.isFinite(fees) || !Number.isFinite(factor) || factor < 0) throw new Error('Invalid price assumptions.');
  return market.map(price => (price+fees)*factor);
}

export function buildSolverInputs(project,settings,{buses=project.buses || [],scenario='baseline',hours=settings.planning_horizon,
  marketPrices=project.pricing || [],prices=effectivePrices(marketPrices,project.meta?.price_assumptions),
  horizonStart=0,cyclicConnections=true,daily=false,initialEnergies={},initialConnections,pvConfig=null,bessConfig=null}={}) {
  const periods=hours*60/settings.time_resolution;
  if (!Number.isInteger(periods) || periods<=0) throw new Error('Horizon must contain a whole number of time steps.');
  const initialFraction=project.meta?.initial_soc_fraction;
  const reserveFraction=project.meta?.min_final_soc_fraction;
  return {scenario,...chargingInputs(project),...socPolicyInputs(settings),
    planning_horizon_hours:hours,time_step_minutes:settings.time_resolution,horizon_start_minute:horizonStart,
    cyclic_connections:cyclicConnections,...(daily ? {daily_cyclic:true,use_cyclic_soc:true} : {}),
    use_next_day_readiness:daily ? false : settings.use_next_day_readiness,
    buses:buses.map(bus => {
      const battery=bus.max_battery_capacity_kwh ?? project.constraints.max_battery_capacity_kwh ?? 350;
      const initial=bus.initial_soc_override_kwh ?? (initialFraction != null ? battery*initialFraction : bus.initial_soc_kwh ?? battery);
      const reserve=bus.min_final_soc_override_kwh ?? (reserveFraction != null ? battery*reserveFraction : bus.min_final_soc_kwh ?? battery*.2);
      return {...bus,max_battery_capacity_kwh:battery,initial_soc_kwh:initialEnergies[bus.id] ?? initial,min_final_soc_kwh:reserve,
        efficiency:bus.efficiency ?? settings.efficiency,max_power_kw:bus.max_power_kw ?? settings.max_power_per_bus,
        availability:repeatProfile(bus.availability,periods),trip_energy_profile_kwh:repeatProfile(bus.trip_energy_profile_kwh,periods),
        ...locationProfilesForHorizon(bus,periods,settings.time_resolution,project.meta?.time_resolution),
        initial_connection_site:initialConnections ? initialConnections[bus.id] : bus.initial_connection_site ?? null};
    }),
    electricity_prices:repeatProfile(prices,periods),market_prices:repeatProfile(marketPrices,periods),
    charger_capacity_kw:settings.charger_capacity_kw,grid_limit_kw:settings.grid_limit_kw,num_chargers:settings.num_chargers ?? 50,
    initial_soc_fraction:initialFraction ?? 1,min_final_soc_fraction:reserveFraction ?? .2,pv_config:pvConfig,bess_config:bessConfig};
}
