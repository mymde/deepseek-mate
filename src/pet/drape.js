// Seated skirt drape.
//
// Many avatars skin the skirt (and apron) to the hips only. Standing that is fine, but once the
// thighs swing forward to sit, the legs pass straight through the cloth and the knees poke out of
// the front of the skirt. Rather than re-rig the model, build one morph target per leg at load:
// where the hip-bound cloth would lie if it were draped over that thigh in the seated pose. Each
// frame the morph follows how far that thigh is actually raised (sitting, walking, dangling), so
// any sit clip or pose gets a skirt over the lap instead of legs through it.
import * as THREE from 'three'
import { SIT_LEGS } from './poses.js'

const SIT_PITCH = SIT_LEGS.pitch // thigh pitch the morph is built for (the seated legs)
const FLARE_KEEP = 0.6 // how much of the skirt's flare beyond the thigh is kept on the lap
const CLEARANCE = 0.012 // m between thigh surface and the innermost cloth layer

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

let detached = 0

/** Builds the morphs; returns { update(), meshes, legs } or null when the model has no hip-bound cloth. */
export function addSitDrape(vrm) {
  const raw = (name) => vrm.humanoid?.getRawBoneNode(name) ?? null
  const hips = raw('hips')
  const legs = [
    ['left', raw('leftUpperLeg'), raw('leftLowerLeg')],
    ['right', raw('rightUpperLeg'), raw('rightLowerLeg')]
  ]
    .filter(([, thigh, knee]) => thigh && knee)
    .map(([side, thigh, knee]) => ({ side, thigh, knee }))
  if (!hips || legs.length !== 2) return null
  vrm.scene.updateMatrixWorld(true)
  for (const leg of legs) {
    leg.joint = leg.thigh.getWorldPosition(new THREE.Vector3())
    leg.kneeAt = leg.knee.getWorldPosition(new THREE.Vector3())
    leg.length = leg.joint.distanceTo(leg.kneeAt)
  }
  if (legs.some((l) => !(l.length > 0.01))) return null
  const [left, right] = legs
  const center = (left.joint.x + right.joint.x) / 2
  const sideSign = Math.sign(left.joint.x - right.joint.x) || 1
  const gap = Math.abs(left.joint.x - right.joint.x)

  const skinned = []
  vrm.scene.traverse((o) => {
    if (o.isSkinnedMesh && o.geometry?.attributes?.skinWeight) skinned.push(o)
  })
  // Ribbons, hair ends and cloth with a few percent of stray thigh weight (auto-weighting) are
  // torn into spikes when the legs move: they belong to the body, not the legs.
  const legBones = new Set(
    ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes']
      .map(raw)
      .filter(Boolean)
  )
  detached = 0
  for (const mesh of skinned) detached += pruneStrayWeights(mesh) + detachStrayLegWeights(mesh, legBones, hips)
  const radius = thighRadius(skinned, legs)
  const hipBones = new Set([hips, raw('spine'), raw('chest'), raw('upperChest')].filter(Boolean))

  const v = new THREE.Vector3()
  const target = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const knee = new THREE.Vector3()
  const hang = new THREE.Vector3()
  // The seated leg rotations (normalized bones are world-aligned at rest; +Z forward, left = +X).
  const turns = legs.map((leg) => {
    const inward = (leg.side === 'left' ? -1 : 1) * SIT_LEGS.inward * (sideSign > 0 ? 1 : -1)
    const thigh = new THREE.Quaternion().setFromEuler(new THREE.Euler(-SIT_PITCH, 0, inward, 'XYZ'))
    const shin = thigh
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(SIT_LEGS.knee, 0, 0, 'XYZ')))
    return { thigh, shin }
  })
  // Where a point of hip-bound cloth lies when draped over leg k (world, rest frame), or null.
  const drapeTarget = (p, k, out) => {
    const leg = legs[k]
    const a = leg.joint.y - p.y // depth below the hip joint
    const blend = smooth(0, leg.length * 0.35, a)
    if (blend < 1e-3) return null
    // Cross-section around the (vertical, at rest) thigh: keep layer order, drop most flare.
    const l = p.x - leg.joint.x
    const f = p.z - leg.joint.z
    const rho = Math.hypot(l, f)
    const angle = Math.atan2(f, l)
    const fitted = radius + CLEARANCE + Math.max(0, rho - radius) * FLARE_KEEP
    offset.set(Math.cos(angle) * fitted, 0, Math.sin(angle) * fitted)
    // Along the thigh, then (smoothly, so no triangle tears at the knee) hanging past it.
    const bend = smooth(leg.length * 0.8, leg.length * 1.15, a)
    const { thigh: thighTurn, shin: shinTurn } = turns[k]
    out
      .set(offset.x, -Math.min(a, leg.length * 1.15), offset.z)
      .applyQuaternion(thighTurn)
      .add(leg.joint)
    if (bend > 0) {
      knee.set(0, -leg.length, 0).applyQuaternion(thighTurn).add(leg.joint)
      hang
        .set(offset.x, -(a - leg.length), offset.z)
        .applyQuaternion(shinTurn)
        .add(knee)
      out.lerp(hang, bend)
    }
    return out.lerp(p, 1 - blend)
  }
  // Which leg carries a point: a soft split so cloth between the knees follows both.
  const legShare = (p, k) => {
    const t = smooth(-gap * 0.3, gap * 0.3, (p.x - center) * sideSign)
    return k === 0 ? t : 1 - t
  }

  const meshes = []
  const box = new THREE.Box3()
  const origin = new THREE.Vector3()
  for (const mesh of skinned) {
    const g = mesh.geometry
    const pos = g.attributes.position
    // Cloth that hangs from the hips below the hip joints, vertex by vertex: a mesh can mix arm
    // geometry with a few strands sewn onto the skirt. The legs themselves are never draped.
    if (shareOf(g, mesh.skeleton, legBones) >= 0.25) continue
    const hipBound = vertexShares(g, mesh.skeleton, hipBones)
    const bind = mesh.bindMatrix
    const unbind = mesh.bindMatrixInverse
    box.makeEmpty()
    let below = 0
    for (let i = 0; i < pos.count; i++) {
      if (hipBound[i] < 0.85) continue
      v.fromBufferAttribute(pos, i).applyMatrix4(bind)
      box.expandByPoint(v)
      if (v.y < left.joint.y - 0.03) below++
    }
    if (below < 3) continue
    // Small rigid pieces (bows, buttons, charms) move as a whole with the cloth under them.
    const whole = hipBound.every((x) => x >= 0.85)
    const rigid = whole && box.getSize(origin).length() < radius * 3
    const centre = box.getCenter(new THREE.Vector3())
    const deltas = legs.map(() => new Float32Array(pos.count * 3))
    let moved = 0
    for (let k = 0; k < 2; k++) {
      const d = deltas[k]
      if (rigid) {
        const part = legShare(centre, k)
        if (part < 1e-3 || !drapeTarget(centre, k, target)) continue
        const shift = target.applyMatrix4(unbind).sub(origin.copy(centre).applyMatrix4(unbind)).multiplyScalar(part)
        for (let i = 0; i < pos.count; i++) {
          d[i * 3] = shift.x
          d[i * 3 + 1] = shift.y
          d[i * 3 + 2] = shift.z
        }
        moved++
        continue
      }
      for (let i = 0; i < pos.count; i++) {
        if (hipBound[i] < 0.85) continue
        v.fromBufferAttribute(pos, i).applyMatrix4(bind)
        const part = legShare(v, k)
        if (part < 1e-3 || !drapeTarget(v, k, target)) continue
        // Back to the mesh's own (bind) space.
        target.applyMatrix4(unbind).sub(origin.fromBufferAttribute(pos, i)).multiplyScalar(part)
        d[i * 3] = target.x
        d[i * 3 + 1] = target.y
        d[i * 3 + 2] = target.z
        moved++
      }
    }
    if (!moved) continue
    const normals = rigid || !g.attributes.normal ? deltas.map(() => null) : normalDeltas(g, deltas)
    const morphs = g.morphAttributes
    const before = morphs.position?.length ?? 0
    morphs.position ??= []
    // three.js needs normal morphs for every target once any target has them.
    if (!morphs.normal)
      morphs.normal = Array.from(
        { length: before },
        () => new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3)
      )
    if (morphs.normal.length !== before) continue
    const first = before
    deltas.forEach((d, k) => {
      morphs.position.push(new THREE.BufferAttribute(d, 3))
      morphs.normal.push(new THREE.BufferAttribute(normals[k] ?? new Float32Array(pos.count * 3), 3))
    })
    g.morphTargetsRelative = true
    mesh.updateMorphTargets()
    meshes.push({ mesh, first, rigid })
  }
  if (!meshes.length) return null

  // Rest thigh direction and the forward axis, both in the hips' own frame.
  const hipsInverse = new THREE.Matrix4().copy(hips.matrixWorld).invert()
  const hipsTurn = new THREE.Quaternion().setFromRotationMatrix(hipsInverse)
  for (const leg of legs) {
    leg.down = leg.kneeAt.clone().sub(leg.joint).applyQuaternion(hipsTurn).normalize()
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(hipsTurn)
    leg.forward = forward.sub(leg.down.clone().multiplyScalar(forward.dot(leg.down))).normalize()
  }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const inv = new THREE.Matrix4()
  const weights = [0, 0]
  return {
    meshes: meshes.map((m) => m.mesh.name + (m.rigid ? ' (rigid)' : '')),
    detached,
    radius,
    weights,
    /** Call after vrm.update(): reads the thighs and sets the morph weights. */
    update() {
      legs[0].knee.updateWorldMatrix(true, false)
      legs[1].knee.updateWorldMatrix(true, false)
      inv.copy(hips.matrixWorld).invert()
      for (let k = 0; k < 2; k++) {
        const leg = legs[k]
        a.setFromMatrixPosition(leg.thigh.matrixWorld).applyMatrix4(inv)
        b.setFromMatrixPosition(leg.knee.matrixWorld).applyMatrix4(inv)
        b.sub(a).normalize()
        const pitch = Math.atan2(b.dot(leg.forward), b.dot(leg.down))
        weights[k] = Math.min(1.1, Math.max(0, pitch / SIT_PITCH))
      }
      for (const { mesh, first } of meshes) {
        mesh.morphTargetInfluences[first] = weights[0]
        mesh.morphTargetInfluences[first + 1] = weights[1]
      }
    }
  }
}

/** Per vertex: share of its skin weight on the given bones. */
function vertexShares(g, skeleton, bones) {
  const idx = g.attributes.skinIndex
  const w = g.attributes.skinWeight
  const on = new Set((skeleton?.bones ?? []).map((bone, i) => (bones.has(bone) ? i : -1)).filter((i) => i >= 0))
  const out = new Float32Array(w.count)
  for (let i = 0; i < w.count; i++) {
    let hit = 0
    let total = 0
    for (let c = 0; c < 4; c++) {
      const x = w.getComponent(i, c)
      total += x
      if (on.has(idx.getComponent(i, c))) hit += x
    }
    out[i] = total ? hit / total : 0
  }
  return out
}

/** Share of the skin weight carried by the given bones. */
function shareOf(g, skeleton, bones) {
  const idx = g.attributes.skinIndex
  const w = g.attributes.skinWeight
  if (!idx || !w || !skeleton) return 0
  const on = new Set(skeleton.bones.map((bone, i) => (bones.has(bone) ? i : -1)).filter((i) => i >= 0))
  let hip = 0
  let total = 0
  for (let i = 0; i < w.count; i++) {
    for (let c = 0; c < 4; c++) {
      const weight = w.getComponent(i, c)
      total += weight
      if (on.has(idx.getComponent(i, c))) hip += weight
    }
  }
  return total ? hip / total : 0
}

/** Thigh radius from the leg mesh: vertices mostly bound to a thigh, around its middle. */
function thighRadius(skinned, legs) {
  const v = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const distances = []
  for (const mesh of skinned) {
    const g = mesh.geometry
    const idx = g.attributes.skinIndex
    const w = g.attributes.skinWeight
    const pos = g.attributes.position
    const bones = mesh.skeleton?.bones ?? []
    for (const leg of legs) {
      const bi = bones.indexOf(leg.thigh)
      if (bi < 0) continue
      axis.copy(leg.kneeAt).sub(leg.joint).normalize()
      for (let i = 0; i < pos.count; i++) {
        let weight = 0
        for (let c = 0; c < 4; c++) if (idx.getComponent(i, c) === bi) weight += w.getComponent(i, c)
        if (weight < 0.6) continue
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).sub(leg.joint)
        const along = v.dot(axis)
        if (along < leg.length * 0.25 || along > leg.length * 0.75) continue
        distances.push(v.sub(axis.clone().multiplyScalar(along)).length())
      }
    }
  }
  if (distances.length < 20) return legs[0].length * 0.3
  distances.sort((x, y) => x - y)
  return distances[Math.floor(distances.length * 0.92)]
}

/**
 * Normal changes for each leg's morph, so lighting and the MToon outline shell (pushed out along
 * the normals) follow the draped cloth. Computed on the mesh's own topology and added to the
 * authored normals, which keeps seams and hand-tuned normals intact.
 */
function normalDeltas(g, deltas) {
  const pos = g.attributes.position
  const base = new THREE.BufferGeometry()
  base.setIndex(g.index)
  base.setAttribute('position', pos)
  base.computeVertexNormals()
  const n0 = base.attributes.normal.array
  // Both legs draped (the seated shape); each leg takes its own share of the change.
  const moved = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++)
    for (let c = 0; c < 3; c++) moved[i * 3 + c] = pos.getComponent(i, c) + deltas[0][i * 3 + c] + deltas[1][i * 3 + c]
  const draped = new THREE.BufferGeometry()
  draped.setIndex(g.index)
  draped.setAttribute('position', new THREE.BufferAttribute(moved, 3))
  draped.computeVertexNormals()
  const n1 = draped.attributes.normal.array
  return deltas.map((d, k) => {
    const out = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const own = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])
      const other = Math.hypot(deltas[1 - k][i * 3], deltas[1 - k][i * 3 + 1], deltas[1 - k][i * 3 + 2])
      const part = own + other > 1e-9 ? own / (own + other) : 0
      for (let c = 0; c < 3; c++) out[i * 3 + c] = (n1[i * 3 + c] - n0[i * 3 + c]) * part
    }
    return out
  })
}

/**
 * In a mesh that is not part of the legs (< 25 % of its weight on leg bones), drop the leg-bone
 * influences and renormalise the rest (or bind to the hips). Returns the vertices changed.
 */
function detachStrayLegWeights(mesh, legBones, hips) {
  const g = mesh.geometry
  const idx = g.attributes.skinIndex
  const w = g.attributes.skinWeight
  const bones = mesh.skeleton?.bones ?? []
  const leg = new Set(bones.map((b, i) => (legBones.has(b) ? i : -1)).filter((i) => i >= 0))
  if (!leg.size) return 0
  let legWeight = 0
  let total = 0
  for (let i = 0; i < w.count; i++)
    for (let c = 0; c < 4; c++) {
      const x = w.getComponent(i, c)
      total += x
      if (leg.has(idx.getComponent(i, c))) legWeight += x
    }
  if (!total || legWeight / total >= 0.25) return 0
  const hipIndex = bones.indexOf(hips)
  let changed = 0
  for (let i = 0; i < w.count; i++) {
    let rest = 0
    let stray = 0
    for (let c = 0; c < 4; c++) {
      const x = w.getComponent(i, c)
      if (leg.has(idx.getComponent(i, c))) stray += x
      else rest += x
    }
    if (stray <= 0) continue
    for (let c = 0; c < 4; c++) {
      if (leg.has(idx.getComponent(i, c))) {
        w.setComponent(i, c, 0)
      } else if (rest > 0.01) w.setComponent(i, c, w.getComponent(i, c) / rest)
    }
    if (rest <= 0.01) {
      if (hipIndex < 0) continue
      idx.setComponent(i, 0, hipIndex)
      w.setComponent(i, 0, 1)
      for (let c = 1; c < 4; c++) w.setComponent(i, c, 0)
    }
    changed++
  }
  if (changed) {
    idx.needsUpdate = true
    w.needsUpdate = true
  }
  return changed
}

/**
 * Auto-weighting leaves a few percent of far-away bones on some vertices (an arm vertex with a
 * little hips and head weight). Harmless at rest, but once the limb moves those vertices are pulled
 * back toward the far bone and the triangles turn into thin dark spikes. Drop influences from bones
 * that carry < 6 % of the mesh and are more than two steps from the vertex's main bone.
 */
function pruneStrayWeights(mesh) {
  const g = mesh.geometry
  const idx = g.attributes.skinIndex
  const w = g.attributes.skinWeight
  const bones = mesh.skeleton?.bones ?? []
  if (!bones.length) return 0
  const totals = new Float64Array(bones.length)
  let total = 0
  for (let i = 0; i < w.count; i++)
    for (let c = 0; c < 4; c++) {
      const x = w.getComponent(i, c)
      totals[idx.getComponent(i, c)] += x
      total += x
    }
  if (!total) return 0
  const minor = new Set()
  totals.forEach((x, b) => {
    if (x > 0 && x / total < 0.06) minor.add(b)
  })
  if (!minor.size) return 0
  const depth = (bone) => {
    let d = 0
    for (let b = bone; b; b = b.parent) d++
    return d
  }
  const near = new Map()
  const close = (a, b) => {
    const key = a * 4096 + b
    if (near.has(key)) return near.get(key)
    // Distance in the bone tree through the nearest common ancestor.
    let x = bones[a],
      y = bones[b],
      steps = 0
    let dx = depth(x),
      dy = depth(y)
    while (dx > dy) {
      x = x.parent
      dx--
      steps++
    }
    while (dy > dx) {
      y = y.parent
      dy--
      steps++
    }
    while (x !== y && x && y) {
      x = x.parent
      y = y.parent
      steps += 2
    }
    const ok = x === y && steps <= 2
    near.set(key, ok)
    return ok
  }
  let changed = 0
  for (let i = 0; i < w.count; i++) {
    let main = 0
    for (let c = 1; c < 4; c++) if (w.getComponent(i, c) > w.getComponent(i, main)) main = c
    const mainBone = idx.getComponent(i, main)
    let dropped = 0
    for (let c = 0; c < 4; c++) {
      const b = idx.getComponent(i, c)
      const x = w.getComponent(i, c)
      if (c === main || x <= 0 || !minor.has(b) || close(mainBone, b)) continue
      w.setComponent(i, c, 0)
      dropped += x
    }
    if (!dropped) continue
    const rest = 1 - dropped
    for (let c = 0; c < 4; c++) w.setComponent(i, c, rest > 1e-6 ? w.getComponent(i, c) / rest : c === main ? 1 : 0)
    changed++
  }
  // Whole vertices bound to a far bone inside an area bound to another one (an arm vertex fully on
  // the hips): take the weights of the neighbours.
  if (g.index) {
    const index = g.index
    const neighbours = Array.from({ length: w.count }, () => [])
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t),
        b = index.getX(t + 1),
        c = index.getX(t + 2)
      neighbours[a].push(b, c)
      neighbours[b].push(a, c)
      neighbours[c].push(a, b)
    }
    const mainOf = (v) => {
      let m = 0
      for (let c = 1; c < 4; c++) if (w.getComponent(v, c) > w.getComponent(v, m)) m = c
      return idx.getComponent(v, m)
    }
    for (let pass = 0; pass < 3; pass++) {
      let fixed = 0
      for (let v = 0; v < w.count; v++) {
        const list = neighbours[v]
        if (list.length < 2) continue
        const m = mainOf(v)
        if (!minor.has(m)) continue
        const votes = new Map()
        for (const n of list) {
          const b = mainOf(n)
          votes.set(b, (votes.get(b) ?? 0) + 1)
        }
        let best = -1,
          bestVotes = 0
        for (const [b, n] of votes)
          if (n > bestVotes) {
            best = b
            bestVotes = n
          }
        if (best === m || bestVotes < list.length * 0.6 || close(m, best)) continue
        const donor = list.find((n) => mainOf(n) === best)
        for (let c = 0; c < 4; c++) {
          idx.setComponent(v, c, idx.getComponent(donor, c))
          w.setComponent(v, c, w.getComponent(donor, c))
        }
        fixed++
      }
      changed += fixed
      if (!fixed) break
    }
  }
  if (changed) {
    idx.needsUpdate = true
    w.needsUpdate = true
  }
  return changed
}
