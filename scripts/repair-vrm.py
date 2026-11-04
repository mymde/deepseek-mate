#!/usr/bin/env python3
"""Repair a VRM 1.0 avatar so it behaves as a desktop pet in three-vrm.

Fixes found on DeepSeek_Reset_4K_Lite.vrm, written generically:

  --rest-from-bind   joint rest transforms are rebuilt from the skin's inverse bind matrices
                     (the exported rest pose had the arm bones turned 90 degrees away from the mesh)
  --face +x|-x|-z    bake a rotation so the character faces +Z as VRM 1.0 requires
  --unlit-emission   materials whose colour lives only in emission (black base colour) become
                     KHR_materials_unlit with the emission passed through AgX, i.e. what Blender showed
  --eyes A,B         register eye bones (node names) as leftEye/rightEye for bone look-at
  --expressions F    bind VRM preset expressions to morph targets from a JSON map {preset: {target: weight}}
  slimming (always): drop constant COLOR_n sets, drop morph NORMAL targets when every material using
                     the mesh is unlit, and store morph POSITION targets as sparse accessors

The input file is never modified.
Usage: repair-vrm.py IN.vrm OUT.vrm [options]
"""
import argparse, json, struct, math
import numpy as np

CT = {5126: ('<f4', 4), 5125: ('<u4', 4), 5123: ('<u2', 2), 5122: ('<i2', 2), 5121: ('u1', 1), 5120: ('i1', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NORM = {5123: 65535.0, 5121: 255.0, 5122: 32767.0, 5120: 127.0}


def load_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF'
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]
    b = d[28 + jl:28 + jl + bl]
    return j, b


def read_accessor(j, b, ai):
    a = j['accessors'][ai]
    dt, sz = CT[a['componentType']]
    n = NC[a['type']]
    if 'bufferView' in a:
        bv = j['bufferViews'][a['bufferView']]
        stride = bv.get('byteStride', sz * n)
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        raw = np.frombuffer(b[off:off + stride * (a['count'] - 1) + sz * n], dtype='u1')
        rows = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], sz * n), strides=(stride, 1)).copy()
        arr = rows.view(dt).reshape(a['count'], n)
    else:
        arr = np.zeros((a['count'], n), dtype=dt)
    if 'sparse' in a:
        sp = a['sparse']
        idt, isz = CT[sp['indices']['componentType']]
        ibv = j['bufferViews'][sp['indices']['bufferView']]
        ioff = ibv.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0)
        idx = np.frombuffer(b[ioff:ioff + isz * sp['count']], dtype=idt)
        vbv = j['bufferViews'][sp['values']['bufferView']]
        voff = vbv.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)
        vals = np.frombuffer(b[voff:voff + sz * n * sp['count']], dtype=dt).reshape(-1, n)
        arr = arr.copy()
        arr[idx] = vals
    return arr


# ------------------------------------------------------------------ math

def trs_matrix(n):
    t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    if 'matrix' in n:
        return np.array(n['matrix'], dtype='f8').reshape(4, 4).T
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * np.array(s)
    M[:3, 3] = t
    return M


def mat_to_quat(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        w, x, y, z = 0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        w, x, y, z = (R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        w, x, y, z = (R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        w, x, y, z = (R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)


def set_trs(n, M):
    for k in ('matrix',):
        n.pop(k, None)
    t = M[:3, 3]
    sx, sy, sz = (np.linalg.norm(M[:3, i]) for i in range(3))
    R = M[:3, :3] / np.array([sx, sy, sz])
    n['translation'] = [float(v) for v in t]
    n['rotation'] = [float(v) for v in mat_to_quat(R)]
    if max(abs(sx - 1), abs(sy - 1), abs(sz - 1)) > 1e-4:
        n['scale'] = [float(sx), float(sy), float(sz)]
    else:
        n.pop('scale', None)


# AgX (three.js r169 AgXToneMapping), producing linear sRGB.
def _cols(*c): return np.array(c, dtype='f8').T
SRGB_TO_2020 = _cols((0.6274, 0.0691, 0.0164), (0.3293, 0.9195, 0.0880), (0.0433, 0.0113, 0.8956))
R2020_TO_SRGB = _cols((1.6605, -0.1246, -0.0182), (-0.5876, 1.1329, -0.1006), (-0.0728, -0.0083, 1.1187))
INSET = _cols((0.856627153315983, 0.137318972929847, 0.11189821299995), (0.0951212405381588, 0.761241990602591, 0.0767994186031903), (0.0482516061458583, 0.101439036467562, 0.811302368396859))
OUTSET = _cols((1.1271005818144368, -0.1413297634984383, -0.14132976349843826), (-0.11060664309660323, 1.157823702216272, -0.11060664309660294), (-0.016493938717834573, -0.016493938717834257, 1.2519364065950405))


def agx(c, exposure=1.0):
    c = SRGB_TO_2020 @ (np.array(c, dtype='f8') * exposure)
    c = INSET @ c
    c = np.log2(np.maximum(c, 1e-10))
    c = np.clip((c + 12.47393) / (4.026069 + 12.47393), 0, 1)
    x2 = c * c; x4 = x2 * x2
    c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232
    c = OUTSET @ c
    c = np.power(np.maximum(c, 0), 2.2)
    return np.clip(R2020_TO_SRGB @ c, 0, 1)


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--rest-from-bind', action='store_true')
    ap.add_argument('--face', choices=['+x', '-x', '-z', '+z'], default='+z')
    ap.add_argument('--unlit-emission', action='store_true')
    ap.add_argument('--exposure', type=float, default=1.0)
    ap.add_argument('--eyes', default='')
    ap.add_argument('--expressions', default='')
    ap.add_argument('--report', default='')
    ap.add_argument('--patch-materials', default='', help='JSON {material: {baseColorTexture: {image: name|index}, baseColorFactor, alphaMode, alphaCutoff}}')
    ap.add_argument('--add-image', action='append', default=[], help='name=path.png appended as a new image')
    ap.add_argument('--nudge', action='append', default=[], help='MeshNodeName=dx,dy,dz offset (after facing fix) to settle z-fighting layers')
    ap.add_argument('--textures-max', type=int, default=0, help='downscale textures larger than this (px)')
    ap.add_argument('--jpeg', type=int, default=0, help='re-encode opaque textures as JPEG with this quality (0 = keep)')
    ap.add_argument('--thicken', action='append', default=[], help='MeshNodeName=axis,factor: scale the mesh about its centre on one axis (hairline ribbons that vanish at pet size)')
    o = ap.parse_args()
    j, b = load_glb(o.src)
    N = j['nodes']
    report = {'source': o.src}
    parent = {c: i for i, n in enumerate(N) for c in n.get('children', [])}
    data = {i: read_accessor(j, b, i) for i in range(len(j['accessors']))}

    def world(i, table):
        M = trs_matrix(N[i])
        p = parent.get(i)
        return (world(p, table) if p is not None else np.eye(4)) @ M if p is None or p not in table else table[p] @ M

    # 1. rest pose from bind pose
    skinned_meshes = {n['mesh'] for n in N if 'mesh' in n and 'skin' in n}
    if o.rest_from_bind:
        bind = {}
        for s in j['skins']:
            ibm = data[s['inverseBindMatrices']].astype('f8')
            for k, ji in enumerate(s['joints']):
                bind[ji] = np.linalg.inv(ibm[k].reshape(4, 4).T)
        changed = 0
        cache = {}
        def current_world(i):
            if i in cache: return cache[i]
            p = parent.get(i)
            W = (current_world(p) if p is not None else np.eye(4)) @ trs_matrix(N[i])
            cache[i] = W; return W
        for ji, W in bind.items():
            p = parent.get(ji)
            Wp = bind.get(p) if p in bind else (current_world(p) if p is not None else np.eye(4))
            local = np.linalg.inv(Wp) @ W
            before = trs_matrix(N[ji])
            if np.abs(before - local).max() > 1e-4: changed += 1
            set_trs(N[ji], local)
        report['restFromBind'] = {'joints': len(bind), 'changed': changed}

    # 2. bake facing rotation
    if o.face != '+z':
        ang = {'+x': -90, '-x': 90, '-z': 180}[o.face]
        th = math.radians(ang)
        R = np.array([[math.cos(th), 0, math.sin(th)], [0, 1, 0], [-math.sin(th), 0, math.cos(th)]])
        R4 = np.eye(4); R4[:3, :3] = R
        baked = set()
        for mi in skinned_meshes:
            for p in j['meshes'][mi]['primitives']:
                for key in ('POSITION', 'NORMAL', 'TANGENT'):
                    if key in p['attributes'] and p['attributes'][key] not in baked:
                        a = data[p['attributes'][key]].astype('f4')
                        a[:, :3] = a[:, :3] @ R.T.astype('f4'); data[p['attributes'][key]] = a; baked.add(p['attributes'][key])
                for t in p.get('targets', []):
                    for key in ('POSITION', 'NORMAL', 'TANGENT'):
                        if key in t and t[key] not in baked:
                            a = data[t[key]].astype('f4'); a[:, :3] = a[:, :3] @ R.T.astype('f4'); data[t[key]] = a; baked.add(t[key])
        for s in j['skins']:
            ibm = data[s['inverseBindMatrices']].astype('f8')
            out = np.empty_like(ibm)
            for k in range(len(ibm)):
                M = ibm[k].reshape(4, 4).T @ R4.T
                out[k] = M.T.reshape(16)
            data[s['inverseBindMatrices']] = out.astype('f4')
        roots = j['scenes'][j.get('scene', 0)]['nodes']
        for ri in roots:
            n = N[ri]
            if 'mesh' in n and 'skin' in n: continue
            if 'mesh' in n and n['mesh'] in skinned_meshes: continue
            set_trs(n, R4 @ trs_matrix(n))
        report['faceRotation'] = ang

    # 3. eyes
    vrm = j['extensions']['VRMC_vrm']
    if o.eyes:
        names = o.eyes.split(',')
        idx = {n['name']: i for i, n in enumerate(N)}
        for bone, nm in zip(('leftEye', 'rightEye'), names):
            if nm in idx: vrm['humanoid']['humanBones'][bone] = {'node': idx[nm]}
        report['eyes'] = names

    # 4. expressions
    if o.expressions:
        mapping = json.load(open(o.expressions))
        presets = vrm.setdefault('expressions', {}).setdefault('preset', {})
        custom = vrm['expressions'].setdefault('custom', {})
        bound = {}
        for name, targets in mapping.items():
            binds = []
            for ni, n in enumerate(N):
                if 'mesh' not in n: continue
                tn = (j['meshes'][n['mesh']].get('extras') or {}).get('targetNames') or []
                for t, w in targets.items():
                    if t in tn: binds.append({'node': ni, 'index': tn.index(t), 'weight': float(w)})
            table = presets if name in presets or name in ('happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight', 'neutral', 'lookUp', 'lookDown', 'lookLeft', 'lookRight') else custom
            e = table.setdefault(name, {'isBinary': False, 'overrideBlink': 'none', 'overrideLookAt': 'none', 'overrideMouth': 'none'})
            e['morphTargetBinds'] = binds
            if name in ('happy', 'surprised', 'sad', 'angry', 'relaxed'): e['overrideBlink'] = 'blend'
            bound[name] = len(binds)
        report['expressions'] = bound

    # 5. materials: emission-only -> unlit with AgX-mapped colour
    unlit = set()
    if o.unlit_emission:
        used = set(j.get('extensionsUsed', []))
        conv = {}
        for mi, m in enumerate(j['materials']):
            ext = m.get('extensions', {})
            if 'KHR_materials_unlit' in ext: unlit.add(mi); continue
            base = (m.get('pbrMetallicRoughness') or {}).get('baseColorFactor', [1, 1, 1, 1])
            em = m.get('emissiveFactor')
            if not em or max(base[:3]) > 0.02 or 'baseColorTexture' in (m.get('pbrMetallicRoughness') or {}): continue
            strength = ext.get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1.0)
            col = agx(np.array(em) * strength, o.exposure)
            pbr = {'baseColorFactor': [float(col[0]), float(col[1]), float(col[2]), float(base[3])]}
            if 'emissiveTexture' in m: pbr['baseColorTexture'] = m.pop('emissiveTexture')
            m['pbrMetallicRoughness'] = pbr
            m.pop('emissiveFactor', None)
            ext.pop('KHR_materials_emissive_strength', None)
            ext['KHR_materials_unlit'] = {}
            m['extensions'] = ext
            unlit.add(mi); conv[m['name']] = [round(float(v), 3) for v in col]
        used.add('KHR_materials_unlit')
        if not any('KHR_materials_emissive_strength' in m.get('extensions', {}) for m in j['materials']):
            used.discard('KHR_materials_emissive_strength')
        j['extensionsUsed'] = sorted(used)
        report['unlit'] = conv

    # 5b. explicit material patches (restore textures the export dropped)
    images = j.setdefault('images', [])
    named = {img.get('name'): k for k, img in enumerate(images)}
    extra_images = {}
    for spec in o.add_image:
        name, path = spec.split('=', 1)
        images.append({'name': name, 'mimeType': 'image/png'})
        named[name] = len(images) - 1
        extra_images[len(images) - 1] = open(path, 'rb').read()
    if o.patch_materials:
        patches = json.load(open(o.patch_materials))
        byname = {m['name']: m for m in j['materials']}
        for name, pt in patches.items():
            m = byname[name]
            pbr = m.setdefault('pbrMetallicRoughness', {})
            if 'baseColorTexture' in pt:
                img = pt['baseColorTexture']['image']
                src = named[img] if isinstance(img, str) else img
                tex = next((ti for ti, t in enumerate(j['textures']) if t.get('source') == src), None)
                if tex is None:
                    j['textures'].append({'sampler': pt['baseColorTexture'].get('sampler', 0), 'source': src}); tex = len(j['textures']) - 1
                pbr['baseColorTexture'] = {'index': tex}
            if 'baseColorFactor' in pt: pbr['baseColorFactor'] = pt['baseColorFactor']
            for k in ('alphaMode', 'alphaCutoff'):
                if k in pt: m[k] = pt[k]
        report['patchedMaterials'] = list(patches)
    j['__extra_images'] = extra_images

    # 5c. nudge coplanar layers (e.g. irises fighting the eye whites)
    for spec in o.nudge:
        name, vec = spec.split('=', 1)
        off = np.array([float(v) for v in vec.split(',')], dtype='f4')
        for n in N:
            if n.get('name') == name and 'mesh' in n:
                for p in j['meshes'][n['mesh']]['primitives']:
                    ai = p['attributes']['POSITION']; data[ai] = data[ai].astype('f4') + off
        report.setdefault('nudged', []).append(name)

    for spec in o.thicken:
        name, rest = spec.split('=', 1)
        axis, factor = rest.split(','); ax = 'xyz'.index(axis); factor = float(factor)
        for n in N:
            if n.get('name') == name and 'mesh' in n:
                for p in j['meshes'][n['mesh']]['primitives']:
                    ai = p['attributes']['POSITION']; a = data[ai].astype('f4').copy()
                    c = (a[:, ax].min() + a[:, ax].max()) / 2
                    a[:, ax] = c + (a[:, ax] - c) * factor; data[ai] = a
        report.setdefault('thickened', []).append(name)

    # 6. slimming
    dropped_colors = 0
    dropped_morph_normals = 0
    for m in j['meshes']:
        all_unlit = all(p.get('material') in unlit for p in m['primitives'])
        for p in m['primitives']:
            for k in [k for k in p['attributes'] if k.startswith('COLOR_')]:
                a = data[p['attributes'][k]]
                if a.size and np.allclose(a, a[0]):
                    del p['attributes'][k]; dropped_colors += 1
            if all_unlit:
                for t in p.get('targets', []):
                    for k in ('NORMAL', 'TANGENT'):
                        if k in t: del t[k]; dropped_morph_normals += 1
    report['droppedColorSets'] = dropped_colors
    report['droppedMorphNormals'] = dropped_morph_normals

    if o.textures_max or o.jpeg:
        recompress_images(j, b, o.textures_max, o.jpeg, report)
    write_glb(j, b, data, o.dst, report)
    if o.report:
        json.dump(report, open(o.report, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(report, ensure_ascii=False)[:2000])


def recompress_images(j, b, max_px, quality, report):
    import io
    from PIL import Image
    extra = j.setdefault('__extra_images', {})
    saved = 0
    for k, img in enumerate(j.get('images', [])):
        if k in extra:
            raw = extra[k]
        elif 'bufferView' in img:
            bv = j['bufferViews'][img['bufferView']]
            raw = b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        else:
            continue
        im = Image.open(io.BytesIO(raw))
        im.load()
        if max_px and max(im.size) > max_px:
            f = max_px / max(im.size)
            im = im.resize((max(1, round(im.size[0] * f)), max(1, round(im.size[1] * f))), Image.LANCZOS)
        has_alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 255
        out = io.BytesIO()
        if quality and not has_alpha:
            im.convert('RGB').save(out, 'JPEG', quality=quality, optimize=True)
            mime = 'image/jpeg'
        else:
            im.save(out, 'PNG', optimize=True)
            mime = 'image/png'
        if len(out.getvalue()) < len(raw) or max_px:
            extra[k] = out.getvalue(); img['mimeType'] = mime; saved += len(raw) - len(out.getvalue())
    report['textureBytesSaved'] = int(saved)


def write_glb(j, b, data, dst, report):
    """Rebuild buffer: only referenced accessors, morph targets as sparse accessors."""
    refs = {}
    morph = set()
    for m in j['meshes']:
        for p in m['primitives']:
            for k, v in p['attributes'].items(): refs.setdefault(v, k)
            if 'indices' in p: refs.setdefault(p['indices'], 'INDICES')
            for t in p.get('targets', []):
                for k, v in t.items(): refs.setdefault(v, 'MORPH_' + k); morph.add(v)
    for s in j['skins']: refs.setdefault(s['inverseBindMatrices'], 'IBM')
    for a in j.get('animations', []):
        for s in a['samplers']: refs.setdefault(s['input'], 'ANIM'); refs.setdefault(s['output'], 'ANIM')
    order = sorted(refs)
    remap = {old: new for new, old in enumerate(order)}
    out = bytearray()
    views = []

    def add_view(raw, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(raw); views.append(v); return len(views) - 1

    # images first (keep bytes)
    extra = j.pop('__extra_images', {})
    for k, img in enumerate(j.get('images', [])):
        if k in extra:
            img['bufferView'] = add_view(extra[k])
        elif 'bufferView' in img:
            bv = j['bufferViews'][img['bufferView']]
            raw = b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
            img['bufferView'] = add_view(raw)

    accessors = []
    sparse_saved = 0
    for old in order:
        a = dict(j['accessors'][old])
        arr = data[old]
        dt, sz = CT[a['componentType']]
        a.pop('byteOffset', None); a.pop('sparse', None)
        arr = np.ascontiguousarray(arr.astype(dt))
        kind = refs[old]
        if old in morph:
            nz = np.nonzero(np.abs(arr.astype('f4')).max(axis=1) > 1e-7)[0]
            a.pop('bufferView', None)
            if len(nz) < len(arr):
                ic = 5123 if len(arr) < 65536 else 5125
                idx = nz.astype('<u2' if ic == 5123 else '<u4')
                a['sparse'] = {'count': int(len(nz)),
                               'indices': {'bufferView': add_view(idx.tobytes()), 'componentType': ic},
                               'values': {'bufferView': add_view(arr[nz].tobytes())}}
                if len(nz) == 0:  # empty target: glTF needs count >= 1
                    a['sparse']['count'] = 1
                    a['sparse']['indices'] = {'bufferView': add_view(np.zeros(1, idx.dtype).tobytes()), 'componentType': ic}
                    a['sparse']['values'] = {'bufferView': add_view(np.zeros((1, arr.shape[1]), dt).tobytes())}
                sparse_saved += arr.nbytes - len(nz) * (arr.shape[1] * sz + idx.itemsize)
            else:
                a['bufferView'] = add_view(arr.tobytes(), 34962)
        else:
            target = 34963 if kind == 'INDICES' else (34962 if kind not in ('IBM', 'ANIM') else None)
            a['bufferView'] = add_view(arr.tobytes(), target)
        if kind in ('POSITION', 'MORPH_POSITION'):
            f = arr.astype('f4')
            a['min'] = [float(v) for v in f.min(axis=0)]; a['max'] = [float(v) for v in f.max(axis=0)]
        accessors.append(a)
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = remap[p['indices']]
            if 'targets' in p: p['targets'] = [{k: remap[v] for k, v in t.items()} for t in p['targets']]
    for s in j['skins']: s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
    for an in j.get('animations', []):
        for s in an['samplers']: s['input'] = remap[s['input']]; s['output'] = remap[s['output']]
    j['accessors'] = accessors
    j['bufferViews'] = views
    while len(out) % 4: out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(out), b'BIN\x00')); f.write(out)
    report['bytes'] = total
    report['sparseSavedBytes'] = int(sparse_saved)


if __name__ == '__main__':
    main()
