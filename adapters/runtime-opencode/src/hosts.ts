/** Hosts OpenCode reaches during a run, measured per provider and sign-in type (hosts.json, Task 1 / Task 8). */
import { readFileSync } from 'node:fs';

type Hosts = { code: string[]; noCode: string[] };
const TABLE = JSON.parse(readFileSync(new URL('./hosts.json', import.meta.url), 'utf8')) as Record<string, Hosts>;

/** Exact entry for `<provider>:<type>`; without a type, the union of every measured type of that provider. */
export function measuredHosts(providerId: string, type?: string): Hosts | undefined {
  if (type) return TABLE[`${providerId}:${type}`];
  const all = Object.entries(TABLE).filter(([k]) => k.startsWith(`${providerId}:`)).map(([, v]) => v);
  if (!all.length) return undefined;
  return { code: [...new Set(all.flatMap(h => h.code))], noCode: [...new Set(all.flatMap(h => h.noCode))] };
}
/** `<provider>:<type>` connections whose hosts were measured — the only ones certified (final review C1). */
export const MEASURED_CONNECTIONS: readonly string[] = Object.keys(TABLE);
/** Providers whose models run on this machine. */
export const LOCAL_PROVIDERS: readonly string[] = ['ollama', 'lmstudio'];
