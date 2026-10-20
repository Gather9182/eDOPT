"""CBC adapter with an owned subprocess; cancellation never affects other jobs.

Uses PuLP's MPS writer, CBC options and solution reader, as COIN_CMD does.
The unmanaged legacy endpoint retains PuLP's original execution path.
"""
import os
import subprocess

import pulp
from .optimization_progress import current_progress


class CancellableCBC(pulp.PULP_CBC_CMD):
    def solve_CBC(self, lp, use_mps=True):
        progress = current_progress.get()
        if progress is None:
            return super().solve_CBC(lp,use_mps)
        progress.check_cancelled()
        if not use_mps:
            raise ValueError('Cancellable CBC requires the MPS execution path.')
        tmp_lp,tmp_mps,tmp_sol,tmp_mst = self.create_tmp_files(lp.name,'lp','mps','sol','mst')
        process = None
        pipe = None
        try:
            variables,names,constraints,_ = lp.writeMPS(tmp_mps,rename=1)
            progress.check_cancelled()
            args = [self.path,tmp_mps]
            if lp.sense == pulp.LpMaximize:
                args.append('-max')
            if self.timeLimit is not None:
                args += ['-sec',str(self.timeLimit)]
            for option in self.options + self.getOptions():
                args += ('-'+option).split()
            args += ['-solve' if self.mip else '-initialSolve','-printingOptions','all','-solution',tmp_sol]
            log_path = self.optionsDict.get('logPath')
            pipe = open(log_path,'w') if log_path else self.get_pipe()
            process = subprocess.Popen(args,stdout=pipe,stderr=pipe,stdin=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            progress.attach_process(process)
            code = process.wait()
            progress.check_cancelled()
            if code != 0 or not os.path.exists(tmp_sol):
                raise pulp.PulpSolverError('CBC did not produce a valid solution file.')
            status,values,reduced,shadow,slacks,solution_status = self.readsol_MPS(tmp_sol,lp,variables,names,constraints)
            lp.assignVarsVals(values)
            lp.assignVarsDj(reduced)
            lp.assignConsPi(shadow)
            lp.assignConsSlack(slacks,activity=True)
            lp.assignStatus(status,solution_status)
            return status
        finally:
            if process is not None:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                progress.detach_process(process)
            if pipe:
                pipe.close()
            self.delete_tmp_files(tmp_mps,tmp_lp,tmp_sol,tmp_mst)
