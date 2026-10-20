"""Hard automatic charging during unattended locks, with capped equal shares.

Shares are interval-average kW. Individual caps include the full integrated
charging curve and the configured SoC target. Reaching a cap frees capacity for
other connected buses. Price cannot defer charging during an automatic lock.
"""
import pulp

from .charging_sites import slot_is_blocked
from .soc_policy import preferred_maximum
from .opportunity_charging import potential_profiles
from .optimization_progress import check_cancelled


def balanced_allocation(caps, budget):
    result = [0.0]*len(caps)
    remaining = list(range(len(caps)))
    budget = max(0,budget)
    while remaining and budget > 1e-10:
        share = budget/len(remaining)
        limited = [i for i in remaining if caps[i] <= share+1e-10]
        if not limited:
            for i in remaining: result[i] = share
            break
        for i in limited:
            result[i] = max(0,caps[i])
            budget -= result[i]
        remaining = [i for i in remaining if i not in limited]
    return result


def add_automatic_charging(problem, inputs, states, site_state, opportunities, curve_elapsed, energy=None, logs=None):
    if not site_state:
        return
    automatic_sites = [site for site in inputs.charging_sites if site.lock_charging_mode == 'automatic_balanced' and site.no_switch_windows]
    if not automatic_sites:
        return
    connections,powers,grids = site_state
    dt = inputs.time_step_minutes/60
    n = len(inputs.electricity_prices)
    potential = {bus.id:potential_profiles(bus,inputs) for bus in inputs.buses}
    for si,site in enumerate(automatic_sites):
        for t in range(n):
            check_cancelled()
            if not slot_is_blocked(site,inputs.horizon_start_minute+t*inputs.time_step_minutes,inputs.time_step_minutes):
                continue
            if not any(potential[bus.id].get(site.id,[0]*n)[t] for bus in inputs.buses):
                continue
            prefix = f'auto_s{si}_t{t}'
            max_share = max((min(bus.max_power_kw,site.charger_power_kw) for bus in inputs.buses),default=0)
            if max_share <= 0:
                continue
            share = pulp.LpVariable(prefix+'_share',lowBound=0,upBound=max_share)
            charger_full = pulp.LpVariable(prefix+'_charger_full',cat='Binary')
            source_full = pulp.LpVariable(prefix+'_source_full',cat='Binary')
            total = pulp.lpSum(powers[bus.id,site.id,t] for bus in inputs.buses)
            problem += total >= site.charger_capacity_kw*charger_full
            problem += grids[site.id,t] >= site.grid_limit_kw*source_full
            problem += share >= max_share*(1-charger_full-source_full)
            if energy is not None and site.id == inputs.energy_site_id:
                # If source capacity is the bottleneck, available PV and storage
                # must supply buses before grid/BESS arbitrage can delay charging.
                pv,curtailed,charge,discharge,bess_soc,bess = energy
                problem += curtailed[t] <= max(0,pv[t])*(1-source_full)
                problem += charge[t] <= bess.max_charge_power_kw*(1-source_full)
                rate_full = pulp.LpVariable(prefix+'_bess_rate_full',cat='Binary')
                empty = pulp.LpVariable(prefix+'_bess_empty',cat='Binary')
                problem += rate_full+empty >= source_full
                problem += discharge[t] >= bess.max_discharge_power_kw*rate_full
                problem += bess_soc[t+1] <= bess.min_soc_kwh+(bess.max_soc_kwh-bess.min_soc_kwh)*(1-empty)
            for bi,bus in enumerate(inputs.buses):
                if not potential[bus.id].get(site.id,[0]*n)[t]:
                    continue
                available = bus.site_availability.get(site.id,[0]*n)[t]
                busy = opportunities['busy'].get((bus.id,t),0)
                visit = opportunities['presence'].get((bus.id,site.id,t),0)
                allowed = available*(1-busy)+visit
                if isinstance(allowed,(int,float)) and allowed == 0:
                    continue
                cap = min(bus.max_power_kw,site.charger_power_kw,site.charger_capacity_kw)
                if inputs.scenario == 'baseline' or site.id != inputs.energy_site_id:
                    cap = min(cap,site.grid_limit_kw)
                if cap <= 0:
                    continue
                key = (bus.id,site.id,t)
                label = prefix+f'_b{bi}'
                connected = connections[key]
                if isinstance(allowed,(int,float)):
                    active = connected
                else:
                    active = pulp.LpVariable(label+'_active',cat='Binary')
                    problem += active <= connected
                    problem += active <= allowed
                    problem += active >= connected+allowed-1
                capacity = bus.max_battery_capacity_kwh
                target = preferred_maximum(inputs,bus)
                if inputs.operating_max_soc_enabled and inputs.operating_max_soc_mode == 'soft':
                    target = pulp.LpVariable(label+'_target',lowBound=target,upBound=capacity)
                start = states[bus.id,t]
                power = powers[key]
                end = start+power*dt*bus.efficiency
                needs_charge = pulp.LpVariable(label+'_needs_charge',cat='Binary')
                target_full = pulp.LpVariable(label+'_target_full',cat='Binary')
                power_full = pulp.LpVariable(label+'_power_full',cat='Binary')
                problem += start <= target+capacity*(2-needs_charge-active)
                problem += start >= target-capacity*(needs_charge+1-active)
                problem += power <= cap*needs_charge
                problem += end <= target+capacity*(2-needs_charge-active)
                problem += target_full <= active
                problem += power_full <= active
                problem += end >= target-capacity*(1-target_full)
                problem += power <= share
                problem += power >= share-max_share*(target_full+power_full+1-active)
                if inputs.charging_curve.enabled:
                    elapsed = curve_elapsed.get(key)
                    if elapsed is None:
                        raise ValueError(f'Automatic charging curve state is missing for {bus.id} at {site.id}, period {t}.')
                    problem += elapsed >= dt*power_full
                else:
                    problem += power >= cap*power_full
    if logs is not None:
        logs.append('[Automatic charging] Locked locations use maximum available power with capped equal shares; new connections are prohibited.')
