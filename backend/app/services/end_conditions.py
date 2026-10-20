"""Bus end conditions shared by all solver and reference paths, never BESS."""

CYCLIC_SOC_TOLERANCE_KWH = .001


def end_target(inputs, bus):
    if inputs.use_cyclic_soc:
        return bus.initial_soc_kwh
    return bus.min_final_soc_kwh + (bus.next_day_required_energy_kwh if inputs.use_next_day_readiness else 0)


def add_end_condition(problem, inputs, bus, final_state, bus_index):
    if inputs.use_cyclic_soc:
        problem += final_state == bus.initial_soc_kwh, f'cyclic_soc_b{bus_index}'
        # The independent end reserve must still hold; never reinterpret it.
        problem += final_state >= bus.min_final_soc_kwh, f'final_soc_b{bus_index}'
    else:
        problem += final_state >= end_target(inputs, bus), f'final_soc_b{bus_index}'


def reference_end_issues(inputs, bus, final_energy):
    if inputs.use_cyclic_soc and abs(final_energy - bus.initial_soc_kwh) > CYCLIC_SOC_TOLERANCE_KWH:
        return [f'Bus {bus.id}: arrival reference does not satisfy Start SoC = End SoC '
                f'({bus.initial_soc_kwh:.3f} -> {final_energy:.3f} kWh).']
    if final_energy < max(bus.min_final_soc_kwh, end_target(inputs, bus)) - CYCLIC_SOC_TOLERANCE_KWH:
        return [f'Bus {bus.id}: arrival reference does not reach the final energy target.']
    return []


def end_condition_results(inputs, profiles):
    rows = []
    for bus in inputs.buses:
        final = profiles[bus.id][-1]
        delta = final - bus.initial_soc_kwh
        compliant = (abs(delta) <= CYCLIC_SOC_TOLERANCE_KWH if inputs.use_cyclic_soc
                     else final >= end_target(inputs, bus) - CYCLIC_SOC_TOLERANCE_KWH)
        rows.append(dict(bus_id=bus.id, initial_soc_kwh=bus.initial_soc_kwh, final_soc_kwh=final,
            difference_kwh=round(delta, 6), target_soc_kwh=end_target(inputs, bus),
            min_final_soc_kwh=bus.min_final_soc_kwh,
            compliant=compliant and final >= bus.min_final_soc_kwh - CYCLIC_SOC_TOLERANCE_KWH))
    return dict(mode='cyclic_soc' if inputs.use_cyclic_soc else 'next_day_readiness' if inputs.use_next_day_readiness else 'end_reserve',
        cyclic_soc_enabled=inputs.use_cyclic_soc, next_day_readiness_enabled=inputs.use_next_day_readiness,
        tolerance_kwh=CYCLIC_SOC_TOLERANCE_KWH, buses=rows,
        scope='Bus battery energy only. Cyclic mode assumes the same complete 24-hour timetable repeats; connection boundaries also apply. No cyclic BESS energy constraint is added.')
