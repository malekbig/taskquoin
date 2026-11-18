// Builds the frames of the README languages GIF from the REAL console code: the same banner and "/" menu,
// started in eight of the 22 languages (alignment computed by the console itself, CJK included).
// Regenerate: node scripts/console-gif/languages.mjs && python3 scripts/console-gif/render.py scripts/console-gif/languages.json docs/assets/languages.gif (needs Pillow and CJK fonts)
import { writeFileSync } from 'node:fs';
const C = await import(new URL('../../apps/cli/src/console.ts', import.meta.url).href);
const { setLanguage } = await import(new URL('../../apps/cli/src/i18n/index.ts', import.meta.url).href);
const { LANGUAGES } = await import(new URL('../../apps/cli/src/i18n/languages.ts', import.meta.url).href);
const SHOWN = ['en', 'fr', 'es', 'de', 'ru', 'ja', 'zh-CN', 'ko'];
const ok = () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] });
const agents = Object.fromEntries(['planner', 'implementer', 'challenger'].map(id => [id, { runtime: 'opencode', model: 'openai/gpt-6-astra' }]));
const ACCENT = (t) => `\x1b[38;2;94;242;194m${t}\x1b[0m`;
const dim = (t) => `\x1b[38;2;154;165;206m${t}\x1b[0m`;
const PROMPT = ACCENT('taskquoin ›') + ' ';
const CUR = '\x1b[7m \x1b[0m';
const name = (code) => LANGUAGES.find((l) => l.code === code).nativeName;
const tabs = (current) => ' ' + SHOWN.map((c) => (c === current ? ACCENT(`[${name(c)}]`) : dim(` ${name(c)} `))).join(' ')
  + dim(`  +${LANGUAGES.length - SHOWN.length}`);
const logo = C.logoFrames().at(-1);
const frames = [];
for (const code of SHOWN) {
  setLanguage(code);
  const squad = C.squadOf(agents, ok, true);
  const shell = dim('$ ') + `TASKQUOIN_LANG=${code} taskquoin`;
  const screen = tabs(code) + '\n\n' + shell + '\n' + logo + '\n' + C.renderBanner(squad, { color: true, logo: false });
  frames.push({ ansi: screen + '\n' + PROMPT + CUR, ms: 900, lang: code });
  frames.push({ ansi: screen + '\n' + PROMPT + '/' + CUR + '\n' + C.slashMenu('/').map(dim).join('\n'), ms: 2300, lang: code });
}
setLanguage('en');
writeFileSync(new URL('./languages.json', import.meta.url), JSON.stringify(frames));
console.log(`${frames.length} frames, ${frames.reduce((a, f) => a + f.ms, 0) / 1000} s, max rows ${Math.max(...frames.map(f => f.ansi.split('\n').length))}`);
