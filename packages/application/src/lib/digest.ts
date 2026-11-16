import { createHash } from 'node:crypto';

/** Stable digest of an invocation (no prompt: it is on stdin). */
export function invocationDigest(bin: string, args: readonly string[], env: Readonly<Record<string, string>>): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ bin, args, env: Object.keys(env).sort().map(k => `${k}=${env[k]}`) }));
  return `sha256:${h.digest('hex')}`;
}
