#!/usr/bin/env python3
"""Tweak MToon parameters of a VRM 1.0 in place-free fashion (writes a new file, BIN chunk untouched).

  tune-mtoon.py IN.vrm OUT.vrm --outline-width 0.0012 --outline-mode screenCoordinates
                 [--shade 0.85,0.82,0.92] [--toony 0.9] [--shift -0.1] [--skip-outline Iris,EyeWhite,...]
"""
import argparse, json, struct

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--outline-width', type=float)
ap.add_argument('--outline-mode', choices=['none', 'worldCoordinates', 'screenCoordinates'])
ap.add_argument('--outline-color')
ap.add_argument('--shade', help='r,g,b multiplier applied to shadeColorFactor of textured materials')
ap.add_argument('--toony', type=float)
ap.add_argument('--shift', type=float)
ap.add_argument('--gi', type=float)
ap.add_argument('--skip-outline', default='Iris,EyeWhite,Mouth,QC star,Head_Skin')
o = ap.parse_args()
d = open(o.src, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20 + jl])
rest = d[20 + jl:]
skip = [s for s in o.skip_outline.split(',') if s]
n = 0
for m in j['materials']:
    mt = m.get('extensions', {}).get('VRMC_materials_mtoon')
    if not mt:
        continue
    n += 1
    no_outline = any(s in m.get('name', '') for s in skip)
    if no_outline:
        mt['outlineWidthMode'] = 'none'
    else:
        if o.outline_mode: mt['outlineWidthMode'] = o.outline_mode
        if o.outline_width is not None: mt['outlineWidthFactor'] = o.outline_width
        if o.outline_color: mt['outlineColorFactor'] = [float(v) for v in o.outline_color.split(',')]
    if o.shade and 'shadeMultiplyTexture' in mt:
        mt['shadeColorFactor'] = [float(v) for v in o.shade.split(',')]
    if o.toony is not None: mt['shadingToonyFactor'] = o.toony
    if o.shift is not None: mt['shadingShiftFactor'] = o.shift
    if o.gi is not None: mt['giEqualizationFactor'] = o.gi
js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf8')
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + len(rest)
with open(o.dst, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, total)); f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js); f.write(rest)
print('mtoon materials', n)
