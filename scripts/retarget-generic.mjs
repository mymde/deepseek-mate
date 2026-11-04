// Local Biped -> normalized VRM retarget experiment. No Unity runtime required.
// Calibration is specific to GI's Nahida Biped: X is bone length; fixed world
// bases define a straight T-pose. This is NOT the FBX's posed first frame.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import * as T from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
const [repo, cache, output = 'test/local-motions/generic.json'] = process.argv.slice(2)
if (!repo || !cache) throw Error('Usage: node scripts/retarget-generic.mjs GI_REPO CURVE_CACHE [OUTPUT]')
T.TextureLoader.prototype.load = () => new T.Texture()
globalThis.window = { URL }
const fb = readFileSync(join(repo, 'Assets/MATE ENGINE - Animations/nEW/NPC_Avatar_Loli_Catalyst_Nahida.fbx'))
const root = new FBXLoader().parse(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength), '')
const mapping = { hips: 'Pelvis', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head' }
for (const [side, s] of [
  ['left', 'L'],
  ['right', 'R']
]) {
  for (const [human, source] of Object.entries({
    Shoulder: 'Clavicle',
    UpperArm: 'UpperArm',
    LowerArm: 'Forearm',
    Hand: 'Hand',
    UpperLeg: 'Thigh',
    LowerLeg: 'Calf',
    Foot: 'Foot',
    Toes: 'Toe0'
  }))
    mapping[side + human] = s + '_' + source
  for (const [i, finger] of ['Index', 'Middle', 'Ring', 'Little'].entries())
    for (const [j, part] of ['Proximal', 'Intermediate', 'Distal'].entries())
      mapping[side + finger + part] = s + '_Finger' + (i + 1) + (j || '')
}
const q = (...x) => new T.Quaternion(...x),
  h = Math.SQRT1_2
const bind = {},
  nodes = {},
  parents = {}
for (const [human, suffix] of Object.entries(mapping)) {
  const node = root.getObjectByName('Bip001_' + suffix)
  if (!node) throw Error('Missing reference bone ' + suffix)
  nodes[human] = node
  bind[human] = /Leg|Foot/.test(human)
    ? q(0.5, -0.5, -0.5, 0.5)
    : /Toes/.test(human)
      ? q(0, -h, 0, h)
      : /Hand|Index|Middle|Ring|Little/.test(human)
        ? human.startsWith('left')
          ? q(1, 0, 0, 0)
          : q(0, 0, 1, 0)
        : /Shoulder|Arm/.test(human)
          ? human.startsWith('left')
            ? q(-h, 0, 0, h)
            : q(0, -h, h, 0)
          : q(0.5, 0.5, 0.5, 0.5)
}
for (const [human, node] of Object.entries(nodes)) {
  let p = node.parent
  while (p && !Object.values(nodes).includes(p)) p = p.parent
  parents[human] = Object.keys(nodes).find((k) => nodes[k] === p)
}
const defaults = []
root.traverse((n) => defaults.push([n, n.position.clone(), n.quaternion.clone(), n.scale.clone()]))
const sample = (keys, t, rotation) => {
  let lo = 0,
    hi = keys.length - 1
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1
    if (keys[m][0] <= t) lo = m
    else hi = m
  }
  const a = keys[lo],
    b = keys[hi],
    w = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)))
  if (rotation)
    return q(...a.slice(1))
      .normalize()
      .slerp(q(...b.slice(1)).normalize(), w)
      .toArray()
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * w)
}
const pack = { version: 1, name: '原骨架本地重定向（实验）', clips: {} }
for (const file of readdirSync(cache)
  .filter((n) => n.endsWith('.json'))
  .sort()) {
  const data = JSON.parse(readFileSync(join(cache, file)))
  if (!data.source.path.includes('Ani_Avatar_NPC_Loli_Catalyst_Nahida_')) continue
  // Fail closed: nested sleeve/hair paths must not be mistaken for body tracks.
  const animated = new Set(data.curves.m_RotationCurves.map((c) => c.path.split('/').at(-1).replaceAll(' ', '_')))
  const missing = ['hips', 'spine', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'].filter(
    (k) => !animated.has(nodes[k].name)
  )
  if (missing.length)
    throw Error('REJECTED ' + data.source.path + ': missing body rotation channels: ' + missing.join(', '))
  const start = data.settings.m_StartTime,
    duration = data.settings.m_StopTime - start
  if (!(duration > 0 && duration <= 300)) throw Error('Unsupported duration ' + data.source.path)
  const tracks = []
  for (const [kind, list] of Object.entries(data.curves))
    for (const c of list) {
      const name = c.path.split('/').at(-1).replaceAll(' ', '_'),
        node = root.getObjectByName(name)
      if (!node) throw Error('Missing source channel ' + c.path)
      tracks.push({ kind, node, keys: c.keys })
    }
  for (const [n, p, r, s] of defaults) {
    n.position.copy(p)
    n.quaternion.copy(r)
    n.scale.copy(s)
  }
  const count = Math.ceil(duration * 30) + 1,
    frames = Object.fromEntries(Object.keys(nodes).map((k) => [k, []]))
  for (let i = 0; i < count; i++) {
    const t = start + (i * duration) / (count - 1)
    for (const { kind, node, keys } of tracks) {
      if (kind === 'm_RotationCurves') {
        const [x, y, z, w] = sample(keys, t, true)
        node.quaternion.set(x, -y, -z, w)
      } else if (kind === 'm_PositionCurves') {
        const [x, y, z] = sample(keys, t, false)
        node.position.set(-x, y, z)
      } else {
        const s = sample(keys, t, false)
        if (s.some((v) => Math.abs(v - 1) > 0.001)) throw Error('Animated scaling needs explicit adaptation')
        node.scale.set(...s)
      }
    }
    root.updateMatrixWorld(true)
    const delta = {}
    for (const k in nodes)
      delta[k] = nodes[k].getWorldQuaternion(new T.Quaternion()).multiply(bind[k].clone().invert()).normalize()
    for (const k in nodes) {
      const v = parents[k] ? delta[parents[k]].clone().invert().multiply(delta[k]) : delta[k]
      v.normalize()
      if (frames[k].length && v.dot(q(...frames[k].slice(-4))) < 0) v.set(-v.x, -v.y, -v.z, -v.w)
      frames[k].push(...v.toArray().map((v) => +v.toFixed(6)))
    }
  }
  const stem = basename(data.source.path, '.anim').replace('Ani_Avatar_NPC_Loli_Catalyst_Nahida_', ''),
    id = 'npc-' + stem.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  pack.clips[id] = {
    label: stem,
    category: '原骨架动作',
    duration,
    loop: stem.endsWith('Loop'),
    frames,
    source: data.source,
    adaptation:
      'Biped axis calibration; upper-body preview; thumbs, facial curves, root translation, IK and props are not retargeted.'
  }
  console.log(id, count, Object.keys(frames).length)
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(pack))
