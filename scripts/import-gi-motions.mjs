// Converts a local GI-Engine checkout for personal preview. No engine source is copied.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
const repo = process.argv[2],
  output = process.argv[3] ?? 'test/local-motions/gi-motions.json'
if (!repo) throw new Error('Usage: node scripts/import-gi-motions.mjs /path/to/GI-Engine [output.json]')
THREE.TextureLoader.prototype.load = () => new THREE.Texture()
globalThis.window = { URL, innerWidth: 1, innerHeight: 1 }
const selected = {
  stand: ['01_Idles/AGIA_Idle_generic_01.fbx', '自然待机', true],
  walk: ['03_Others/AGIA_Other_walking_01.fbx', '行走', true],
  wave: ['03_Others/AGIA_Other_waving_arm_01.fbx', '挥手', true],
  'gi-fist': ['01_Idles/AGIA_Idle_energetic_01_right_fist_up.fbx', '元气握拳', true],
  'gi-shy': ['01_Idles/AGIA_Idle_pitiable_01_right_hand_on_back_head.fbx', '害羞挠头', true],
  'gi-brave': ['01_Idles/AGIA_Idle_brave_01_hand_on_chest.fbx', '手抚胸口', true],
  'gi-surprise': ['01_Idles/AGIA_Idle_surprise_01_hands_open_front.fbx', '惊讶摊手', true],
  'gi-angry': ['01_Idles/AGIA_Idle_angry_01_hands_on_waist.fbx', '叉腰', true],
  'gi-peace': ['01_Idles/AGIA_Idle_energetic_02_right_hand_piece.fbx', '元气比耶', true],
  'gi-concern': ['01_Idles/AGIA_Idle_concern_01_right_hand_front.fbx', '关切伸手', true],
  'gi-calm': ['01_Idles/AGIA_Idle_calm_01_hands_on_back.fbx', '背手待机', true],
  'gi-sway': ['02_Layers/AGIA_Layer_swinging_body_01.fbx', '轻摆身体', true],
  'gi-look': ['02_Layers/AGIA_Layer_look_away_01.fbx', '转头张望', true],
  'gi-nod': ['02_Layers/AGIA_Layer_nodding_once_01.fbx', '点头', false]
}
const pack = {
  version: 1,
  name: 'GI-Engine 本地动作适配',
  attribution:
    'GI-Engine (Nekoluna-dot), Anime Girl Idle Animations (AGIA) by Clean Curve Studio. Original asset terms apply; not MIT. Local personal-use adaptation; not cleared for public redistribution.',
  clips: {}
}
const vec = (text) =>
  Object.fromEntries([...text.matchAll(/([xyzw]):\s*([-+\deE.]+)/g)].map((m) => [m[1], Number(m[2])]))
for (const [id, [relative, label, loop]] of Object.entries(selected)) {
  const path = join(repo, 'Assets/MATE ENGINE - Animations', relative)
  const bytes = readFileSync(path),
    meta = readFileSync(path + '.meta', 'utf8')
  const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const mapping = {}
  for (const m of meta.matchAll(/- boneName: (.+)\n\s+humanName: (.+)/g)) {
    let n = m[2].replaceAll(' ', '')
    n = n[0].toLowerCase() + n.slice(1)
    n = n.replace('ThumbProximal', 'ThumbMetacarpal').replace('ThumbIntermediate', 'ThumbProximal')
    if (model.getObjectByName(m[1])) mapping[n] = m[1]
  }
  const restNodes = new Map()
  const skeleton = meta.split('    skeleton:')[1] ?? ''
  for (const m of skeleton.matchAll(
    /- name: (.+)\n\s+parentName:([^\n]*)\n\s+position: \{([^}]+)\}\n\s+rotation: \{([^}]+)\}/g
  )) {
    const p = vec(m[3]),
      q = vec(m[4]),
      node = new THREE.Object3D()
    node.name = m[1]
    node.position.set(-p.x * 100, p.y * 100, p.z * 100)
    node.quaternion.set(q.x, -q.y, -q.z, q.w).normalize()
    restNodes.set(node.name, { node, parent: m[2].trim() })
  }
  for (const { node, parent } of restNodes.values()) restNodes.get(parent)?.node.add(node)
  const rest = {},
    parents = {},
    nodes = {}
  for (const [human, name] of Object.entries(mapping)) {
    const bind = restNodes.get(name)?.node
    if (!bind) throw new Error('Missing authoritative avatar rest bone: ' + name)
    bind.updateWorldMatrix(true, false)
    rest[human] = bind.getWorldQuaternion(new THREE.Quaternion()).invert()
    nodes[human] = model.getObjectByName(name)
    let p = nodes[human].parent
    while (p && !Object.values(mapping).includes(p.name)) p = p.parent
    parents[human] = Object.keys(mapping).find((k) => mapping[k] === p?.name)
  }
  const hipRestY = restNodes.get(mapping.hips).node.getWorldPosition(new THREE.Vector3()).y
  const height = restNodes.get(mapping.head).node.getWorldPosition(new THREE.Vector3()).y + 20
  const clip = model.animations[0]
  if (!clip || !(clip.duration > 0)) throw new Error('No animated FBX clip: ' + path)
  const mixer = new THREE.AnimationMixer(model)
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play().clampWhenFinished = true
  const count = Math.ceil(clip.duration * 30) + 1
  const frames = Object.fromEntries(Object.keys(mapping).map((k) => [k, []]))
  const rootY = [],
    deltas = {},
    hip = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    mixer.setTime(Math.min(clip.duration - 1e-6, (i * clip.duration) / (count - 1)))
    model.updateMatrixWorld(true)
    for (const k in nodes) deltas[k] = nodes[k].getWorldQuaternion(new THREE.Quaternion()).multiply(rest[k]).normalize()
    for (const k in nodes) {
      const q = parents[k] ? deltas[parents[k]].clone().invert().multiply(deltas[k]) : deltas[k].clone()
      const prev = frames[k].slice(-4)
      if (prev.length && q.dot(new THREE.Quaternion(...prev)) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      frames[k].push(...q.toArray().map((v) => +v.toFixed(6)))
    }
    rootY.push(+((nodes.hips.getWorldPosition(hip).y - hipRestY) / height).toFixed(6))
  }
  // Layer FBXs are authored as overlays; only retain the affected upper body.
  if (relative.startsWith('02_Layers/')) {
    const keep = id === 'gi-sway' ? ['spine', 'chest', 'upperChest'] : ['neck', 'head']
    for (const bone of Object.keys(frames)) if (!keep.includes(bone)) delete frames[bone]
    rootY.fill(0)
  }
  pack.clips[id] = {
    label,
    category: relative.startsWith('01_') ? '待机' : relative.startsWith('02_') ? '上身动作' : '互动',
    duration: clip.duration,
    loop,
    ...(id === 'wave' ? { playDuration: 2.4 } : {}),
    frames,
    rootY,
    source: { project: 'GI-Engine', path: relative, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(model)
  console.log(id, { seconds: clip.duration, bones: Object.keys(frames).length, samples: count })
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(pack))
console.log(output)
