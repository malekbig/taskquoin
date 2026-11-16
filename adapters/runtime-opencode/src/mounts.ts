/**
 * What the sandbox must show of the OpenCode binary while HOME is hidden (Review Focus 3): its real file up to its
 * package root (npm layout: …/node_modules/opencode-ai/bin/opencode.exe → …/opencode-ai), and the interpreter of a
 * shebang script. Never HOME itself or one of its ancestors (a stray ~/package.json must not expose HOME).
 */
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

function lookPath(name: string, PATH: string): string | undefined {
  for (const d of PATH.split(delimiter)) {
    if (!d.startsWith('/')) continue;
    const p = join(d, name); try { if (statSync(p).isFile()) return realpathSync(p); } catch { /* next */ }
  }
  return undefined;
}
function packageRoot(file: string, home: string): string {
  const own = dirname(file); let d = own;
  for (;;) {
    if (d === home || home.startsWith(d + '/') || d === '/') return own;
    if (existsSync(join(d, 'package.json'))) return d;
    d = dirname(d);
  }
}
export function binaryMounts(bin: string, PATH: string, home: string): string[] {
  const real = realpathSync(bin); const out = [packageRoot(real, realpathSync(home))];
  let head = '';
  try { const fd = openSync(real, 'r'); try { const b = Buffer.alloc(256); head = b.subarray(0, readSync(fd, b, 0, 256, 0)).toString('latin1'); } finally { closeSync(fd); } } catch { /* unreadable: no interpreter */ }
  if (head.startsWith('#!')) {
    const [interp, arg] = head.slice(2).split('\n')[0].trim().split(/\s+/);
    const target = interp?.endsWith('/env') && arg ? lookPath(arg, PATH) : interp;
    if (target && isAbsolute(target)) { try { out.push(dirname(realpathSync(target))); } catch { /* missing interpreter: the run fails visibly */ } }
  }
  return [...new Set(out)];
}
