import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from threading import Event

from app.services.optimization_progress import OptimizationJobs, Progress, current_progress, parse_cbc_line, report_progress
from app.services.optimization_progress import OptimizationCancelled
from app.services.cancellable_solver import CancellableCBC
from app.services.solver_diagnostics import OptimizationFailure


class ProgressTests(unittest.TestCase):
    def test_cancellation_kills_owned_process_and_releases_worker_for_next_job(self):
        started,finished = Event(),Event()
        processes=[]
        def runner(value):
            if value == 'next': return {'ok':True}
            progress=current_progress.get()
            process=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
            processes.append(process)
            progress.attach_process(process)
            started.set()
            try:
                process.wait(timeout=5)
                progress.check_cancelled()
            finally:
                progress.detach_process(process)
                finished.set()
        jobs=OptimizationJobs(runner)
        try:
            key=jobs.submit('stop')
            self.assertTrue(started.wait(2))
            jobs.cancel(key)
            self.assertTrue(finished.wait(2))
            next_key=jobs.submit('next')
        finally:
            for process in processes:
                if process.poll() is None: process.kill()
            jobs.executor.shutdown(wait=True)
        self.assertEqual(jobs.get(key)['status'],'cancelled')
        self.assertNotIn('result',jobs.get(key))
        self.assertIsNotNone(processes[0].poll())
        self.assertTrue(jobs.get(next_key)['result']['ok'])
        self.assertEqual(jobs.cancel(key)['status'],'cancelled')

    def test_cancelled_queued_job_never_calls_runner_and_completed_job_is_unchanged(self):
        started,release=Event(),Event()
        calls=[]
        def runner(value):
            calls.append(value);started.set();release.wait(3);return {'value':value}
        jobs=OptimizationJobs(runner)
        try:
            first=jobs.submit('first');self.assertTrue(started.wait(2))
            queued=jobs.submit('queued')
            self.assertEqual(jobs.cancel(queued)['status'],'cancelled')
        finally:
            release.set();jobs.executor.shutdown(wait=True)
        self.assertEqual(calls,['first'])
        self.assertEqual(jobs.cancel(first)['status'],'completed')
        with self.assertRaises(KeyError):jobs.cancel('missing')

    def test_cancellable_adapter_solves_real_cbc_and_cancellation_is_not_an_exception_fallback(self):
        import pulp
        progress=Progress();token=current_progress.set(progress)
        try:
            problem=pulp.LpProblem('cancel_adapter',pulp.LpMinimize)
            value=pulp.LpVariable('value',lowBound=2)
            problem+=value
            problem.solve(CancellableCBC(msg=0))
            self.assertEqual(pulp.value(value),2)
            self.assertIsNone(progress.process)
            progress.cancel()
            with self.assertRaises(OptimizationCancelled):problem.solve(CancellableCBC(msg=0))
            self.assertFalse(issubclass(OptimizationCancelled,Exception))
        finally:current_progress.reset(token)

    def test_cbc_parser_distinguishes_no_solution_from_feasible_solution(self):
        metrics = {}
        parse_cbc_line('Cbc0010I After 12 nodes, 7 on tree, 1e+50 best solution, best possible -25 (3.5 seconds)',metrics)
        self.assertIsNone(metrics['incumbent'])
        self.assertIsNone(metrics['relative_gap_percent'])
        self.assertEqual(metrics['nodes'],12)
        parse_cbc_line('Cbc0012I Integer solution of -20 found by feasibility pump after 0 iterations and 0 nodes (4.2 seconds)',metrics)
        self.assertEqual(metrics['incumbent'],-20)
        self.assertEqual(metrics['relative_gap_percent'],25)

    def test_zero_objective_and_unknown_lines_do_not_create_false_progress(self):
        metrics = {}
        self.assertFalse(parse_cbc_line('Continuous objective value is 10 - 0.01 seconds',metrics))
        self.assertNotIn('incumbent',metrics)
        parse_cbc_line('Cbc0010I After 0 nodes, 1 on tree, 0 best solution, best possible 0 (1 seconds)',metrics)
        self.assertEqual(metrics['relative_gap_percent'],0)

    def test_incremental_log_reads_and_new_pass_reset(self):
        progress = Progress()
        class Model:
            def numVariables(self): return 20
            def numConstraints(self): return 30
        descriptor = tempfile.NamedTemporaryFile(delete=False)
        path = Path(descriptor.name)
        descriptor.close()
        try:
            progress.start_solver(path,Model(),180)
            path.write_text('Cbc0010I After 10 nodes, 2 on tree, 100 best solution, best possible 90 (1 seconds)\n')
            self.assertEqual(progress.snapshot()['metrics']['relative_gap_percent'],10)
            with path.open('a') as stream:
                stream.write('Cbc0012I Integer solution of 95 found by heuristic (2 seconds)\n')
            self.assertEqual(progress.snapshot()['metrics']['incumbent'],95)
            progress.finish_solver('Optimal')
            self.assertEqual(progress.snapshot()['metrics']['relative_gap_percent'],0)
            progress.start_solver(path,Model(),180)
            self.assertEqual(progress.data['metrics'],{})
            self.assertNotIn('last_solver_message',progress.data)
        finally:
            path.unlink(missing_ok=True)

    def test_worker_status_is_readable_while_job_is_blocked_and_queue_is_serial(self):
        entered,release = Event(),Event()
        def runner(inputs):
            report_progress('minimizing_soc','Testing stage.',objective_label='SoC deviation')
            entered.set()
            if not release.wait(3): raise RuntimeError('Test worker release timed out')
            return {'result_for':inputs}
        jobs = OptimizationJobs(runner)
        try:
            first = jobs.submit('first')
            self.assertTrue(entered.wait(2))
            second = jobs.submit('second')
            snapshot = jobs.get(first)
            self.assertEqual(snapshot['status'],'running')
            self.assertEqual(snapshot['phase'],'minimizing_soc')
            self.assertEqual(jobs.get(second)['status'],'queued')
            self.assertNotIn('result',snapshot)
        finally:
            release.set()
            jobs.executor.shutdown(wait=True)
        self.assertEqual(jobs.get(first)['result'],{'result_for':'first'})
        self.assertEqual(jobs.get(second)['result'],{'result_for':'second'})
        self.assertIsNone(current_progress.get())

    def test_diagnostic_failure_is_preserved_and_unknown_job_is_explicit(self):
        def runner(_):
            raise OptimizationFailure('Infeasible',{'solver_status':'Infeasible','model_lp':'evidence'})
        jobs = OptimizationJobs(runner)
        key = jobs.submit(None)
        jobs.executor.shutdown(wait=True)
        response = jobs.get(key)
        self.assertEqual(response['status'],'failed')
        self.assertEqual(response['error']['diagnostics']['model_lp'],'evidence')
        with self.assertRaises(KeyError): jobs.get('missing')

    def test_event_history_is_bounded_but_sequence_keeps_increasing(self):
        progress = Progress()
        for i in range(100): progress.update('building_model',str(i))
        events = progress.snapshot()['events']
        self.assertEqual(len(events),80)
        self.assertEqual(events[-1]['sequence'],100)
