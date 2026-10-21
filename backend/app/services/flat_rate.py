"""Record a constant tariff and reprice the existing arrival baseline, without changing its schedule."""
import math


def flat_rate_results(inputs,baseline_load,total_cost,baseline_issues):
    result={}
    if inputs.price_mode=='flat_rate':
        result['price_assumption']=dict(mode='flat_rate',base_eur_kwh=inputs.flat_rate_base_eur_kwh,
            effective_eur_mwh=inputs.flat_rate_effective_eur_mwh,scope='Constant procurement price in every model period; configured fees and taxes included in effective price. All operational constraints retained.')
    rate=inputs.arrival_flat_rate_eur_mwh
    if rate is not None and inputs.price_mode!='flat_rate':
        comparable=not baseline_issues and baseline_load is not None and all(math.isfinite(float(value)) for value in baseline_load)
        cost=sum(float(value) for value in baseline_load)*inputs.time_step_minutes/60*rate/1000 if comparable else None
        result['flat_rate_comparison']=dict(enabled=True,comparable=comparable,base_eur_kwh=inputs.flat_rate_base_eur_kwh,
            effective_eur_mwh=rate,baseline_cost_eur=round(cost,6) if comparable else None,
            savings_eur=round(cost-float(total_cost),6) if comparable else None,
            reason='' if comparable else 'Charge-on-arrival does not provide a validated feasible reference.',
            scope='Additional tariff valuation of the existing charge-on-arrival schedule, without PV/BESS. Difference includes tariff, charging strategy and selected technologies; it is not an isolated smart-charging benefit.')
    return result
