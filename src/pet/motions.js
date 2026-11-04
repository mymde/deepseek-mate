import { Quaternion } from 'three'
import { VRMHumanBoneName } from '@pixiv/three-vrm'
const validBones = new Set(Object.values(VRMHumanBoneName))
const a = new Quaternion(), b = new Quaternion()
const validExpressions = new Set(['happy','angry','sad','relaxed','surprised','neutral','blink','blinkLeft','blinkRight','aa','ih','ou','ee','oh'])
const safeId = id => /^[a-z][a-z0-9-]{0,79}$/.test(id) && !['constructor','prototype'].includes(id)

/** Validate before replacing any installed motions. No executable data or node paths. */
export function validateMotionPack(pack) {
  if (pack?.version !== 1 || !pack.clips || typeof pack.clips !== 'object') throw new Error('不支持的动作包格式')
  let samples = 0
  for (const [id, clip] of Object.entries(pack.clips)) {
    if (!safeId(id)) throw new Error('动作标识无效：' + id)
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 300) throw new Error('动作时长无效：' + id)
    if (!clip.frames || (!Object.keys(clip.frames).length && !Object.keys(clip.expressions ?? {}).length)) throw new Error('动作缺少轨迹：' + id)
    if (clip.playDuration !== undefined && (!Number.isFinite(clip.playDuration) || clip.playDuration <= 0 || clip.playDuration > 300)) throw new Error('动作播放时长无效')
    if (clip.posture !== undefined && clip.posture !== 'sit') throw new Error('动作姿态无效')
    let count
    for (const [name, values] of Object.entries(clip.frames)) {
      if (!validBones.has(name)) throw new Error('未知骨骼：' + name)
      if (!Array.isArray(values) || values.length < 8 || values.length % 4 || !values.every(Number.isFinite)) throw new Error('骨骼轨迹无效：' + id)
      count ??= values.length / 4
      if (values.length !== count * 4) throw new Error('动作采样数不一致：' + id)
      for (let i = 0; i < values.length; i += 4) {
        const norm = Math.hypot(...values.slice(i, i + 4))
        if (norm < 0.9 || norm > 1.1) throw new Error('骨骼旋转未归一化：' + id)
      }
      samples += count
    }
    for (const [name, values] of Object.entries(clip.expressions ?? {})) {
      if (!validExpressions.has(name) || !Array.isArray(values) || values.length < 2 || !values.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('表情轨迹无效：' + id)
      count ??= values.length
      if (values.length !== count) throw new Error('表情采样数不一致：' + id)
      samples += count
    }
    if (samples > 1000000) throw new Error('动作包过大')
    if (clip.rootY && (clip.rootY.length !== count || !clip.rootY.every(v => Number.isFinite(v) && Math.abs(v) < 2))) throw new Error('根骨轨迹无效')
  }
  for (const [slot,id] of Object.entries(pack.defaults ?? {})) if (!['stand','sit','walk','talk','dance'].includes(slot) || typeof id !== 'string' || !Object.hasOwn(pack.clips,id)) throw new Error('默认动作映射无效')
  if (pack.catalog !== undefined && (!Array.isArray(pack.catalog) || pack.catalog.length > 2000 || pack.catalog.some(e => !safeId(e.id) || typeof e.label !== 'string' || e.label.length > 240 || !['ready','needs-unity','needs-rig','missing-body','source-asset'].includes(e.status) || (e.status === 'ready' && !Object.hasOwn(pack.clips, e.id))))) throw new Error('动作目录无效')
  return pack
}

export class MotionLibrary {
  constructor(pack) { this.pack = validateMotionPack(pack) }
  get(id) { return Object.hasOwn(this.pack.clips, id) ? this.pack.clips[id] : Object.hasOwn(this.pack.defaults ?? {}, id) ? this.pack.clips[this.pack.defaults[id]] : undefined }
  catalog() { return this.pack.catalog ?? Object.entries(this.pack.clips).map(([id,c]) => ({id,label:c.label ?? id,category:c.category ?? '动作',status:'ready'})) }
  sample(id, time, height = 1) {
    const clip = this.get(id)
    if (!clip) return null
    const count = Object.values(clip.frames)[0]?.length / 4 || Object.values(clip.expressions)[0].length
    const t = clip.loop ? ((time % clip.duration) + clip.duration) % clip.duration : Math.max(0, Math.min(time, clip.duration))
    const index = t / clip.duration * (count - 1)
    const lo = Math.floor(index), hi = Math.min(count - 1, lo + 1), alpha = index - lo
    const quaternions = {}
    for (const [name, values] of Object.entries(clip.frames)) {
      a.fromArray(values, lo * 4); b.fromArray(values, hi * 4)
      quaternions[name] = a.slerp(b, alpha).normalize().toArray()
    }
    // Close authored loops with a short crossfade, without wrapping a frame discontinuity.
    if (clip.loop && t > clip.duration - Math.min(0.16, clip.duration * 0.15)) {
      const w = (t - clip.duration + Math.min(0.16, clip.duration * 0.15)) / Math.min(0.16, clip.duration * 0.15)
      for (const [name, values] of Object.entries(clip.frames)) quaternions[name] = a.fromArray(quaternions[name]).slerp(b.fromArray(values), w * w * (3 - 2 * w)).toArray()
    }
    let y = clip.rootY ? (clip.rootY[lo] * (1 - alpha) + clip.rootY[hi] * alpha) * height : 0
    if (clip.loop) {
      const fade = Math.min(0.16, clip.duration * 0.15)
      if (t > clip.duration - fade) { const w = (t - clip.duration + fade) / fade; y += ((clip.rootY?.[0] ?? 0) * height - y) * w * w * (3 - 2 * w) }
    }
    const face = {}
    for (const [name, values] of Object.entries(clip.expressions ?? {})) {
      face[name] = values[lo] * (1 - alpha) + values[hi] * alpha
      const fade = Math.min(0.16, clip.duration * 0.15)
      if (clip.loop && t > clip.duration - fade) { const w = (t - clip.duration + fade) / fade; face[name] += (values[0] - face[name]) * w * w * (3 - 2 * w) }
    }
    return { quaternions, root: { y }, face }
  }
}
