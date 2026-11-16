/**
 * Run a local tool (scanner, Graphify CLI, AnyDoc, …) with NO network (ADR-0010): fresh user + network namespace via
 * util-linux `unshare -rn` — no root needed, not even loopback is reachable. Refuses to run if isolation is unavailable
 * (fail closed: a "local" tool that could reach the network is not run).
 */
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { runProcess, type ProcessRequest, type ProcessResult } from '@taskquoin/process-runner';

const UNSHARE = ['/usr/bin/unshare', '/bin/unshare'].find(p => existsSync(p));

export async function localToolIsolationAvailable(): Promise<boolean> {
  if (!UNSHARE || process.platform !== 'linux') return false;
  const r = await runProcess({ bin: UNSHARE, args: ['-rn', '--', '/bin/true'], cwd: '/', env: {}, timeoutMs: 5000, maxOutputBytes: 1000 });
  return r.status === 'completed';
}

export async function runLocalTool(req: ProcessRequest, signal?: AbortSignal): Promise<ProcessResult> {
  if (!isAbsolute(req.bin)) throw new Error(`binary "${req.bin}" must be an absolute path`);
  if (!(await localToolIsolationAvailable())) throw new Error('network isolation (unshare -rn) unavailable on this host; refusing to run a local tool with network access (ADR-0010)');
  return runProcess({ ...req, bin: UNSHARE!, args: ['-rn', '--', req.bin, ...req.args] }, signal);
}
