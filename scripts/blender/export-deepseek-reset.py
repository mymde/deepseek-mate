"""Re-export DeepSeek_Reset_4K_Lite.blend as a desk-pet ready VRM 1.0 (Blender 5.2 + VRM Add-on 4.10).

Run (the .blend is opened read-only in memory and never saved):
  blender -b DeepSeek_Reset_4K_Lite.blend --python export-deepseek-reset.py -- OUT.vrm WORKDIR

What it does, in order:
  1. turns the character from +X to -Y (Blender front) — mesh data, shape keys and armature rest bones
  2. drops the duplicate MMD outline mesh and solidify outlines (MToon outlines replace them)
  3. bakes each material's true colour (HoYoverse/Genshin toon groups -> emission) with Cycles
  4. converts every material to MToon 1.0 with lit/shade colours and screen-space outlines
  5. binds VRM expressions to the existing shape keys, registers eye bones, fills credit meta
"""
import bpy, math, os, sys, json
import numpy as np
from mathutils import Matrix

import time
T0 = time.time()
def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, WORK = argv[0], argv[1]
os.makedirs(WORK, exist_ok=True)
report = {}
scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.data.pose_position = 'REST'
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)

# Desk-pet scale never needs 4K: shrink big textures up front (also keeps the bake within ~1.5 GB).
for img in bpy.data.images:
    if img.source == 'FILE' and max(img.size) > 2048:
        img.scale(2048, 2048)
        log('scaled', img.name)
log('textures ready')

# ---------------------------------------------------------------- 1. face -Y
R = Matrix.Rotation(-math.pi / 2, 4, 'Z')
done_meshes = set()
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.name not in done_meshes:
        o.data.transform(R, shape_keys=True)
        done_meshes.add(o.data.name)
arm.data.transform(R)
for o in bpy.data.objects:
    if o.parent is None and o.type not in ('MESH', 'ARMATURE'):
        o.matrix_world = R @ o.matrix_world
report['rotatedMeshes'] = len(done_meshes)

# ---------------------------------------------------------------- 2. outlines
for name in ['Body MMD outline - face and hands']:
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name])
removed = 0
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for m in list(o.modifiers):
        if m.type == 'SOLIDIFY' and 'mmd' in m.name.lower():
            o.modifiers.remove(m); removed += 1
report['removedSolidify'] = removed

# Small geometric fixes: settle the iris/eye-white z-fight, make the hairline mouth visible.
for name, delta in [('Iris_L', (0, -0.0015, 0)), ('Iris_R', (0, -0.0015, 0)), ('QC_Star_L', (0, -0.0018, 0)), ('QC_Star_R', (0, -0.0018, 0))]:
    if name in bpy.data.objects:
        bpy.data.objects[name].data.transform(Matrix.Translation(delta), shape_keys=True)
if 'DeepSeek mouth contour' in bpy.data.objects:
    me = bpy.data.objects['DeepSeek mouth contour'].data
    zs = [v.co.z for v in me.vertices]
    c = (min(zs) + max(zs)) / 2
    S = Matrix.Translation((0, 0, c)) @ Matrix.Diagonal((1, 1, 6, 1)) @ Matrix.Translation((0, 0, -c))
    me.transform(S, shape_keys=True)

# ---------------------------------------------------------------- 3. bake true colours
export_objects = [o for o in bpy.data.objects if o.type == 'MESH' and not o.hide_render and o.visible_get()]
SKIP = {'Teacher_Ahoge_1'}
mats = {}
for o in export_objects:
    for slot in o.material_slots:
        m = slot.material
        if m and not m.name.startswith('mmd_edge') and m.name not in SKIP and m.use_nodes:
            mats.setdefault(m.name, (m, []))[1].append(o)


def source_size(m):
    sizes = [n.image.size[0] for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image and n.image.size[0] > 8]
    return max(sizes) if sizes else 0


def to_emission(m):
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output)
    rim_emissions = {n for n in nt.nodes if n.bl_idname == 'ShaderNodeEmission'}
    for g in [n for n in nt.nodes if n.bl_idname == 'ShaderNodeGroup' and n.node_tree and n.node_tree.name.startswith('HoYoverse')]:
        em = nt.nodes.new('ShaderNodeEmission')
        dc = g.inputs.get('Diffuse Color')
        if dc and dc.is_linked:
            nt.links.new(dc.links[0].from_socket, em.inputs['Color'])
        elif dc:
            em.inputs['Color'].default_value = dc.default_value
        for l in list(g.outputs['BSDF'].links):
            nt.links.new(em.outputs['Emission'], l.to_socket)
    # Bypass rim-light mixes: a Mix Shader whose one side is an original Emission node.
    for n in [n for n in nt.nodes if n.bl_idname == 'ShaderNodeMixShader']:
        a, b = n.inputs[1], n.inputs[2]
        side_rim = lambda s: s.is_linked and s.links[0].from_node in rim_emissions
        if side_rim(b) and not side_rim(a):
            for l in list(n.inputs[0].links): nt.links.remove(l)
            n.inputs[0].default_value = 0.0
        elif side_rim(a) and not side_rim(b):
            for l in list(n.inputs[0].links): nt.links.remove(l)
            n.inputs[0].default_value = 1.0
    # Transparent/emission mixes (iris, eye layers) keep their colour branch only.
    for n in [n for n in nt.nodes if n.bl_idname == 'ShaderNodeMixShader']:
        for i in (1, 2):
            s = n.inputs[i]
            if s.is_linked and s.links[0].from_node.bl_idname == 'ShaderNodeBsdfTransparent':
                for l in list(n.inputs[0].links): nt.links.remove(l)
                n.inputs[0].default_value = 1.0 if i == 1 else 0.0
    return out


scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = 3
scene.render.bake.margin = 8
scene.render.bake.use_clear = True
scene.render.bake.target = 'IMAGE_TEXTURES'
baked = {}
solid = {}


def solid_colour(m):
    """Colour of a texture-less toon material: the GI group's diffuse input (ramp evaluated mid-way)."""
    for g in m.node_tree.nodes:
        if g.bl_idname == 'ShaderNodeGroup' and g.node_tree and g.node_tree.name.startswith('HoYoverse'):
            dc = g.inputs.get('Diffuse Color')
            if dc is None: break
            if not dc.is_linked: return tuple(dc.default_value)[:3]
            src = dc.links[0].from_node
            if src.bl_idname == 'ShaderNodeValToRGB': return tuple(src.color_ramp.evaluate(0.5))[:3]
            if src.bl_idname == 'ShaderNodeRGB': return tuple(src.outputs[0].default_value)[:3]
    for n in m.node_tree.nodes:
        if n.bl_idname == 'ShaderNodeEmission' and not n.inputs['Color'].is_linked:
            c = n.inputs['Color'].default_value; k = n.inputs['Strength'].default_value
            return tuple(min(1.0, c[i] * min(k, 1.0)) for i in range(3))
    return (1.0, 1.0, 1.0)


for name, (m, objs) in list(mats.items()):
    if all(not o.data.uv_layers for o in objs) or source_size(m) == 0:
        solid[name] = solid_colour(m)
        del mats[name]
report['solid'] = {k: [round(c, 3) for c in v] for k, v in solid.items()}
for name, (m, objs) in mats.items():
    size = source_size(m)
    res = 64 if size == 0 else min(2048 if name in ('Hair.002', 'Head_Skin - rebuilt mouth', 'Tripo_skirt_fb_v65', 'Tripo_torso.001') else 1024, size)
    to_emission(m)
    img = bpy.data.images.new('bake_' + name, res, res, alpha=False)
    node = m.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    for n in m.node_tree.nodes: n.select = False
    node.select = True
    m.node_tree.nodes.active = node
    baked[name] = (img, node)
# Bake one material at a time with only its objects renderable: keeps Cycles from loading every 4K
# texture in the scene at once (the full-scene bake needs ~3 GB).
all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
saved_hide = {o.name: o.hide_render for o in all_meshes}
for o in all_meshes:
    if o.data.uv_layers:
        o.data.uv_layers.active_index = 0
for name, (img, node) in baked.items():
    m, objs = mats[name]
    objs = [o for o in objs if o.data.uv_layers]
    if not objs:
        continue
    for o in all_meshes:
        o.hide_render = o not in objs
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # Other materials on these objects must not receive this bake: deselect their image nodes.
    for o in objs:
        for slot in o.material_slots:
            om = slot.material
            if om and om.use_nodes and om.name != name:
                for n in om.node_tree.nodes:
                    if n.bl_idname == 'ShaderNodeTexImage':
                        n.select = False
                mine = baked.get(om.name)
                om.node_tree.nodes.active = mine[1] if mine else None
                if mine:
                    mine[1].select = False
    node.select = True
    m.node_tree.nodes.active = node
    bpy.ops.object.bake(type='EMIT', use_clear=True)
    path = os.path.join(WORK, f'{name.replace(" ", "_").replace("/", "_")}.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    for src in bpy.data.images:
        if src.has_data and src not in [v[0] for v in baked.values()]:
            src.buffers_free()
    log('BAKED', name, img.size[0])
for o in all_meshes:
    o.hide_render = saved_hide[o.name]
report['baked'] = {k: v[0].size[0] for k, v in baked.items()}

# Irises: keep the baked colour, take the cut-out from the base layer's alpha.
for side in ('L', 'R'):
    key = f'Iris_{side}.001'
    base = bpy.data.images.get(f'tex{side}_iris_base.png')
    if key in baked and base:
        img = baked[key][0]
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        b = np.array(base.pixels[:], dtype=np.float32).reshape(base.size[1], base.size[0], 4)
        if b.shape[:2] != (h, w):
            ys = (np.arange(h) * b.shape[0] / h).astype(int); xs = (np.arange(w) * b.shape[1] / w).astype(int)
            b = b[ys][:, xs]
        rgba = bpy.data.images.new(f'iris_{side}_rgba', w, h, alpha=True)
        px[:, :, 3] = b[:, :, 3]
        rgba.pixels[:] = px.ravel()
        rgba.filepath_raw = os.path.join(WORK, f'iris_{side}.png'); rgba.file_format = 'PNG'; rgba.save()
        baked[key] = (rgba, None)

# ---------------------------------------------------------------- 4. MToon
NO_OUTLINE = ('Iris', 'EyeWhite', 'Mouth', 'QC star', 'Head_Skin')
for name, colour in solid.items():
    m = bpy.data.materials[name]
    m1 = m.vrm_addon_extension.mtoon1
    m1.enabled = True
    m1.pbr_metallic_roughness.base_color_factor = (*colour, 1)
    mt = m1.extensions.vrmc_materials_mtoon
    mt.shade_color_factor = tuple(c * 0.8 for c in colour)
    mt.shading_toony_factor = 0.92
    mt.shading_shift_factor = -0.15
    if any(k in name for k in NO_OUTLINE):
        mt.outline_width_mode = 'none'
    else:
        mt.outline_width_mode = 'worldCoordinates'
        mt.outline_width_factor = 0.0007
        mt.outline_color_factor = (0.12, 0.08, 0.13)
        mt.outline_lighting_mix_factor = 1.0
for name, (img, _) in baked.items():
    m = bpy.data.materials[name]
    m1 = m.vrm_addon_extension.mtoon1
    m1.enabled = True
    m1.pbr_metallic_roughness.base_color_factor = (1, 1, 1, 1)
    m1.pbr_metallic_roughness.base_color_texture.index.source = img
    mt = m1.extensions.vrmc_materials_mtoon
    mt.shade_multiply_texture.index.source = img
    face_like = any(k in name for k in ('Iris', 'EyeWhite', 'Mouth', 'QC star'))
    mt.shade_color_factor = (1, 1, 1) if face_like else (0.80, 0.76, 0.88)
    mt.shading_toony_factor = 0.92
    mt.shading_shift_factor = -0.15
    mt.gi_equalization_factor = 0.9
    if any(k in name for k in NO_OUTLINE):
        mt.outline_width_mode = 'none'
    else:
        mt.outline_width_mode = 'worldCoordinates'
        mt.outline_width_factor = 0.0007
        mt.outline_color_factor = (0.12, 0.08, 0.13)
        mt.outline_lighting_mix_factor = 1.0
    if name.startswith('Iris'):
        m1.alpha_mode = 'MASK'
        m1.alpha_cutoff = 0.5
    m1.double_sided = True
report['mtoon'] = len(baked)

# ---------------------------------------------------------------- 5. VRM data
ext = arm.data.vrm_addon_extension
ext.spec_version = '1.0'
hb = ext.vrm1.humanoid.human_bones
# Explicit Mixamo -> VRM humanoid map (the .blend had no assignment; auto-matching is not deterministic).
MIXAMO = {'hips': 'Hips', 'spine': 'Spine', 'chest': 'Spine1', 'upper_chest': 'Spine2', 'neck': 'Neck', 'head': 'Head',
          'left_eye': 'LeftEye', 'right_eye': 'RightEye'}
for side, S in (('left', 'Left'), ('right', 'Right')):
    MIXAMO.update({f'{side}_shoulder': f'{S}Shoulder', f'{side}_upper_arm': f'{S}Arm', f'{side}_lower_arm': f'{S}ForeArm', f'{side}_hand': f'{S}Hand',
                   f'{side}_upper_leg': f'{S}UpLeg', f'{side}_lower_leg': f'{S}Leg', f'{side}_foot': f'{S}Foot', f'{side}_toes': f'{S}ToeBase',
                   f'{side}_thumb_metacarpal': f'{S}HandThumb1', f'{side}_thumb_proximal': f'{S}HandThumb2', f'{side}_thumb_distal': f'{S}HandThumb3'})
    for vrm_f, mx_f in (('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('little', 'Pinky')):
        for k, part in enumerate(('proximal', 'intermediate', 'distal'), 1):
            MIXAMO[f'{side}_{vrm_f}_{part}'] = f'{S}Hand{mx_f}{k}'
by_suffix = {b.name.split(':')[-1]: b.name for b in arm.data.bones}
assigned = 0
for vrm_name, mx in MIXAMO.items():
    if mx in by_suffix and hasattr(hb, vrm_name):
        getattr(hb, vrm_name).node.bone_name = by_suffix[mx]
        assigned += 1
report['humanBones'] = assigned
# Geometry-node lighting helpers only feed Blender's Genshin shader; they block shape-key export.
for o in bpy.data.objects:
    if o.type == 'MESH':
        for m in list(o.modifiers):
            if m.type == 'NODES':
                o.modifiers.remove(m)
ext.vrm1.humanoid.pose = 'restPositionPose'

EXPR = {
    'blink': {'EA_blink': 1}, 'blink_left': {'EA_blink_L': 1}, 'blink_right': {'EA_blink_R': 1},
    'happy': {'QC_smile': 1, 'OD_smile': 1, 'EA_brow_happy': 1},
    'angry': {'EA_angry_eye': 1, 'EA_brow_angry': 1, 'OD_corner_down': 0.6},
    'sad': {'EA_sad_eye': 1, 'EA_brow_sad': 1, 'OD_corner_down': 0.5},
    'relaxed': {'EA_relaxed_eye': 1, 'EA_brow_relaxed': 1, 'OD_smile': 0.4},
    'surprised': {'EA_surprised_eye': 1, 'EA_brow_surprised': 1, 'OD_oh': 0.6},
    'aa': {'OD_aa': 1}, 'ih': {'OD_ih': 1}, 'ou': {'OD_ou': 1}, 'ee': {'OD_ee': 1}, 'oh': {'OD_oh': 1},
}
CUSTOM = {'jito': {'AP_jito': 1}, 'wink': {'QC_wink_l': 1}, 'tehe': {'OD_tongue_tehe': 1, 'QC_wink_r': 1}}
mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]


def bind(expr, targets):
    n = 0
    for o in mesh_objs:
        keys = o.data.shape_keys.key_blocks
        for k, w in targets.items():
            if k in keys:
                b = expr.morph_target_binds.add()
                b.node.mesh_object_name = o.name
                b.index = k
                b.weight = w
                n += 1
    return n


bound = {}
preset = ext.vrm1.expressions.preset
for name, targets in EXPR.items():
    e = getattr(preset, name)
    e.morph_target_binds.clear()
    bound[name] = bind(e, targets)
    if name in ('happy', 'angry', 'sad', 'relaxed', 'surprised'):
        e.override_blink = 'blend'
for name, targets in CUSTOM.items():
    e = ext.vrm1.expressions.custom.add()
    e.custom_name = name
    bound[name] = bind(e, targets)
report['expressions'] = bound

meta = ext.vrm1.meta
meta.vrm_name = 'DeepSeek Reset'
meta.version = '1.0-deskpet'
meta.authors.clear()
meta.authors.add().value = 'hihihihi202 (bilibili)'
meta.contact_information = 'https://space.bilibili.com/3546568969947566'
meta.references.clear()
meta.references.add().value = 'https://space.bilibili.com/3546568969947566'
meta.copyright_information = '使用本模型请注明 B站 @hihihihi202（https://space.bilibili.com/3546568969947566）。原作者允许修改，禁止商用。'
meta.avatar_permission = 'everyone'
meta.commercial_usage = 'personalNonProfit'
meta.credit_notation = 'required'
meta.allow_redistribution = True
meta.modification = 'allowModificationRedistribution'

# ---------------------------------------------------------------- export
from bl_ext.user_default.vrm.editor.validation import WM_OT_vrm_validator, VrmValidationError
bpy.types.WindowManager.deskpet_errors = bpy.props.CollectionProperty(type=VrmValidationError)
wm = bpy.context.window_manager
wm.deskpet_errors.clear()
WM_OT_vrm_validator.detect_errors(bpy.context, wm.deskpet_errors, arm.name, execute_migration=True)
for e in wm.deskpet_errors:
    log('VALIDATION', e.severity, e.message[:300])
report['validation'] = [(e.severity, e.message[:300]) for e in wm.deskpet_errors]
log('exporting')
bpy.context.view_layer.objects.active = arm
res = bpy.ops.export_scene.vrm(filepath=OUT, armature_object_name=arm.name, ignore_warning=True)
report['export'] = list(res)
json.dump(report, open(os.path.join(WORK, 'export-report.json'), 'w'), indent=1, ensure_ascii=False)
print('EXPORT_REPORT', json.dumps(report, ensure_ascii=False))
