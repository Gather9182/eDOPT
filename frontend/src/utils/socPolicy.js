export function socPolicyInputs(settings) {
  return {use_cyclic_soc:settings.use_cyclic_soc ?? false,
    operating_min_soc_mode:settings.operating_min_soc_mode ?? 'off',
    operating_min_soc_fraction:settings.operating_min_soc_fraction ?? .1,
    operating_max_soc_enabled:settings.operating_max_soc_enabled ?? false,
    operating_max_soc_mode:settings.operating_max_soc_mode ?? 'soft',
    operating_max_soc_fraction:settings.operating_max_soc_fraction ?? .9};
}

export function endConditionPatch(patch) {
  if (patch.use_cyclic_soc === true) return {...patch,use_next_day_readiness:false};
  if (patch.use_next_day_readiness === true) return {...patch,use_cyclic_soc:false};
  return patch;
}

export function endConditionIssues(settings, simulationMode) {
  if (!settings.use_cyclic_soc) return [];
  const messages = [];
  if (settings.use_next_day_readiness) messages.push('Start SoC = End SoC and Next-Day Readiness cannot both be enabled.');
  if (simulationMode !== 'single' || Number(settings.planning_horizon) !== 24) {
    messages.push('Start SoC = End SoC supports complete 24-hour Short-Term runs only. Disable it for multi-day or Long-Term simulations.');
  }
  return messages.map(message => ({type:'ERROR',code:'CYCLIC_SOC_CONFIGURATION',category:'vehicle',message}));
}

export function socPolicyIssues(settings) {
  const policy = socPolicyInputs(settings);
  const messages = [];
  if (![policy.operating_min_soc_fraction, policy.operating_max_soc_fraction].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    messages.push('Operating SoC limits must be between 0 and 100 percent.');
  }
  if (policy.operating_min_soc_mode !== 'off' && policy.operating_max_soc_enabled
      && policy.operating_min_soc_fraction > policy.operating_max_soc_fraction) {
    messages.push('Operating minimum SoC must not exceed the configured maximum SoC.');
  }
  return messages.map(message => ({type:'ERROR',code:'OPERATING_SOC_CONFIGURATION',category:'vehicle',message}));
}

export function mergeSocPolicies(policies) {
  if (!policies.length) return {};
  return {...policies[0], violations:policies.flatMap(policy => policy.violations || []),
    minimum_deviation_kwh_h:policies.reduce((sum, policy) => sum + (policy.minimum_deviation_kwh_h ?? 0), 0),
    scope:'Each chronological chunk minimises its own deviations before cost. This is not a full-horizon optimum.'};
}
