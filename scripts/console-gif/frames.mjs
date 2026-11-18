// Builds the frames of the README console GIF from the REAL console code (logo animation, banner, "/" menu, /help).
// Regenerate: node scripts/console-gif/frames.mjs && python3 scripts/console-gif/render.py scripts/console-gif/frames.json docs/assets/console.gif (needs Pillow)
import { writeFileSync } from 'node:fs';
const C = await import(new URL('../../apps/cli/src/console.ts', import.meta.url).href);
const { setLanguage } = await import(new URL('../../apps/cli/src/i18n/index.ts', import.meta.url).href);
setLanguage('fr'); // the README GIF is French
const ok = () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] });
const agents = Object.fromEntries(['planner', 'implementer', 'challenger'].map(id => [id, { runtime: 'opencode', model: 'openai/gpt-6-astra' }]));
const squad = C.squadOf(agents, ok, true);
const frames = [];
const logo = C.logoFrames();
logo.forEach((f, i) => frames.push({ ansi: f, ms: i < 14 ? 50 : 90 }));
const screen = logo.at(-1) + '\n' + C.renderBanner(squad, { color: true, logo: false });
frames.push({ ansi: screen, ms: 1600 });
const PROMPT = '\x1b[38;2;94;242;194mtaskquoin ›\x1b[0m ';
const dim = (t) => `\x1b[38;2;154;165;206m${t}\x1b[0m`;
const CUR = '\x1b[7m \x1b[0m';
const typed = (line, extra = []) => screen + '\n' + PROMPT + line + CUR + (extra.length ? '\n' + extra.join('\n') : '');
frames.push({ ansi: typed(''), ms: 700 });
frames.push({ ansi: typed('/', C.slashMenu('/').map(dim)), ms: 1800 });
frames.push({ ansi: typed('/h', C.slashMenu('/h').map(dim)), ms: 250 });
frames.push({ ansi: typed('/he', C.slashMenu('/he').map(dim)), ms: 250 });
frames.push({ ansi: typed('/hel', C.slashMenu('/hel').map(dim)), ms: 250 });
frames.push({ ansi: typed('/help', C.slashMenu('/help').map(dim)), ms: 700 });
frames.push({ ansi: screen + '\n' + PROMPT + '/help\n' + C.consoleHelp() + '\n' + PROMPT + CUR, ms: 4500 });
writeFileSync(new URL('./frames.json', import.meta.url), JSON.stringify(frames));
console.log(`${frames.length} frames, ${frames.reduce((a, f) => a + f.ms, 0) / 1000} s, max rows ${Math.max(...frames.map(f => f.ansi.split('\n').length))}`);
