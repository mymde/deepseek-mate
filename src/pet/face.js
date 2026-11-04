// Facial animation: emotion blending, natural blinking, and text-driven lip sync.
import { damp, rand } from './util.js'

const EMOTIONS = ['happy', 'angry', 'sad', 'relaxed', 'Surprised']
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh']
const LATIN_VOWEL = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', y: 'ih' }

export class Face {
  constructor(vrm) {
    this.em = vrm.expressionManager
    this.available = new Set((this.em?.expressions ?? []).map((e) => e.expressionName))
    // VRM 0.x custom names (e.g. "Surprised") and VRM 1.0 presets ("surprised") resolve the same way.
    this.names = new Map()
    for (const n of this.available) this.names.set(n.toLowerCase(), n)
    this.values = {}
    this.targets = {}
    this.holds = [] // { name, value, until }
    this.nextBlink = rand(1.5, 4)
    this.blinkT = -1
    this.mouth = { name: 'aa', open: 0, target: 0, nextAt: 0 }
    this.speech = null // { text, index, cps }
  }

  resolve(name) {
    return this.available.has(name) ? name : (this.names.get(String(name).toLowerCase()) ?? null)
  }

  has(name) {
    return this.resolve(name) !== null
  }

  /** Hold an expression for `seconds` (layered over the mood). */
  hold(name, value, seconds) {
    if (!this.has(name)) return false
    this.holds = this.holds.filter((h) => h.name !== name)
    this.holds.push({ name, value, until: performance.now() / 1000 + seconds })
    return true
  }

  clearHolds() {
    this.holds = []
  }

  /** Start mouthing `text` at a typing speed; returns the duration in seconds. */
  speak(text, cps = 16) {
    this.speech = { text: Array.from(text), index: 0, cps, acc: 0 }
    return this.speech.text.length / cps
  }

  /** Follow an incrementally streamed text: mouth while new characters arrive. */
  feed(chars) {
    if (!this.speech) this.speech = { text: [], index: 0, cps: 22, acc: 0 }
    this.speech.text.push(...Array.from(chars))
  }

  stopSpeaking() {
    this.speech = null
  }

  get speaking() {
    return !!this.speech && this.speech.index < this.speech.text.length
  }

  update(dt, t, mood) {
    if (!this.em) return
    const now = performance.now() / 1000
    this.holds = this.holds.filter((h) => h.until > now)

    // Mood (from gestures / state) + explicit holds; strongest wins per expression.
    const want = {}
    for (const name of EMOTIONS) want[name] = 0
    for (const [k, v] of Object.entries(mood ?? {})) want[k] = Math.max(want[k] ?? 0, v)
    for (const h of this.holds) want[h.name] = Math.max(want[h.name] ?? 0, h.value)
    if (want.happy > 0.3) want.relaxed = 0

    // Blink: random interval, occasional double blink; suppressed while eyes are closed by mood.
    let blink = want.blink ?? 0
    delete want.blink
    if (this.blinkT >= 0) {
      this.blinkT += dt
      const p = this.blinkT / 0.16
      blink = Math.max(blink, p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2))
      if (this.blinkT > 0.16) {
        this.blinkT = -1
        this.nextBlink = Math.random() < 0.18 ? 0.12 : rand(2.2, 5.5)
      }
    } else if ((this.nextBlink -= dt) <= 0) {
      this.blinkT = 0
    }
    const eyesBusy = Math.max(want.happy ?? 0, want.Surprised ?? 0)
    blink *= 1 - Math.min(1, eyesBusy * 1.2)

    // Lip sync: one mouth shape per character, closing on punctuation and spaces.
    if (this.speech && this.speech.index < this.speech.text.length) {
      const s = this.speech
      s.acc += dt * s.cps
      while (s.acc >= 1 && s.index < s.text.length) {
        s.acc -= 1
        const ch = s.text[s.index++]
        const lower = ch.toLowerCase()
        if (/[\s，。！？、,.!?;；：:…—\-~]/.test(ch)) this.mouth.target = 0
        else {
          this.mouth.name = LATIN_VOWEL[lower] ?? (/[a-z0-9]/.test(lower) ? 'ih' : VOWELS[(ch.codePointAt(0) * 7) % 5])
          this.mouth.target = 0.55 + (ch.codePointAt(0) % 5) / 10
        }
      }
    } else {
      this.mouth.target = 0
    }
    this.mouth.open = damp(this.mouth.open, this.mouth.target, this.mouth.target > this.mouth.open ? 30 : 18, dt)

    for (const name of new Set([...EMOTIONS, ...Object.keys(this.values), ...Object.keys(want)])) {
      if (VOWELS.includes(name)) continue
      if (!this.has(name)) continue
      this.values[name] = damp(this.values[name] ?? 0, want[name] ?? 0, 8, dt)
      this.em.setValue(this.resolve(name), this.values[name])
    }
    if (this.has('blink')) this.em.setValue(this.resolve('blink'), Math.min(1, blink))
    for (const v of VOWELS) {
      if (!this.has(v)) continue
      const target = Math.max(want[v] ?? 0, v === this.mouth.name ? this.mouth.open : 0)
      this.values[v] = damp(this.values[v] ?? 0, target, 25, dt)
      this.em.setValue(this.resolve(v), this.values[v] * (1 - Math.min(0.6, (this.values.happy ?? 0) * 0.5)))
    }
  }
}
