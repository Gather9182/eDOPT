import unittest
from io import BytesIO

import pandas as pd

from app.models import OptimizationInputs, ChargingSite
from app.services.charging_sites import is_switch_blocked, validate_sites, simulate_site_baseline
from app.services.optimization import run_optimization
from app.services.solver import run_milp_solver, run_extended_milp_solver
from app.utils.excel_exporter import ExcelExporter
from app.utils.excel_processor import process_umlauf_excel, scan_umlauf_excel, to_minutes, clean_distance


def run_offline(coroutine):
    # These solver cases use supplied profiles and do not await network I/O.
    # Avoid the Windows asyncio loop's socketpair in network-restricted tests.
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    finally:
        coroutine.close()
    raise AssertionError('Offline test unexpectedly attempted asynchronous I/O')


def site(site_id='D', **kwargs):
    result = dict(id=site_id, nodes=[site_id+'_A', site_id+'_E'], num_chargers=1,
                  charger_power_kw=40, charger_capacity_kw=40, grid_limit_kw=40, lock_charging_mode='optimized')
    result.update(kwargs)
    return result


def bus(bus_id, site_id='D', n=4, **kwargs):
    result = dict(id=bus_id, availability=[1]*n, site_availability={site_id: [1]*n},
                  site_presence={site_id: [1]*n}, site_arrivals={site_id: [0]*n},
                  max_power_kw=40, max_battery_capacity_kwh=20, efficiency=1,
                  initial_soc_kwh=0, min_final_soc_kwh=20, trip_energy_profile_kwh=[0]*n)
    result.update(kwargs)
    return result


def inputs(buses, sites=None, **kwargs):
    result = dict(buses=buses, charging_sites=sites or [site()], electricity_prices=[100]*4,
                  planning_horizon_hours=1, time_step_minutes=15, charger_capacity_kw=1000,
                  grid_limit_kw=1000, cyclic_connections=False)
    result.update(kwargs)
    return OptimizationInputs(**result)


class PhysicalChargingTests(unittest.TestCase):
    def solve(self, data, extended=False):
        return run_offline(run_extended_milp_solver(data, []) if extended else run_milp_solver(data))

    def test_without_lock_two_buses_share_one_connector(self):
        result = self.solve(inputs([bus('a'), bus('b')]))
        self.assertAlmostEqual(sum(result.schedules['a'])/4, 20)
        self.assertAlmostEqual(sum(result.schedules['b'])/4, 20)
        self.assertTrue(all(v <= 1 for v in result.site_occupied_connectors['D']))

    def test_full_night_lock_cannot_swap_even_after_bus_is_full(self):
        data = inputs([bus('a'), bus('b')], [site(no_switch_windows=[dict(start='00:00', end='00:00')])])
        with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
            self.solve(data)
        with self.assertRaisesRegex(RuntimeError, 'No feasible charging schedule'):
            run_offline(run_optimization(data))

    def test_zero_power_vehicle_keeps_connector(self):
        data = inputs([bus('a', initial_connection_site='D')], [site(no_switch_windows=[dict(start='00:00', end='00:00')])])
        result = self.solve(data)
        self.assertEqual(result.connection_schedules['a'], ['D']*4)
        self.assertTrue(any(p == 0 for p in result.schedules['a']))

    def test_lock_ends_and_allows_replugging(self):
        data = inputs([bus('a'), bus('b')], [site(no_switch_windows=[dict(start='00:00', end='00:30')])])
        self.solve(data)

    def test_departure_releases_socket_and_arrival_can_connect(self):
        a = bus('a', availability=[1,1,0,0], site_availability={'D':[1,1,0,0]}, site_presence={'D':[1,1,0,0]}, initial_connection_site='D')
        b = bus('b', availability=[0,0,1,1], site_availability={'D':[0,0,1,1]}, site_presence={'D':[0,0,1,1]}, site_arrivals={'D':[0,0,1,0]})
        data = inputs([a,b], [site(no_switch_windows=[dict(start='00:00', end='00:00')])])
        result = self.solve(data)
        self.assertEqual(result.connection_schedules['a'], ['D','D','',''])
        self.assertEqual(result.connection_schedules['b'], ['','','D','D'])

    def test_arrival_cannot_displace_parked_bus(self):
        a = bus('a', initial_soc_kwh=20, initial_connection_site='D')
        b = bus('b', availability=[0,0,1,1], site_availability={'D':[0,0,1,1]}, site_presence={'D':[0,0,1,1]}, site_arrivals={'D':[0,0,1,0]})
        data = inputs([a,b], [site(no_switch_windows=[dict(start='00:00', end='00:00')])])
        with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
            self.solve(data)

    def test_legacy_arrival_ban_is_normalized_to_the_new_rule(self):
        data = inputs([bus('b', availability=[0,0,1,1], site_availability={'D':[0,0,1,1]}, site_presence={'D':[0,0,1,1]}, site_arrivals={'D':[0,0,1,0]})],
                      [site(no_switch_windows=[dict(start='00:00', end='00:00')], allow_connect_on_arrival=False)])
        self.assertTrue(data.charging_sites[0].allow_connect_on_arrival)
        result=self.solve(data)
        self.assertEqual(result.connection_schedules['b'],['','','D','D'])

    def test_separate_sites_have_separate_connectors_and_limits(self):
        data = inputs([bus('a','A'),bus('b','B')], [site('A'),site('B')])
        result = self.solve(data)
        self.assertEqual(set(result.site_load_profiles), {'A','B'})
        for profile in result.site_load_profiles.values():
            self.assertTrue(all(v <= 40.001 for v in profile))

    def test_location_limits_replace_legacy_limits_in_all_scenarios(self):
        from app.main import validate_inputs
        from app.services.solver import run_scenario_optimization
        for scenario in ('baseline', 'pv', 'bess', 'pv_bess'):
            with self.subTest(scenario=scenario):
                # Both locations must supply 20 kWh in one hour, despite zero
                # unused legacy capacity and zero legacy connector count.
                data = inputs([bus('a','A'), bus('b','B')], [site('A'), site('B')],
                              grid_limit_kw=0, charger_capacity_kw=0, num_chargers=0,
                              scenario=scenario, energy_site_id='A',
                              pv_config=dict(capacity_kw=1, profile_kwh=[0]*4))
                checked = run_offline(validate_inputs(data))
                self.assertEqual(checked['status'], 'valid', checked)
                result = run_offline(run_scenario_optimization(data, []))
                self.assertAlmostEqual(sum(result.grid_import_profile)/4, 40)
                self.assertTrue(result.baseline_feasible)
                for identifier in ('a', 'b'):
                    self.assertAlmostEqual(result.soc_profiles[identifier][-1], 20)
                for profile in result.site_grid_import_profiles.values():
                    self.assertTrue(all(v <= 40.001 for v in profile))

    def test_one_configured_site_also_replaces_legacy_limits(self):
        result = self.solve(inputs([bus('a')], grid_limit_kw=0, charger_capacity_kw=0))
        self.assertAlmostEqual(result.soc_profiles['a'][-1], 20)

    def test_local_pv_and_storage_do_not_depend_on_legacy_grid_limit(self):
        for scenario in ('pv', 'bess', 'pv_bess'):
            with self.subTest(scenario=scenario):
                data = inputs([bus('a','A'), bus('b','B')],
                              [{**site('A'), 'grid_limit_kw':0}, site('B')],
                              scenario=scenario, energy_site_id='A',
                              grid_limit_kw=0, charger_capacity_kw=0,
                              pv_config=dict(capacity_kw=40, profile_kwh=[40]*4),
                              bess_config=dict(capacity_kwh=20, initial_soc_kwh=20,
                                               min_soc_kwh=0, max_soc_kwh=20,
                                               max_charge_power_kw=40, max_discharge_power_kw=40, efficiency=1))
                result = self.solve(data, extended=True)
                self.assertTrue(all(abs(v) < .001 for v in result.site_grid_import_profiles['A']))
                self.assertAlmostEqual(sum(result.site_grid_import_profiles['B'])/4, 20)
                for identifier in ('a', 'b'):
                    self.assertAlmostEqual(result.soc_profiles[identifier][-1], 20)

    def test_local_grid_and_charger_limits_remain_independent(self):
        for extended in (False, True):
            for limited_field in ('grid_limit_kw', 'charger_capacity_kw'):
                with self.subTest(extended=extended, limited_field=limited_field):
                    # A has spare capacity, but cannot supply B's independent connection.
                    sites = [site('A'), {**site('B'), limited_field: 10}]
                    data = inputs([bus('a','A'), bus('b','B')], sites,
                                  scenario='pv' if extended else 'baseline', energy_site_id='A',
                                  pv_config=dict(capacity_kw=0, profile_kwh=[0]*4))
                    with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
                        self.solve(data, extended=extended)

    def test_legacy_depot_still_enforces_grid_and_charger_limits(self):
        for extended in (False, True):
            for limited_field in ('grid_limit_kw', 'charger_capacity_kw'):
                with self.subTest(extended=extended, limited_field=limited_field):
                    data = inputs([bus('a')], charging_sites=[], **{limited_field: 10},
                                  pv_config=dict(capacity_kw=0, profile_kwh=[0]*4))
                    with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
                        self.solve(data, extended=extended)

    def test_pv_cannot_supply_a_different_site(self):
        data = inputs([bus('a','B')], [site('A'),{**site('B'), 'grid_limit_kw':0}],
                      scenario='pv', energy_site_id='A', pv_config=dict(capacity_kw=100,profile_kwh=[100]*4))
        with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
            self.solve(data, extended=True)

    def test_extended_solver_obeys_connection_lock(self):
        data = inputs([bus('a'),bus('b')], [site(no_switch_windows=[dict(start='00:00',end='00:00')])], scenario='pv', energy_site_id='D', pv_config=dict(capacity_kw=0))
        with self.assertRaisesRegex(RuntimeError, 'Infeasible'):
            self.solve(data, extended=True)

    def test_extended_solver_returns_site_flows(self):
        data = inputs([bus('a')], scenario='pv', energy_site_id='D', pv_config=dict(capacity_kw=40,profile_kwh=[40]*4))
        result = self.solve(data, extended=True)
        self.assertAlmostEqual(sum(result.site_grid_import_profiles['D']), 0)
        self.assertAlmostEqual(sum(result.site_load_profiles['D'])/4, 20)

    def test_pv_scenario_can_work_even_when_grid_only_is_infeasible(self):
        data=inputs([bus('a')],[{**site(), 'grid_limit_kw':0}],scenario='pv',energy_site_id='D',pv_config=dict(capacity_kw=40,profile_kwh=[40]*4))
        result=run_offline(run_optimization(data))
        self.assertIsNone(result.basic_optimized_cost_eur)
        self.assertAlmostEqual(result.soc_profiles['a'][-1],20)
        self.assertFalse(result.baseline_feasible)

    def test_node_changes_require_new_import(self):
        data = inputs([bus('a',site_nodes={'D':['old']})])
        with self.assertRaisesRegex(ValueError, 'nodes changed'):
            validate_sites(data)

    def test_incomplete_profiles_report_validation_error(self):
        data=inputs([bus('a',availability=[1])])
        with self.assertRaisesRegex(ValueError,'lengths must match'):
            validate_sites(data)

    def test_baseline_does_not_release_full_parked_bus(self):
        data = inputs([bus('a'),bus('b')], [site(no_switch_windows=[dict(start='00:00',end='00:00')])])
        load, issues = simulate_site_baseline(data)
        self.assertAlmostEqual(sum(load)/4, 20)
        self.assertTrue(issues)

    def test_cross_midnight_window(self):
        config = ChargingSite(**site(no_switch_windows=[dict(start='22:00',end='05:00')]))
        for minute in [1320,1439,1440,1740-1]:
            self.assertTrue(is_switch_blocked(config, minute))
        self.assertFalse(is_switch_blocked(config, 300))
        self.assertFalse(is_switch_blocked(config, 1319))

    def test_repeating_day_cannot_swap_at_midnight(self):
        profile=[1,1]+[0]*92+[1,1]
        arrivals=[0]*94+[1,0]
        buses=[bus(name,n=96,availability=profile,site_availability={'D':profile},site_presence={'D':profile},site_arrivals={'D':arrivals},trip_energy_profile_kwh=[0]*96) for name in ['a','b']]
        data=inputs(buses,[site(no_switch_windows=[dict(start='22:00',end='05:00')])],electricity_prices=[100]*96,planning_horizon_hours=24,cyclic_connections=True)
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            self.solve(data)
        data.cyclic_connections=False
        self.solve(data)

    def test_lock_boundary_inside_slot_is_conservative(self):
        data=inputs([bus('a',initial_connection_site='')],[site(no_switch_windows=[dict(start='22:07',end='05:00')])],horizon_start_minute=22*60)
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            self.solve(data)

    def test_export_preserves_connections_and_site_configuration(self):
        data=inputs([bus('a',initial_connection_site='D')],[site(lock_charging_mode='automatic_balanced',no_switch_windows=[dict(start='00:00',end='00:00')])])
        result=self.solve(data).model_dump()
        result['run_metadata']={'inputs':data.model_dump()}
        stream=ExcelExporter.generate_excel(result)
        sheets=pd.ExcelFile(stream)
        self.assertIn('Charging Locations',sheets.sheet_names)
        self.assertIn('Location Settings',sheets.sheet_names)
        self.assertIn('Bus Connections',sheets.sheet_names)
        occupancy=sheets.parse('Charging Locations',header=2)
        self.assertEqual(occupancy['Occupied connectors'].tolist(),[1]*4)
        self.assertTrue(sheets.parse('Location Settings',header=2)['Connect on arrival'].iloc[0])


def workbook(rows, sheet='Mo-Do Schule'):
    defaults = dict(Umlauf='U', Betriebstage='Alle Mo-Fr', Planungsbedingung='OSchule',
                    Typ='L', von='D_E', nach='D_A', Startzeit='08:00', Endzeit='09:00', Meter=0, Fahrzeugtyp='EV')
    frame = pd.DataFrame([{**defaults, **r} for r in rows])
    stream = BytesIO()
    frame.to_excel(stream, sheet_name=sheet, index=False)
    return stream.getvalue()


class ImportTests(unittest.TestCase):
    def test_validation_messages_are_english_and_have_categories(self):
        from app.main import validate_inputs
        data = inputs([bus('R1', min_final_soc_kwh=30),
                       bus('R2', availability=[0]*4, site_availability={'D':[0]*4})], use_next_day_readiness=False)
        result = run_offline(validate_inputs(data))
        energy = next(issue for issue in result['issues'] if issue.get('code') == 'BUS_FINAL_TARGET_EXCEEDS_CAPACITY')
        charging = next(issue for issue in result['issues'] if issue.get('code') == 'NO_CHARGING_AVAILABILITY')
        self.assertEqual(energy['category'], 'energy')
        self.assertEqual(charging['category'], 'charging')
        self.assertIn('battery can hold only 20.0 kWh', energy['message'])
        self.assertEqual(energy['details']['required_energy_kwh'], 30)
        for issue in result['issues']:
            self.assertIn('code', issue)
            self.assertIn('category', issue)
            self.assertNotRegex(issue['message'], r'Umlauf|Batteriekapazität|Folgetagsbedarf|fehlen|prüfen')

    def test_validation_diagnostics_include_normalized_defaults_all_profiles_and_all_issues(self):
        from app.main import validate_inputs
        data = inputs([bus('unavailable', availability=[0]*4, site_availability={'D':[0]*4})],electricity_prices=[100])
        normal = run_offline(validate_inputs(data))
        detailed = run_offline(validate_inputs(data, include_diagnostics=True))
        self.assertEqual(detailed['status'], 'invalid')
        self.assertEqual(detailed['issues'], normal['issues'])
        self.assertNotIn('diagnostics', normal)
        effective = detailed['diagnostics']['effective_inputs']
        self.assertEqual(effective['num_chargers'], data.num_chargers)
        self.assertEqual(effective['buses'][0]['site_availability']['D'], [0]*4)
        self.assertEqual(effective['charging_sites'][0]['num_chargers'], 1)
        self.assertIn('pydantic', detailed['diagnostics']['packages'])
        self.assertTrue(detailed['diagnostics']['checked_at'])

    def test_empty_and_distance_only_footer_rows_are_reported_without_hiding_bad_trips(self):
        row = dict(Umlauf='U', Betriebstage='Alle Mo-Fr', Planungsbedingung='OSchule', Typ='L',
                   von='X', nach='Y', Startzeit='08:00', Endzeit='09:00', Meter=1000, Fahrzeugtyp='EV')
        stream = BytesIO()
        pd.DataFrame([row, {}, dict(Meter=1000)]).to_excel(stream, sheet_name='Mo-Do Schule', index=False)
        content = stream.getvalue()
        self.assertEqual(scan_umlauf_excel(content)['ignored_non_trip_rows'], [3, 4])
        result = process_umlauf_excel(content, dict(BETRIEBSTAGE=[]))
        self.assertEqual(result['import_summary']['source_rows'], 3)
        self.assertEqual(result['import_summary']['imported_rows'], 1)
        self.assertEqual(result['import_summary']['ignored_non_trip_rows'], [3, 4])
        stream = BytesIO()
        pd.DataFrame([row, {}, {**row, 'Umlauf': None}]).to_excel(stream, sheet_name='Mo-Do Schule', index=False)
        with self.assertRaisesRegex(ValueError, r'Excel rows \[4\]'):
            process_umlauf_excel(stream.getvalue(), dict(BETRIEBSTAGE=[]))

    def test_vehicle_groups_are_scanned_separately_and_drive_specs_when_enabled(self):
        content = workbook([dict(Fahrzeugtyp='RB12', Fahrzeugtypgruppe='GB', Meter=100),
                            dict(Umlauf='V', Fahrzeugtyp='RB12', Fahrzeugtypgruppe='LB', Meter=200)])
        scan = scan_umlauf_excel(content)
        self.assertEqual(scan['vehicle_type_groups'], ['GB', 'LB'])
        self.assertEqual(scan['umlaeufe'][0]['vehicle_type_groups'], ['GB'])
        settings = dict(BETRIEBSTAGE=[], VEHICLE_TYPE_SPECS={
            'RB12': dict(consumption_wh_per_m=1, battery_capacity_kwh=200),
            'GB': dict(consumption_wh_per_m=2, battery_capacity_kwh=400),
            'LB': dict(consumption_wh_per_m=3, battery_capacity_kwh=500)})
        normal = process_umlauf_excel(content, settings)
        self.assertEqual([b['vehicle_type'] for b in normal['bus_inputs']], ['RB12', 'RB12'])
        grouped = process_umlauf_excel(content, {**settings, 'USE_VEHICLE_TYPE_GROUP': True})
        self.assertEqual([b['vehicle_type'] for b in grouped['bus_inputs']], ['GB', 'LB'])
        self.assertEqual([b['max_battery_capacity_kwh'] for b in grouped['bus_inputs']], [400, 500])
        self.assertAlmostEqual(grouped['bus_inputs'][0]['energy_demand_kwh'], .2)
        self.assertAlmostEqual(grouped['bus_inputs'][1]['energy_demand_kwh'], .6)

    def test_vehicle_groups_combine_with_first_part_and_manual_override(self):
        content = workbook([dict(Fahrzeugtyp='RB12', Fahrzeugtypgruppe=' GB / LB ', Meter=100),
                            dict(Umlauf='V', Fahrzeugtypgruppe='GB/LB', Meter=100)])
        settings = dict(BETRIEBSTAGE=[], USE_VEHICLE_TYPE_GROUP=True, USE_FIRST_VEHICLE_TYPE=True,
                        UMLAUF_VEHICLE_TYPES={'V': 'Manual/Type'}, VEHICLE_TYPE_SPECS={
                            'GB': dict(consumption_wh_per_m=2, battery_capacity_kwh=400),
                            'Manual/Type': dict(consumption_wh_per_m=3, battery_capacity_kwh=500)})
        result = process_umlauf_excel(content, settings)
        self.assertEqual([b['vehicle_type'] for b in result['bus_inputs']], ['GB', 'Manual/Type'])
        self.assertAlmostEqual(result['bus_inputs'][1]['energy_demand_kwh'], .3)

    def test_missing_vehicle_group_requires_explicit_resolution(self):
        content = workbook([dict(Meter=100)])
        self.assertEqual(scan_umlauf_excel(content)['vehicle_type_groups'], [])
        with self.assertRaisesRegex(ValueError, 'Vehicle type group is missing.*2'):
            process_umlauf_excel(content, dict(BETRIEBSTAGE=[], USE_VEHICLE_TYPE_GROUP=True))
        result = process_umlauf_excel(content, dict(BETRIEBSTAGE=[], USE_VEHICLE_TYPE_GROUP=True,
                                                   UMLAUF_VEHICLE_TYPES={'U': 'Manual'}))
        self.assertEqual(result['bus_inputs'][0]['vehicle_type'], 'Manual')

    def test_validation_identifies_only_routes_without_charging_for_exclusion(self):
        from app.main import validate_inputs
        unavailable = bus('Bus: unavailable', availability=[0]*4, site_availability={'D':[0]*4})
        data = inputs([unavailable, bus('available')])
        validation = run_offline(validate_inputs(data))
        flagged = [issue for issue in validation['issues'] if issue.get('code') == 'NO_CHARGING_AVAILABILITY']
        self.assertEqual([issue['bus_id'] for issue in flagged], ['Bus: unavailable'])
        self.assertEqual(validation['status'], 'warning')
        remaining = inputs([bus('available')],electricity_prices=[100])
        validation = run_offline(validate_inputs(remaining))
        self.assertEqual(validation['status'], 'invalid')
        self.assertTrue(any('Electricity price' in issue['message'] for issue in validation['issues']))
        self.assertFalse(any(issue.get('code') == 'NO_CHARGING_AVAILABILITY' for issue in validation['issues']))

    def test_next_day_parser(self):
        self.assertEqual(to_minutes('00:14[+1]'),1454)
        self.assertEqual(to_minutes('25:10'),1510)

    def test_explicit_distance_rules(self):
        self.assertEqual(clean_distance(21,'mixed'),21000)
        self.assertEqual(clean_distance(613,'mixed'),613)
        self.assertEqual(clean_distance(94,'mixed'),94)
        self.assertEqual(clean_distance(86.16,'mixed'),86160)
        self.assertEqual(clean_distance('1,5 km','m'),1500)
        self.assertEqual(clean_distance(21),21)

    def test_sheet_scan_and_all_day_labels(self):
        content=workbook([{},dict(Umlauf='V',Betriebstage='Mo-Do')])
        scan=scan_umlauf_excel(content)
        self.assertEqual(scan['suggested_operating_days'],[])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[]))
        self.assertEqual(result['import_summary']['imported_rows'],2)
        self.assertEqual(len(result['bus_inputs']),2)

    def test_opportunity_stop_without_A_E_markers_and_no_driving_charge(self):
        content=workbook([dict(von='D_E',nach='STOP',Startzeit='08:00',Endzeit='09:02',Meter=10),dict(von='STOP',nach='D_A',Startzeit='10:00',Endzeit='11:00',Meter=10,Typ='B')])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],CHARGING_SITES=[dict(id='S',nodes=['STOP'])]))
        availability=result['bus_inputs'][0]['availability']
        self.assertEqual(availability[36],0) # 09:00 is a partial driving slot
        self.assertEqual(availability[37:40],[1,1,1])
        self.assertEqual(availability[40:44],[0,0,0,0]) # B is driving

    def test_overnight_arrival_is_not_available_from_midnight(self):
        content=workbook([dict(Typ='E',Startzeit='05:00',Endzeit='06:00',von='D_E',nach='X',Meter=10),dict(Typ='A',Startzeit='23:00',Endzeit='00:19[+1]',von='X',nach='D_A',Meter=10)])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],CHARGING_SITES=[dict(id='D',nodes=['D_E','D_A'])]))
        self.assertEqual(result['bus_inputs'][0]['availability'][:3],[0,0,1])
        self.assertEqual(len(result['cleaned_trips']),2)

    def test_invalid_time_fails_instead_of_dropping_rows(self):
        with self.assertRaisesRegex(ValueError,'No rows were silently removed'):
            process_umlauf_excel(workbook([dict(Startzeit='bad')]),dict(BETRIEBSTAGE=[]))

    def test_vehicle_override_applies_to_all_trip_energy(self):
        content=workbook([dict(Fahrzeugtyp='A',Meter=100),dict(Fahrzeugtyp='B',Meter=100,Startzeit='10:00',Endzeit='11:00')])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],UMLAUF_VEHICLE_TYPES={'U':'EV'},VEHICLE_TYPE_SPECS={'EV':dict(consumption_wh_per_m=2,battery_capacity_kwh=300)}))
        self.assertEqual(result['bus_inputs'][0]['energy_demand_kwh'],.4)
        self.assertEqual(result['bus_inputs'][0]['max_battery_capacity_kwh'],300)

    def test_first_vehicle_type_resolves_slash_alternatives_per_source_entry(self):
        content=workbook([dict(Fahrzeugtyp='Z/EV',Meter=100),dict(Fahrzeugtyp='A',Meter=100,Startzeit='10:00',Endzeit='11:00'),dict(Fahrzeugtyp='A',Meter=100,Startzeit='12:00',Endzeit='13:00')])
        settings=dict(BETRIEBSTAGE=[],VEHICLE_TYPE_SPECS={'Z/EV':dict(consumption_wh_per_m=3,battery_capacity_kwh=400),'Z':dict(consumption_wh_per_m=2,battery_capacity_kwh=300),'A':dict(consumption_wh_per_m=1,battery_capacity_kwh=200)})
        self.assertEqual(scan_umlauf_excel(content)['umlaeufe'][0]['vehicle_types'],['Z/EV','A'])
        unchanged=process_umlauf_excel(content,settings)
        self.assertEqual(unchanged['bus_inputs'][0]['vehicle_type'],'A')
        self.assertAlmostEqual(unchanged['bus_inputs'][0]['energy_demand_kwh'],.5)
        result=process_umlauf_excel(content,{**settings,'USE_FIRST_VEHICLE_TYPE':True})
        self.assertEqual(result['bus_inputs'][0]['vehicle_type'],'A')
        self.assertAlmostEqual(result['bus_inputs'][0]['energy_demand_kwh'],.4)
        self.assertEqual([row['vehicle_type'] for row in result['cleaned_trips']],['Z','A','A'])
        manual=process_umlauf_excel(content,{**settings,'USE_FIRST_VEHICLE_TYPE':True,'UMLAUF_VEHICLE_TYPES':{'U':'Z/EV'}})
        self.assertEqual(manual['bus_inputs'][0]['vehicle_type'],'Z/EV')
        self.assertAlmostEqual(manual['bus_inputs'][0]['energy_demand_kwh'],.9)

    def test_first_vehicle_type_updates_battery_and_leaves_plain_labels_unchanged(self):
        content=workbook([dict(Fahrzeugtyp=' NGB /RB12/LB12',Meter=100),dict(Umlauf='V',Fahrzeugtyp='Other')])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],USE_FIRST_VEHICLE_TYPE=True,VEHICLE_TYPE_SPECS={'NGB':dict(consumption_wh_per_m=2,battery_capacity_kwh=300)}))
        self.assertEqual({b['id']:b['vehicle_type'] for b in result['bus_inputs']},{'U':'NGB','V':'Other'})
        self.assertEqual(result['bus_inputs'][0]['max_battery_capacity_kwh'],300)
        self.assertAlmostEqual(result['bus_inputs'][0]['energy_demand_kwh'],.2)

    def test_rounding_changes_charging_but_not_actual_arrival(self):
        content=workbook([dict(von='X',nach='STOP',Startzeit='08:00',Endzeit='09:02',Meter=10),dict(von='STOP',nach='X',Startzeit='10:00',Endzeit='11:00',Meter=10)])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],ROUND_TO_30=True,CHARGING_SITES=[dict(id='S',nodes=['STOP'])]))
        b=result['bus_inputs'][0]
        self.assertEqual(b['site_arrivals']['S'][36],1)
        self.assertEqual(b['site_presence']['S'][36],1)
        self.assertEqual(b['availability'][36:40],[0,0,1,1])

    def test_numeric_umlauf_identifier_with_sites(self):
        content=workbook([dict(Umlauf=1,Typ='E',Startzeit='05:00',Endzeit='06:00',von='D_E',nach='X'),dict(Umlauf=1,Typ='A',Startzeit='18:00',Endzeit='19:00',von='X',nach='D_A')])
        result=process_umlauf_excel(content,dict(BETRIEBSTAGE=[],CHARGING_SITES=[dict(id='D',nodes=['D_E','D_A'])]))
        self.assertEqual(result['availability_matrix']['index'],['1'])
        self.assertEqual(len(result['availability_matrix']['data']),1)

    def test_api_import_serializes_all_source_rows(self):
        from fastapi import UploadFile
        from fastapi.encoders import jsonable_encoder
        from tempfile import SpooledTemporaryFile
        from app.main import handle_excel_upload,handle_excel_pre_scan
        content=workbook([{},dict(Umlauf='V',Betriebstage='Mo-Do')])
        with SpooledTemporaryFile() as source:
            source.write(content)
            source.seek(0)
            uploaded=UploadFile(source,filename='input.xlsx')
            scan=run_offline(handle_excel_pre_scan(uploaded,sheet_name=None))
            self.assertEqual(scan['selected_sheet'],'Mo-Do Schule')
            source.seek(0)
            result=run_offline(handle_excel_upload(uploaded,round_to_30=False,settings='{"BETRIEBSTAGE":[]}'))
        self.assertEqual(jsonable_encoder(result)['import_summary']['imported_rows'],2)


if __name__ == '__main__':
    unittest.main()
