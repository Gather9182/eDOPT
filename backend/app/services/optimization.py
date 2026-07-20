import numpy as np
from typing import Dict, List
from ..models import OptimizationInputs, OptimizationResult, BusDiagnostic, PVConfig, BESSConfig
from .solver import run_milp_solver, run_scenario_optimization, update_cell_temperature, capacity_factor_from_cell_temp
from .pv_service import PVService
from .weather_service import WeatherService

async def run_optimization(inputs: OptimizationInputs) -> OptimizationResult:
    """
    Primary entry point for depot optimization.
    Routes to the scenario-aware MILP solver.
    """
    solver_logs = []
    try:
        res = await run_scenario_optimization(inputs, solver_logs)
        res.solver_logs = solver_logs
        return res
    except Exception as e:
        err_str = str(e)
        print(f"Solver failed: {err_str}. Falling back to heuristic.")
        res = await run_placeholder_optimization(inputs, solver_logs, error_msg=err_str)
        res.solver_logs = solver_logs
        return res

async def run_placeholder_optimization(inputs: OptimizationInputs, solver_logs: List[str], error_msg: str = None) -> OptimizationResult:
    """
    Simple feasible heuristic with battery state tracking.
    Now includes basic PV and BESS logic for profile consistency.
    """
    num_periods = int((inputs.planning_horizon_hours * 60) / inputs.time_step_minutes)
    delta_t = inputs.time_step_minutes / 60.0

    schedules: Dict[str, List[float]] = {}
    soc_profiles: Dict[str, List[float]] = {}
    bus_diagnostics: List[BusDiagnostic] = []
    
    # Infrastructure Profiles
    aggregated_load = np.zeros(num_periods)
    grid_import = np.zeros(num_periods)
    
    # PV Initialization
    pv_cfg = inputs.pv_config or PVConfig(capacity_kw=0)
    pv_yield = pv_cfg.profile_kwh
    if pv_yield is None or len(pv_yield) == 0:
        if pv_cfg.profile_mode == "open_meteo" and pv_cfg.latitude and pv_cfg.longitude:
            pv_yield = await PVService.get_profile(pv_cfg, num_periods, inputs.time_step_minutes, solver_logs)
        
        # Fallback to bell curve
        if not pv_yield:
            pv_yield = []
            periods_per_day = int(1440 / inputs.time_step_minutes)
            for t in range(num_periods):
                t_day = t % periods_per_day
                hour = (t_day * inputs.time_step_minutes) / 60.0
                if 6.0 <= hour <= 18.0:
                    rad = np.pi * (hour - 6.0) / 12.0
                    pv_yield.append(pv_cfg.capacity_kw * np.sin(rad))
                else:
                    pv_yield.append(0.0)
    
    pv_used = np.zeros(num_periods)
    pv_curtailed = np.zeros(num_periods)
    pv_2_bess = np.zeros(num_periods)
    pv_2_bus = np.zeros(num_periods)

    # BESS Initialization
    bess_cfg = inputs.bess_config or BESSConfig(capacity_kwh=0)
    
    # Derating Profile Generation (Heuristic)
    amb_temp_prof = []
    cell_temp_prof = []
    cap_fact_prof = []
    max_usable_prof = []
    
    if bess_cfg.enable_temperature_capacity_derating and bess_cfg.capacity_kwh > 0:
        lat = inputs.pv_config.latitude if inputs.pv_config else None
        lon = inputs.pv_config.longitude if inputs.pv_config else None
        ref_date = inputs.pv_config.reference_date if inputs.pv_config else None
        amb_temp_prof = await WeatherService.get_temperature_profile(lat, lon, ref_date, num_periods, inputs.time_step_minutes, solver_logs)
        
        curr_t = bess_cfg.initial_cell_temperature_c
        if curr_t is None: curr_t = amb_temp_prof[0]
        
        for t in range(num_periods):
            cell_temp_prof.append(round(curr_t, 3))
            cf = max(bess_cfg.min_capacity_factor, min(1.0, capacity_factor_from_cell_temp(curr_t, bess_cfg)))
            cap_fact_prof.append(round(cf, 4))
            max_usable_prof.append(round(bess_cfg.capacity_kwh * cf, 4))
            # In heuristic, we update at each step, but since BESS power is solved 
            # after the first pass in this specific implementation, we'll do 
            # a similar post-processing pass or just stick to ambient for the initial cap.
            # I'll update the loop below after b_charge/b_discharge are computed.
            curr_t = update_cell_temperature(curr_t, amb_temp_prof[t], delta_t, bess_cfg.thermal_time_constant_hours, 0, 0)
        cell_temp_prof.append(round(curr_t, 3))
    else:
        amb_temp_prof = [25.0] * num_periods
        cell_temp_prof = [25.0] * (num_periods + 1)
        cap_fact_prof = [1.0] * num_periods
        max_usable_prof = [bess_cfg.capacity_kwh] * num_periods

    b_soc = [float(bess_cfg.initial_soc_kwh)]
    bess_curr_soc = float(bess_cfg.initial_soc_kwh)
    b_charge = np.zeros(num_periods)
    b_discharge = np.zeros(num_periods)
    grid_2_bess = np.zeros(num_periods)

    total_cost = 0.0
    total_energy_kwh = 0.0

    # First Pass: Bus Charging (Simplified Greedy with Grid Limit awareness)
    for bus in inputs.buses:
        bus_schedule = np.zeros(num_periods)
        bus_soc = [float(bus.initial_soc_kwh)]
        soc = float(bus.initial_soc_kwh)
        total_trip_energy = sum(bus.trip_energy_profile_kwh)
        charged_this_bus_kwh = 0.0
        out_of_energy = False

        for t in range(num_periods):
            # Apply trip consumption
            trip_energy = float(bus.trip_energy_profile_kwh[t])
            if soc < trip_energy: out_of_energy = True
            soc = max(0.0, soc - trip_energy)

            # Target is future need + buffer
            future_need = sum(bus.trip_energy_profile_kwh[t+1:])
            buffer = bus.next_day_required_energy_kwh if getattr(inputs, 'use_next_day_readiness', False) else 0
            target_soc = min(bus.max_battery_capacity_kwh, future_need + buffer)

            # Static heuristic charging
            if bus.availability[t] == 1 and soc < target_soc:
                # Check available power (crude heuristic cap)
                avail_depot_p = max(0, inputs.grid_limit_kw - aggregated_load[t])
                max_bus_p = min(bus.max_power_kw, avail_depot_p)
                
                charge_to_bat = min(target_soc - soc, max_bus_p * delta_t * bus.efficiency)
                if charge_to_bat > 0:
                    p_kw = charge_to_bat / (delta_t * bus.efficiency)
                    bus_schedule[t] = p_kw
                    aggregated_load[t] += p_kw
                    soc += charge_to_bat
                    charged_this_bus_kwh += charge_to_bat

            bus_soc.append(round(soc, 4))
        
        schedules[bus.id] = [round(x, 4) for x in bus_schedule.tolist()]
        soc_profiles[bus.id] = bus_soc
        total_energy_kwh += charged_this_bus_kwh

        # Diagnostics mapping...
        final_thresh = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if getattr(inputs, 'use_next_day_readiness', False) else 0)
        reason = f"Heuristic Fallback ({error_msg or 'Infeasible'})"
        if out_of_energy: reason = "Critical: Vehicle ran out of energy during transit."
        elif soc < final_thresh: reason = "Constraint Violation: Insufficient charging for morning readiness."
        elif charged_this_bus_kwh < 0.1: reason = "No charging required: Initial SoC sufficient."
        
        bus_diagnostics.append(BusDiagnostic(
            id=bus.id, capacity_kwh=bus.max_battery_capacity_kwh, initial_soc_kwh=bus.initial_soc_kwh,
            final_soc_kwh=soc, min_soc_reached_kwh=min(bus_soc), total_trip_energy_kwh=total_trip_energy,
            total_charged_energy_kwh=charged_this_bus_kwh, is_charged=charged_this_bus_kwh > 0.1,
            vehicle_type=bus.vehicle_type, status_flag="critical" if out_of_energy else "warning",
            diagnostic_reason=reason
        ))

    # Second Pass: Infrastructure Balance (PV & BESS)
    avg_price = np.mean(inputs.electricity_prices)
    for t in range(num_periods):
        # 1. Distribute PV
        # Direct use for buses
        pv_2_bus[t] = min(pv_yield[t], aggregated_load[t])
        surplus_pv = pv_yield[t] - pv_2_bus[t]
        
        # 2. BESS Charging
        # Charge from surplus PV first
        # Dynamic upper bound
        dynamic_max_soc = min(bess_cfg.max_soc_kwh, max_usable_prof[t])
        can_charge_kwh = max(0, dynamic_max_soc - bess_curr_soc)
        max_p_kwh = (bess_cfg.max_charge_power_kw * delta_t)
        
        pv_cap_kwh = min(surplus_pv * delta_t, can_charge_kwh, max_p_kwh)
        if pv_cap_kwh > 0:
            pv_2_bess[t] = pv_cap_kwh / delta_t
            bess_curr_soc += pv_cap_kwh * bess_cfg.efficiency
            surplus_pv -= pv_2_bess[t]
        
        # Charge from Grid if cheap and space left
        if inputs.electricity_prices[t] < avg_price * 0.9 and bess_curr_soc < dynamic_max_soc * 0.8:
            grid_cap_kwh = min(can_charge_kwh - pv_cap_kwh, max_p_kwh - pv_cap_kwh, 20.0) # Cap grid charge to avoid peak
            if grid_cap_kwh > 0:
                grid_2_bess[t] = grid_cap_kwh / delta_t
                bess_curr_soc += grid_cap_kwh * bess_cfg.efficiency
        
        b_charge[t] = pv_2_bess[t] + grid_2_bess[t]
        pv_curtailed[t] = surplus_pv
        pv_used[t] = pv_2_bus[t] + pv_2_bess[t]

        # 3. BESS Discharging
        # Use BESS to support buses if prices are high or grid load is high
        if inputs.electricity_prices[t] > avg_price * 1.1 or (aggregated_load[t] + grid_2_bess[t]) > inputs.grid_limit_kw * 0.8:
            can_dis_kwh = (bess_curr_soc - bess_cfg.min_soc_kwh)
            dis_p_kwh = min(can_dis_kwh, bess_cfg.max_discharge_power_kw * delta_t, aggregated_load[t] * delta_t)
            if dis_p_kwh > 0:
                b_discharge[t] = dis_p_kwh / delta_t
                bess_curr_soc -= (dis_p_kwh / bess_cfg.efficiency)
        
        b_soc.append(round(bess_curr_soc, 4))
        
        # 4. Final Grid Import
        # Import = Bus Demand + BESS Grid Charge - BESS Discharge - PV Direct
        grid_import[t] = max(0, aggregated_load[t] + grid_2_bess[t] - b_discharge[t] - pv_2_bus[t])
        total_cost += grid_import[t] * (inputs.electricity_prices[t] / 1000.0) * delta_t

    # Post-processing: Recalculate accurately with solved BESS power
    if bess_cfg.enable_temperature_capacity_derating:
        curr_t = bess_cfg.initial_cell_temperature_c or amb_temp_prof[0]
        cell_temp_prof = [round(curr_t, 3)]
        cap_fact_prof = []
        max_usable_prof = []
        for t in range(num_periods):
            p_net = b_charge[t] - b_discharge[t]
            curr_t = update_cell_temperature(curr_t, amb_temp_prof[t], delta_t, bess_cfg.thermal_time_constant_hours, p_net, bess_cfg.thermal_heating_coefficient)
            cell_temp_prof.append(round(curr_t, 3))
            cf = max(bess_cfg.min_capacity_factor, min(1.0, capacity_factor_from_cell_temp(curr_t, bess_cfg)))
            cap_fact_prof.append(round(cf, 4))
            max_usable_prof.append(round(bess_cfg.capacity_kwh * cf, 4))

    return OptimizationResult(
        scenario=inputs.scenario,
        total_cost_eur=round(total_cost, 2),
        peak_load_kw=round(float(np.max(grid_import)), 2),
        total_energy_mwh=round(np.sum(grid_import) * delta_t / 1000.0, 3),
        schedules=schedules, soc_profiles=soc_profiles, bus_diagnostics=bus_diagnostics,
        aggregated_load_profile=aggregated_load.tolist(),
        grid_import_profile=grid_import.tolist(),
        pv_yield_profile=pv_yield, pv_used_profile=pv_used.tolist(), pv_curtailed_profile=pv_curtailed.tolist(),
        total_pv_generated_kwh=round(sum(pv_yield) * delta_t, 2),
        total_pv_used_kwh=round(sum(pv_used) * delta_t, 2),
        total_pv_curtailed_kwh=round(sum(pv_curtailed) * delta_t, 2),
        bess_charge_profile=b_charge.tolist(), bess_discharge_profile=b_discharge.tolist(), bess_soc_profile=b_soc,
        bess_charge_from_pv_profile=pv_2_bess.tolist(), bess_charge_from_grid_profile=grid_2_bess.tolist(),
        total_bess_throughput_kwh=round(sum(b_charge) * delta_t, 2),
        electricity_prices=inputs.electricity_prices,
        optimization_gap=0.08, status=f"Heuristic Fallback: {error_msg or 'Infeasible'}",
        ambient_temperature_profile_c=amb_temp_prof,
        bess_cell_temperature_profile_c=cell_temp_prof,
        bess_capacity_factor_profile=cap_fact_prof,
        bess_max_usable_capacity_profile_kwh=max_usable_prof
    )
