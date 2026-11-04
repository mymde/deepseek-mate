// Pose library. All rotations are Euler XYZ in the VRM 1.0 normalized convention:
// the character faces +Z, its left hand is +X, +x on a bone bends it forward.
// (VRM 0.x models are converted when the pose is applied; see rig.js.)
import * as THREE from 'three'
import { wobble, clamp } from './util.js'

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const REST = { left: new THREE.Vector3(1, 0, 0), right: new THREE.Vector3(-1, 0, 0) }

/**
 * Euler for an upper arm pointing along `dir` (body space), with an extra twist (radians)
 * around the arm. Easier to author than raw angles.
 */
export function armAim(side, dir, twist = 0) {
  const d = new THREE.Vector3(...dir).normalize()
  _q.setFromUnitVectors(REST[side], d)
  if (twist) _q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, twist))
  _e.setFromQuaternion(_q, 'XYZ')
  return [_e.x, _e.y, _e.z]
}

/** Elbow flex (radians, positive = bend) as a lower-arm Euler for each side. */
export function elbow(side, flex) {
  return side === 'left' ? [0, -flex, 0] : [0, flex, 0]
}

// Relaxed arms hanging slightly forward and away from the skirt.
const ARM_DOWN_L = armAim('left', [0.28, -0.95, 0.12], 0.2)
const ARM_DOWN_R = armAim('right', [-0.28, -0.95, 0.12], -0.2)

export function standPose(t, ctx) {
  const breath = Math.sin(t * (Math.PI * 2) / 4.2)
  const shift = wobble(t * 0.35, 1)
  const arms = 0.04 * wobble(t * 0.6, 3)
  return {
    bones: {
      hips: [0, 0.03 * wobble(t * 0.2, 5), 0.035 * shift],
      spine: [0.02 + 0.012 * breath, 0, -0.02 * shift],
      chest: [0.018 * breath, 0.02 * wobble(t * 0.3, 7), -0.012 * shift],
      upperChest: [0.01 * breath, 0, 0],
      neck: [0.02, 0, 0],
      head: [0.03 * wobble(t * 0.5, 2), 0.05 * wobble(t * 0.27, 4), 0.03 * wobble(t * 0.4, 6)],
      leftShoulder: [0, 0, -0.03 - 0.01 * breath],
      rightShoulder: [0, 0, 0.03 + 0.01 * breath],
      leftUpperArm: [ARM_DOWN_L[0] + arms, ARM_DOWN_L[1], ARM_DOWN_L[2]],
      rightUpperArm: [ARM_DOWN_R[0] - arms, ARM_DOWN_R[1], ARM_DOWN_R[2]],
      leftLowerArm: elbow('left', 0.22 + 0.05 * breath),
      rightLowerArm: elbow('right', 0.22 + 0.05 * breath),
      leftHand: [0, 0, -0.12],
      rightHand: [0, 0, 0.12],
      leftUpperLeg: [0, 0, -0.03 * shift],
      rightUpperLeg: [0, 0, -0.03 * shift],
      leftLowerLeg: [0.04 + 0.04 * Math.max(0, shift), 0, 0],
      rightLowerLeg: [0.04 + 0.04 * Math.max(0, -shift), 0, 0],
    },
    root: { y: -0.004 * (1 - breath) },
  }
}

/**
 * Seated legs for a well-mannered girl: knees and feet together, lower legs drawn slightly back,
 * toes pointed; only a slow, small, synchronized sway (no kicking). Applied over every sit clip.
 * Also used by drape.js so the skirt is shaped for exactly this pose.
 */
export const SIT_LEGS = { pitch: 1.42, inward: 0.17, knee: 1.5, foot: -0.22, toesIn: 0.06 }

export function sitLegs(t, legs = SIT_LEGS, swing = 1) {
  const sway = 0.03 * Math.sin(t * 1.1) * Math.min(1, swing)
  return {
    leftUpperLeg: [-legs.pitch, 0, -legs.inward],
    rightUpperLeg: [-legs.pitch, 0, legs.inward],
    leftLowerLeg: [legs.knee + sway, 0, 0],
    rightLowerLeg: [legs.knee + sway, 0, 0],
    leftFoot: [legs.foot, -legs.toesIn, 0],
    rightFoot: [legs.foot, legs.toesIn, 0],
  }
}

export function sitPose(t, ctx) {
  const breath = Math.sin(t * (Math.PI * 2) / 4.6)
  const swing = ctx.legSwing ?? 1
  const l = Math.sin(t * 2.1) * 0.22 * swing
  const r = Math.sin(t * 2.1 + 2.2) * 0.22 * swing
  const lap = armAim('left', [0.35, -0.72, 0.6], 0.6)
  const lapR = armAim('right', [-0.35, -0.72, 0.6], -0.6)
  return {
    bones: {
      hips: [0, 0, 0],
      spine: [0.06 + 0.01 * breath, 0, 0],
      chest: [0.03 + 0.015 * breath, 0.02 * wobble(t * 0.3, 2), 0],
      upperChest: [0.01 * breath, 0, 0],
      neck: [0.03, 0, 0],
      head: [0.05 + 0.03 * wobble(t * 0.45, 3), 0.06 * wobble(t * 0.25, 5), 0.04 * wobble(t * 0.35, 8)],
      leftShoulder: [0, 0, -0.04],
      rightShoulder: [0, 0, 0.04],
      leftUpperArm: lap,
      rightUpperArm: lapR,
      leftLowerArm: elbow('left', 0.55),
      rightLowerArm: elbow('right', 0.55),
      leftHand: [0, 0, -0.2],
      rightHand: [0, 0, 0.2],
      leftUpperLeg: [-1.42, 0, 0.06],
      rightUpperLeg: [-1.42, 0, -0.06],
      leftLowerLeg: [1.25 + l, 0, 0],
      rightLowerLeg: [1.25 + r, 0, 0],
      leftFoot: [-0.15 + l * 0.4, 0, 0],
      rightFoot: [-0.15 + r * 0.4, 0, 0],
    },
    root: {},
  }
}

export function walkPose(t, ctx) {
  const p = ctx.walkPhase ?? 0
  const s = Math.sin(p)
  const c = Math.cos(p)
  const bob = Math.abs(c)
  return {
    bones: {
      hips: [0, 0.12 * s, 0.03 * c],
      spine: [0.06, -0.08 * s, 0],
      chest: [0.02, -0.06 * s, 0],
      head: [0.02, 0.1 * s, 0],
      leftUpperArm: armAim('left', [0.25, -0.95, -0.35 * s]),
      rightUpperArm: armAim('right', [-0.25, -0.95, 0.35 * s]),
      leftLowerArm: elbow('left', 0.35 + 0.2 * Math.max(0, -s)),
      rightLowerArm: elbow('right', 0.35 + 0.2 * Math.max(0, s)),
      leftUpperLeg: [-0.42 * s, 0, 0],
      rightUpperLeg: [0.42 * s, 0, 0],
      leftLowerLeg: [0.15 + 0.6 * Math.max(0, s), 0, 0],
      rightLowerLeg: [0.15 + 0.6 * Math.max(0, -s), 0, 0],
      leftFoot: [-0.15 * s, 0, 0],
      rightFoot: [0.15 * s, 0, 0],
    },
    root: { y: 0.025 * bob - 0.012 },
  }
}

/** Held by the cursor around the upper chest; body swings against the drag velocity. */
export function danglePose(t, ctx) {
  const vx = clamp((ctx.vel?.x ?? 0) / 900, -1, 1)
  const vy = clamp((ctx.vel?.y ?? 0) / 900, -1, 1)
  const kick = Math.sin(t * 7) * 0.18
  return {
    bones: {
      hips: [0.05, 0, 0],
      spine: [-0.05, 0, 0.1 * vx],
      chest: [-0.04, 0, 0.06 * vx],
      head: [0.15 + 0.15 * vy, 0, -0.1 * vx],
      leftUpperArm: armAim('left', [0.75, 0.55, 0.25]),
      rightUpperArm: armAim('right', [-0.75, 0.55, 0.25]),
      leftLowerArm: elbow('left', 0.5),
      rightLowerArm: elbow('right', 0.5),
      leftUpperLeg: [-0.25 + kick + 0.4 * vx, 0, 0.05],
      rightUpperLeg: [-0.1 - kick + 0.4 * vx, 0, -0.05],
      leftLowerLeg: [0.55 - kick, 0, 0],
      rightLowerLeg: [0.35 + kick, 0, 0],
      leftFoot: [0.3, 0, 0],
      rightFoot: [0.3, 0, 0],
    },
    root: { rotZ: -0.5 * vx, rotX: 0.25 * vy },
  }
}

export function fallPose(t, ctx) {
  const f = Math.sin(t * 12) * 0.25
  return {
    bones: {
      spine: [-0.08, 0, 0],
      head: [-0.1, 0, 0],
      leftUpperArm: armAim('left', [0.7, 0.7 + f, 0.1]),
      rightUpperArm: armAim('right', [-0.7, 0.7 - f, 0.1]),
      leftLowerArm: elbow('left', 0.3),
      rightLowerArm: elbow('right', 0.3),
      leftUpperLeg: [-0.5, 0, 0.1],
      rightUpperLeg: [-0.2, 0, -0.1],
      leftLowerLeg: [0.8, 0, 0],
      rightLowerLeg: [0.5, 0, 0],
    },
    root: {},
  }
}

/** Knees absorb the landing, then straighten. `k` = 0..1 compression. */
export function landPose(t, ctx) {
  const k = ctx.landK ?? 0
  return {
    bones: {
      hips: [0, 0, 0],
      spine: [0.25 * k, 0, 0],
      head: [-0.1 * k, 0, 0],
      leftUpperArm: armAim('left', [0.6, -0.6, 0.4]),
      rightUpperArm: armAim('right', [-0.6, -0.6, 0.4]),
      leftLowerArm: elbow('left', 0.4),
      rightLowerArm: elbow('right', 0.4),
      leftUpperLeg: [-0.75 * k, 0, 0.05],
      rightUpperLeg: [-0.75 * k, 0, -0.05],
      leftLowerLeg: [1.3 * k, 0, 0],
      rightLowerLeg: [1.3 * k, 0, 0],
      leftFoot: [-0.5 * k, 0, 0],
      rightFoot: [-0.5 * k, 0, 0],
    },
    root: { y: -0.16 * k },
  }
}

// ---------------------------------------------------------------- gestures
// A gesture returns bone Eulers that override the base pose for the listed bones
// (blended by the gesture envelope), plus optional additive `add` bones and root offsets.

export const GESTURES = {
  wave: {
    duration: 2.6,
    face: { happy: 0.7 },
    fn: (g) => ({
      bones: {
        rightUpperArm: armAim('right', [-0.55, 0.78, 0.2], -0.4),
        rightLowerArm: [0, 0.3 + 0.25 * Math.sin(g * 9), -1.1],
        rightHand: [0, 0, 0.25 * Math.sin(g * 9)],
      },
      add: { head: [0, 0, -0.08], chest: [0, 0, -0.04] },
    }),
  },
  nod: {
    duration: 1.1,
    fn: (g) => ({ add: { head: [0.22 * Math.max(0, Math.sin(g * 11)), 0, 0], neck: [0.08 * Math.max(0, Math.sin(g * 11)), 0, 0] } }),
  },
  shake: {
    duration: 1.3,
    face: { sad: 0.25 },
    fn: (g) => ({ add: { head: [0, 0.3 * Math.sin(g * 13), 0], neck: [0, 0.1 * Math.sin(g * 13), 0] } }),
  },
  think: {
    duration: 1e9,
    fade: 0.45,
    face: { relaxed: 0.25 },
    fn: (g) => ({
      bones: {
        rightUpperArm: armAim('right', [-0.25, -0.55, 0.8], -0.9),
        rightLowerArm: elbow('right', 2.15),
        rightHand: [0.3, 0, 0.2],
        leftUpperArm: armAim('left', [0.2, -0.75, 0.62], 0.7),
        leftLowerArm: elbow('left', 1.55),
      },
      add: { head: [-0.12, 0.12 + 0.05 * Math.sin(g * 0.8), 0.12], chest: [0.02, 0.05, 0] },
      look: { x: -0.35, y: 0.55 },
    }),
  },
  pat: {
    duration: 2.4,
    face: { happy: 1 },
    fn: (g) => ({
      bones: {
        leftUpperArm: armAim('left', [0.2, -0.7, 0.68], 0.9),
        rightUpperArm: armAim('right', [-0.2, -0.7, 0.68], -0.9),
        leftLowerArm: elbow('left', 1.1),
        rightLowerArm: elbow('right', 1.1),
      },
      add: { head: [0.12, 0, 0.16 + 0.05 * Math.sin(g * 5)], chest: [0.04, 0, 0.04 * Math.sin(g * 2.5)] },
    }),
  },
  poke: {
    duration: 1.6,
    face: { Surprised: 0.9 },
    fn: (g) => ({ add: { spine: [-0.14 * Math.exp(-g * 3), 0, 0], head: [-0.1 * Math.exp(-g * 3), 0, 0] } }),
  },
  cheer: {
    duration: 2.2,
    face: { happy: 1 },
    fn: (g) => ({
      bones: {
        leftUpperArm: armAim('left', [0.45, 0.88, 0.1]),
        rightUpperArm: armAim('right', [-0.45, 0.88, 0.1]),
        leftLowerArm: elbow('left', 0.3),
        rightLowerArm: elbow('right', 0.3),
      },
      root: { y: 0.06 * Math.max(0, Math.sin(g * 7)) },
    }),
  },
  bow: {
    duration: 2,
    face: { happy: 0.5 },
    fn: (g) => ({
      bones: {
        leftUpperArm: armAim('left', [0.12, -0.9, 0.42], 0.6),
        rightUpperArm: armAim('right', [-0.12, -0.9, 0.42], -0.6),
        leftLowerArm: elbow('left', 0.6),
        rightLowerArm: elbow('right', 0.6),
      },
      add: { spine: [0.28, 0, 0], chest: [0.15, 0, 0], head: [0.1, 0, 0] },
    }),
  },
  stretch: {
    duration: 3.2,
    face: { blink: 1, oh: 0.7 },
    fn: (g) => ({
      bones: {
        leftUpperArm: armAim('left', [0.15, 0.98, -0.1]),
        rightUpperArm: armAim('right', [-0.15, 0.98, -0.1]),
        leftLowerArm: elbow('left', 0.15),
        rightLowerArm: elbow('right', 0.15),
      },
      add: { spine: [-0.12, 0, 0.05 * Math.sin(g * 1.5)], head: [-0.2, 0, 0] },
    }),
  },
  shy: {
    duration: 2.5,
    face: { happy: 0.6 },
    fn: (g) => ({
      bones: {
        leftUpperArm: armAim('left', [0.1, -0.8, 0.6], 0.8),
        rightUpperArm: armAim('right', [-0.1, -0.8, 0.6], -0.8),
        leftLowerArm: elbow('left', 1.3),
        rightLowerArm: elbow('right', 1.3),
      },
      add: { head: [0.18, -0.15, -0.1], spine: [0.05, 0, 0.04 * Math.sin(g * 3)] },
    }),
  },
  dance: {
    duration: 7,
    face: { happy: 0.8 },
    fn: (g) => {
      const b = g * Math.PI * 2 * 1.1
      return {
        bones: {
          leftUpperArm: armAim('left', [0.7, 0.3 + 0.5 * Math.sin(b), 0.3]),
          rightUpperArm: armAim('right', [-0.7, 0.3 - 0.5 * Math.sin(b), 0.3]),
          leftLowerArm: elbow('left', 0.9 + 0.4 * Math.sin(b)),
          rightLowerArm: elbow('right', 0.9 - 0.4 * Math.sin(b)),
        },
        add: { hips: [0, 0.25 * Math.sin(b / 2), 0.08 * Math.sin(b)], head: [0.08 * Math.abs(Math.sin(b)), 0, 0.12 * Math.sin(b / 2)], spine: [0, 0, -0.06 * Math.sin(b)] },
        root: { y: 0.03 * Math.abs(Math.sin(b)) },
      }
    },
  },
  talk: {
    duration: 1e9,
    fade: 0.4,
    fn: (g) => ({
      add: {
        head: [0.03 * Math.sin(g * 3.1), 0.06 * Math.sin(g * 1.3), 0.03 * Math.sin(g * 1.9)],
        rightUpperArm: [0, 0, 0.12 * Math.max(0, Math.sin(g * 1.1))],
        rightLowerArm: [0, 0.35 * Math.max(0, Math.sin(g * 1.1)), 0],
      },
    }),
  },
  sleep: {
    duration: 1e9,
    fade: 1.2,
    face: { blink: 1, relaxed: 0.4 },
    fn: (g) => ({ add: { head: [0.35 + 0.03 * Math.sin(g * 1.3), 0, 0.15], neck: [0.12, 0, 0], spine: [0.08, 0, 0] } }),
  },
}
