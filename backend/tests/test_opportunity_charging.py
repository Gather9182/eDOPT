import unittest
from io import BytesIO

import pandas as pd

from app.services.solver import run_milp_solver, run_extended_milp_solver
from app.services.feasibility import energy_feasibility_issues
from app.utils.excel_processor import process_umlauf_excel, scan_umlauf_excel
from test_charging import bus, site, inputs, run_offline


def visit(**changes):
    return dict(id='V',gap_id='pause',site_id='D',from_node='STOP',to_node='STOP',
                pause_start_min=0,pause_end_min=90,outbound_minutes=15,return_minutes=15,
                outbound_km=2,return_km=2,outbound_energy_kwh=2,return_energy_kwh=2,
                min_charge_minutes=30,**changes)


def visiting_bus(name='a', options=None, **changes):
    values = dict(availability=[0]*8,site_availability={'D':[0]*8},site_presence={'D':[0]*8},
                  site_arrivals={'D':[0]*8},initial_soc_kwh=10,min_final_soc_kwh=0,
                  trip_energy_profile_kwh=[0]*6+[15,0],opportunity_visits=options or [visit()])
    values.update(changes)
    return bus(name,n=8,**values)


def data(buses,sites=None,**changes):
    return inputs(buses,sites,electricity_prices=[100]*8,planning_horizon_hours=2,**changes)


class OptionalVisitTests(unittest.TestCase):
    def test_chosen_round_trip_preserves_schedule_and_energy_balance(self):
        source = data([visiting_bus()])
        self.assertEqual(energy_feasibility_issues(source),[])
        result = run_offline(run_milp_solver(source))
        chosen = result.opportunity_charging_visits[0]
        self.assertLessEqual(chosen['return_arrival_min'],90)
        self.assertGreaterEqual(chosen['charger_arrival_min']-chosen['departure_min'],15)
        self.assertGreaterEqual(chosen['return_arrival_min']-chosen['return_departure_min'],15)
        self.assertEqual(sum(result.additional_trip_energy_profiles['a']),4)
        self.assertEqual(result.bus_diagnostics[0].total_trip_energy_kwh,19)
        self.assertAlmostEqual(10+sum(result.schedules['a'])/4-19,result.soc_profiles['a'][-1],places=3)
        for t,power in enumerate(result.schedules['a']):
            if power > .001:
                self.assertGreaterEqual(t*15,chosen['charger_arrival_min'])
                self.assertLess(t*15,chosen['return_departure_min'])
        self.assertGreaterEqual(sum(p >= .999 for p in result.schedules['a']),2)

    def test_unused_visit_causes_no_extra_consumption(self):
        result = run_offline(run_milp_solver(data([visiting_bus(trip_energy_profile_kwh=[0]*8)])))
        self.assertEqual(result.opportunity_charging_visits,[])
        self.assertEqual(result.additional_trip_energy_profiles,{})

    def test_must_have_energy_to_reach_charger(self):
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus(initial_soc_kwh=1)])))

    def test_short_pause_and_rounded_grid_cannot_create_fake_charging(self):
        short = {**visit(),'pause_end_min':59}
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus(options=[short])])) )

    def test_competing_buses_share_existing_site_connectors(self):
        only = {**visit(),'pause_end_min':60}
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus('a',[only]),visiting_bus('b',[only])],[site()])))

    def test_switch_lock_does_not_allow_optional_departure_to_bypass_unplugging(self):
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus()],[site(no_switch_windows=[dict(start='00:00',end='02:00')])])))

    def test_arrival_during_lock_can_wait_until_return_is_allowed(self):
        source=data([visiting_bus()],[site(no_switch_windows=[dict(start='00:00',end='00:45')])])
        result=run_offline(run_milp_solver(source))
        self.assertGreaterEqual(result.opportunity_charging_visits[0]['return_departure_min'],45)

    def test_transfer_time_windows_are_enforced(self):
        restricted={**visit(),'allowed_windows':[dict(start='01:30',end='02:00')]}
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus(options=[restricted])])) )

    def test_extended_solver_also_accounts_for_optional_travel(self):
        result=run_offline(run_extended_milp_solver(data([visiting_bus()],scenario='pv',energy_site_id='D',pv_config=dict(capacity_kw=0,profile_kwh=[0]*8)),[]))
        self.assertEqual(sum(result.additional_trip_energy_profiles['a']),4)
        self.assertEqual(result.bus_diagnostics[0].total_trip_energy_kwh,19)

    def test_original_depot_is_not_occupied_while_bus_is_away(self):
        b=visiting_bus(site_availability={'D':[0]*8,'HOME':[1]*8},site_presence={'D':[0]*8,'HOME':[1]*8},site_arrivals={'D':[0]*8,'HOME':[0]*8},availability=[1]*8,
                       options=[{**visit(),'origin_site_id':'HOME','return_site_id':'HOME'}])
        source=data([b],[site(),{**site('HOME'),'charger_power_kw':0}])
        result=run_offline(run_milp_solver(source))
        chosen=result.opportunity_charging_visits[0]
        for t,connection in enumerate(result.connection_schedules['a']):
            if chosen['departure_min'] <= t*15 < chosen['return_arrival_min']:
                self.assertNotEqual(connection,'HOME')

    def test_minimum_net_energy_gain_and_one_destination_per_pause(self):
        demanding={**visit(),'min_net_energy_kwh':100}
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus(options=[demanding])])) )
        alternative={**visit(),'id':'alternative'}
        result=run_offline(run_milp_solver(data([visiting_bus(options=[visit(),alternative])])) )
        self.assertEqual(len(result.opportunity_charging_visits),1)

    def test_grid_and_repeated_horizon_keep_each_selected_trip_once(self):
        source=data([visiting_bus()])
        b=source.buses[0]
        b.opportunity_period_minutes=120
        b.availability*=2;b.site_availability['D']*=2;b.site_presence['D']*=2;b.site_arrivals['D']*=2;b.trip_energy_profile_kwh*=2
        source.electricity_prices*=2;source.planning_horizon_hours=4
        result=run_offline(run_milp_solver(source))
        self.assertEqual(len(result.opportunity_charging_visits),2)
        self.assertEqual(sum(result.additional_trip_energy_profiles['a']),8)

    def test_scheduled_driving_interval_cannot_be_repurposed_for_charging(self):
        b=visiting_bus(trips=[dict(start_min=30,end_min=45,dist_m=1000,von='STOP',nach='OTHER')])
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([b])))

    def test_partial_boundary_slots_do_not_count_towards_minimum_charging(self):
        bounded={**visit(),'pause_start_min':5,'pause_end_min':65}
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(data([visiting_bus(options=[bounded])])) )

    def test_arrival_permission_is_respected_for_optional_visits(self):
        long_charge={**visit(),'min_charge_minutes':60}
        allowed=data([visiting_bus(options=[long_charge])],[site(no_switch_windows=[dict(start='00:00',end='00:45')])])
        run_offline(run_milp_solver(allowed))
        allowed.charging_sites[0].allow_connect_on_arrival=False
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(allowed))

    def test_opportunity_visits_are_exported_with_travel_details(self):
        from app.utils.excel_exporter import ExcelExporter
        result=run_offline(run_milp_solver(data([visiting_bus()])))
        output=ExcelExporter.generate_excel(result.model_dump())
        sheet=pd.read_excel(output,sheet_name='Optional Charging Trips',header=2)
        self.assertEqual(sheet.iloc[0]['travel_energy_kwh'],4)
        self.assertEqual(sheet.iloc[0]['distance_km'],4)

    def test_cyclic_overnight_visit_counts_travel_once_and_charges_at_actual_location(self):
        n=96
        profile=[0]*n;profile[24]=15
        overnight={**visit(),'pause_start_min':1380,'pause_end_min':1530}
        b=bus('night',n=n,availability=[0]*n,site_availability={'D':[0]*n},site_presence={'D':[0]*n},site_arrivals={'D':[0]*n},
              initial_soc_kwh=10,min_final_soc_kwh=0,trip_energy_profile_kwh=profile,opportunity_visits=[overnight])
        source=inputs([b],electricity_prices=[100]*n,planning_horizon_hours=24,cyclic_connections=True)
        result=run_offline(run_milp_solver(source))
        self.assertEqual(len(result.opportunity_charging_visits),1)
        self.assertEqual(sum(result.additional_trip_energy_profiles['night']),4)
        self.assertTrue(any(p > 0 for p in result.schedules['night'][:24]))
        source.cyclic_connections=False
        with self.assertRaisesRegex(RuntimeError,'Infeasible'):
            run_offline(run_milp_solver(source))


def mapped_workbook(mapping_rows=None, mapping_columns=None):
    defaults=dict(Umlauf='U',Betriebstage='Mo-Do',Planungsbedingung='',Typ='L',Meter=1000,Fahrzeugtyp='EV')
    rows=[{**defaults,'von':'X','nach':'STOP','Startzeit':'08:00','Endzeit':'09:00','von (Beschreibung)':'X','nach (Beschreibung)':'Pause'},
          {**defaults,'von':'STOP','nach':'X','Startzeit':'11:00','Endzeit':'12:00','von (Beschreibung)':'Pause','nach (Beschreibung)':'X'}]
    stream=BytesIO()
    with pd.ExcelWriter(stream) as writer:
        pd.DataFrame(rows).to_excel(writer,sheet_name='Mo-Do Schule',index=False)
        pd.DataFrame(mapping_rows if mapping_rows is not None else [['Pause','Target','15 min','10 min']],
                     columns=mapping_columns or ['Haltestelle','Ladestandort','Hinweg','Rückweg']).to_excel(writer,sheet_name='Mapping Lademöglichkeiten',index=False)
    return stream.getvalue()


class MappingImportTests(unittest.TestCase):
    def test_disabled_mapping_import_has_no_optional_visits(self):
        content = mapped_workbook([['STOP', 'Pause', 'Target', 15, 4]],
            ['Haltestellen Code', 'Haltestelle', 'Ladestandort', 'Hinweg/Rückweg [min]', 'einfache Strecke [km]'])
        mapping = scan_umlauf_excel(content)['charging_mappings'][0]
        mapping['site_id'] = 'D'
        settings = dict(BETRIEBSTAGE=[], CHARGING_SITES=[site()],
            OPPORTUNITY_CHARGING=dict(enabled=True, mappings=[mapping]))
        enabled = process_umlauf_excel(content, settings)['bus_inputs'][0]
        self.assertTrue(enabled.get('opportunity_visits'))
        settings['OPPORTUNITY_CHARGING']['enabled'] = False
        disabled = process_umlauf_excel(content, settings)['bus_inputs'][0]
        self.assertFalse(disabled.get('opportunity_visits'))
        self.assertEqual(enabled['site_availability'], disabled['site_availability'])
        self.assertEqual(enabled['trip_energy_profile_kwh'], disabled['trip_energy_profile_kwh'])

    def test_code_mapping_with_shared_per_direction_time_and_distance(self):
        content = mapped_workbook([['STOP', 'Renamed stop', 'Target', 15, '10,5']],
                                  ['Haltestellen Code', 'Haltestelle', 'Ladestandort', 'Hinweg/Rückweg [min]', 'einfache Strecke [km]'])
        mapping = scan_umlauf_excel(content)['charging_mappings'][0]
        self.assertEqual(mapping['nodes'], ['STOP'])
        self.assertEqual(mapping['source_node_code'], 'STOP')
        self.assertEqual(mapping['outbound_minutes'], 15)
        self.assertEqual(mapping['return_minutes'], 15)
        self.assertEqual(mapping['outbound_km'], 10.5)
        self.assertEqual(mapping['return_km'], 10.5)
        mapping['site_id'] = 'D'
        result = process_umlauf_excel(content, dict(BETRIEBSTAGE=[], CHARGING_SITES=[site()],
            DEFAULT_CONSUMPTION_WH_PER_M=1.5, OPPORTUNITY_CHARGING=dict(enabled=True, mappings=[mapping])))
        visit = result['bus_inputs'][0]['opportunity_visits'][0]
        self.assertEqual(visit['outbound_energy_kwh'] + visit['return_energy_kwh'], 31.5)
        self.assertEqual(visit['outbound_minutes'] + visit['return_minutes'], 30)

    def test_explicit_code_never_falls_back_to_a_matching_description(self):
        content = mapped_workbook([['UNKNOWN', 'Pause', 'Target', 15, 10]],
                                  ['Haltestellen Code', 'Haltestelle', 'Ladestandort', 'Hinweg/Rückweg [min]', 'einfache Strecke [km]'])
        mapping = scan_umlauf_excel(content)['charging_mappings'][0]
        self.assertEqual(mapping['nodes'], [])
        self.assertIn('UNKNOWN', mapping['node_issue'])
        mapping['site_id'] = 'D'
        result = process_umlauf_excel(content, dict(BETRIEBSTAGE=[], CHARGING_SITES=[site()],
            OPPORTUNITY_CHARGING=dict(enabled=True, mappings=[mapping])))
        self.assertFalse(result['bus_inputs'][0].get('opportunity_visits'))
        self.assertTrue(any('UNKNOWN' in warning['message'] for warning in result['validation_results']['warnings']))

    def test_separate_legs_override_shared_values_and_zero_is_preserved(self):
        content = mapped_workbook([['STOP', 'Target', 15, 0, 10, 5, 0, 3]],
                                  ['Haltestellen Code', 'Ladestandort', 'Hinweg/Rückweg [min]', 'Hinweg [min]', 'Rückweg [min]',
                                   'einfache Strecke [km]', 'Hinweg [km]', 'Rückweg [km]'])
        mapping = scan_umlauf_excel(content)['charging_mappings'][0]
        self.assertEqual((mapping['outbound_minutes'], mapping['return_minutes']), (0, 10))
        self.assertEqual((mapping['outbound_km'], mapping['return_km']), (0, 3))

    def test_invalid_distance_is_reported_with_its_excel_row(self):
        content = mapped_workbook([['STOP', 'Target', 15, -3]],
                                  ['Haltestellen Code', 'Ladestandort', 'Hinweg/Rückweg [min]', 'einfache Strecke [km]'])
        with self.assertRaisesRegex(ValueError, 'Mapping row 2: Invalid distance'):
            scan_umlauf_excel(content)

    def test_mapping_scan_and_missing_distances_are_explicit(self):
        content=mapped_workbook()
        mappings=scan_umlauf_excel(content)['charging_mappings']
        self.assertEqual(mappings[0]['nodes'],['STOP'])
        self.assertIsNone(mappings[0]['outbound_km'])
        mappings[0]['site_id']='D'
        settings=dict(BETRIEBSTAGE=[],CHARGING_SITES=[site()],OPPORTUNITY_CHARGING=dict(enabled=True,mappings=mappings))
        result=process_umlauf_excel(content,settings)
        self.assertFalse(result['bus_inputs'][0].get('opportunity_visits'))
        self.assertTrue(any('distance' in w['message'] for w in result['validation_results']['warnings']))
        mappings[0].update(outbound_km=4,return_km=3)
        result=process_umlauf_excel(content,settings)
        option=result['bus_inputs'][0]['opportunity_visits'][0]
        self.assertEqual(option['outbound_energy_kwh'],4)
        self.assertEqual(option['return_energy_kwh'],3)
        self.assertEqual(option['pause_end_min'],660)


if __name__ == '__main__':
    unittest.main()
