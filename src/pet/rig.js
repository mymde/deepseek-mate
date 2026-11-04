// Applies blended poses to a three-vrm humanoid with smoothing, and adds the spring
// bones the model is missing (hair strands, skirt, tail) so the body reacts to motion.
import * as THREE from 'three'
import { VRMSpringBoneJoint, VRMHumanBoneName } from '@pixiv/three-vrm'

export const BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot'
]

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()

export class Rig {
  constructor(vrm) {
    this.vrm = vrm
    this.vrm0 = vrm.meta?.metaVersion === '0'
    this.nodes = {}
    for (const name of Object.values(VRMHumanBoneName)) {
      const node = vrm.humanoid.getNormalizedBoneNode(name)
      if (node) this.nodes[name] = node
    }
    this.acc = Object.fromEntries(Object.keys(this.nodes).map((n) => [n, new THREE.Quaternion()]))
    this.root = { y: 0, rotX: 0, rotY: 0, rotZ: 0 }
    this.reset()
  }

  reset() {
    for (const q of Object.values(this.acc)) q.identity()
    this.weight = 0
    this.rootAcc = { y: 0, rotX: 0, rotY: 0, rotZ: 0 }
  }

  // Blend rotations on the unit sphere; Euler interpolation flips at +/- pi.
  addPose(pose, w) {
    if (w <= 0.0005 || !pose) return
    const blend = w / (this.weight + w)
    for (const name in this.nodes) {
      const v = pose.bones?.[name] ?? [0, 0, 0]
      if (pose.quaternions?.[name]) _q.fromArray(pose.quaternions[name]).normalize()
      else _q.setFromEuler(_e.set(...v, 'XYZ'))
      this.acc[name].slerp(_q, blend)
    }
    this.weight += w
    this.addRoot(pose.root, w)
  }

  overridePose(bones, w, quaternions) {
    if (w <= 0.0005) return
    for (const name of new Set([...Object.keys(bones ?? {}), ...Object.keys(quaternions ?? {})])) {
      if (!this.acc[name]) continue
      if (quaternions?.[name]) _q.fromArray(quaternions[name]).normalize()
      else _q.setFromEuler(_e.set(...bones[name], 'XYZ'))
      this.acc[name].slerp(_q, w)
    }
  }

  addOffsets(bones, w) {
    if (w <= 0.0005 || !bones) return
    for (const name in bones) {
      if (!this.acc[name]) continue
      const v = bones[name]
      _q.setFromEuler(_e.set(v[0] * w, v[1] * w, v[2] * w, 'XYZ'))
      this.acc[name].multiply(_q)
    }
  }

  addRoot(root, w) {
    if (!root) return
    for (const k in root) this.rootAcc[k] = (this.rootAcc[k] ?? 0) + root[k] * w
  }

  apply(dt, sharpness = 16) {
    const k = 1 - Math.exp(-sharpness * dt)
    for (const name in this.nodes) {
      _q.copy(this.acc[name])
      if (this.vrm0) _q.set(-_q.x, _q.y, -_q.z, _q.w)
      this.nodes[name].quaternion.slerp(_q, k).normalize()
    }
    for (const key in this.root) this.root[key] += ((this.rootAcc[key] ?? 0) - this.root[key]) * k
  }
}

/**
 * Turn unconfigured secondary chains (VRoid hair joints, skirt, tail, fins) into spring
 * joints. Existing springs stay; we only add chains whose root bone has no joint yet.
 */
export function addSprings(vrm) {
  const manager = vrm.springBoneManager
  if (!manager) return 0
  const taken = new Set()
  for (const joint of manager.joints) taken.add(joint.bone)
  const colliders = manager.colliderGroups ?? []
  const presets = [
    { test: /^HairJoint-/, settings: { stiffness: 1.1, dragForce: 0.35, gravityPower: 0.25, hitRadius: 0.02 } },
    { test: /^OceanHair/i, settings: { stiffness: 0.9, dragForce: 0.3, gravityPower: 0.3, hitRadius: 0.03 } },
    { test: /Skirt/i, settings: { stiffness: 1.6, dragForce: 0.45, gravityPower: 0.2, hitRadius: 0.04 } },
    { test: /^WhaleTail/i, settings: { stiffness: 1.4, dragForce: 0.4, gravityPower: 0.1, hitRadius: 0.03 } },
    { test: /Fin|Ear/i, settings: { stiffness: 2.5, dragForce: 0.5, gravityPower: 0.05, hitRadius: 0.01 } }
  ]
  let added = 0
  vrm.scene.traverse((bone) => {
    if (!bone.isBone && bone.type !== 'Object3D' && bone.type !== 'Bone') return
    const preset = presets.find((p) => p.test.test(bone.name))
    if (!preset || taken.has(bone)) return
    // Only start chains at their first matching bone.
    if (bone.parent && preset.test.test(bone.parent.name)) return
    let current = bone
    while (current) {
      const child = current.children.find((c) => preset.test.test(c.name) || /_end$/.test(c.name))
      if (!child || taken.has(current)) break
      const joint = new VRMSpringBoneJoint(
        current,
        child,
        {
          ...preset.settings,
          gravityDir: new THREE.Vector3(0, -1, 0)
        },
        colliders
      )
      manager.addJoint(joint)
      taken.add(current)
      added++
      current = /_end$/.test(child.name) ? null : child
    }
  })
  if (added) manager.setInitState()
  return added
}
