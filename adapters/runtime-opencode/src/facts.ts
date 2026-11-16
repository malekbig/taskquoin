/**
 * OpenCode facts MEASURED on the reference machine (plan Task 1, 2026-11-16) for opencode-ai 1.19.5 — every value
 * comes from docs/reports/opencode-interface-1.19.5.md (recorded runs: test/fixtures/*.ndjson). A new OpenCode version
 * is re-measured before any value here changes.
 */
import { join } from 'node:path';

export const OPENCODE_VERSION = '1.19.5';

/** OpenCode's four XDG roots (it appends `opencode/` to each: `debug paths`, measured). */
export interface OpenCodeDirs { config: string; data: string; cache: string; state: string }

/** Non-interactive run with raw JSON events (NDJSON on stdout); the prompt is read from stdin (measured: ok-stdin). */
export function runArgs(model: string): string[] { return ['run', '--format', 'json', '--model', model]; }
export const PROMPT_VIA_STDIN = true;

/** The generated config travels in this variable (no file to write; the repository's and the user's configs are ignored). */
export const CONFIG_ENV = 'OPENCODE_CONFIG_CONTENT';

/**
 * Isolation: OpenCode's dirs, no project config, no ~/.claude reading, no update/catalogue/LSP download, no external
 * plugin; the models catalogue is a local copy (without it OpenCode knows no provider). NOT set on purpose:
 * OPENCODE_DISABLE_DEFAULT_PLUGINS — it removes the ChatGPT sign-in plugin shipped with OpenCode (measured: "Provider not found").
 */
export function isolationEnv(d: OpenCodeDirs): Record<string, string> {
  return {
    XDG_CONFIG_HOME: d.config, XDG_DATA_HOME: d.data, XDG_CACHE_HOME: d.cache, XDG_STATE_HOME: d.state,
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_PURE: '1',
    OPENCODE_MODELS_PATH: modelsPath(d),
  };
}

/** Where OpenCode keeps credentials: a JSON object keyed by provider id, mode 0600. */
export function authPath(d: OpenCodeDirs): string { return join(d.data, 'opencode', 'auth.json'); }
/** Non-secret field of a credential entry that says its kind: "oauth" (ChatGPT sign-in) or "api" (key). */
export const AUTH_TYPE_FIELD = 'type';
/** Local models catalogue (fetched at connect time, never at run time). */
export function modelsPath(d: OpenCodeDirs): string { return join(d.cache, 'opencode', 'models.json'); }
/** Plugin SDK OpenCode installs in its config dir (npm) — installed at connect time, bound read-only into runs. */
export function pluginDir(d: OpenCodeDirs): string { return join(d.config, 'opencode'); }
export const PLUGIN_MANIFESTS = ['package.json', 'package-lock.json', '.gitignore'] as const;

/** Interactive login (`providers` alias `auth`); the ChatGPT method label is OpenCode's own (headless = device code). */
export const LOGIN_ARGS = ['providers', 'login'];
export const CHATGPT_LOGIN = ['-p', 'openai', '-m', 'ChatGPT Pro/Plus (headless)'];

/** Rules shape in 1.19.5: `permission: { "<tool>": action | { "<pattern>": action } }`, appended AFTER the built-in agent rules (last match wins). */
export const PERMISSION_SCHEMA = 'v1-permission-object' as const;
/** `run` uses the built-in `build` agent; `agent.build.steps` is reflected by `debug agent build` (runtime honouring: Task 8). */
export function stepLimit(n: number): object { return { agent: { build: { steps: n } } }; }
/** A tool call refused by a rule ends as tool_use with state.status "error" and this text. */
export const DENIAL_TEXT = 'The user has specified a rule which prevents you from using this specific tool call';
