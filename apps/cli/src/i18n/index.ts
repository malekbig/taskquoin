import { readFileSync } from 'node:fs';
import { en, ENGLISH_ONLY } from './en.ts';
import { LANGUAGES } from './languages.ts';

export type MessageKey = keyof typeof en;
export type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | ParamNames<R> : never;
export type Params<N extends string> = [N] extends [never] ? [] : [params: Record<N, string | number>];
type PluralBase = { [K in MessageKey]: K extends `${infer B}_other` ? B : never }[MessageKey];

const codes = new Map(LANGUAGES.map((x) => [x.code.toLowerCase(), x.code]));

export function normalizeLanguage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parts = raw.replace(/[.@].*$/, '').replace(/_/g, '-').toLowerCase().split('-');
  const full = parts.join('-');
  if (!full || full === 'c' || full === 'posix') return undefined;
  const exact = codes.get(full);
  if (exact) return exact;
  const primary = parts[0] ?? '';
  if (primary === 'zh') return parts.some((p) => ['tw', 'hk', 'mo', 'hant'].includes(p)) ? 'zh-TW' : 'zh-CN';
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'iw') return 'he';
  if (primary === 'in') return 'id';
  return codes.get(primary);
}

export function resolveLanguage(env: Record<string, string | undefined>, prefs: { language?: string }): string {
  const sources: [string, string | undefined][] = [
    ['TASKQUOIN_LANG', env.TASKQUOIN_LANG], ['prefs', prefs.language], ['LC_ALL', env.LC_ALL],
    ['LC_MESSAGES', env.LC_MESSAGES], ['LANG', env.LANG],
  ];
  for (const [name, value] of sources) {
    if (name === 'LC_ALL' && /^(C|POSIX)([.@]|$)/i.test(value ?? '')) return 'en';
    const code = normalizeLanguage(value);
    if (code) return code;
  }
  return 'en';
}

export { loadPreferences } from '../preferences.ts';

export function translate(
  lang: string, base: Record<string, string>, local: Record<string, string> | undefined,
  key: string, params?: Record<string, string | number>,
): string {
  const keys = typeof params?.count === 'number'
    ? [`${key}_${new Intl.PluralRules(lang).select(params.count)}`, `${key}_other`, key]
    : [key];
  const has = (c: Record<string, string> | undefined, k: string): boolean => typeof c?.[k] === 'string';
  const k = keys.find((x) => has(local, x) || has(base, x));
  const template = k === undefined ? key : has(local, k) ? local![k]! : base[k]!;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
}

let lang = 'en';
let local: Record<string, string> | undefined;

const defaultRead = (code: string): string => readFileSync(new URL(`./locales/${code}.json`, import.meta.url), 'utf8');

export function setLanguage(code: string, read: (code: string) => string = defaultRead): void {
  lang = 'en';
  local = undefined;
  const known = codes.get(code.toLowerCase());
  if (!known || known === 'en') return;
  let text: string;
  try {
    text = read(known);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') process.stderr.write(`taskquoin: cannot read the ${known} translation, using English\n`);
    return;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    local = parsed as Record<string, string>;
    lang = known;
  } catch {
    process.stderr.write(`taskquoin: the ${known} translation is invalid, using English\n`);
  }
}

export const currentLanguage = (): string => lang;

export function t<K extends MessageKey>(key: K, ...args: Params<ParamNames<(typeof en)[K]>>): string {
  return translate(lang, en, local, key, args[0]);
}

export function tn<B extends PluralBase>(base: B, count: number, ...args: Params<Exclude<ParamNames<(typeof en)[`${B}_other`]>, 'count'>>): string {
  return translate(lang, en, local, base, { ...args[0], count });
}

/** Engine text (`check --json`, run reasons in `status --json`): English whatever the language — only ENGLISH_ONLY keys. */
export function english<K extends (typeof ENGLISH_ONLY)[number]>(key: K, ...args: Params<ParamNames<(typeof en)[K]>>): string {
  return translate('en', en, undefined, key, args[0]);
}

export { en, ENGLISH_ONLY };
