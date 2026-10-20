"""Process-local optimization jobs and bounded, read-only CBC telemetry."""
import asyncio
import copy
import math
import os
import re
import time
import uuid
from datetime import datetime, timezone
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from pathlib import Path
from threading import RLock, BoundedSemaphore

current_progress = ContextVar('optimization_progress', default=None)


class OptimizationCancelled(BaseException):
    """Control flow, deliberately not a solver failure or heuristic fallback."""


def check_cancelled():
    progress = current_progress.get()
    if progress:
        progress.check_cancelled()

NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'


def parse_cbc_line(line, metrics):
    def number(value):
        value = float(value)
        return value if math.isfinite(value) and abs(value) < 1e40 else None
    changed = False
    match = re.search(rf'After (\d+) nodes, (\d+) on tree, ({NUMBER}) best solution, best possible ({NUMBER})',line)
    if match:
        metrics.update(nodes=int(match[1]),open_nodes=int(match[2]),incumbent=number(match[3]),best_bound=number(match[4]))
        changed = True
    match = re.search(rf'Integer solution of ({NUMBER}) found',line)
    if match:
        metrics['incumbent'] = number(match[1])
        changed = True
    match = re.search(rf'best objective ({NUMBER})',line)
    if match:
        metrics['incumbent'] = number(match[1])
        changed = True
    match = re.search(rf'\(({NUMBER}) seconds\)',line)
    if match:
        metrics['reported_seconds'] = number(match[1])
    if changed:
        incumbent,bound = metrics.get('incumbent'),metrics.get('best_bound')
        metrics['relative_gap_percent'] = (100*abs(incumbent-bound)/max(abs(incumbent),1e-10)
                                           if incumbent is not None and bound is not None else None)
    return changed


class Progress:
    def __init__(self):
        self.lock = RLock()
        self.created = time.monotonic()
        self.phase_started = self.created
        self.updated = self.created
        self.data = dict(status='queued',phase='queued',message='Waiting for the optimization worker.',solver_pass=0,metrics={})
        self.events = deque(maxlen=80)
        self.event_sequence = 0
        self.log_path = None
        self.log_offset = 0
        self.log_buffer = ''
        self.last_solver_log = None
        self.result = None
        self.error = None
        self.cancel_requested = False
        self.process = None

    def check_cancelled(self):
        if self.cancel_requested:
            raise OptimizationCancelled('Optimization cancelled by the user.')

    def attach_process(self, process):
        with self.lock:
            self.process = process
            if self.cancel_requested and process.poll() is None:
                process.kill()

    def detach_process(self, process):
        with self.lock:
            if self.process is process:
                self.process = None

    def cancel(self):
        with self.lock:
            if self.data['status'] in ('completed','failed','cancelled'):
                return
            self.cancel_requested = True
            if self.process and self.process.poll() is None:
                self.process.kill()
            if self.data['status'] == 'queued':
                self.update('cancelled','Queued optimization cancelled before execution.',status='cancelled')
            else:
                self.update('cancelling','Stopping optimization. Waiting for the worker to release resources.',status='cancelling')

    def update(self, phase, message, **fields):
        with self.lock:
            if phase != self.data['phase']:
                self.phase_started = time.monotonic()
            self.updated = time.monotonic()
            self.data.update(phase=phase,message=message,**fields)
            self.event_sequence += 1
            self.events.append(dict(sequence=self.event_sequence,message=message))

    def read_log(self):
        if not self.log_path:
            return
        try:
            with Path(self.log_path).open('rb') as stream:
                stream.seek(self.log_offset)
                raw = stream.read(262144)
                self.log_offset += len(raw)
            if raw:
                self.last_solver_log = time.monotonic()
                lines = (self.log_buffer + raw.decode('utf-8',errors='replace')).split('\n')
                self.log_buffer = lines.pop()
                for line in lines:
                    parse_cbc_line(line,self.data['metrics'])
                self.data['last_solver_message'] = next((line.strip() for line in reversed(lines) if line.strip()),self.data.get('last_solver_message'))
        except OSError:
            pass  # The solver may not have opened the file yet, or has finished.

    def start_solver(self, path, problem, limit):
        with self.lock:
            self.log_path,self.log_offset,self.log_buffer = str(path),0,''
            self.last_solver_log = None
            self.data.pop('last_solver_message',None)
            self.data.update(metrics={},solver_pass=self.data['solver_pass']+1,
                             variables=problem.numVariables(),constraints=problem.numConstraints(),
                             solver_time_limit_seconds=limit)
            self.data.pop('solver_status',None)
            self.solver_started = time.monotonic()

    def finish_solver(self, status):
        with self.lock:
            self.read_log()
            self.log_path = None
            self.data['solver_status'] = status
            if status == 'Optimal' and self.data['metrics'].get('incumbent') is not None:
                self.data['metrics'].update(best_bound=self.data['metrics']['incumbent'],relative_gap_percent=0)

    def snapshot(self):
        with self.lock:
            self.read_log()
            now = time.monotonic()
            result = copy.deepcopy(self.data)
            result.update(elapsed_seconds=round(now-self.created,1),phase_seconds=round(now-self.phase_started,1),
                          solver_seconds=round(now-self.solver_started,1) if self.log_path else None,
                          seconds_since_solver_log=round(now-self.last_solver_log,1) if self.last_solver_log else None,
                          events=list(self.events))
            if self.data['status'] == 'completed':
                result['result'] = self.result
            if self.data['status'] == 'failed':
                result['error'] = self.error
            return result


def report_progress(phase, message, **fields):
    progress = current_progress.get()
    if progress:
        progress.check_cancelled()
        progress.update(phase,message,**fields)


def execute(inputs):
    from .optimization import run_optimization
    return asyncio.run(run_optimization(inputs))


def available_worker_memory():
    if os.name == 'nt':
        import ctypes
        class MemoryStatus(ctypes.Structure):
            _fields_ = [('length',ctypes.c_ulong),('load',ctypes.c_ulong)] + [(name,ctypes.c_ulonglong) for name in
                ('total_physical','available_physical','total_page','available_page','total_virtual','available_virtual','extended')]
        memory = MemoryStatus();memory.length = ctypes.sizeof(memory)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            return 0
        return memory.available_physical
    return os.sysconf('SC_AVPHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')


def daily_worker_resources():
    """Explain the conservative host estimate using this backend's environment."""
    per_worker=2*1024**3
    report=dict(checked_at=datetime.now(timezone.utc).isoformat(),memory_per_worker_bytes=per_worker,
                memory_policy='Conservative estimate, not measured model memory usage.',
                environment_limit_raw=os.environ.get('EDOPT_DAILY_WORKERS'),cpu_count=os.cpu_count() or 1)
    try:
        requested = max(1,min(4,int(os.environ.get('EDOPT_DAILY_WORKERS','4'))))
        available = available_worker_memory()
        memory_limit=max(1,int(available//per_worker))
        workers=max(1,min(requested,report['cpu_count'],memory_limit))
        reasons=[]
        if memory_limit<4: reasons.append('available_memory')
        if report['cpu_count']<4: reasons.append('cpu_count')
        if requested<4: reasons.append('environment_limit')
        return {**report,'daily_workers':workers,'available_memory_bytes':available,'memory_worker_limit':memory_limit,
                'environment_worker_limit':requested,'limiting_factors':reasons,'detection_error':None}
    except (ValueError,OSError,AttributeError):
        return {**report,'daily_workers':1,'available_memory_bytes':None,'memory_worker_limit':None,
                'environment_worker_limit':None,'limiting_factors':['detection_failed'],
                'detection_error':'Resource detection failed or EDOPT_DAILY_WORKERS is not an integer. Using one worker.'}


def daily_worker_capacity():
    return daily_worker_resources()['daily_workers']


class OptimizationJobs:
    def __init__(self, runner=execute, daily_workers=None):
        self.runner = runner
        self.lock = RLock()
        self.jobs = {}
        self.executor = ThreadPoolExecutor(max_workers=1,thread_name_prefix='edopt-optimizer')
        self.daily_workers = daily_worker_capacity() if daily_workers is None else max(1,min(4,daily_workers))
        self.fixed_daily_workers = daily_workers is not None
        self.startup_resources = daily_worker_resources()
        self.daily_executor = ThreadPoolExecutor(max_workers=self.daily_workers,thread_name_prefix='edopt-daily')
        self.slots = BoundedSemaphore(self.daily_workers)

    def capabilities(self):
        with self.lock:
            resources=daily_worker_resources()
            busy=any(job.data['status'] in ('queued','running','cancelling') for job in self.jobs.values())
            target=resources['daily_workers']
            if not busy and not self.fixed_daily_workers and target!=self.daily_workers:
                old=self.daily_executor
                self.daily_workers=target
                self.daily_executor=ThreadPoolExecutor(max_workers=target,thread_name_prefix='edopt-daily')
                self.slots=BoundedSemaphore(target)
                old.shutdown(wait=False)
            return dict(daily_workers=self.daily_workers,daily_queue_capacity=8,cbc_threads_per_daily_job=1,
                        resources=resources,startup_resources=self.startup_resources,
                        refresh_deferred=busy and target!=self.daily_workers,
                        capacity_policy='fixed_override' if self.fixed_daily_workers else 'refresh_when_idle')

    def submit(self, inputs):
        with self.lock:
            now = time.monotonic()
            finished = [key for key,value in self.jobs.items() if value.data['status'] in ('completed','failed','cancelled')]
            for key in finished:
                if now-self.jobs[key].updated > 1800 or len(self.jobs) >= 8:
                    del self.jobs[key]
            daily = bool(getattr(inputs,'daily_cyclic',False))
            if sum(value.data['status'] in ('queued','running','cancelling') and value.daily == daily for value in self.jobs.values()) >= (8 if daily else 4):
                raise RuntimeError('The optimization queue is full. Wait for an active run to finish.')
            key = uuid.uuid4().hex
            progress = Progress()
            progress.daily = daily
            self.jobs[key] = progress
            (self.daily_executor if daily else self.executor).submit(self._run,progress,inputs)
            return key

    def _run(self, progress, inputs):
        token = current_progress.set(progress)
        acquired = False
        slots = self.slots
        try:
            while not slots.acquire(timeout=.1):
                progress.check_cancelled()
            acquired = True
            progress.check_cancelled()
            progress.update('precheck','Checking input data and energy bounds.',status='running')
            result = self.runner(inputs)
            with progress.lock:
                progress.check_cancelled()
                progress.result = result.model_dump(mode='json') if hasattr(result,'model_dump') else result
                progress.update('completed','Optimization completed.',status='completed')
        except OptimizationCancelled:
            with progress.lock:
                progress.result = None
                progress.log_path = None
                progress.update('cancelled','Optimization cancelled. No result from this job was accepted.',status='cancelled')
        except Exception as error:
            with progress.lock:
                progress.error = dict(detail=str(error))
                if hasattr(error,'diagnostics'):
                    progress.error['diagnostics'] = error.diagnostics
                progress.update('failed','Optimization finished with an error. Review the diagnostic report.',status='failed')
        finally:
            if acquired:
                slots.release()
            current_progress.reset(token)

    def shutdown(self):
        self.executor.shutdown(wait=True)
        self.daily_executor.shutdown(wait=True)

    def get(self, key):
        with self.lock:
            progress = self.jobs.get(key)
        if progress is None:
            raise KeyError(key)
        return progress.snapshot()

    def cancel(self, key):
        with self.lock:
            progress = self.jobs.get(key)
        if progress is None:
            raise KeyError(key)
        progress.cancel()
        return progress.snapshot()
