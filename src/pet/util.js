// Small math helpers shared by the pet engine.

/** Frame-rate independent exponential approach. */
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt)
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Smooth 0→1→0 envelope over `duration` with `fade` seconds of ease at both ends. */
export function envelope(elapsed, duration, fade = 0.25) {
  if (elapsed <= 0 || elapsed >= duration) return 0
  const up = Math.min(1, elapsed / fade)
  const down = Math.min(1, (duration - elapsed) / fade)
  const e = Math.min(up, down)
  return e * e * (3 - 2 * e)
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Cheap 1D value noise from summed sines with irrational ratios (deterministic, smooth). */
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 0.73 + seed * 1.7) * 0.5 +
    Math.sin(t * 1.31 + seed * 2.9) * 0.3 +
    Math.sin(t * 2.17 + seed * 4.3) * 0.2
  )
}

export function rand(lo, hi) {
  return lo + Math.random() * (hi - lo)
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}
