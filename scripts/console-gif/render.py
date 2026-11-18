# Renders frames.json (ANSI 24-bit colour text) into an animated GIF with a monospace font (needs Pillow).
# East Asian wide characters take two cells, like in a terminal; they are drawn with a CJK font chosen from the
# frame's "lang" (Noto Sans CJK if installed, else the Windows fonts seen from WSL).
import json, os, re, sys, unicodedata
from PIL import Image, ImageDraw, ImageFont
frames = json.load(open(sys.argv[1])); out = sys.argv[2]
FONT = ImageFont.truetype('/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf', 17)
FALLBACK = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', 15)
NOTO = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
WIN = '/mnt/c/Windows/Fonts/'
CJK_CANDIDATES = {  # (path, index in the collection)
    'ja': [(NOTO, 0), (WIN + 'YuGothR.ttc', 0), (WIN + 'msgothic.ttc', 0)],
    'ko': [(NOTO, 1), (WIN + 'malgun.ttf', 0)],
    'zh': [(NOTO, 2), (WIN + 'simsun.ttc', 0)],
}
BG, FG = (26, 27, 38), (192, 202, 245)
CW, CH, PAD = 9, 19, 18
SGR = re.compile(r'\x1b\[([0-9;]*)m')

def width(ch):
    if unicodedata.category(ch) in ('Mn', 'Me', 'Cf'): return 0
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1

def cells(text):
    rows = []
    for line in text.split('\n'):
        row, color, inv, i = [], FG, False, 0
        while i < len(line):
            m = SGR.match(line, i)
            if m:
                p = [int(x) for x in m.group(1).split(';') if x] or [0]
                if p[:2] == [38, 2]: color = tuple(p[2:5])
                elif p == [0]: color, inv = FG, False
                elif p == [7]: inv = True
                i = m.end(); continue
            w = width(line[i])
            if w == 0 and row: row[-1] = (row[-1][0] + line[i],) + row[-1][1:]
            elif w: row.append((line[i], color, inv, w))
            i += 1
        rows.append(row)
    return rows

grids = [cells(f['ansi']) for f in frames]
cols = max(sum(c[3] for c in r) for g in grids for r in g); nrows = max(len(g) for g in grids)
W, H = cols * CW + 2 * PAD, nrows * CH + 2 * PAD

def has(font, ch):
    try: return font.getmask(ch).getbbox() is not None or ch == ' '
    except Exception: return False

_cjk, _glyph = {}, {}
def cjk_fonts(script):
    if script not in _cjk:
        _cjk[script] = [ImageFont.truetype(p, 16, index=i) for p, i in CJK_CANDIDATES[script] if os.path.exists(p)]
    return _cjk[script]
def bitmap(font, ch):
    im = Image.new('L', (40, 40)); ImageDraw.Draw(im).text((4, 4), ch, font=font, fill=255); return im.tobytes()
def covers(font, ch):  # a missing glyph draws the font's .notdef box: compare with it
    key = (id(font), ch)
    if key not in _glyph: _glyph[key] = bitmap(font, ch) != bitmap(font, '\U0010FFFD')
    return _glyph[key]
def hangul(cp): return 0xAC00 <= cp <= 0xD7A3 or 0x1100 <= cp <= 0x11FF or 0x3130 <= cp <= 0x318F
def kana(cp): return 0x3040 <= cp <= 0x30FF
def run_font(word, lang):
    """One font for a whole run of wide characters (a word never mixes two typefaces); per-character fallback."""
    cps = [ord(c) for c in word]
    if any(hangul(cp) for cp in cps): order = ['ko', 'ja', 'zh']
    elif any(kana(cp) for cp in cps) or lang.startswith('ja'): order = ['ja', 'zh', 'ko']
    else: order = ['zh', 'ja', 'ko']
    fonts = [font for script in order for font in cjk_fonts(script)]
    for font in fonts:
        if all(covers(font, c) for c in word): return lambda c: font
    return lambda c: next((font for font in fonts if covers(font, c)), FALLBACK)
_dy = {}
def centred(font):  # vertical offset that centres a CJK glyph in the cell
    if id(font) not in _dy:
        top, bottom = font.getbbox('中')[1], font.getbbox('中')[3]
        _dy[id(font)] = round((CH - (bottom - top)) / 2 - top)
    return _dy[id(font)]

images = []
for f, g in zip(frames, grids):
    lang = f.get('lang', '')
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    for y, row in enumerate(g):
        x, picks = 0, {}
        j = 0
        while j < len(row):  # runs of wide characters → one font per run
            if row[j][3] != 2: j += 1; continue
            k = j
            while k < len(row) and row[k][3] == 2: k += 1
            pick = run_font(''.join(c[0] for c in row[j:k]), lang)
            for n in range(j, k): picks[n] = pick(row[n][0])
            j = k
        for n, (ch, color, inv, w) in enumerate(row):
            X, Y = PAD + x * CW, PAD + y * CH; x += w
            if inv: d.rectangle([X, Y, X + w * CW - 1, Y + CH - 1], fill=FG); continue
            if ch == ' ': continue
            if ch == '█': d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=color); continue
            cx, cy = X + CW / 2, Y + CH / 2 + 1
            if ch in '●○': d.ellipse([cx - 3.6, cy - 3.6, cx + 3.6, cy + 3.6], fill=color if ch == '●' else None, outline=color); continue
            if ch == '✦':
                r, k = 5.5, 1.6
                d.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)], fill=color); continue
            if w == 2: font = picks[n]; d.text((X + 1, Y + centred(font)), ch, font=font, fill=color); continue
            d.text((X, Y), ch, font=FONT if has(FONT, ch[0]) else FALLBACK, fill=color)
    images.append(im.quantize(colors=64, method=Image.Quantize.MEDIANCUT))
images[0].save(out, save_all=True, append_images=images[1:], duration=[f['ms'] for f in frames], loop=0, optimize=True, disposal=1)
print(out, f'{W}x{H}', len(images), 'frames')
