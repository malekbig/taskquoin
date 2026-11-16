/**
 * Minimal Gherkin runner on node:test — no Cucumber dependency (ADR: minimal dependencies). Supports `# language: fr`
 * and English keywords, Contexte/Background, Scénario/Scenario, Soit/Étant donné/Quand/Alors/Et/Mais (+ EN), and
 * @tags on the line before a scenario. Undefined steps FAIL (never silently skipped).
 */
import { readFileSync } from 'node:fs';
import { describe, test, type TestContext } from 'node:test';

export interface Step { keyword: string; text: string; line: number }
export interface Scenario { name: string; tags: string[]; steps: Step[]; line: number }
export interface Feature { name: string; file: string; background: Step[]; scenarios: Scenario[] }

const FEATURE = /^(Fonctionnalité|Feature):\s*(.*)$/;
const BACKGROUND = /^(Contexte|Background):\s*$/;
const SCENARIO = /^(Scénario|Scenario):\s*(.*)$/;
const STEP = /^(Soit|Étant donnée?s?|Etant donnée?s?|Quand|Lorsque|Alors|Et|Mais|Given|When|Then|And|But)\s+(.*)$/;

export function parseFeature(file: string): Feature {
  const lines = readFileSync(file, 'utf8').split('\n');
  const f: Feature = { name: '', file, background: [], scenarios: [] };
  let target: Step[] | undefined; let tags: string[] = []; let inDescription = false;
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith('#')) return;
    if (l.startsWith('@')) { tags = l.split(/\s+/); return; }
    let m;
    if ((m = FEATURE.exec(l))) { f.name = m[2]; target = undefined; inDescription = true; return; }
    if (BACKGROUND.test(l)) { target = f.background; inDescription = false; return; }
    if ((m = SCENARIO.exec(l))) { const s: Scenario = { name: m[2], tags, steps: [], line: i + 1 }; f.scenarios.push(s); target = s.steps; tags = []; inDescription = false; return; }
    if ((m = STEP.exec(l)) && target) { target.push({ keyword: m[1], text: m[2], line: i + 1 }); return; }
    if (inDescription) return; // free text right under "Fonctionnalité:" only
    throw new Error(`${file}:${i + 1}: unrecognised line (misspelt keyword?): ${l}`); // never silently dropped (Codex R4)
  });
  return f;
}

export type StepFn<W> = (world: W, ...args: string[]) => unknown | Promise<unknown>;
export interface StepDef<W> { re: RegExp; fn: StepFn<W> }

export function runFeature<W extends { cleanup(): void }>(f: Feature, steps: StepDef<W>[], makeWorld: () => W, skipTag?: (tag: string) => string | false) {
  describe(`Fonctionnalité: ${f.name}`, () => {
    for (const sc of f.scenarios) {
      const skip = sc.tags.map(t => skipTag?.(t)).find(Boolean) || false;
      test(`Scénario: ${sc.name}`, { skip, timeout: 180_000 }, async (t: TestContext) => {
        const w = makeWorld();
        try {
          for (const st of [...f.background, ...sc.steps]) {
            const hit = steps.map(d => ({ d, m: d.re.exec(st.text) })).find(x => x.m);
            if (!hit) throw new Error(`undefined step (${f.file}:${st.line}): ${st.keyword} ${st.text}`);
            await hit.d.fn(w, ...hit.m!.slice(1).map(a => a.replace(/\\"/g, '"')));
            t.diagnostic(`✔ ${st.keyword} ${st.text}`);
          }
        } finally { w.cleanup(); }
      });
    }
  });
}
