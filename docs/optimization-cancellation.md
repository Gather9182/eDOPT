# Optimization cancellation

During a run, **Cancel optimization** requests cancellation of that run's job.
The interface waits for backend confirmation before returning to the settings.
The job API exposes `POST /api/optimize/jobs/{job_id}/cancel`; status progresses
through `cancelling` to `cancelled`. Queued jobs are cancelled before execution.
Repeated requests are safe; already completed or failed jobs retain their status.

Each managed CBC solve owns its subprocess. Cancellation kills and reaps that
process, removes temporary solver files and releases the serial worker. This
also applies to soft-SoC stages and diagnostic solves. Cancellation is separate
control flow and cannot trigger an infeasibility diagnostic or heuristic fallback.
Model preparation checks cancellation between routes and while building charging
curve/automatic-charging intervals. Other preparation and data loading finish
their current operation before a cooperative check; no further solve is started. Legacy unmanaged
`/api/optimize` requests do not gain job cancellation.

The frontend retains the cancellation signal for the entire run, including
scenario comparisons and all long-term chunks. If a solver finishes concurrently
with cancellation, its result is not accepted by the interrupted run. A lost
connection is reported as unconfirmed; the UI does not claim the backend stopped.

Completed Daily Cyclic days remain available as a labelled partial result and
can be exported. The interrupted date is `cancelled`, later dates are
`not_calculated`. Flexible runs also retain completed chunk requests and raw
results in IndexedDB under `optimization_checkpoint_<run-id>_<chunk>`; this does
not add a recovery UI or resume function. Previously saved full results are
not replaced with an interrupted job.

Tests cover queued and active cancellation, owned-process termination, worker
reuse, unchanged completed jobs, submit/finish races, failed cancellation
requests and retention of completed Daily Cyclic days.
