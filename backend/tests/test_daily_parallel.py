import unittest
from threading import Event,Lock
from types import SimpleNamespace
from unittest.mock import patch

from app.services.optimization_progress import OptimizationJobs,Progress,OptimizationCancelled,current_progress,report_progress,daily_worker_capacity
from app.services.daily_boundary import required_boundary_pairs,validate_daily_boundary
from app.services.solver import run_milp_solver
from app.services.solver_diagnostics import OptimizationFailure
from app.services.solver_diagnostics import diagnostic_paths
from app.services.cancellable_solver import CancellableCBC
from test_cyclic_soc import cycle_inputs,cycle_bus
from test_charging import site,run_offline


class DailyParallelTests(unittest.TestCase):
    def source(self):
        return cycle_inputs([cycle_bus(initial=10,consumption=6)],daily_cyclic=True,
                            sites=[site(no_switch_windows=[dict(start='22:00',end='05:00')])])

    def test_seed_and_fixed_boundaries_preserve_cost_and_both_midnight_ends(self):
        data=self.source();data.daily_boundary_seed=True
        data.buses[0].initial_connection_site='D'
        seed=run_offline(run_milp_solver(data,[]))
        self.assertEqual(required_boundary_pairs(data),[('a','D')])
        value=int(seed.connection_schedules['a'][0]=='D')
        self.assertEqual(value,1)
        self.assertEqual(int(seed.final_connections['a']=='D'),value)
        fixed=data.model_copy(deep=True);fixed.daily_boundary_seed=False
        fixed.daily_connection_boundary={'a':{'D':value}}
        result=run_offline(run_milp_solver(fixed,[]))
        self.assertAlmostEqual(result.total_cost_eur,seed.total_cost_eur,places=5)
        self.assertEqual(int(result.connection_schedules['a'][0]=='D'),value)
        self.assertEqual(int(result.final_connections['a']=='D'),value)
        fixed.electricity_prices=[200]*96
        changed=run_offline(run_milp_solver(fixed,[]))
        self.assertAlmostEqual(changed.total_cost_eur,2*result.total_cost_eur,places=5)

    def test_explicit_initial_connection_cannot_be_overridden_by_fixed_end(self):
        data=self.source();data.buses[0].initial_connection_site='D'
        data.daily_connection_boundary={'a':{'D':0}}
        with self.assertRaises(OptimizationFailure):run_offline(run_milp_solver(data,[]))

    def test_only_necessary_states_are_fixed_and_unsafe_boundaries_are_rejected(self):
        data=self.source();data.charging_sites[0].no_switch_windows=[]
        self.assertEqual(required_boundary_pairs(data),[])
        data.daily_connection_boundary={'a':{'D':1}}
        with self.assertRaisesRegex(ValueError,'exactly'):validate_daily_boundary(data)
        data=self.source();data.buses[0].site_presence['D'][-1]=0
        with self.assertRaisesRegex(ValueError,'ambiguous'):required_boundary_pairs(data)
        data=self.source();data.charging_sites[0].no_switch_windows[0].start='00:05'
        with self.assertRaisesRegex(ValueError,'first interval'):required_boundary_pairs(data)

    def test_two_daily_workers_have_isolated_contexts_and_a_bounded_queue(self):
        entered=[Event(),Event()];release=Event();lock=Lock();active=0;maximum=0
        def runner(inputs):
            nonlocal active,maximum
            report_progress('building_model',inputs.name)
            own=current_progress.get()
            with lock:active+=1;maximum=max(maximum,active)
            if inputs.name in ('0','1'):entered[int(inputs.name)].set()
            try:
                release.wait(4)
                self.assertIs(current_progress.get(),own)
                return {'name':inputs.name}
            finally:
                with lock:active-=1
        jobs=OptimizationJobs(runner,daily_workers=2)
        try:
            keys=[jobs.submit(SimpleNamespace(daily_cyclic=True,name=str(i))) for i in range(8)]
            self.assertTrue(all(event.wait(2) for event in entered))
            self.assertEqual(jobs.get(keys[0])['message'],'0')
            self.assertEqual(jobs.get(keys[1])['message'],'1')
            self.assertEqual(jobs.get(keys[2])['status'],'queued')
            with self.assertRaises(RuntimeError):jobs.submit(SimpleNamespace(daily_cyclic=True,name='overflow'))
        finally:release.set();jobs.shutdown()
        self.assertEqual(maximum,2)
        self.assertEqual([jobs.get(key)['result']['name'] for key in keys],list(map(str,range(8))))

    def test_two_active_daily_cancellations_and_generic_serial_regression(self):
        entered=[Event(),Event()]
        def runner(inputs):
            entered[inputs.index].set()
            progress=current_progress.get()
            while not progress.cancel_requested:
                Event().wait(.01)
            progress.check_cancelled()
        jobs=OptimizationJobs(runner,daily_workers=2)
        try:
            keys=[jobs.submit(SimpleNamespace(daily_cyclic=True,index=i)) for i in range(2)]
            self.assertTrue(all(event.wait(2) for event in entered))
            for key in keys:jobs.cancel(key)
        finally:jobs.shutdown()
        self.assertTrue(all(jobs.get(key)['status']=='cancelled' for key in keys))

    def test_host_detection_can_fall_back_to_one_worker(self):
        with patch('app.services.optimization_progress.os.cpu_count',return_value=1):
            self.assertEqual(daily_worker_capacity(),1)

    def test_default_host_ceiling_allows_four_but_respects_resources_and_explicit_cap(self):
        with patch.dict('os.environ',{},clear=True),patch('app.services.optimization_progress.available_worker_memory',return_value=16*1024**3),patch('app.services.optimization_progress.os.cpu_count',return_value=8):
            self.assertEqual(daily_worker_capacity(),4)
            with patch.dict('os.environ',{'EDOPT_DAILY_WORKERS':'2'}):
                self.assertEqual(daily_worker_capacity(),2)
            with patch('app.services.optimization_progress.available_worker_memory',return_value=5*1024**3):
                self.assertEqual(daily_worker_capacity(),2)

    def test_four_supported_daily_workers_can_actually_run_together(self):
        entered=[Event() for _ in range(4)];release=Event()
        def runner(inputs):
            entered[inputs.index].set();release.wait(4);return {'index':inputs.index}
        with patch('app.services.optimization_progress.daily_worker_capacity',return_value=4):
            jobs=OptimizationJobs(runner)
        try:
            keys=[jobs.submit(SimpleNamespace(daily_cyclic=True,index=i)) for i in range(4)]
            self.assertTrue(all(event.wait(2) for event in entered))
            self.assertTrue(all(jobs.get(key)['status']=='running' for key in keys))
            self.assertEqual(jobs.capabilities()['daily_workers'],4)
        finally:release.set();jobs.shutdown()

    def test_feasible_incumbent_is_not_reported_as_a_proven_optimum(self):
        import pulp
        class FeasibleCBC(CancellableCBC):
            def actualSolve(self,problem,**kwargs):
                status=super().actualSolve(problem,**kwargs)
                problem.sol_status=pulp.LpSolutionIntegerFeasible
                return status
        with patch('app.services.solver_diagnostics.CancellableCBC',FeasibleCBC):
            result=run_offline(run_milp_solver(self.source(),[]))
        self.assertTrue(result.status.startswith('Feasible'))
        self.assertIsNone(result.optimization_gap)

    def test_cancellation_cleanup_disables_poll_readers_before_unlinking_logs(self):
        from pathlib import Path
        progress=Progress();token=current_progress.set(progress);original=Path.unlink
        def guarded_unlink(path,*args,**kwargs):
            if progress.log_path==str(path):raise PermissionError('Polling can still read this file')
            return original(path,*args,**kwargs)
        try:
            with patch.object(Path,'unlink',guarded_unlink),self.assertRaises(OptimizationCancelled):
                with diagnostic_paths() as (log,model):
                    progress.log_path=str(log)
                    raise OptimizationCancelled()
            self.assertIsNone(progress.log_path)
        finally:current_progress.reset(token)
        with patch.dict('os.environ',{'EDOPT_DAILY_WORKERS':'invalid'}):
            self.assertEqual(daily_worker_capacity(),1)
