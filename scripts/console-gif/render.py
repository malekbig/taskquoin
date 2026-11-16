# Renders frames.json (ANSI 24-bit colour text) into an animated GIF with a monospace font (needs Pillow).
import json, re, sys
from PIL import Image, ImageDraw, ImageFont
frames = json.load(open(sys.argv[1])); out = sys.argv[2]
FONT = ImageFont.truetype('/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf', 17)
FALLBACK = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', 15)
BG, FG = (26, 27, 38), (192, 202, 245)
CW, CH, PAD = 9, 19, 18
SGR = re.compile(r'\x1b\[([0-9;]*)m')
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
            row.append((line[i], color, inv)); i += 1
        rows.append(row)
    return rows
grids = [cells(f['ansi']) for f in frames]
cols = max(len(r) for g in grids for r in g); nrows = max(len(g) for g in grids)
W, H = cols * CW + 2 * PAD, nrows * CH + 2 * PAD
def has(font, ch):
    try: return font.getmask(ch).getbbox() is not None or ch == ' '
    except Exception: return False
images = []
for g in grids:
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    for y, row in enumerate(g):
        for x, (ch, color, inv) in enumerate(row):
            X, Y = PAD + x * CW, PAD + y * CH
            if inv: d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=FG); continue
            if ch == ' ': continue
            if ch == '█': d.rectangle([X, Y, X + CW - 1, Y + CH - 1], fill=color); continue
            cx, cy = X + CW / 2, Y + CH / 2 + 1
            if ch in '●○': d.ellipse([cx - 3.6, cy - 3.6, cx + 3.6, cy + 3.6], fill=color if ch == '●' else None, outline=color); continue
            if ch == '✦':
                r, k = 5.5, 1.6
                d.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)], fill=color); continue
            d.text((X, Y), ch, font=FONT if has(FONT, ch) else FALLBACK, fill=color)
    images.append(im.quantize(colors=64, method=Image.Quantize.MEDIANCUT))
images[0].save(out, save_all=True, append_images=images[1:], duration=[f['ms'] for f in frames], loop=0, optimize=True, disposal=1)
print(out, f'{W}x{H}', len(images), 'frames')
