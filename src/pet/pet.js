// 希可儿 desktop pet engine: a transparent overlay that lives on top of a web page.
// It stands on the bottom of the window or sits on the top edge of page elements
// (by default the chat composer), can be dragged and thrown, walks around, looks at
// the cursor, reacts to pats and pokes, and talks through a speech bubble.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { Rig, addSprings } from './rig.js'
import { MotionLibrary } from './motions.js'
import { Face } from './face.js'
import { addSitDrape } from './drape.js'
import { GESTURES, standPose, sitPose, sitLegs, SIT_LEGS, walkPose, danglePose, fallPose, landPose } from './poses.js'
import { damp, clamp, envelope, rand, pick } from './util.js'
import { STYLE } from './style.js'

const GRAVITY = 2600 // px/s² at size 1
const IDLE_SLEEP_SECONDS = 180
const LOCS = ['stand', 'sit', 'walk', 'drag', 'fall', 'land']
const EXPRESSION_ALIASES = { surprised: 'Surprised', joy: 'happy', sorrow: 'sad', fun: 'relaxed' }
export const ACTIONS = [
  'wave',
  'nod',
  'shake',
  'cheer',
  'bow',
  'stretch',
  'shy',
  'dance',
  'jump',
  'sit',
  'stand',
  'walk',
  'sleep',
  'wake',
  'home'
]
const MOTION_CATEGORIES = ['待机', '坐姿', '交流', '舞蹈', '行走', '上身动作', '互动', '姿态']
const CATEGORY_LABELS = { 上身动作: '上身' }
const CATEGORY_ICONS = {
  待机: '🧍',
  坐姿: '🪑',
  交流: '💬',
  舞蹈: '💃',
  行走: '🚶',
  上身动作: '🙆',
  互动: '👋',
  姿态: '🧎',
  表情: '🎭'
}
const BASE_FACES = [
  ['happy', '笑脸', '😄'],
  ['relaxed', '放松', '😌'],
  ['surprised', '惊讶', '😮'],
  ['sad', '难过', '😢'],
  ['angry', '生气', '😠'],
  ['blink', '闭眼', '😑']
]
const BUILTIN_GESTURES = [
  ['cheer', '欢呼'],
  ['bow', '鞠躬'],
  ['nod', '点头'],
  ['shake', '摇头'],
  ['stretch', '伸懒腰'],
  ['shy', '害羞']
]
const GESTURE_LABELS = {
  wave: '挥手',
  nod: '点头',
  shake: '摇头',
  cheer: '欢呼',
  bow: '鞠躬',
  stretch: '伸懒腰',
  shy: '害羞',
  dance: '跳舞',
  pat: '摸头'
}
export const DEFAULT_SIZE = 360
export const SIZES = { small: 240, medium: 300, large: 380, huge: 460 }
export const SIZE_RANGE = { min: 160, max: 640 }
// Right-click shortcuts the user can pick in Settings (motions and expressions), at most this many.
export const MAX_FAVORITES = 6
export const EXPRESSIONS = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'blink']

// Small motions and soft expressions she picks at random while idle (besides walking, sitting, standing up).
const IDLE_MOTIONS = [
  'stretch',
  'gi-brave',
  'gi-calm',
  'gi-peace',
  'gi-shy',
  'gi-look',
  'gi-nod',
  'gi-sway',
  'wave',
  'nod',
  'shy'
]
const IDLE_FACES = [
  'happy',
  'relaxed',
  'happy',
  'surprised',
  'face-370e0e4bd398',
  'face-6521cecbdcb9',
  'face-5de4e91c086c'
]

const HIDDEN_CATEGORIES = new Set(['行走', '坐姿', '姿态'])
const HIDDEN_CHOICES = new Set([
  'walk',
  'stand',
  'face-5dc6f064355f',
  'face-e084a2c5a8b1',
  'face-03a411653594',
  'face-cf5d7d4c3d91',
  'face-d0dbbf337a3f',
  'face-6521cecbdcb9',
  'q-pickup-table'
])

const GREETINGS = ['你好呀～', '我是希可儿，有什么想聊的吗？', '嗯？叫我吗？', '今天也要加油哦！']
const PAT_LINES = ['嘿嘿……', '好舒服～', '再摸一下下？', '♪']
const POKE_LINES = ['呀！', '不要戳我啦', '唔……', '干嘛呀']
const DROP_LINES = ['哇啊——', '轻一点嘛', '好晕……']

export async function createPet(options = {}) {
  const pet = new Pet(options)
  await pet.load()
  return pet
}

class Pet {
  constructor(o) {
    this.o = {
      modelUrl: o.modelUrl,
      parent: o.parent ?? document.body,
      size: o.size ?? DEFAULT_SIZE,
      zIndex: o.zIndex ?? 90, // above page content, below Harness popovers (100) and dialogs (1000+)
      storageKey: o.storageKey ?? 'whale-mate',
      findHome: o.findHome ?? defaultFindHome,
      onEvent: o.onEvent ?? (() => {}),
      onMenu: o.onMenu ?? null,
      labels: o.labels ?? {},
      // Extra perches that are not page elements (desktop mode: the Harness window). Each is an
      // object with getBoundingClientRect(), isConnected and visible() — see virtualSurface().
      surfaces: o.surfaces ?? null,
      // Called with true while the pet needs real mouse events (cursor on her, dragging, menu open).
      onCapture: o.onCapture ?? null,
      // Extra context-menu entries: () => [{ id, label, run }].
      menuItems: o.menuItems ?? null,
      persist: o.persist ?? true,
      motionUrl: o.motionUrl === false ? null : (o.motionUrl ?? new URL('./motions.json', import.meta.url).href)
    }
    this.saved = this.o.persist ? loadSettings(this.o.storageKey) : { ...(o.saved ?? {}) }
    // 0.5.8 and 0.6.0 made her larger (expressions were hard to see). A size still at an old
    // automatic default is upgraded once; any other size the user picked is kept.
    if (
      this.o.persist &&
      ((this.saved.size === 220 && !this.saved.sizeV) || (this.saved.size === 300 && (this.saved.sizeV ?? 0) < 3))
    )
      delete this.saved.size
    this.size = clamp(this.saved.size ?? this.o.size, SIZE_RANGE.min, SIZE_RANGE.max)
    this.favoriteIds = Array.isArray(this.saved.favorites)
      ? this.saved.favorites.filter((id) => typeof id === 'string').slice(0, MAX_FAVORITES)
      : []
    this.visible = this.saved.visible ?? true
    this.t = 0
    this.loc = 'fall'
    this.w = Object.fromEntries(LOCS.map((k) => [k, k === 'stand' ? 1 : 0]))
    this.anchor = { x: innerWidth - 160, y: innerHeight - 2 }
    this.vel = { x: 0, y: 0 }
    this.perch = null // { el, dx } or null = window floor
    this.atHome = false
    this.gesture = null // { name, t0, duration, fade }
    this.flags = { think: 0, talk: 0, sleep: 0 }
    this.busy = false
    this.sleeping = false
    this.lastActivity = 0
    this.nextIdle = rand(5, 9)
    this.walkTarget = null
    this.walkPhase = 0
    this.landT = 0
    this.cursor = { x: -1e4, y: -1e4, at: -1e9 }
    this.press = null
    this.dragVel = { x: 0, y: 0 }
    this.rub = { dist: 0, last: null, cooldownUntil: 0 }
    this.hit = false
    this.bubbleUntil = 0
    this.reply = null // streaming reply text
    this.destroyed = false
    this.pixel = new Uint8Array(4)
    this.suspended = false
    this.capture = false
  }

  // ------------------------------------------------------------------ setup

  async load() {
    this.buildDom()
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(this.o.modelUrl)
    const vrm = gltf.userData.vrm
    if (!vrm) throw new Error('not a VRM file')
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons?.(gltf.scene)
    VRMUtils.rotateVRM0(vrm)
    vrm.scene.traverse((o) => {
      o.frustumCulled = false
    })
    this.vrm = vrm
    this.avatar = new THREE.Group()
    this.avatar.add(vrm.scene)
    this.scene.add(this.avatar)

    // Body measurements from the rest pose (meters).
    vrm.scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const p = (name) =>
      vrm.humanoid.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3()
    this.body = {
      height: box.max.y - box.min.y,
      hips: p('hips').y - box.min.y,
      chest: p('upperChest').y - box.min.y || p('chest').y - box.min.y,
      head: p('head').y - box.min.y,
      floor: box.min.y,
      footHeight: Math.min(p('leftFoot').y, p('rightFoot').y) - box.min.y
    }
    this.rig = new Rig(vrm)
    this.motionStatus = { ready: false, error: null, clips: [] }
    if (this.o.motionUrl) {
      try {
        const response = await fetch(this.o.motionUrl, { signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        this.setMotionPack(await response.json())
      } catch (e) {
        this.motionStatus.error = String(e.message ?? e)
      }
    }
    this.face = new Face(vrm)
    this.springs = addSprings(vrm)
    // Hip-bound skirts: drape them over the thighs when she sits (no legs through the cloth).
    try {
      this.drape = addSitDrape(vrm)
    } catch (e) {
      this.drape = null
      console.warn('[whale-mate] skirt drape unavailable', e)
    }
    this.lookTarget = new THREE.Object3D()
    this.scene.add(this.lookTarget)
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget

    this.applySize()
    this.goHome({ immediate: true })
    this.bindEvents()
    this.setVisible(this.visible)
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame((n) => this.frame(n))
  }

  buildDom() {
    const root = document.createElement('div')
    root.className = 'whale-mate'
    root.style.zIndex = String(this.o.zIndex)
    const style = document.createElement('style')
    style.textContent = STYLE
    root.appendChild(style)
    const canvas = document.createElement('canvas')
    canvas.className = 'whale-mate__canvas'
    const bubble = document.createElement('div')
    bubble.className = 'whale-mate__bubble'
    bubble.hidden = true
    const menu = document.createElement('div')
    menu.className = 'whale-mate__menu'
    menu.hidden = true
    root.append(canvas, bubble, menu)
    this.o.parent.appendChild(root)
    Object.assign(this, { root, canvas, bubble, menu })

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.scene = new THREE.Scene()
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8f9bc8, 1.25))
    const key = new THREE.DirectionalLight(0xfff6ec, 1.6)
    key.position.set(-1.2, 2.4, 3)
    this.scene.add(key, key.target)
    this.keyLight = key
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -20, 20)
  }

  applySize() {
    const s = this.size
    this.ppm = s / this.body.height // pixels per meter
    this.box = { w: Math.round(s * 1.2), h: Math.round(s * 1.78), ax: Math.round(s * 0.6), ay: Math.round(s * 1.14) }
    const dpr = Math.min(devicePixelRatio || 1, 2)
    this.dpr = dpr
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.box.w, this.box.h, false)
    this.canvas.style.width = this.box.w + 'px'
    this.canvas.style.height = this.box.h + 'px'
    const { w, h, ax, ay } = this.box
    Object.assign(this.camera, {
      left: -ax / this.ppm,
      right: (w - ax) / this.ppm,
      top: ay / this.ppm,
      bottom: -(h - ay) / this.ppm
    })
    this.camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------------------ public API

  setVisible(v) {
    this.visible = !!v
    this.applyDisplay()
    this.save()
  }

  /** Hide without touching the saved visibility (another surface, e.g. the desktop overlay, shows her). */
  setSuspended(v) {
    this.suspended = !!v
    this.applyDisplay()
  }

  applyDisplay() {
    const on = this.visible && !this.suspended
    this.root.style.display = on ? '' : 'none'
    if (!on) this.setCapture(false)
  }

  /** Make her visible again and put her somewhere reachable (sidebar button, settings, menu). */
  recall() {
    this.setVisible(true)
    this.closeMenu()
    this.press = null
    if (!this.goHome({ immediate: true })) {
      this.perch = null
      this.atHome = false
      this.anchor = { x: clamp(innerWidth * 0.85, this.box.w * 0.3, innerWidth - this.box.w * 0.3), y: innerHeight - 2 }
      this.setLoc('stand', true)
    }
    return true
  }

  /** Cursor position fed from outside the page (desktop overlay polls the OS cursor). */
  feedCursor(x, y) {
    if (this.press) return
    this.cursor = { x, y, at: this.t }
    if (this.inBox(x, y)) this.wake()
    this.trackRub({ clientX: x, clientY: y })
  }

  setCapture(on) {
    on = !!on
    if (on === this.capture) return
    this.capture = on
    try {
      this.o.onCapture?.(on)
    } catch {}
  }

  setSize(px) {
    this.size = clamp(Math.round(Number(px) || DEFAULT_SIZE), SIZE_RANGE.min, SIZE_RANGE.max)
    this.applySize()
    this.save()
  }

  /** Show a line in the bubble and mouth it. */
  say(text, { expression, hold } = {}) {
    text = String(text ?? '').trim()
    if (!text) return
    this.wake()
    this.reply = null
    const seconds = this.face.speak(text, 16)
    this.showBubble(text, Math.max(3.5, seconds + (hold ?? 2.5 + text.length * 0.06)))
    if (expression) this.expression(expression, 1, seconds + 1.5)
  }

  setThinking(on) {
    this.busy = !!on
    if (on) {
      this.wake()
      if (!this.reply) this.showBubble(null, 1e9, true)
    } else if (!this.reply && this.bubble.classList.contains('is-thinking')) {
      this.hideBubble()
    }
  }

  /** Feed the full reply text streamed so far. */
  streamReply(text) {
    this.wake()
    const prev = this.reply ?? ''
    this.reply = text
    if (text.startsWith(prev)) this.face.feed(text.slice(prev.length))
    else this.face.feed(text)
    this.showBubble(tail(text, 90), 1e9)
  }

  finishReply(text, { error = false } = {}) {
    const final = (text ?? this.reply ?? '').trim()
    this.reply = null
    this.busy = false
    if (error) {
      this.face.stopSpeaking()
      this.showBubble(final || '出错了……', 6)
      this.expression('sad', 0.8, 4)
      this.play('shake')
      return
    }
    if (!final) return this.hideBubble()
    const shown = summary(final, 110)
    this.showBubble(shown, clamp(3 + Array.from(shown).length * 0.09, 4, 14))
    if (Math.random() < 0.35) this.play(pick(['nod', 'shy', 'cheer']))
  }

  /** A message was just sent from the composer. */
  noticeUserMessage() {
    this.wake()
    this.play('nod')
    this.expression('happy', 0.6, 1.5)
  }

  expression(name, weight = 1, seconds = 3) {
    const key = EXPRESSION_ALIASES[name] ?? name
    if (key === 'neutral') {
      this.face.clearHolds()
      return true
    }
    return this.face.hold(key, clamp(weight, 0, 1), clamp(seconds, 0.2, 60))
  }

  action(name) {
    this.wake()
    switch (name) {
      case 'sit':
        return this.sitDown()
      case 'stand':
        return this.standUp()
      case 'walk':
        return this.walkTo(this.anchor.x + (Math.random() < 0.5 ? -1 : 1) * this.size * 1.2)
      case 'jump':
        this.vel = { x: 0, y: -900 * (this.size / 240) }
        this.perch = null
        this.setLoc('fall')
        return true
      case 'sleep':
        this.sleeping = true
        if (this.loc === 'stand') this.sitDown()
        return true
      case 'wake':
        this.wake()
        return true
      case 'home':
        return this.goHome()
      default:
        if (GESTURES[name] || this.motions?.get(name)) {
          this.play(name)
          return true
        }
        return false
    }
  }

  goHome({ immediate = false } = {}) {
    const home = safeFindHome(this.o.findHome, this.root)
    if (home && home.getBoundingClientRect().top >= this.minPerchTop()) {
      const r = home.getBoundingClientRect()
      const dx = clamp(this.saved.homeDx ?? r.width * 0.64, this.box.w * 0.35, r.width - this.box.w * 0.35)
      if (immediate) {
        this.perch = { el: home, dx }
        this.atHome = true
        this.anchor = { x: r.left + dx, y: r.top }
        this.setLoc('sit', true)
        return true
      }
      return this.jumpTo(r.left + dx, r.top)
    }
    if (immediate) {
      this.perch = null
      this.atHome = false
      this.anchor = { x: innerWidth * (this.saved.floorX ?? 0.85), y: innerHeight - 2 }
      this.setLoc('stand', true)
    }
    return false
  }

  state() {
    return {
      loc: this.loc,
      perch: this.perch ? (this.perch.el.name ?? (this.atHome ? 'composer' : 'element')) : 'floor',
      perchWindow: this.perch?.el?.windowId ?? null,
      busy: this.busy,
      talking: this.face?.speaking ?? false,
      sleeping: this.sleeping,
      visible: this.visible,
      size: this.size,
      springs: this.springs,
      drape: this.drape
        ? {
            meshes: this.drape.meshes,
            radius: Math.round(this.drape.radius * 1000) / 1000,
            weights: this.drape.weights.map((w) => Math.round(w * 100) / 100)
          }
        : null,
      motions: this.motionStatus
    }
  }

  setMotionPack(pack) {
    const library = new MotionLibrary(pack)
    this.motions = library
    const catalog = library.catalog()
    this.motionStatus = {
      ready: true,
      error: null,
      name: pack.name,
      clips: Object.keys(pack.clips),
      catalog: {
        total: catalog.length,
        playable: catalog.filter((e) => e.status === 'ready').length,
        needsUnity: catalog.filter((e) => e.status === 'needs-unity').length,
        needsRig: catalog.filter((e) => e.status === 'needs-rig').length,
        missingBody: catalog.filter((e) => e.status === 'missing-body').length
      }
    }
    return this.motionStatus
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.unbind?.()
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene)
    this.renderer.dispose()
    this.root.remove()
  }

  // ------------------------------------------------------------------ behaviour

  setLoc(loc, immediate = false) {
    this.loc = loc
    if (loc === 'land') this.landT = 0
    if (immediate) for (const k of LOCS) this.w[k] = k === loc ? 1 : 0
  }

  play(name) {
    const g = GESTURES[name]
    const clip = this.motions?.get(name)
    if (!g && !clip) return false
    if (clip?.posture === 'sit') {
      if (this.loc === 'drag' || this.loc === 'fall') return false
      // A chair pose needs a ledge: at the screen floor its feet would be clipped.
      if (!this.perch && !this.goHome({ immediate: true })) return false
      if (!this.sitDown()) return false
    }
    if (clip?.expressions) this.face?.clearHolds()
    this.gesture = {
      name,
      t0: this.t,
      duration: clip?.playDuration ?? clip?.duration ?? g.duration,
      fade: clip ? Math.min(0.22, clip.duration / 4) : (g.fade ?? 0.3)
    }
    return true
  }

  wake() {
    this.lastActivity = this.t
    this.sleeping = false
  }

  sitDown() {
    if (this.loc === 'drag' || this.loc === 'fall') return false
    this.walkTarget = null
    this.setLoc('sit')
    return true
  }

  standUp() {
    if (this.loc !== 'sit') return false
    this.setLoc('stand')
    return true
  }

  walkTo(x) {
    if (this.loc === 'drag' || this.loc === 'fall') return false
    const bounds = this.walkBounds()
    this.walkTarget = clamp(x, bounds[0], bounds[1])
    if (Math.abs(this.walkTarget - this.anchor.x) < 8) {
      this.walkTarget = null
      return false
    }
    this.setLoc('walk')
    return true
  }

  /** Ballistic hop that lands on (x, y); perch detection picks up the surface on the way down. */
  jumpTo(x, y) {
    if (this.loc === 'drag') return false
    const g = GRAVITY * (this.size / 240)
    const peak = Math.min(this.anchor.y, y) - this.size * 0.5
    const up = Math.max(10, this.anchor.y - peak)
    const vy = -Math.sqrt(2 * g * up)
    const tUp = -vy / g
    const tDown = Math.sqrt((2 * Math.max(1, y - peak)) / g)
    this.vel = { x: (x - this.anchor.x) / (tUp + tDown), y: vy }
    this.perch = null
    this.atHome = false
    this.jumpGoal = { x, y }
    this.setLoc('fall')
    return true
  }

  /** A perch higher than this would push her head out of the window (and out of reach). */
  minPerchTop() {
    return this.size * 0.82
  }

  walkBounds() {
    const m = this.box.w * 0.3
    if (this.perch) {
      const span = this.perch.el.spanAt?.(this.anchor.x)
      if (span) return [span[0] + m, Math.max(span[0] + m, span[1] - m)]
      const r = this.perch.el.getBoundingClientRect()
      return [r.left + m, r.right - m]
    }
    return [m, innerWidth - m]
  }

  idleBrain(dt) {
    if (
      this.busy ||
      this.reply ||
      this.face.speaking ||
      this.press ||
      this.loc === 'drag' ||
      this.loc === 'fall' ||
      this.loc === 'land'
    )
      return
    if (this.t - this.lastActivity > IDLE_SLEEP_SECONDS && !this.sleeping) {
      this.sleeping = true
      if (this.loc === 'stand' || this.loc === 'walk') this.sitDown()
    }
    if (this.sleeping) return
    if ((this.nextIdle -= dt) > 0) return
    this.nextIdle = rand(7, 16)
    if (this.gesture) return
    // She never hops onto the composer or a window by herself (that leap does not look good);
    // walking, sitting down, standing up and small motions or expressions are all fine.
    const r = Math.random()
    if (this.loc === 'stand') {
      if (r < 0.3) this.walkTo(this.anchor.x + rand(-1, 1) * this.size * 2)
      else if (r < 0.45 && this.perch) this.sitDown()
      else this.idleFlourish()
    } else if (this.loc === 'sit') {
      if (r < 0.15 && !this.atHome) this.standUp()
      else if (r < 0.3) this.legBurst = this.t
      else this.idleFlourish()
    }
  }

  /** A small motion or a change of expression, picked at random. */
  idleFlourish() {
    if (Math.random() < 0.5) {
      const id = pick(IDLE_FACES.filter((f) => !f.startsWith('face-') || this.motions?.get(f)))
      if (id.startsWith('face-')) this.play(id)
      else this.expression(id, 0.75, rand(2, 3.5))
    } else {
      const motions = IDLE_MOTIONS.filter((m) => GESTURES[m] || this.motions?.get(m))
      if (motions.length) this.play(pick(motions))
    }
  }

  // ------------------------------------------------------------------ surfaces

  resolvePerch() {
    if (!this.perch)
      return { x: clamp(this.anchor.x, this.box.w * 0.3, innerWidth - this.box.w * 0.3), y: innerHeight - 2 }
    if (this.atHome && (!this.perch.el.isConnected || !isVisible(this.perch.el))) {
      // The composer was re-rendered (session switch, layout change): follow the new one.
      const home = safeFindHome(this.o.findHome, this.root)
      if (home) {
        const old = this.perch.el.getBoundingClientRect()
        const ratio = old.width > 0 ? this.perch.dx / old.width : 0.64
        this.perch = { el: home, dx: home.getBoundingClientRect().width * ratio }
      }
    }
    const el = this.perch.el
    const r = el.isConnected ? el.getBoundingClientRect() : null
    if (!r || r.width < 60 || r.bottom < 0 || r.top > innerHeight || r.top < this.minPerchTop() * 0.9 || !isVisible(el))
      return null
    this.perch.dx = clamp(
      this.perch.dx,
      Math.min(r.width / 2, this.box.w * 0.3),
      Math.max(r.width / 2, r.width - this.box.w * 0.3)
    )
    // Another window moved in front of her seat: give it a moment (it may just pass by), then drop.
    if (el.accepts && !el.accepts(r.left + this.perch.dx, 0)) {
      this.perch.coveredAt ??= this.t
      if (this.t - this.perch.coveredAt > 0.9) return null
    } else if (this.perch.coveredAt != null) this.perch.coveredAt = null
    return { x: r.left + this.perch.dx, y: r.top }
  }

  /** Find a surface whose top edge lies between y0 and y1 under x (falling feet). */
  findSurface(x, y0, y1) {
    const minTop = this.minPerchTop()
    for (const el of this.o.surfaces?.() ?? []) {
      if (!el?.isConnected || !isVisible(el)) continue
      const r = el.getBoundingClientRect()
      const m = this.box.w * 0.15
      const inside = el.accepts ? el.accepts(x, m) : x >= r.left + m && x <= r.right - m
      if (r.top >= y0 - 3 && r.top <= y1 + 6 && r.top >= minTop && inside) return { el, top: r.top, left: r.left }
    }
    const ys = [y1 + 2, (y0 + y1) / 2 + 2]
    for (const y of ys) {
      if (y < 0 || y > innerHeight - 6) continue
      for (const el of document.elementsFromPoint(x, y)) {
        if (this.root.contains(el)) continue
        const s = surfaceOf(el, x, y0 - 3, y1 + 6)
        if (s && s.top >= minTop) return s
      }
    }
    return null
  }

  // ------------------------------------------------------------------ input

  bindEvents() {
    const onMove = (e) => {
      this.cursor = { x: e.clientX, y: e.clientY, at: this.t }
      if (this.inBox(e.clientX, e.clientY)) this.wake()
      if (this.press) this.onDragMove(e)
      else this.trackRub(e)
    }
    const onUp = (e) => this.onPointerUp(e)
    const onDown = (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target)) this.closeMenu()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') this.closeMenu()
      this.wake()
    }
    const onResize = () => {
      if (!this.perch) this.anchor.y = innerHeight - 2
    }
    addEventListener('pointermove', onMove, { capture: true, passive: true })
    addEventListener('pointerup', onUp, true)
    addEventListener('pointerdown', onDown, true)
    addEventListener('keydown', onKey)
    addEventListener('resize', onResize)
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault()
      this.play('wave')
      this.say(pick(GREETINGS), { expression: 'happy' })
      this.o.onEvent('wave', {})
    })
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.openMenu(e.clientX, e.clientY)
    })
    const onVisibility = () => {
      this.lastFrame = performance.now()
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.unbind = () => {
      removeEventListener('pointermove', onMove, { capture: true })
      removeEventListener('pointerup', onUp, true)
      removeEventListener('pointerdown', onDown, true)
      removeEventListener('keydown', onKey)
      removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  inBox(x, y) {
    const r = this.boxRect
    return r && x >= r.left && x < r.left + this.box.w && y >= r.top && y < r.top + this.box.h
  }

  onPointerDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    this.closeMenu()
    this.canvas.setPointerCapture?.(e.pointerId)
    this.press = {
      x: e.clientX,
      y: e.clientY,
      at: this.t,
      onHead: this.nearHead(e.clientX, e.clientY),
      dragging: false
    }
  }

  onDragMove(e) {
    const p = this.press
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) {
      p.dragging = true
      this.perch = null
      this.atHome = false
      this.walkTarget = null
      this.gesture = null
      this.setLoc('drag')
      this.expression('surprised', 0.8, 0.7)
      this.o.onEvent('drag_start', {})
    }
    if (p.dragging && !p.edgeNoted && (e.clientY < 8 || e.clientX < 8 || e.clientX > innerWidth - 8)) {
      p.edgeNoted = true
      this.o.onEvent('drag_edge', { x: e.clientX, y: e.clientY })
    }
  }

  onPointerUp(_e) {
    const p = this.press
    if (!p) return
    this.press = null
    if (p.dragging) {
      this.vel = { x: clamp(this.dragVel.x, -2400, 2400), y: clamp(this.dragVel.y, -2400, 1200) }
      // Released right above a surface: sit there instead of falling.
      const s = this.findSurface(this.anchor.x, this.anchor.y - this.size * 0.15, this.anchor.y + this.size * 0.25)
      if (s && Math.hypot(this.vel.x, this.vel.y) < 500) {
        this.perch = { el: s.el, dx: this.anchor.x - s.left }
        this.atHome = isHome(s.el, safeFindHome(this.o.findHome, this.root))
        this.setLoc('sit')
        this.saveHomeDx()
      } else {
        this.setLoc('fall')
        if (Math.hypot(this.vel.x, this.vel.y) > 1200) this.say(pick(DROP_LINES), { expression: 'surprised' })
      }
      this.o.onEvent('drag_end', {})
      return
    }
    if (this.t - p.at < 0.35) {
      if (p.onHead) this.patted('click')
      else {
        this.play('poke')
        this.say(pick(POKE_LINES), { expression: Math.random() < 0.5 ? 'angry' : 'surprised' })
        this.o.onEvent('poke', {})
      }
    }
  }

  nearHead(x, y) {
    if (!this.headScreen) return false
    return Math.hypot(x - this.headScreen.x, y - this.headScreen.y) < this.size * 0.13
  }

  trackRub(e) {
    if (!this.nearHead(e.clientX, e.clientY) || this.t < this.rub.cooldownUntil) {
      this.rub.dist *= 0.9
      this.rub.last = null
      return
    }
    if (this.rub.last) this.rub.dist += Math.hypot(e.clientX - this.rub.last.x, e.clientY - this.rub.last.y)
    this.rub.last = { x: e.clientX, y: e.clientY }
    if (this.rub.dist > this.size * 1.6) this.patted('rub')
  }

  patted(how) {
    this.rub = { dist: 0, last: null, cooldownUntil: this.t + 3.5 }
    this.wake()
    this.play('pat')
    if (Math.random() < 0.6) this.say(pick(PAT_LINES), { expression: 'happy' })
    this.o.onEvent('headpat', { how })
  }

  // ------------------------------------------------------------------ menu

  /**
   * Right-click wheel around the cursor: the shortcuts picked in Settings, then the host's entries
   * (mode switch) and "hide". Where she sits is changed by dragging her or switching mode.
   */
  openMenu(x, y) {
    const NS = 'http://www.w3.org/2000/svg'
    const L = (k, d) => this.o.labels[k] ?? d
    const svg = (tag, attrs = {}) => {
      const n = document.createElementNS(NS, tag)
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
      return n
    }
    const byId = new Map(this.motionChoices().map((c) => [c.id, c]))
    const entries = this.favoriteIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((c) => ({ kind: 'choice', id: c.id, label: c.label, title: c.label, run: () => this.playChoice(c.id) }))
    let extra = []
    try {
      extra = this.o.menuItems?.() ?? []
    } catch {}
    for (const it of extra)
      entries.push({
        kind: it.id === 'mode' ? 'mode' : 'item',
        id: it.id,
        label: it.label,
        title: it.title ?? it.label,
        run: it.run
      })
    if (!extra.some((it) => it.id === 'hide'))
      entries.push({
        kind: 'item',
        id: 'hide',
        label: L('hide', '隐藏'),
        title: '隐藏希可儿',
        run: () => this.setVisible(false)
      })

    const R = 112
    const r = 42
    const size = R * 2 + 8
    const c = size / 2
    const n = entries.length
    const gap = n > 1 ? 1.4 : 0
    const point = (rad, deg) => [c + rad * Math.cos((deg * Math.PI) / 180), c + rad * Math.sin((deg * Math.PI) / 180)]
    const ring = svg('svg', {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      class: 'whale-mate__wheel-svg',
      role: 'menu'
    })
    const hub = svg('g', { class: 'whale-mate__hub', role: 'button', tabindex: '0', 'aria-label': '关闭' })
    hub.append(svg('circle', { cx: c, cy: c, r: r - 5 }))
    const hubText = svg('text', { x: c, y: c, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
    hubText.textContent = '希可儿'
    hub.append(hubText)
    hub.addEventListener('click', () => this.closeMenu())
    entries.forEach((e, k) => {
      const a0 = -90 + (360 * k) / n + gap / 2
      const a1 = -90 + (360 * (k + 1)) / n - gap / 2
      const g = svg('g', {
        class: `whale-mate__seg is-${e.kind}`,
        role: 'menuitem',
        tabindex: '0',
        'aria-label': e.title
      })
      g.dataset[e.kind === 'choice' ? 'choice' : 'item'] = e.id
      let d
      if (n === 1) {
        d = `M ${c - R} ${c} A ${R} ${R} 0 1 1 ${c + R} ${c} A ${R} ${R} 0 1 1 ${c - R} ${c} M ${c - r} ${c} A ${r} ${r} 0 1 0 ${c + r} ${c} A ${r} ${r} 0 1 0 ${c - r} ${c} Z`
      } else {
        const large = a1 - a0 > 180 ? 1 : 0
        const [x0, y0] = point(R, a0),
          [x1, y1] = point(R, a1),
          [x2, y2] = point(r, a1),
          [x3, y3] = point(r, a0)
        d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`
      }
      g.append(svg('path', { d, 'fill-rule': 'evenodd' }))
      const mid = n === 1 ? -90 : (a0 + a1) / 2
      const [tx, ty] = point((R + r) / 2, mid)
      const t = svg('text', {
        x: tx,
        y: ty,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: [...e.label].length > 4 ? 'is-long' : ''
      })
      t.textContent = e.label
      g.append(t)
      const run = () => {
        this.closeMenu()
        e.run?.()
        this.o.onEvent('menu', {
          id: e.kind === 'choice' ? 'favorite' : e.id,
          choice: e.kind === 'choice' ? e.id : undefined
        })
      }
      g.addEventListener('click', run)
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          run()
        }
      })
      g.addEventListener('pointerenter', () => {
        hubText.textContent = e.title
      })
      g.addEventListener('pointerleave', () => {
        hubText.textContent = '希可儿'
      })
      ring.append(g)
    })
    ring.append(hub)
    this.menu.classList.remove('whale-mate__library')
    this.menu.classList.add('whale-mate__wheel')
    this.menu.replaceChildren(ring)
    this.menu.hidden = false
    this.menu.style.left = clamp(x - size / 2, 4, innerWidth - size - 4) + 'px'
    this.menu.style.top = clamp(y - size / 2, 4, innerHeight - size - 4) + 'px'
  }

  /** Everything she can play right now: motions (by category) and expressions, as { id, label, category, icon }. */
  motionChoices() {
    const catalog = this.motions?.catalog() ?? []
    const motions = catalog.filter((e) => e.status === 'ready' && e.category !== '表情')
    for (const [id, label] of BUILTIN_GESTURES)
      if (GESTURES[id] && !motions.some((e) => e.id === id)) motions.push({ id, label, category: '互动' })
    if (!motions.some((e) => e.id === 'wave')) motions.unshift({ id: 'wave', label: '挥手', category: '互动' })
    if (GESTURES.dance && !motions.some((e) => e.id === 'dance'))
      motions.push({ id: 'dance', label: '跳舞', category: '舞蹈' })
    const faces = [
      ...BASE_FACES.map(([id, label, icon]) => ({ id: 'face:' + id, label, category: '表情', face: id, icon })),
      ...catalog.filter((e) => e.status === 'ready' && e.category === '表情')
    ]
    // Only things she can do in place: no walking, sitting down or crouching (those move her), no
    // technical face tracks, and one entry per name.
    const seen = new Set()
    return [...motions, ...faces]
      .filter(
        (e) =>
          !HIDDEN_CATEGORIES.has(e.category) && !HIDDEN_CHOICES.has(e.id) && !seen.has(e.label) && seen.add(e.label)
      )
      .map((e) => ({
        id: e.id,
        label: e.label,
        category: e.category ?? '其他',
        icon: e.icon ?? CATEGORY_ICONS[e.category] ?? '✨',
        ...(e.face ? { face: e.face } : {})
      }))
  }

  /** Play one entry of motionChoices() (a motion id, or "face:<expression>"). */
  playChoice(id) {
    id = String(id ?? '')
    this.wake()
    if (id.startsWith('face:')) {
      this.expression(id.slice(5), 1, 4)
      this.faceShown = { id, until: this.t + 4 }
      return true
    }
    if (id === 'wave') {
      this.play('wave')
      this.say(pick(GREETINGS), { expression: 'happy' })
      return true
    }
    if (this.play(id)) return true
    const clip = this.motions?.get(id)
    this.say(clip?.posture === 'sit' ? '这里没有能坐的地方……' : '现在做不了这个动作', { expression: 'sad' })
    return false
  }

  get sizeRange() {
    return { ...SIZE_RANGE }
  }
  get maxFavorites() {
    return MAX_FAVORITES
  }

  /** Right-click shortcuts (ids from motionChoices()). */
  favorites() {
    return [...this.favoriteIds]
  }

  setFavorites(ids) {
    this.favoriteIds = [
      ...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id.length < 120))
    ].slice(0, MAX_FAVORITES)
    this.save()
    return this.favorites()
  }

  closeMenu() {
    if (this.menu) this.menu.hidden = true
    clearInterval(this.libraryTimer)
    this.libraryTimer = null
  }

  /**
   * Motion and expression picker (same panel in the Harness page and the desktop overlay).
   * Opens beside her so the motion stays visible, stays open while trying several, and keeps the
   * source files that cannot play yet out of the way.
   */
  openMotionMenu(x, y) {
    const el = (tag, cls, text) => {
      const n = document.createElement(tag)
      if (cls) n.className = cls
      if (text != null) n.textContent = text
      return n
    }
    const catalog = this.motions?.catalog() ?? []
    const ready = catalog.filter((e) => e.status === 'ready' && e.category !== '表情')
    for (const [id, label] of BUILTIN_GESTURES)
      if (GESTURES[id] && !ready.some((e) => e.id === id)) ready.push({ id, label, category: '互动' })
    const faces = [
      ...BASE_FACES.map(([id, label, icon]) => ({ id: 'face:' + id, label, category: '表情', face: id, icon })),
      ...catalog.filter((e) => e.status === 'ready' && e.category === '表情')
    ]
    const pending = catalog.filter((e) => e.status !== 'ready')
    const tabs = [['all', '全部', ready.length]]
    for (const c of MOTION_CATEGORIES) {
      const n = ready.filter((e) => e.category === c).length
      if (n) tabs.push([c, CATEGORY_LABELS[c] ?? c, n])
    }
    for (const c of new Set(ready.map((e) => e.category)))
      if (!MOTION_CATEGORIES.includes(c)) tabs.push([c, c, ready.filter((e) => e.category === c).length])
    tabs.push(['表情', '表情', faces.length])
    let tab = this.libraryTab && tabs.some((t) => t[0] === this.libraryTab) ? this.libraryTab : 'all'

    const head = el('div', 'whale-mate__lib-head')
    const title = el('strong', null, '动作与表情')
    const closeX = el('button', 'whale-mate__lib-x', '×')
    closeX.type = 'button'
    closeX.setAttribute('aria-label', '关闭')
    closeX.onclick = () => this.closeMenu()
    head.append(title, closeX)
    const search = el('input')
    search.type = 'search'
    search.placeholder = '搜索：挥手、坐、开心…'
    search.setAttribute('aria-label', '搜索动作和表情')
    const bar = el('div', 'whale-mate__tabs')
    bar.setAttribute('role', 'tablist')
    const grid = el('div', 'whale-mate__motion-grid')
    const foot = el('div', 'whale-mate__lib-foot')
    const now = el('span', 'whale-mate__lib-now')
    const stop = el('button', 'whale-mate__lib-stop', '■ 停止')
    stop.type = 'button'
    stop.onclick = () => {
      this.gesture = null
      this.face?.clearHolds()
      this.faceShown = null
      refresh()
    }
    foot.append(now, stop)
    const more = el('details', 'whale-mate__lib-more')
    more.append(el('summary', null, `暂不能播放的源文件（${pending.length}）`))
    const pendingList = el('div', 'whale-mate__lib-pending')
    more.append(pendingList)
    more.ontoggle = () => {
      if (!more.open || pendingList.childElementCount) return
      for (const e of pending) {
        const row = el('div', null, e.label)
        row.title =
          e.reason ??
          {
            'needs-unity': '需要 Unity 转换',
            'needs-rig': '待重定向',
            'missing-body': '缺少主体动画',
            'source-asset': '源资源'
          }[e.status] ??
          ''
        pendingList.append(row)
      }
    }
    if (!pending.length) more.hidden = true

    const playing = () => this.gesture?.name ?? null
    const tile = (e) => {
      const b = el('button', 'whale-mate__tile')
      b.type = 'button'
      b.dataset.motion = e.id
      b.append(el('span', 'whale-mate__tile-icon', e.icon ?? CATEGORY_ICONS[e.category] ?? '✨'))
      const text = el('span', 'whale-mate__tile-text')
      text.append(el('span', 'whale-mate__tile-label', e.label))
      const clip = e.face ? null : this.motions?.get(e.id)
      const meta = e.face
        ? '表情 · 4 秒'
        : [
            CATEGORY_LABELS[e.category] ?? e.category,
            clip?.posture === 'sit' ? '坐着' : null,
            clip ? (clip.loop ? '循环' : '单次') : null
          ]
            .filter(Boolean)
            .join(' · ')
      text.append(el('span', 'whale-mate__tile-meta', meta))
      b.append(text)
      b.title = e.face ? `换成「${e.label}」表情` : `播放「${e.label}」`
      b.onclick = () => {
        this.wake()
        if (e.face) {
          this.expression(e.face, 1, 4)
          this.faceShown = { id: e.id, until: this.t + 4 }
        } else if (!this.play(e.id)) {
          this.say(clip?.posture === 'sit' ? '这里没有能坐的地方……' : '现在做不了这个动作', { expression: 'sad' })
        }
        this.o.onEvent('motion', { id: e.id })
        refresh()
      }
      return b
    }
    const render = () => {
      const q = search.value.trim().toLowerCase()
      const pool = q
        ? [...ready, ...faces]
        : tab === 'all'
          ? ready
          : tab === '表情'
            ? faces
            : ready.filter((e) => e.category === tab)
      const entries = pool.filter(
        (e) => !q || `${e.label} ${e.id} ${CATEGORY_LABELS[e.category] ?? e.category ?? ''}`.toLowerCase().includes(q)
      )
      bar.replaceChildren(
        ...tabs.map(([id, label, n]) => {
          const t = el('button', 'whale-mate__tab' + (!q && id === tab ? ' is-on' : ''), label)
          t.type = 'button'
          t.setAttribute('role', 'tab')
          t.setAttribute('aria-selected', String(!q && id === tab))
          t.append(el('small', null, String(n)))
          t.onclick = () => {
            tab = this.libraryTab = id
            search.value = ''
            render()
          }
          return t
        })
      )
      grid.replaceChildren(...entries.map(tile))
      if (!entries.length)
        grid.append(el('p', 'whale-mate__lib-empty', q ? '没有匹配的动作或表情' : '这一类还没有动作'))
      refresh()
    }
    const refresh = () => {
      const g = playing()
      const face = this.faceShown && this.faceShown.until > this.t ? this.faceShown.id : null
      for (const b of grid.querySelectorAll('.whale-mate__tile'))
        b.classList.toggle('is-on', b.dataset.motion === g || b.dataset.motion === face)
      const label = g
        ? (this.motions?.get(g)?.label ?? catalog.find((e) => e.id === g)?.label ?? GESTURE_LABELS[g] ?? g)
        : null
      now.textContent = label
        ? '正在播放：' + label
        : face
          ? '表情：' + faces.find((e) => e.id === face)?.label
          : '点一下试试，可以连续点'
      stop.disabled = !g && !face
    }
    search.oninput = render

    this.closeMenu()
    this.menu.classList.remove('whale-mate__wheel')
    this.menu.classList.add('whale-mate__library')
    this.menu.replaceChildren(head, search, bar, grid, foot, more)
    this.menu.hidden = false
    render()
    this.libraryTimer = setInterval(refresh, 300)
    // Beside her, not on top of her: the point is to watch the motion.
    const r = this.menu.getBoundingClientRect()
    const box = this.boxRect
      ? {
          left: this.boxRect.left,
          top: this.boxRect.top,
          right: this.boxRect.left + this.box.w,
          bottom: this.boxRect.top + this.box.h
        }
      : null
    let left, top
    if (box) {
      const body = { left: box.left + this.box.w * 0.22, right: box.right - this.box.w * 0.22 }
      left =
        body.right + 12 + r.width <= innerWidth - 4
          ? body.right + 12
          : body.left - 12 - r.width >= 4
            ? body.left - 12 - r.width
            : (x ?? innerWidth / 2 - r.width / 2)
      top = box.top + this.box.h * 0.08
    } else {
      left = x ?? innerWidth / 2 - r.width / 2
      top = y ?? innerHeight / 2 - r.height / 2
    }
    this.menu.style.left = clamp(left, 4, innerWidth - r.width - 4) + 'px'
    this.menu.style.top = clamp(top, 4, innerHeight - r.height - 4) + 'px'
    this.menu.onkeydown = (e) => {
      if (e.key === 'Escape') this.closeMenu()
    }
    search.focus({ preventScroll: true })
    this.setCapture(true)
  }

  // ------------------------------------------------------------------ bubble

  showBubble(text, seconds, thinking = false) {
    const b = this.bubble
    b.classList.toggle('is-thinking', thinking)
    if (thinking) b.replaceChildren(...[0, 1, 2].map(() => Object.assign(document.createElement('i'), {})))
    else b.textContent = text
    b.hidden = false
    this.bubbleUntil = this.t + seconds
  }

  hideBubble() {
    this.bubble.hidden = true
    this.bubble.classList.remove('is-thinking')
  }

  placeBubble(headY) {
    const b = this.bubble
    if (b.hidden) return
    if (this.t > this.bubbleUntil) return this.hideBubble()
    const w = b.offsetWidth
    const h = b.offsetHeight
    let top = headY - h - 14
    const below = top < 6
    if (below) top = headY + this.size * 0.42
    b.classList.toggle('is-below', below)
    b.style.left = clamp(this.anchor.x - w / 2, 6, innerWidth - w - 6) + 'px'
    b.style.top = clamp(top, 6, innerHeight - h - 6) + 'px'
  }

  // ------------------------------------------------------------------ frame

  frame(now) {
    if (this.destroyed) return
    this.raf = requestAnimationFrame((n) => this.frame(n))
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    if (!this.visible || this.suspended || document.hidden || dt <= 0) return
    this.t += dt
    this.step(dt)
    this.animate(dt)
    this.render()
  }

  step(dt) {
    const scale = this.size / 240
    this.idleBrain(dt)

    if (this.loc === 'drag') {
      const target = {
        x: this.cursor.x,
        y: this.cursor.y + (this.body.height - this.body.chest) * this.ppm + this.size * 0.05
      }
      const nx = damp(this.anchor.x, target.x, 22, dt)
      const ny = damp(this.anchor.y, target.y, 22, dt)
      this.dragVel = {
        x: damp(this.dragVel.x, (nx - this.anchor.x) / dt, 10, dt),
        y: damp(this.dragVel.y, (ny - this.anchor.y) / dt, 10, dt)
      }
      this.anchor = { x: nx, y: ny }
      return
    }

    if (this.loc === 'fall') {
      const g = GRAVITY * scale
      const y0 = this.anchor.y
      this.vel.y += g * dt
      this.anchor.x += this.vel.x * dt
      this.anchor.y += this.vel.y * dt
      const m = this.box.w * 0.3
      if (this.anchor.x < m || this.anchor.x > innerWidth - m) {
        this.anchor.x = clamp(this.anchor.x, m, innerWidth - m)
        this.vel.x *= -0.45
      }
      if (this.vel.y > 0) {
        const s = this.findSurface(this.anchor.x, y0, this.anchor.y)
        if (s) {
          this.perch = { el: s.el, dx: this.anchor.x - s.left }
          this.atHome = isHome(s.el, safeFindHome(this.o.findHome, this.root))
          this.anchor.y = s.top
          this.land()
          return
        }
      }
      if (this.anchor.y >= innerHeight - 2) {
        this.anchor.y = innerHeight - 2
        this.perch = null
        this.atHome = false
        this.land()
      }
      return
    }

    const base = this.resolvePerch()
    if (!base) {
      // perch vanished (scrolled away, closed, re-rendered): fall
      this.perch = null
      this.atHome = false
      this.vel = { x: 0, y: 0 }
      this.setLoc('fall')
      return
    }
    if (this.loc === 'walk' && this.walkTarget != null) {
      const dir = Math.sign(this.walkTarget - this.anchor.x)
      const speed = 70 * scale
      this.walkPhase += dt * 6.2
      if (this.perch) this.perch.dx += dir * speed * dt
      else this.anchor.x += dir * speed * dt
      this.walkDir = dir
      const pos = this.perch ? this.resolvePerch() : this.anchor
      if (!pos || Math.abs(this.walkTarget - pos.x) < 4) {
        this.walkTarget = null
        this.setLoc('stand')
      }
    }
    const pos = this.resolvePerch() ?? base
    this.anchor.x = pos.x
    this.anchor.y = pos.y

    if (this.loc === 'land') {
      this.landT += dt
      if (this.landT > 0.5) {
        this.setLoc(this.perch ? 'sit' : 'stand')
        if (this.perch) this.saveHomeDx()
      }
    }
  }

  land() {
    const speed = this.vel.y
    this.vel = { x: 0, y: 0 }
    this.jumpGoal = null
    this.setLoc('land')
    this.landImpact = clamp(speed / 1600, 0.35, 1)
    if (speed > 1500) this.expression('sad', 0.5, 1.2)
    this.o.onEvent('land', { surface: this.perch ? (this.atHome ? 'composer' : 'element') : 'floor' })
  }

  animate(dt) {
    const rig = this.rig
    const t = this.t
    // Locomotion weights (fast for drag, gentle otherwise).
    for (const k of LOCS)
      this.w[k] = damp(this.w[k], k === this.loc ? 1 : 0, this.loc === 'drag' || k === 'drag' ? 14 : 6.5, dt)
    const ctx = {
      vel: this.loc === 'drag' ? this.dragVel : this.vel,
      walkPhase: this.walkPhase,
      landK: Math.sin(Math.min(1, this.landT / 0.5) * Math.PI) * (this.landImpact ?? 0.6),
      legSwing: this.legBurst && t - this.legBurst < 3 ? 2 : this.sleeping ? 0.25 : 1
    }
    rig.reset()
    rig.addPose(this.motions?.sample('stand', t, this.body.height) ?? standPose(t, ctx), this.w.stand)
    rig.addPose(this.motions?.sample('sit', t, this.body.height) ?? sitPose(t, ctx), this.w.sit)
    rig.addPose(
      this.motions?.sample(
        'walk',
        (this.walkPhase / (2 * Math.PI)) * (this.motions.get('walk')?.duration ?? 1),
        this.body.height
      ) ?? walkPose(t, ctx),
      this.w.walk
    )
    rig.addPose(danglePose(t, ctx), this.w.drag)
    rig.addPose(fallPose(t, ctx), this.w.fall)
    rig.addPose(landPose(t, ctx), this.w.land)

    // Continuous layers.
    const talking = this.face.speaking
    this.flags.think = damp(this.flags.think, this.busy && !this.reply ? 1 : 0, 4, dt)
    this.flags.talk = damp(this.flags.talk, talking ? 1 : 0, 4, dt)
    this.flags.sleep = damp(this.flags.sleep, this.sleeping ? 1 : 0, 1.5, dt)
    const mood = {}
    const layer = (name, w, g) => {
      if (w < 0.002) return
      const imported = this.motions?.sample(name, g, this.body.height)
      const out = imported ?? GESTURES[name]?.fn(g)
      if (!out) return
      // A greeting while seated must not straighten the legs or move the seat.
      if (imported && (this.w.sit > 0.1 || this.w.walk > 0.1)) {
        out.quaternions = Object.fromEntries(
          Object.entries(out.quaternions).filter(([n]) => !/hips|Leg|Foot|Toes/.test(n))
        )
        out.root = {}
      }
      rig.overridePose(out.bones, w, out.quaternions)
      rig.addOffsets(out.add, w)
      rig.addRoot(out.root, w)
      for (const [k, v] of Object.entries(
        imported?.face && Object.keys(imported.face).length ? imported.face : (GESTURES[name]?.face ?? {})
      ))
        mood[k] = Math.max(mood[k] ?? 0, v * w)
      if (out.look) this.lookOverride = { ...out.look, w }
    }
    this.lookOverride = null
    layer('sleep', this.flags.sleep, t)
    layer('think', this.flags.think, t)
    layer(
      this.w.sit > 0.5 && this.motions?.get('q-sitting-talking-loop') ? 'q-sitting-talking-loop' : 'talk',
      this.flags.talk * (1 - this.flags.think),
      t
    )

    // One-shot gesture.
    if (this.gesture) {
      const g = this.gesture
      const el = t - g.t0
      const w = envelope(el, g.duration, g.fade) * (this.loc === 'drag' || this.loc === 'fall' ? 0 : 1)
      if (el > g.duration) this.gesture = null
      else layer(g.name, w, el)
    }

    // Look at the cursor (or the gesture's gaze), with head/neck sharing the turn.
    this.updateLook(dt, rig, mood)

    // Whatever the sit clip or gesture does with the legs, she sits with knees and feet together.
    if (this.w.sit > 0.002) rig.overridePose(sitLegs(t, this.__sitLegs ?? SIT_LEGS, ctx.legSwing), this.w.sit)
    if (this.flags.think > 0.5) mood.relaxed = Math.max(mood.relaxed ?? 0, 0.2)
    mood.seated = this.w.sit
    rig.apply(dt, this.loc === 'drag' ? 22 : 15)
    this.face.update(dt, t, mood)

    // Root placement: world position mirrors the page so springs feel real motion.
    const sitDrop = this.w.sit * (this.body.hips - 0.07)
    const dragDrop = this.w.drag * 0
    const ppm = this.ppm
    // Sitting reads better at a slight three-quarter angle (the long skirt hides the thighs head-on).
    const sitYaw = this.w.sit * (this.anchor.x > innerWidth / 2 ? -0.42 : 0.42)
    const yawToward = this.loc === 'walk' ? 0.8 * (this.walkDir ?? 0) : this.lookYaw * 0.35 + sitYaw
    this.bodyYaw = damp(this.bodyYaw ?? 0, yawToward + (this.__debugYaw ?? 0), 5, dt)
    this.avatar.position.set(
      this.anchor.x / ppm,
      -this.anchor.y / ppm - this.body.floor + rig.root.y - sitDrop - dragDrop,
      0
    )
    this.avatar.rotation.set(rig.root.rotX ?? 0, this.bodyYaw, rig.root.rotZ ?? 0)
    if (this.w.drag > 0.01) {
      // Pivot the dangling body around the grab point (upper chest), not the feet.
      const pivotY = this.body.chest
      this.avatar.position.y += pivotY * (1 - Math.cos(this.avatar.rotation.z)) * this.w.drag
      this.avatar.position.x += -Math.sin(this.avatar.rotation.z) * pivotY * this.w.drag
    }
    // Keep the lowest supporting foot on its surface after retargeting body proportions.
    // Sitting, dragging and airborne states retain their own anchor/pivot.
    if (this.motions && this.w.stand + this.w.walk > 0.001) {
      const left = this.rig.nodes.leftFoot,
        right = this.rig.nodes.rightFoot
      if (left && right) {
        this.avatar.updateMatrixWorld(true)
        const low = Math.min(
          left.getWorldPosition(new THREE.Vector3()).y,
          right.getWorldPosition(new THREE.Vector3()).y
        )
        const correction = -this.anchor.y / ppm + this.body.footHeight - low
        this.avatar.position.y += correction * (this.w.stand + this.w.walk)
      }
    }
    // Teleports (first frame, window resize, perch re-layout) would fling hair and tail: reset springs.
    const jump = this.lastPos
      ? Math.hypot(this.avatar.position.x - this.lastPos.x, this.avatar.position.y - this.lastPos.y)
      : Infinity
    this.lastPos = { x: this.avatar.position.x, y: this.avatar.position.y }
    this.vrm.update(dt)
    this.drape?.update()
    if (jump > this.body.height * 0.6 && this.loc !== 'drag' && this.loc !== 'fall') {
      this.vrm.scene.updateMatrixWorld(true)
      this.vrm.springBoneManager?.reset()
    }
  }

  updateLook(dt, rig, _mood) {
    const head = this.vrm.humanoid.getNormalizedBoneNode('head')
    head.updateWorldMatrix(true, false)
    const hp = head.getWorldPosition(new THREE.Vector3())
    // Head position on the page (for bubble and pat detection).
    this.headScreen = { x: hp.x * this.ppm, y: -hp.y * this.ppm }
    const recent = this.t - this.cursor.at < 5
    let dx, dy, w
    if (this.lookOverride) {
      dx = this.lookOverride.x
      dy = this.lookOverride.y
      w = this.lookOverride.w
    } else if (recent && this.loc !== 'drag') {
      dx = (this.cursor.x - this.headScreen.x) / this.ppm
      dy = (this.headScreen.y - this.cursor.y) / this.ppm
      w = 1
    } else {
      dx = 0.4 * Math.sin(this.t * 0.17)
      dy = -0.15 + 0.1 * Math.sin(this.t * 0.23)
      w = 0.6
    }
    w *= 1 - this.flags.sleep
    const depth = 0.9
    const yaw = clamp(Math.atan2(dx, depth), -0.75, 0.75) * w
    const pitch = clamp(Math.atan2(dy, depth), -0.4, 0.45) * w
    this.lookYaw = damp(this.lookYaw ?? 0, yaw, 7, dt)
    this.lookPitch = damp(this.lookPitch ?? 0, pitch, 7, dt)
    rig.addOffsets(
      {
        neck: [-this.lookPitch * 0.35, this.lookYaw * 0.35, 0],
        head: [-this.lookPitch * 0.55, this.lookYaw * 0.45, 0]
      },
      1
    )
    // Eyes: aim the VRM look-at a little ahead of the face.
    this.lookTarget.position.set(hp.x + Math.sin(yaw) * 2, hp.y + Math.sin(pitch) * 2, 2)
  }

  render() {
    const { ax, ay, w, h } = this.box
    const left = Math.round(this.anchor.x - ax)
    const top = Math.round(this.anchor.y - ay)
    this.boxRect = { left, top }
    this.canvas.style.transform = `translate(${left}px, ${top}px)`
    this.camera.position.set(this.anchor.x / this.ppm, -this.anchor.y / this.ppm, 10)
    this.camera.updateMatrixWorld()
    this.renderer.render(this.scene, this.camera)

    // Per-pixel hit test: only opaque character pixels capture the mouse.
    let hit = false
    const cx = this.cursor.x - left
    const cy = this.cursor.y - top
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) {
      const gl = this.renderer.getContext()
      gl.readPixels(
        Math.floor(cx * this.dpr),
        Math.floor((h - cy) * this.dpr),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.pixel
      )
      hit = this.pixel[3] > 24
      // Legs hanging over the perch must not block the element underneath (e.g. the send button).
      if (hit && this.loc === 'sit' && this.perch && this.cursor.y > this.anchor.y - 2) hit = false
    }
    if (hit !== this.hit || this.press) {
      this.hit = hit
      this.canvas.style.pointerEvents = hit || this.press ? 'auto' : 'none'
      this.canvas.style.cursor = this.press?.dragging ? 'grabbing' : hit ? 'grab' : ''
    }
    this.setCapture(hit || !!this.press || !this.menu.hidden)
    const headTop = this.headScreen ? this.headScreen.y - this.body.height * 0.09 * this.ppm : top
    this.placeBubble(headTop)
  }

  saveHomeDx() {
    if (this.atHome && this.perch) this.saved.homeDx = this.perch.dx
    this.save()
  }

  save() {
    this.saved = {
      ...this.saved,
      sizeV: 3,
      size: this.size,
      favorites: this.favoriteIds,
      visible: this.visible,
      floorX: this.perch ? this.saved.floorX : this.anchor.x / innerWidth
    }
    if (this.o.persist)
      try {
        localStorage.setItem(this.o.storageKey, JSON.stringify(this.saved))
      } catch {}
  }
}

// ---------------------------------------------------------------------- helpers

function isHome(el, home) {
  if (!home) return false
  if (el === home) return true
  return el instanceof Node && home instanceof Node && home.contains(el)
}

function loadSettings(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function safeFindHome(fn, root) {
  try {
    const el = fn()
    return el && !(el instanceof Node && root.contains(el)) && isVisible(el) ? el : null
  } catch {
    return null
  }
}

function isVisible(el) {
  const r = el.getBoundingClientRect()
  if (r.width < 60 || r.height < 16) return false
  if (!(el instanceof Element)) return el.visible?.() ?? true
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
}

/** The composer card: the visible textarea's nearest boxed ancestor. */
export function defaultFindHome() {
  const areas = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 160 && r.height > 12 && r.bottom > innerHeight * 0.4
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)
  const area = areas[0]
  if (!area) return null
  let best = area
  for (let el = area.parentElement, i = 0; el && i < 6; el = el.parentElement, i++) {
    const r = el.getBoundingClientRect()
    if (r.height > Math.max(320, innerHeight * 0.45)) break
    if (looksBoxed(el)) best = el
  }
  return best
}

function looksBoxed(el) {
  const s = getComputedStyle(el)
  const bg = s.backgroundColor
  const hasBg = bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)
  const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'
  return hasBg || hasBorder || (s.boxShadow && s.boxShadow !== 'none')
}

/** The nearest boxed ancestor of `el` whose top edge is within [y0, y1] and spans x. */
function surfaceOf(el, x, y0, y1) {
  for (
    let n = el, i = 0;
    n && n !== document.body && n !== document.documentElement && i < 8;
    n = n.parentElement, i++
  ) {
    const r = n.getBoundingClientRect()
    if (
      r.top >= y0 &&
      r.top <= y1 &&
      r.left <= x &&
      r.right >= x &&
      r.width >= 140 &&
      r.height >= 20 &&
      (looksBoxed(n) || /^(TEXTAREA|IMG|VIDEO|PRE|TABLE)$/.test(n.tagName))
    ) {
      // Prefer the outer card: an input inside a boxed composer should seat the pet on the card edge.
      let best = { el: n, top: r.top, left: r.left }
      for (let a = n.parentElement, j = 0; a && a !== document.body && j < 3; a = a.parentElement, j++) {
        const ar = a.getBoundingClientRect()
        if (
          ar.top <= best.top &&
          ar.top >= best.top - 28 &&
          ar.left <= x &&
          ar.right >= x &&
          ar.height < innerHeight * 0.5 &&
          looksBoxed(a)
        )
          best = { el: a, top: ar.top, left: ar.left }
      }
      return best
    }
  }
  return null
}

function tail(text, n) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length <= n ? chars.join('') : '…' + chars.slice(-n).join('')
}

function summary(text, n) {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(flat)
  if (chars.length <= n) return flat
  const head = chars.slice(0, n).join('')
  const cut = Math.max(...['。', '！', '？', '!', '?', '. '].map((p) => head.lastIndexOf(p)))
  return (cut > n * 0.45 ? head.slice(0, cut + 1) : head) + '…'
}

/**
 * A perch that is not a page element: a rectangle in overlay coordinates kept up to date by the
 * caller (desktop mode uses it for the Harness window and its composer).
 */
export function virtualSurface(name) {
  let rect = null
  let spans = null // visible parts of the top edge [[left, right], …]; null = all of it
  const spanAt = (x, margin = 0) => {
    if (!rect) return null
    for (const s of spans ?? [[rect.left, rect.right]]) if (x >= s[0] + margin && x <= s[1] - margin) return s
    return null
  }
  return {
    name,
    get isConnected() {
      return rect !== null
    },
    visible: () => rect !== null,
    set(r, visibleSpans = null) {
      rect = r
        ? {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            right: r.left + r.width,
            bottom: r.top + r.height
          }
        : null
      spans = Array.isArray(visibleSpans)
        ? visibleSpans
            .filter((s) => Array.isArray(s) && s.length === 2 && s.every(Number.isFinite))
            .map((s) => [s[0], s[1]])
        : null
    },
    spans: () => (rect ? (spans ?? [[rect.left, rect.right]]) : []),
    spanAt,
    accepts: (x, margin = 0) => spanAt(x, margin) !== null,
    getBoundingClientRect: () => rect ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
  }
}
