export interface Language { code: string; nativeName: string; englishName: string; rtl: boolean; machine: boolean }

const l = (code: string, nativeName: string, englishName: string, opts: { rtl?: boolean; machine?: boolean } = {}): Language =>
  ({ code, nativeName, englishName, rtl: opts.rtl ?? false, machine: opts.machine ?? true });

export const LANGUAGES: readonly Language[] = [
  l('en', 'English', 'English', { machine: false }),
  l('fr', 'Français', 'French', { machine: false }),
  l('es', 'Español', 'Spanish'),
  l('pt-BR', 'Português (Brasil)', 'Brazilian Portuguese'),
  l('de', 'Deutsch', 'German'),
  l('it', 'Italiano', 'Italian'),
  l('nl', 'Nederlands', 'Dutch'),
  l('pl', 'Polski', 'Polish'),
  l('ru', 'Русский', 'Russian'),
  l('uk', 'Українська', 'Ukrainian'),
  l('tr', 'Türkçe', 'Turkish'),
  l('ar', 'العربية', 'Arabic', { rtl: true }),
  l('fa', 'فارسی', 'Persian', { rtl: true }),
  l('he', 'עברית', 'Hebrew', { rtl: true }),
  l('hi', 'हिन्दी', 'Hindi'),
  l('id', 'Bahasa Indonesia', 'Indonesian'),
  l('vi', 'Tiếng Việt', 'Vietnamese'),
  l('th', 'ไทย', 'Thai'),
  l('zh-CN', '简体中文', 'Simplified Chinese'),
  l('zh-TW', '繁體中文', 'Traditional Chinese'),
  l('ja', '日本語', 'Japanese'),
  l('ko', '한국어', 'Korean'),
];
