import math
import pulp
import time
from typing import Dict, List, Optional
import numpy as np
from ..models import OptimizationInputs, OptimizationResult, BusDiagnostic, PVConfig, BESSConfig
from .pv_service import PVService
from .weather_service import WeatherService

def simulate_baseline_load(inputs: OptimizationInputs) -> np.ndarray:
    """
    Simulates a 'Charge on Arrival' heuristic while respecting depot constraints.
    Used for comparing optimization results against a standard greedy strategy.
    """
    num_periods = len(inputs.electricity_prices)
    delta_t = inputs.time_step_minutes / 60.0
    baseline_load = np.zeros(num_periods)
    
    # Start with the same initial SoC used in the optimization
    bus_socs = [float(bus.initial_soc_kwh) for bus in inputs.buses]
    
    for t in range(num_periods):
        current_step_grid_kw = 0.0
        current_step_chargers = 0
        
        # Greedy charging for available buses
        for i, bus in enumerate(inputs.buses):
            # Consumption happens during the period
            trip_energy = float(bus.trip_energy_profile_kwh[t])
            
            # Check availability and appetite
            is_available = bus.availability[t] == 1
            is_hungry = bus_socs[i] < (bus.max_battery_capacity_kwh - 0.1)
            
            if is_available and is_hungry:
                # Depot constraints
                has_socket = current_step_chargers < inputs.num_chargers
                has_grid_room = current_step_grid_kw < inputs.grid_limit_kw
                
                if has_socket and has_grid_room:
                    # Power calculation
                    max_bus_kw = bus.max_power_kw
                    needed_kwh = (bus.max_battery_capacity_kwh - bus_socs[i])
                    needed_kw = needed_kwh / (delta_t * bus.efficiency)
                    
                    remaining_grid_kw = max(0.0, inputs.grid_limit_kw - current_step_grid_kw)
                    allowable_kw = min(max_bus_kw, needed_kw, remaining_grid_kw)
                    
                    if allowable_kw > 1.0:
                        chg_kwh = allowable_kw * delta_t * bus.efficiency
                        baseline_load[t] += allowable_kw
                        bus_socs[i] += chg_kwh
                        current_step_grid_kw += allowable_kw
                        current_step_chargers += 1
            
            # Update SoC for consumption (same interval as charging)
            bus_socs[i] = max(0.0, bus_socs[i] - trip_energy)
            
    return baseline_load

def _validate_bus_inputs(inputs: OptimizationInputs):
    num_periods = len(inputs.electricity_prices)

    for bus in inputs.buses:
        if len(bus.availability) != num_periods:
            raise ValueError(
                f"Bus {bus.id}: availability length {len(bus.availability)} "
                f"does not match number of price periods {num_periods}."
            )

        if len(bus.trip_energy_profile_kwh) != num_periods:
            raise ValueError(
                f"Bus {bus.id}: trip_energy_profile_kwh length {len(bus.trip_energy_profile_kwh)} "
                f"does not match number of price periods {num_periods}."
            )

        if bus.initial_soc_kwh < 0:
            raise ValueError(f"Bus {bus.id}: initial_soc_kwh must be non-negative.")

        if bus.initial_soc_kwh > bus.max_battery_capacity_kwh:
            raise ValueError(
                f"Bus {bus.id}: initial_soc_kwh exceeds max battery capacity."
            )

        if bus.min_final_soc_kwh < 0:
            raise ValueError(f"Bus {bus.id}: min_final_soc_kwh must be non-negative.")

        if bus.min_final_soc_kwh > bus.max_battery_capacity_kwh:
            raise ValueError(
                f"Bus {bus.id}: min_final_soc_kwh exceeds max battery capacity."
            )


def update_cell_temperature(
    prev_cell_temp_c: float,
    ambient_temp_c: float,
    dt_hours: float,
    tau_hours: float,
    power_kw: float,
    heating_coeff: float
) -> float:
    """
    First-order thermal model for BESS cell temperature.
    Includes ambient transfer and usage-based heat generation.
    λ = dt / tau
    """
    lam = 1.0 - math.exp(-dt_hours / max(0.1, tau_hours))
    # Ambient transfer
    t_new = prev_cell_temp_c + lam * (ambient_temp_c - prev_cell_temp_c)
    # Heat generation (P * dt * gamma)
    # We use absolute power because both charge and discharge generate heat
    t_new += abs(power_kw) * dt_hours * heating_coeff
    return t_new


def capacity_factor_from_cell_temp(T: float, bess_cfg: BESSConfig) -> float:
    """
    Piecewise linear approximation of BESS capacity factor vs cell temperature.
    Logic:
    - T <= T_min: CF_min
    - T_min < T < -10C: Interpolate between CF_min and CF_-10
    - -10C <= T < T_full: Interpolate between CF_-10 and 1.0
    - T >= T_full: 1.0
    """
    T_full = bess_cfg.full_capacity_temperature_c
    T_min = bess_cfg.min_modeled_cell_temperature_c
    T_mid = -10.0
    
    CF_min = bess_cfg.min_capacity_factor
    CF_mid = bess_cfg.capacity_factor_at_minus_10c
    CF_full = 1.0
    
    if T <= T_min:
        cf = CF_min
    elif T >= T_full:
        cf = CF_full
    elif T <= T_mid:
        # Interpolate between (T_min, CF_min) and (T_mid, CF_mid)
        # Ensure T_min < T_mid to avoid div by zero
        if T_min >= T_mid:
            cf = CF_mid
        else:
            span_t = T_mid - T_min
            span_cf = CF_mid - CF_min
            cf = CF_min + (span_cf / span_t) * (T - T_min)
    else:
        # Interpolate between (T_mid, CF_mid) and (T_full, CF_full)
        # Ensure T_mid < T_full
        if T_mid >= T_full:
            cf = CF_full
        else:
            span_t = T_full - T_mid
            span_cf = CF_full - CF_mid
            cf = CF_mid + (span_cf / span_t) * (T - T_mid)
            
    return max(CF_min, min(1.0, cf))


def generate_pv_profile(capacity_kw: float, num_periods: int, time_step_min: int) -> List[float]:
    """
    Generates a bell-curve PV profile peaking at noon.
    Repeats for horizons longer than 24h.
    """
    profile = []
    periods_per_day = int(1440 / time_step_min)
    for t in range(num_periods):
        t_day = t % periods_per_day
        hour = (t_day * time_step_min) / 60.0
        # Bell curve from 06:00 to 18:00
        if 6.0 <= hour <= 18.0:
            rad = np.pi * (hour - 6.0) / 12.0
            val = capacity_kw * np.sin(rad)
            profile.append(val)
        else:
            profile.append(0.0)
    return profile


async def run_scenario_optimization(inputs: OptimizationInputs, solver_logs: List[str]) -> OptimizationResult:
    """
    Main entry point for scenario-aware optimization.
    Branches between standard baseline and extended PV/BESS models.
    """
    # If standard baseline is selected, use the original untouched logic
    if inputs.scenario == "baseline":
        solver_logs.append("[Solver] Routing to standard baseline MILP solver.")
        return await run_milp_solver(inputs, solver_logs)

    # For other scenarios, we run the extended model
    # BUT first, we run the basic baseline optimization to provide the comparison metric
    # as requested: "if there is a bonus scenario involved additionally compare it to the 'basic' baseline optimization"
    basic_baseline_inputs = inputs.copy(deep=True)
    basic_baseline_inputs.scenario = "baseline"
    basic_res = await run_milp_solver(basic_baseline_inputs)
    
    # Now run the extended model
    solver_logs.append(f"[Solver] Routing to extended scenario solver (Scenario: {inputs.scenario}).")
    extended_res = await run_extended_milp_solver(inputs, solver_logs)
    
    # Inject the comparison metric
    extended_res.basic_optimized_cost_eur = basic_res.total_cost_eur
    return extended_res


async def run_extended_milp_solver(inputs: OptimizationInputs, solver_logs: List[str]) -> OptimizationResult:
    """
    Extended MILP including PV and depot BESS storage.
    """
    start_time = time.time()
    num_periods = len(inputs.electricity_prices)
    delta_t = inputs.time_step_minutes / 60.0
    
    _validate_bus_inputs(inputs)
    
    prob = pulp.LpProblem("ExtendedDepotOptimization", pulp.LpMinimize)
    
    # --- Bus Variables --- (Same as original)
    p_vars = {} # Bus charging power
    z_vars = {} # Bus charging binary
    soc_vars = {} # Bus battery SoC
    
    for bus in inputs.buses:
        for t in range(num_periods):
            up_bound = bus.max_power_kw if bus.availability[t] == 1 else 0.0
            p_vars[(bus.id, t)] = pulp.LpVariable(f"p_{bus.id}_{t}", lowBound=0, upBound=up_bound)
            z_vars[(bus.id, t)] = pulp.LpVariable(f"z_{bus.id}_{t}", cat="Binary")
            
        for t in range(num_periods + 1):
            soc_vars[(bus.id, t)] = pulp.LpVariable(
                f"soc_{bus.id}_{t}", lowBound=0, upBound=bus.max_battery_capacity_kwh
            )

    # --- PV Logic ---
    pv_config = inputs.pv_config or PVConfig(capacity_kw=0)
    
    # Force PV to 0 if scenario does not include it
    if inputs.scenario == "bess":
        solver_logs.append("[Solver] Scenario 'Baseline + BESS' active: Zeroing Photovoltaic profile.")
        pv_gen_profile = [0.0] * num_periods
    else:
        pv_gen_profile = pv_config.profile_kwh
        if pv_gen_profile is None or len(pv_gen_profile) == 0:
            if pv_config.profile_mode == "open_meteo" and pv_config.latitude and pv_config.longitude:
                pv_gen_profile = await PVService.get_profile(pv_config, num_periods, inputs.time_step_minutes, solver_logs)
            
            # Fallback to bell curve if Open-Meteo failed or wasn't selected
            if not pv_gen_profile:
                pv_gen_profile = generate_pv_profile(pv_config.capacity_kw, num_periods, inputs.time_step_minutes)
    
    pv_used = [pulp.LpVariable(f"pv_used_{t}", lowBound=0) for t in range(num_periods)]
    pv_curtailed = [pulp.LpVariable(f"pv_curtailed_{t}", lowBound=0) for t in range(num_periods)]

    # --- BESS Variables and Temperature Derating ---
    bess_cfg = inputs.bess_config or BESSConfig(capacity_kwh=0)
    
    # Force BESS to 0 if scenario does not include it
    if inputs.scenario == "pv":
        solver_logs.append("[Solver] Scenario 'Baseline + PV' active: Zeroing BESS capacity.")
        bess_cfg = BESSConfig(capacity_kwh=0)
    
    # Derating Logic
    ambient_temp_prof = []
    cell_temp_prof = []
    cap_factor_prof = []
    max_usable_cap_prof = []
    
    if bess_cfg.enable_temperature_capacity_derating and bess_cfg.capacity_kwh > 0:
        solver_logs.append("[Solver] BESS temperature derating enabled.")
        
        # 1. Fetch Ambient Temp
        lat = inputs.pv_config.latitude if inputs.pv_config else None
        lon = inputs.pv_config.longitude if inputs.pv_config else None
        ref_date = inputs.pv_config.reference_date if inputs.pv_config else None
        
        ambient_temp_prof = await WeatherService.get_temperature_profile(
            lat, lon, ref_date, num_periods, inputs.time_step_minutes, solver_logs
        )
        
        # 2. Compute Cell Temp and Capacity Profiles
        # Initial cell temp: use configured value or ambient at t=0
        curr_cell_temp = bess_cfg.initial_cell_temperature_c
        if curr_cell_temp is None:
            curr_cell_temp = ambient_temp_prof[0]
            solver_logs.append(f"[Solver] Initial cell temperature not set, using ambient at t=0: {curr_cell_temp:.1f} °C")
        else:
            solver_logs.append(f"[Solver] Using configured initial cell temperature: {curr_cell_temp:.1f} °C")
            
        tau = bess_cfg.thermal_time_constant_hours
        
        for t in range(num_periods):
            cell_temp_prof.append(round(curr_cell_temp, 3))
            
            # Capacity Factor Logic
            cf = capacity_factor_from_cell_temp(curr_cell_temp, bess_cfg)
            cf = max(bess_cfg.min_capacity_factor, min(1.0, cf)) # Clamp
            cap_factor_prof.append(round(cf, 4))
            max_usable_cap_prof.append(round(bess_cfg.capacity_kwh * cf, 4))
            
            # Update for next period
            # Update for next period
            # Power is not yet solved here, so we use a placeholder or 
            # we must solve cell temp AFTER solving the MILP.
            # IN THE MILP: We assume ambient tracking first, then do a second pass 
            # OR we move cell temp calculation AFTER the solve to reflect actual power.
            # For the dynamic capacity constraint, the ambient lag is the main driver.
            # For the VISUALIZATION, we'll re-calculate accurately with solved power.
            curr_cell_temp = update_cell_temperature(curr_cell_temp, ambient_temp_prof[t], delta_t, tau, 0, 0)
        
        # Add final cell temp point for consistency
        cell_temp_prof.append(round(curr_cell_temp, 3))
        solver_logs.append("[Solver] Applied dynamic BESS capacity ceiling based on estimated cell temperature.")
    else:
        # Defaults for disabled feature
        ambient_temp_prof = [25.0] * num_periods
        cell_temp_prof = [25.0] * (num_periods + 1)
        cap_factor_prof = [1.0] * num_periods
        max_usable_cap_prof = [bess_cfg.capacity_kwh] * num_periods

    b_charge = [pulp.LpVariable(f"b_chg_{t}", lowBound=0, upBound=bess_cfg.max_charge_power_kw) for t in range(num_periods)]
    b_discharge = [pulp.LpVariable(f"b_dischg_{t}", lowBound=0, upBound=bess_cfg.max_discharge_power_kw) for t in range(num_periods)]
    b_soc = [pulp.LpVariable(f"b_soc_{t}", lowBound=bess_cfg.min_soc_kwh, upBound=bess_cfg.max_soc_kwh) for t in range(num_periods + 1)]
    b_binary = [pulp.LpVariable(f"b_bin_{t}", cat="Binary") for t in range(num_periods)] # 1 = charging, 0 = discharging
    
    # Apply Dynamic Capacity Ceiling
    for t in range(num_periods):
        # The effective upper bound is the minimum of configured static max_soc and dynamic usable capacity
        dynamic_upper_bound = min(bess_cfg.max_soc_kwh, max_usable_cap_prof[t])
        prob += (b_soc[t] <= dynamic_upper_bound)
    
    # Final period check
    prob += (b_soc[num_periods] <= min(bess_cfg.max_soc_kwh, (bess_cfg.capacity_kwh * capacity_factor_from_cell_temp(cell_temp_prof[-1], bess_cfg))))

    # --- Grid Import Variable ---
    grid_import = [pulp.LpVariable(f"grid_import_{t}", lowBound=0) for t in range(num_periods)]
    b_chg_from_grid = [pulp.LpVariable(f"b_chg_grid_{t}", lowBound=0) for t in range(num_periods)]

    # --- Explicit Flow Variables (Requested for attribution) ---
    pv_to_bus = [pulp.LpVariable(f"pv_2_bus_{t}", lowBound=0) for t in range(num_periods)]
    pv_to_bess = [pulp.LpVariable(f"pv_2_bess_{t}", lowBound=0) for t in range(num_periods)]
    grid_to_bus = [pulp.LpVariable(f"grid_2_bus_{t}", lowBound=0) for t in range(num_periods)]
    grid_to_bess = [pulp.LpVariable(f"grid_2_bess_{t}", lowBound=0) for t in range(num_periods)]
    bess_to_bus = [pulp.LpVariable(f"bess_2_bus_{t}", lowBound=0) for t in range(num_periods)]

    # --- Objective ---
    # Minimize total electricity procurement cost from the grid
    prob += pulp.lpSum(
        grid_import[t] * (inputs.electricity_prices[t] / 1000.0) * delta_t
        for t in range(num_periods)
    )

    # --- Constraints ---
    
    # 1. Bus Constraints (SoC dynamics and limits)
    for bus in inputs.buses:
        prob += (soc_vars[(bus.id, 0)] == bus.initial_soc_kwh)
        for t in range(num_periods):
            trip_energy = float(bus.trip_energy_profile_kwh[t])
            prob += (
                soc_vars[(bus.id, t + 1)] == soc_vars[(bus.id, t)] 
                + p_vars[(bus.id, t)] * delta_t * bus.efficiency - trip_energy
            )
            prob += (p_vars[(bus.id, t)] <= bus.max_power_kw * z_vars[(bus.id, t)])
        
        final_threshold = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if getattr(inputs, 'use_next_day_readiness', False) else 0)
        prob += (soc_vars[(bus.id, num_periods)] >= final_threshold)

    # 2. PV Constraints
    for t in range(num_periods):
        # PV yield consists of direct use, storage use, or curtailment
        prob += (pv_to_bus[t] + pv_to_bess[t] + pv_curtailed[t] == pv_gen_profile[t])

    # 3. BESS Constraints
    eff_bess = bess_cfg.efficiency
    prob += (b_soc[0] == bess_cfg.initial_soc_kwh)
    for t in range(num_periods):
        # SoC dynamics
        prob += (
            b_soc[t+1] == b_soc[t] 
            + (b_charge[t] * eff_bess * delta_t) 
            - (b_discharge[t] / eff_bess * delta_t)
        )
        # Simultaneous charge/discharge prevention
        M = 5000.0 # Large enough constant
        prob += (b_charge[t] <= M * b_binary[t])
        prob += (b_discharge[t] <= M * (1 - b_binary[t]))
        
        # Explicit input sourcing
        prob += (b_charge[t] == pv_to_bess[t] + grid_to_bess[t])
        # Explicit output usage
        prob += (b_discharge[t] == bess_to_bus[t])

    # 4. Depot Balance and Net Import logic
    for t in range(num_periods):
        total_bus_p = pulp.lpSum(p_vars[(bus.id, t)] for bus in inputs.buses)
        
        # Grid Source Balance
        prob += (grid_import[t] == grid_to_bus[t] + grid_to_bess[t])
        
        # Bus Demand Satisfaction (Power from Grid, PV, or BESS)
        prob += (total_bus_p == grid_to_bus[t] + pv_to_bus[t] + bess_to_bus[t])
        
        # PV used tracking (for result model)
        prob += (pv_used[t] == pv_to_bus[t] + pv_to_bess[t])
        
        # Grid Limit applies to the net import
        prob += (grid_import[t] <= inputs.grid_limit_kw)
        
        # Socket limits (Original bus charger constraints)
        prob += (pulp.lpSum(z_vars[(bus.id, t)] for bus in inputs.buses) <= inputs.num_chargers)
        prob += (total_bus_p <= inputs.charger_capacity_kw)

    # --- Solve ---
    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=180)
    prob.solve(solver)
    
    status = pulp.LpStatus[prob.status]
    if status not in {"Optimal", "Feasible"}:
        raise RuntimeError(f"Scenario optimization ended with status: {status}")

    # --- Extract Results ---
    schedules = {}
    soc_profiles = {}
    for bus in inputs.buses:
        schedules[bus.id] = [round(float(pulp.value(p_vars[(bus.id, t)]) or 0.0), 4) for t in range(num_periods)]
        soc_profiles[bus.id] = [round(float(pulp.value(soc_vars[(bus.id, t)]) or 0.0), 4) for t in range(num_periods + 1)]

    # Profiles
    aggregated_load = [sum(schedules[bus.id][t] for bus in inputs.buses) for t in range(num_periods)]
    import_prof = [round(float(pulp.value(grid_import[t]) or 0.0), 4) for t in range(num_periods)]
    
    pv_y_prof = [round(v, 4) for v in pv_gen_profile]
    pv_u_prof = [round(float(pulp.value(pv_used[t]) or 0.0), 4) for t in range(num_periods)]
    pv_c_prof = [round(float(pulp.value(pv_curtailed[t]) or 0.0), 4) for t in range(num_periods)]
    
    b_chg_prof = [round(float(pulp.value(b_charge[t]) or 0.0), 4) for t in range(num_periods)]
    b_dis_prof = [round(float(pulp.value(b_discharge[t]) or 0.0), 4) for t in range(num_periods)]
    b_soc_prof = [round(float(pulp.value(b_soc[t]) or 0.0), 4) for t in range(num_periods + 1)]
    
    b_chg_pv = [round(float(pulp.value(pv_to_bess[t]) or 0.0), 4) for t in range(num_periods)]
    b_chg_grid = [round(float(pulp.value(grid_to_bess[t]) or 0.0), 4) for t in range(num_periods)]

    # New granular profiles for source-to-bus coloring
    pv_tb_prof = [round(float(pulp.value(pv_to_bus[t]) or 0.0), 4) for t in range(num_periods)]
    grid_tb_prof = [round(float(pulp.value(grid_to_bus[t]) or 0.0), 4) for t in range(num_periods)]
    bess_tb_prof = [round(float(pulp.value(bess_to_bus[t]) or 0.0), 4) for t in range(num_periods)]

    # Recalculate cell temperature with solved power for accurate visualization
    heat_coeff = bess_cfg.thermal_heating_coefficient
    tau = bess_cfg.thermal_time_constant_hours
    cell_temp_prof = [float(bess_cfg.initial_cell_temperature_c or ambient_temp_prof[0])]
    cap_factor_prof = []
    max_usable_cap_prof = []
    
    current_t = cell_temp_prof[0]
    for t in range(num_periods):
        # Calculate CF based on start-of-period temperature (consistent with solver)
        cf = capacity_factor_from_cell_temp(current_t, bess_cfg)
        cf = max(bess_cfg.min_capacity_factor, min(1.0, cf))
        cap_factor_prof.append(round(cf, 4))
        max_usable_cap_prof.append(round(bess_cfg.capacity_kwh * cf, 4))
        
        # Update temperature for the next step
        p_net = b_chg_prof[t] - b_dis_prof[t]
        current_t = update_cell_temperature(current_t, ambient_temp_prof[t], delta_t, tau, p_net, heat_coeff)
        cell_temp_prof.append(round(current_t, 3))

    # Metrics
    total_cost = sum(import_prof[t] * (inputs.electricity_prices[t] / 1000.0) * delta_t for t in range(num_periods))
    total_energy_kwh = sum(import_prof) * delta_t
    
    # Baseline comparison (Charge on arrival)
    baseline_load = simulate_baseline_load(inputs)
    baseline_cost = sum(baseline_load[t] * (inputs.electricity_prices[t] / 1000.0) * delta_t for t in range(num_periods))

    # Diagnostics (Simplified reuse)
    bus_diagnostics = []
    for bus in inputs.buses:
        final_soc = soc_profiles[bus.id][-1]
        min_reached = min(soc_profiles[bus.id])
        charged_to_bat = sum(schedules[bus.id][t] * delta_t * bus.efficiency for t in range(num_periods))
        
        final_threshold = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if getattr(inputs, 'use_next_day_readiness', False) else 0)
        
        if charged_to_bat < 0.1:
            reason = "No charging required: Initial SoC sufficient for all trips."
            status = "healthy"
        elif final_soc < final_threshold - 0.5:
            reason = "Constraint Violation: Insufficient time/power to meet readiness buffer."
            status = "critical"
        else:
            reason = "Charging requirement fully met (Optimized)."
            status = "healthy" if min_reached > 20 else "warning"

        bus_diagnostics.append(BusDiagnostic(
            id=bus.id,
            capacity_kwh=bus.max_battery_capacity_kwh,
            initial_soc_kwh=bus.initial_soc_kwh,
            final_soc_kwh=final_soc,
            min_soc_reached_kwh=min_reached,
            total_trip_energy_kwh=sum(bus.trip_energy_profile_kwh),
            total_charged_energy_kwh=charged_to_bat,
            is_charged=charged_to_bat > 0.1,
            status_flag=status,
            diagnostic_reason=reason
        ))

    return OptimizationResult(
        scenario=inputs.scenario,
        total_cost_eur=round(float(total_cost), 2),
        total_energy_mwh=round(float(total_energy_kwh) / 1000.0, 3),
        peak_load_kw=round(float(np.max(import_prof)), 2),
        schedules=schedules,
        soc_profiles=soc_profiles,
        aggregated_load_profile=[round(x, 1) for x in aggregated_load],
        grid_import_profile=import_prof,
        baseline_aggregated_load_profile=[round(x, 1) for x in baseline_load.tolist()],
        baseline_cost_eur=round(float(baseline_cost), 2),
        pv_yield_profile=pv_y_prof,
        pv_used_profile=pv_u_prof,
        pv_curtailed_profile=pv_c_prof,
        total_pv_generated_kwh=round(sum(pv_y_prof) * delta_t, 2),
        total_pv_used_kwh=round(sum(pv_u_prof) * delta_t, 2),
        total_pv_curtailed_kwh=round(sum(pv_c_prof) * delta_t, 2),
        bess_charge_profile=b_chg_prof,
        bess_discharge_profile=b_dis_prof,
        bess_soc_profile=b_soc_prof,
        bess_charge_from_pv_profile=b_chg_pv,
        bess_charge_from_grid_profile=b_chg_grid,
        pv_to_bus_profile=pv_tb_prof,
        grid_to_bus_profile=grid_tb_prof,
        bess_to_bus_profile=bess_tb_prof,
        total_bess_throughput_kwh=round(sum(b_chg_prof) * delta_t, 2),
        electricity_prices=inputs.electricity_prices,
        market_prices=inputs.market_prices,
        bus_diagnostics=bus_diagnostics,
        optimization_gap=0.0,
        status=f"Scenario {inputs.scenario} solved ({status})",
        ambient_temperature_profile_c=ambient_temp_prof,
        bess_cell_temperature_profile_c=cell_temp_prof,
        bess_capacity_factor_profile=cap_factor_prof,
        bess_max_usable_capacity_profile_kwh=max_usable_cap_prof
    )


async def run_milp_solver(inputs: OptimizationInputs, solver_logs: List[str] = None) -> OptimizationResult:
    """
    ORIGINAL Logic - Safe, unchanged for reproducibility.
    Solves the cost-optimal charging schedule for electric buses.
    """
    start_time = time.time()
    num_periods = len(inputs.electricity_prices)
    delta_t = inputs.time_step_minutes / 60.0
    _validate_bus_inputs(inputs)

    prob = pulp.LpProblem("BusDepotChargingOptimization", pulp.LpMinimize)
    p_vars = {}
    z_vars = {}
    soc_vars = {}

    for bus in inputs.buses:
        for t in range(num_periods):
            up_bound = bus.max_power_kw if bus.availability[t] == 1 else 0.0
            p_vars[(bus.id, t)] = pulp.LpVariable(f"p_{bus.id}_{t}", lowBound=0, upBound=up_bound)
            z_vars[(bus.id, t)] = pulp.LpVariable(f"z_{bus.id}_{t}", cat="Binary")
        for t in range(num_periods + 1):
            soc_vars[(bus.id, t)] = pulp.LpVariable(f"soc_{bus.id}_{t}", lowBound=0, upBound=bus.max_battery_capacity_kwh)

    prob += pulp.lpSum(p_vars[(bus.id, t)] * (inputs.electricity_prices[t] / 1000.0) * delta_t for bus in inputs.buses for t in range(num_periods))

    for bus in inputs.buses:
        prob += (soc_vars[(bus.id, 0)] == bus.initial_soc_kwh)
        for t in range(num_periods):
            trip_energy = float(bus.trip_energy_profile_kwh[t])
            prob += (soc_vars[(bus.id, t + 1)] == soc_vars[(bus.id, t)] + p_vars[(bus.id, t)] * delta_t * bus.efficiency - trip_energy)
            prob += (p_vars[(bus.id, t)] <= bus.max_power_kw * z_vars[(bus.id, t)])
        final_threshold = bus.min_final_soc_kwh
        if getattr(inputs, 'use_next_day_readiness', False):
            final_threshold += bus.next_day_required_energy_kwh
        prob += (soc_vars[(bus.id, num_periods)] >= final_threshold)

    for t in range(num_periods):
        prob += (pulp.lpSum(p_vars[(bus.id, t)] for bus in inputs.buses) <= inputs.grid_limit_kw)
        prob += (pulp.lpSum(z_vars[(bus.id, t)] for bus in inputs.buses) <= inputs.num_chargers)
        prob += (pulp.lpSum(p_vars[(bus.id, t)] for bus in inputs.buses) <= inputs.charger_capacity_kw)

    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=180)
    prob.solve(solver)
    status = pulp.LpStatus[prob.status]
    if status not in {"Optimal", "Feasible"}:
        raise RuntimeError(f"Optimization ended with status: {status}")

    schedules = {}
    soc_profiles = {}
    bus_diagnostics = []
    aggregated_profile = np.zeros(num_periods)
    for bus in inputs.buses:
        bus_sch = [round(float(pulp.value(p_vars[(bus.id, t)]) or 0.0), 4) for t in range(num_periods)]
        bus_soc = [round(float(pulp.value(soc_vars[(bus.id, t)]) or 0.0), 4) for t in range(num_periods + 1)]
        schedules[bus.id] = bus_sch
        soc_profiles[bus.id] = bus_soc
        for t in range(num_periods): aggregated_profile[t] += bus_sch[t]
        
        # Enhanced Diagnostics logic
        total_trip_energy = sum(bus.trip_energy_profile_kwh)
        charged_en = sum(bus_sch[t] * delta_t * bus.efficiency for t in range(num_periods))
        min_soc = min(bus_soc)
        final_threshold = bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if getattr(inputs, 'use_next_day_readiness', False) else 0)
        
        if charged_en < 0.1:
            reason = "No charging required: Initial SoC sufficient for all trips."
            diag_status = "healthy"
        elif bus_soc[-1] < final_threshold - 0.5:
            reason = "Constraint Violation: Insufficient time/power to meet readiness buffer."
            diag_status = "critical"
        else:
            reason = "Charging requirement fully met (Baseline)."
            diag_status = "healthy" if min_soc > 20 else "warning"
        
        bus_diagnostics.append(BusDiagnostic(
            id=bus.id, capacity_kwh=bus.max_battery_capacity_kwh, initial_soc_kwh=bus.initial_soc_kwh,
            final_soc_kwh=bus_soc[-1], min_soc_reached_kwh=min_soc, total_trip_energy_kwh=total_trip_energy,
            total_charged_energy_kwh=charged_en, is_charged=charged_en > 0.1, status_flag=diag_status,
            diagnostic_reason=reason
        ))

    total_energy_kwh = np.sum(aggregated_profile) * delta_t
    total_cost_eur = np.sum(aggregated_profile * np.array(inputs.electricity_prices) * delta_t / 1000.0)
    
    # Baseline comparison (Charge on arrival) - Now respecting constraints
    baseline_load = simulate_baseline_load(inputs)
    baseline_cost = np.sum(baseline_load * np.array(inputs.electricity_prices) * delta_t / 1000.0)

    return OptimizationResult(
        scenario=inputs.scenario,
        total_cost_eur=round(float(total_cost_eur), 2),
        total_energy_mwh=round(float(total_energy_kwh) / 1000.0, 3),
        peak_load_kw=round(float(np.max(aggregated_profile)), 2),
        schedules=schedules,
        soc_profiles=soc_profiles,
        aggregated_load_profile=[round(x, 1) for x in aggregated_profile.tolist()],
        grid_import_profile=[round(x, 1) for x in aggregated_profile.tolist()],
        baseline_aggregated_load_profile=[round(x, 1) for x in baseline_load.tolist()],
        baseline_cost_eur=round(float(baseline_cost), 2),
        electricity_prices=inputs.electricity_prices,
        market_prices=inputs.market_prices,
        bus_diagnostics=bus_diagnostics,
        pv_to_bus_profile=[0.0] * num_periods,
        bess_to_bus_profile=[0.0] * num_periods,
        grid_to_bus_profile=[round(x, 4) for x in aggregated_profile.tolist()],
        optimization_gap=0.0,
        status=f"{status} (Baseline Optimized)"
    )
