// Browser half of dsh-plugin-whale-mate (hand-written dsh client module, no build step).
// Loads the pet engine from the host route, follows the session in the main view and
// turns its live events into pet behaviour: thinking while the agent runs, mouthing the
// streamed reply, reacting to pet_* tool calls, and showing errors.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-whale-mate',
  factory: (require) => {
    'use strict'
    const React = require('react')
    const h = React.createElement

    /** Tiny external store so React widgets re-render when the pet changes. */
    function createStore() {
      let state = { pet: null, error: null, visible: true }
      const subs = new Set()
      return {
        get: () => state,
        set(patch) { state = { ...state, ...patch }; for (const fn of subs) fn() },
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
      }
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    function textOf(message) {
      return (message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('')
    }

    function parseArgs(raw) {
      if (raw && typeof raw === 'object') return raw
      try { return JSON.parse(raw || '{}') } catch { return {} }
    }

    function failureHint(message) {
      const m = String(message ?? '')
      if (/no API key/i.test(m)) return '还没有配置 API Key，请在 设置 → 模型 中填写～'
      if (/401|unauthori[sz]ed|invalid api key/i.test(m)) return 'API Key 好像不对……'
      if (/429|rate limit|quota|insufficient/i.test(m)) return '请求太频繁或额度不足了'
      if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|network|fetch failed/i.test(m)) return '网络好像断了……'
      return m ? '出错了：' + Array.from(m).slice(0, 60).join('') : '出错了……'
    }

    /** Follow the main-view session and drive the pet from its live events. */
    function followChat(ctx, getPet) {
      const sessions = ctx.sessions
      if (!sessions?.list) return () => {}
      let currentId = null
      let unbind = null
      let running = false
      let seen = new Set()
      const replies = new Map() // attemptId -> text so far
      let streaming = null

      const mainViewId = () => {
        const byId = sessions.list.getSnapshot()?.byId ?? {}
        for (const row of Object.values(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id
        return null
      }

      function onEntry(entry) {
        const pet = getPet()
        if (!pet || !entry) return
        if (entry.type === 'transient') {
          const ev = entry.event
          if (ev?.type !== 'assistant/live-chunk') return
          const { attemptId, chunk } = ev.data ?? {}
          if (chunk?.type !== 'text-delta' || !chunk.text) return
          const text = (replies.get(attemptId) ?? '') + chunk.text
          replies.set(attemptId, text)
          streaming = attemptId
          pet.streamReply(text)
          return
        }
        if (entry.type !== 'event') return
        const ev = entry.event
        if (!ev || (ev.seq != null && seen.has(ev.seq))) return
        if (ev.seq != null) seen.add(ev.seq)
        const d = ev.data ?? {}
        switch (ev.type) {
          case 'user/message':
            if (d.source?.kind === 'user') pet.noticeUserMessage()
            break
          case 'assistant/message': {
            const text = textOf(d.message)
            replies.clear()
            streaming = null
            if (text.trim()) pet.finishReply(text)
            break
          }
          case 'assistant/attempt': {
            const finish = (d.stream ?? []).map((f) => f?.chunk).find((c) => c?.type === 'finish')
            const failure = finish?.reason?.failure?.message
            replies.clear()
            streaming = null
            if (failure) pet.finishReply(failureHint(failure), { error: true })
            break
          }
          case 'tool/call': {
            if (!String(d.name ?? '').startsWith('pet_')) break
            const a = parseArgs(d.arguments)
            if (d.name === 'pet_say' && a.text) pet.say(a.text, { expression: a.expression })
            else if (d.name === 'pet_expression' && a.name) pet.expression(a.name, 1, Math.min(30, Math.max(1, a.seconds ?? 4)))
            else if (d.name === 'pet_action' && a.name) pet.action(a.name)
            break
          }
          case 'turn/end':
            if (d.reason?.kind === 'error' && !streaming) pet.finishReply(failureHint(d.reason.error?.message), { error: true })
            break
        }
      }

      function onChange(change) {
        if (!change) return
        // History pages and reconnect re-syncs replay old events: only react to live ones.
        if (change.kind === 'append') for (const e of change.entries ?? []) onEntry(e)
        else if (change.kind === 'settle-assistant' && change.entry) onEntry(change.entry)
      }

      function rebind(id) {
        unbind?.()
        unbind = null
        currentId = id
        seen = new Set()
        replies.clear()
        streaming = null
        if (!id) return
        try {
          const b = sessions.binding(id)
          const source = b?.eventSource
          if (!source?.subscribe) return
          const off = source.subscribe(() => onChange(source.getSnapshot()?.change))
          unbind = typeof off === 'function' ? off : () => off?.unsubscribe?.()
        } catch (e) {
          console.warn('[whale-mate] could not follow session', e)
        }
      }

      function onList() {
        const id = mainViewId()
        if (id !== currentId) rebind(id)
        const row = id ? sessions.list.getSnapshot()?.byId?.[id] : null
        const now = !!row?.running
        if (now !== running) {
          running = now
          const pet = getPet()
          if (pet) {
            pet.setThinking(now)
            if (!now && streaming) { pet.finishReply(); streaming = null }
          }
        }
      }

      const offList = sessions.list.subscribe(onList)
      onList()
      return () => {
        if (typeof offList === 'function') offList()
        unbind?.()
      }
    }

    const CLIENT_VERSION = '0.6.3'
    const DESKTOP_PREF = 'dsh-whale-mate.desktop'
    const PET_METHODS = ['say', 'setThinking', 'streamReply', 'finishReply', 'noticeUserMessage', 'expression', 'action', 'setSize', 'recall', 'setVisible', 'openMotionMenu', 'setFavorites', 'playChoice']

    /**
     * Desktop mode: the host opens a transparent always-on-top window and the pet lives there.
     * This side keeps it fed: chat-driven pet calls are relayed, and the Harness window's screen
     * position plus the composer rectangle are reported so she can sit on them.
     */
    function createDesktop(base, store, getPet, getModelId) {
      let status = null
      let seq = -1
      let pollTimer = null
      let geomTimer = null
      let lastGeom = ''
      let queue = []
      let flushTimer = null
      let overlayVisible = true
      let findHome = null
      let disposed = false
      let noticesEnabled = false
      let lastRequest = null
      let lastStartRequest = null
      const pref = () => { try { return localStorage.getItem(DESKTOP_PREF) === '1' } catch { return false } }
      const setPref = (on) => { try { localStorage.setItem(DESKTOP_PREF, on ? '1' : '0') } catch {} }

      // No pop-ups: while switching mode she says how it is going herself (in the page until the
      // desktop window is ready, then from the desktop). Only after the user asked for a switch.
      let lastHint = ''
      let lastHintAt = 0
      let greeted = false
      function hint(text, { expression, failed = false, force = false } = {}) {
        if (!noticesEnabled || disposed || !text) return
        if (text === lastHint && !force) return
        const now = Date.now()
        // Download progress: at most one line every few seconds.
        if (!force && !failed && now - lastHintAt < 3500 && /%/.test(text) && /%/.test(lastHint)) return
        lastHint = text
        lastHintAt = now
        const pet = getPet()
        const viaDesktop = status?.running && status?.ready
        if (viaDesktop) post({ type: 'cmd', method: 'say', args: [text, { expression: expression ?? (failed ? 'sad' : 'happy') }] })
        else if (pet) pet.say(text, { expression: expression ?? (failed ? 'sad' : 'happy') })
      }
      const shortReason = (m) => { const t = String(m ?? '').split('\n')[0].replace(/^.*?第 \d+ 次：/, ''); return Array.from(t).length > 36 ? Array.from(t).slice(0, 36).join('') + '…' : t }

      function showStatus(next) {
        const failure = (!next.running && lastStartRequest?.error) || next.download?.error || (next.tracking?.error && !next.tracking.fallback && next.tracking.error) || (next.lastExit && !next.running && (next.lastExit.message || '桌面窗口退出了：' + next.lastExit.reason))
        if (failure) { hint('去不了桌面……' + shortReason(failure) + '（详情在设置里）', { failed: true }); noticesEnabled = false; return }
        if (!next.supported) { hint(SHORT_REASONS[next.reason] || '这里没法打开桌面窗口……', { failed: true }); noticesEnabled = false; return }
        if (next.download && !next.download.done) {
          const pct = next.download.total ? Math.floor(next.download.received / next.download.total * 100) : null
          return hint(next.download.phase === 'extract' || next.download.phase === 'verify' ? '快好了，正在整理桌面……' : pct === null ? '正在准备桌面，第一次要多等一会儿～' : `正在准备桌面…${pct}%`, { expression: 'relaxed' })
        }
        if (next.running && !next.ready) return hint('马上就到桌面上～')
        if (next.running && next.ready && !greeted) {
          greeted = true
          hint('我到桌面上啦！可以把我拖到任意窗口顶上哦', { force: true })
          setTimeout(() => { noticesEnabled = false }, 500)
        }
      }

      async function api(path, body) {
        const url = new URL('desktop/' + path, base)
        const init = body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        lastRequest = { path, at: Date.now(), state: 'pending' }
        const request = lastRequest
        if (path === 'start') lastStartRequest = request
        let r, data
        try {
          r = await fetch(url.href, { ...init, signal: AbortSignal.timeout(15000) })
          request.httpStatus = r.status
          data = await r.json()
          request.state = r.ok ? 'ok' : 'failed'
        } catch (e) {
          request.state = 'failed'
          request.error = String(e.message ?? e)
          throw new Error(`桌面请求 ${path.split('?')[0]} 失败：${e.name === 'TimeoutError' ? '15 秒内没有响应' : request.error}`)
        }
        if (!r.ok) { request.error = data.error || 'HTTP ' + r.status; throw new Error(request.error) }
        if (/^(status|start|stop)/.test(path) && typeof data.supported !== 'boolean') {
          request.state = 'failed'
          request.error = '桌面接口返回了无效状态，请检查前后端插件版本是否一致。'
          throw new Error(request.error)
        }
        return data
      }

      function apply(next) {
        if (disposed || !next || next.supported === undefined) return
        status = next
        showStatus(next)
        for (const e of next.events ?? []) {
          if (e.name === 'exit') { setPref(false); setTimeout(() => { const p = getPet(); p?.setSuspended?.(false); p?.recall?.(); p?.say?.('我回来啦～', { expression: 'happy' }) }, 300) }
          if (e.name === 'hidden') overlayVisible = false
          if (e.name === 'ready') { lastGeom = ''; overlayVisible = true; const favs = getPet()?.favorites?.(); if (favs) post({ type: 'cmd', method: 'setFavorites', args: [favs] }) }
        }
        seq = next.seq ?? seq
        const pet = getPet()
        pet?.setSuspended?.(!!next.running && !!next.ready)
        if (next.running && !geomTimer) { lastGeom = ''; geomTimer = setInterval(reportGeometry, 200) }
        if (!next.running && geomTimer) { clearInterval(geomTimer); geomTimer = null }
        store.set({ desktop: { ...next, enabled: pref(), lastRequest, lastStartRequest } })
        schedulePoll()
      }

      function schedulePoll() {
        clearTimeout(pollTimer)
        if (disposed) return
        const busy = status?.download && !status.download.done && !status.download.error
        const ms = busy ? 700 : status?.running || pref() ? 1500 : 15000
        pollTimer = setTimeout(refresh, ms)
      }

      async function refresh() {
        try { apply(await api('status?since=' + seq)) } catch (e) { hint('联系不上桌面……' + shortReason(e.message ?? e), { failed: true }); store.set({ desktop: { ...(status ?? {}), error: String(e.message ?? e), enabled: pref(), lastRequest, lastStartRequest } }); schedulePoll() }
      }

      function geometry() {
        let home = null
        try {
          const el = findHome?.()
          if (el) { const r = el.getBoundingClientRect(); home = { left: r.left, top: r.top, width: r.width, height: r.height } }
        } catch {}
        return { screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight, innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio || 1, home, hidden: document.visibilityState === 'hidden' }
      }

      function reportGeometry() {
        const g = geometry()
        const key = JSON.stringify(g, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
        if (key === lastGeom) return
        lastGeom = key
        post({ type: 'geometry', geometry: g })
      }

      function post(msg) {
        if (msg.type === 'cmd' && msg.method === 'streamReply') queue = queue.filter((m) => !(m.type === 'cmd' && m.method === 'streamReply'))
        if (msg.type === 'geometry') queue = queue.filter((m) => m.type !== 'geometry')
        // Dragging the size slider: only the latest size matters.
        if (msg.type === 'cmd' && msg.method === 'setSize') queue = queue.filter((m) => !(m.type === 'cmd' && m.method === 'setSize'))
        queue.push(msg)
        if (!flushTimer) flushTimer = setTimeout(flush, msg.method === 'streamReply' ? 120 : 16)
      }

      async function flush() {
        flushTimer = null
        const messages = queue
        queue = []
        if (!messages.length) return
        try { await api('send', { messages }) } catch {}
      }

      const remote = Object.fromEntries(PET_METHODS.map((m) => [m, (...args) => { post({ type: 'cmd', method: m, args }); return true }]))
      remote.state = () => ({ visible: overlayVisible, loc: 'desktop', perch: 'desktop', size: getPet()?.state().size ?? 360 })

      const onVisibility = () => { if (geomTimer) reportGeometry() }
      document.addEventListener('visibilitychange', onVisibility)

      refresh().then(() => {
        if (pref() && status?.supported && status.runtime?.ready && !status.running) enable()
      })

      async function enable() {
        noticesEnabled = true
        greeted = false
        lastHint = ''
        hint('好呀，我去桌面上等你～')
        setPref(true)
        overlayVisible = true
        try { apply(await api('start', { size: getPet()?.state().size, model: getModelId?.() ?? undefined, download: true })) } catch (e) { hint('去不了桌面……' + shortReason(e.message ?? e), { failed: true }); store.set({ desktop: { ...(status ?? {}), error: String(e.message ?? e), enabled: true, lastRequest, lastStartRequest } }) }
        schedulePoll()
      }

      async function disable({ quiet = false } = {}) {
        setPref(false)
        noticesEnabled = false
        try { apply(await api('stop', {})) } catch {}
        getPet()?.setSuspended?.(false)
        getPet()?.recall?.()
        if (!quiet) getPet()?.say?.('我回来啦～', { expression: 'happy' })
      }

      return {
        remote,
        active: () => !!status?.running && !!status?.ready,
        supported: () => !!status?.supported,
        setFindHome: (fn) => { findHome = fn },
        enable,
        disable,
        toggleVisible() {
          overlayVisible = !overlayVisible
          post({ type: 'visible', on: overlayVisible })
        },
        recall() { overlayVisible = true; post({ type: 'visible', on: true }) },
        dispose() {
          disposed = true
          clearTimeout(pollTimer)
          clearInterval(geomTimer)
          clearTimeout(flushTimer)
          document.removeEventListener('visibilitychange', onVisibility)
        },
      }
    }

    const MODE_REASONS = { remote: '远程访问时不可用', 'no-display': '这台主机没有桌面', platform: '这台电脑暂不支持' }

    const SHORT_REASONS = {
      remote: '远程访问时我出不了这个窗口……',
      'no-display': '这台主机没有桌面，我出不去……',
      platform: '这台电脑还不支持桌面模式……',
    }

    const REASONS = {
      remote: '你正在远程访问 Harness：桌面模式只能在运行 Harness 的那台电脑上使用。',
      'no-display': '运行 Harness 的主机没有图形桌面，无法打开桌面窗口。',
      platform: '当前系统或 CPU 架构没有可用的桌面运行时。',
    }

    function runtimeProgress(dl) {
      const phase = { checksum: '正在获取校验文件', download: '正在下载桌面运行时', retry: '连接中断，正在重试', verify: '正在校验 SHA-256', extract: '正在解压运行时' }[dl.phase] || '正在下载桌面运行时'
      const amount = `${(dl.received / 1048576).toFixed(1)}${dl.total ? ' / ' + (dl.total / 1048576).toFixed(1) : ''} MB`
      return `${phase}：${amount}${dl.source ? '（' + dl.source + '，第 ' + dl.attempt + '/3 次）' : ''}${dl.lastError ? '\n' + dl.lastError : ''}`
    }

    // ------------------------------------------------------------------ Settings → 希可儿mate
    // Plain, card-based and text-only: who she looks like, where she lives, how big she is, and
    // what the right-click wheel offers. Diagnostics stay folded away at the bottom.
    const ACCENT = '#5b6fd6'
    const LINE = 'var(--border, rgba(120,130,170,.28))'
    const ui = {
      card: { display: 'grid', gap: 12, padding: '16px 18px', borderRadius: 14, border: '1px solid ' + LINE, background: 'rgba(127,140,200,.04)' },
      title: { fontWeight: 600, fontSize: 14 },
      muted: { fontSize: 12, opacity: 0.6 },
      button: { padding: '6px 14px', borderRadius: 999, border: '1px solid ' + LINE, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
    }
    const Card = (title, aside, ...children) => h('section', { style: ui.card },
      h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } }, h('span', { style: ui.title }, title), aside ? h('span', { style: ui.muted }, aside) : null),
      ...children)

    function ModelCard({ models, modelId, onPick }) {
      if (!models?.length) return null
      const chosen = models.find((m) => m.id === modelId) ?? models[0]
      return Card('形象', null,
        h('div', { role: 'radiogroup', 'aria-label': '形象', style: { display: 'flex', gap: 12, flexWrap: 'wrap' } }, models.map((m) => {
          const on = m.id === chosen.id
          return h('button', { key: m.id, type: 'button', role: 'radio', 'aria-checked': on, onClick: () => { if (!on) onPick(m.id) }, title: m.name,
            style: { display: 'grid', justifyItems: 'center', gap: 6, width: 112, padding: '8px 8px 10px', borderRadius: 14, cursor: on ? 'default' : 'pointer', color: 'inherit', background: on ? 'rgba(91,111,214,.10)' : 'transparent', border: '2px solid ' + (on ? ACCENT : 'transparent'), boxShadow: on ? 'none' : 'inset 0 0 0 1px ' + LINE } },
            m.thumb ? h('img', { src: m.thumb, alt: '', width: 75, height: 90, style: { width: 75, height: 90, objectFit: 'cover', borderRadius: 10, background: 'linear-gradient(180deg, rgba(91,111,214,.16), rgba(91,111,214,.04))' } })
              : h('div', { style: { width: 75, height: 90, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 12, opacity: 0.6, background: 'rgba(91,111,214,.08)' } }, 'VRM'),
            h('span', { style: { fontSize: 13, fontWeight: on ? 600 : 400 } }, m.name))
        })),
        chosen.credit ? h('span', { style: ui.muted }, chosen.credit) : null)
    }

    function ModeCard({ store, desktop }) {
      const { desktop: d } = useStore(store)
      const dl = d?.download
      const downloading = !!(dl && !dl.done && !dl.error)
      const onDesktop = !!(d?.running || downloading)
      const supported = !!d?.supported
      const failure = (dl?.error && '下载失败：' + dl.error) || (d?.lastExit && ['crashed', 'error'].includes(d.lastExit.reason) && '桌面窗口异常退出：' + (d.lastExit.message || d.lastExit.code || '')) || (d?.tracking?.error && !d.tracking.fallback && d.tracking.error) || d?.error
      const option = (label, sub, on, onClick, disabled) => h('button', { type: 'button', role: 'radio', 'aria-checked': on, onClick, disabled,
        style: { flex: '1 1 0', display: 'grid', gap: 3, textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: disabled || on ? 'default' : 'pointer', color: 'inherit', opacity: disabled ? 0.45 : 1, background: on ? 'rgba(91,111,214,.10)' : 'transparent', border: '2px solid ' + (on ? ACCENT : 'transparent'), boxShadow: on ? 'none' : 'inset 0 0 0 1px ' + LINE } },
        h('span', { style: { fontSize: 14, fontWeight: 600 } }, label), h('span', { style: ui.muted }, sub))
      const pct = downloading && dl.total ? Math.min(100, Math.floor(dl.received / dl.total * 100)) : null
      return Card('模式', null,
        h('div', { role: 'radiogroup', 'aria-label': '模式', style: { display: 'flex', gap: 10 } },
          option('窗口模式', '在 Harness 页面里', !onDesktop, () => { if (onDesktop) desktop.disable() }),
          option('桌面模式', !d ? '正在检测…' : supported ? '可以坐到任意窗口上' : (MODE_REASONS[d.reason] ?? '这台电脑不能使用'), onDesktop, () => { if (!onDesktop) desktop.enable() }, !supported)),
        downloading && h('div', { style: { display: 'grid', gap: 6 } },
          h('div', { style: { height: 6, borderRadius: 999, background: 'rgba(91,111,214,.15)', overflow: 'hidden' } }, h('div', { style: { height: '100%', width: (pct ?? 8) + '%', background: ACCENT, transition: 'width .3s' } })),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', ...ui.muted } }, h('span', null, '首次使用，正在准备桌面' + (pct !== null ? ` ${pct}%` : '…')), h('button', { type: 'button', onClick: () => desktop.disable({ quiet: true }), style: { ...ui.button, padding: '2px 10px', fontSize: 12 } }, '取消'))),
        failure && h('p', { style: { margin: 0, fontSize: 12, color: '#d05050' } }, String(failure).split('\n')[0].slice(0, 160)))
    }

    function SizeCard({ pet, onSize }) {
      const range = pet.sizeRange ?? { min: 160, max: 640 }
      const size = pet.state().size
      return Card('大小', size + ' px',
        h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 12 } },
          h('span', { style: ui.muted }, '小'),
          h('input', { type: 'range', min: range.min, max: range.max, step: 10, value: size, onChange: (e) => onSize(Number(e.target.value)), 'aria-label': '显示大小', style: { width: '100%', accentColor: ACCENT } }),
          h('span', { style: ui.muted }, '大')))
    }

    /** Small static picture of the right-click wheel: the picked slots, then 模式 and 隐藏. */
    function WheelPreview({ labels, fixed: fixedCount = 1 }) {
      const size = 132, c = size / 2, R = 62, r = 24, n = labels.length
      const pt = (rad, deg) => [c + rad * Math.cos(deg * Math.PI / 180), c + rad * Math.sin(deg * Math.PI / 180)]
      return h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true, style: { flex: 'none' } },
        labels.map((l, k) => {
          const a0 = -90 + 360 * k / n + (n > 1 ? 1.5 : 0), a1 = -90 + 360 * (k + 1) / n - (n > 1 ? 1.5 : 0)
          const large = a1 - a0 > 180 ? 1 : 0
          const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0)
          const d = n === 1 ? `M ${c - R} ${c} A ${R} ${R} 0 1 1 ${c + R} ${c} A ${R} ${R} 0 1 1 ${c - R} ${c} M ${c - r} ${c} A ${r} ${r} 0 1 0 ${c + r} ${c} A ${r} ${r} 0 1 0 ${c - r} ${c} Z` : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`
          const [tx, ty] = pt((R + r) / 2, n === 1 ? -90 : (a0 + a1) / 2)
          const fixed = k >= n - fixedCount
          return h('g', { key: k },
            h('path', { d, fillRule: 'evenodd', fill: fixed ? 'rgba(91,111,214,.16)' : 'rgba(91,111,214,.07)', stroke: 'rgba(91,111,214,.35)', strokeWidth: 1 }),
            h('text', { x: tx, y: ty, textAnchor: 'middle', dominantBaseline: 'central', fontSize: n > 6 ? 9 : 10, fill: 'currentColor', opacity: 0.8 }, Array.from(l).slice(0, 4).join('')))
        }),
        h('circle', { cx: c, cy: c, r: r - 4, fill: ACCENT }))
    }

    function WheelCard({ pet, onChange, modeLabel }) {
      const [, force] = React.useState(0)
      const max = pet.maxFavorites ?? 6
      const choices = pet.motionChoices()
      const chosen = pet.favorites().filter((id) => choices.some((c) => c.id === id))
      const byId = new Map(choices.map((c) => [c.id, c]))
      const set = (ids) => { onChange(pet.setFavorites(ids)); force((n) => n + 1) }
      const chip = (c) => {
        const on = chosen.includes(c.id)
        const full = !on && chosen.length >= max
        return h('button', { key: c.id, type: 'button', 'aria-pressed': on, disabled: full, title: on ? '从转盘移除' : full ? `转盘最多 ${max} 个` : '加到转盘',
          onClick: () => set(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id]),
          style: { padding: '5px 12px', borderRadius: 999, fontSize: 12, cursor: full ? 'default' : 'pointer', color: on ? '#fff' : 'inherit', background: on ? ACCENT : 'transparent', border: '1px solid ' + (on ? ACCENT : LINE), opacity: full ? 0.4 : 1 } }, c.label)
      }
      const group = (title, sub, list) => h('div', { style: { display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid ' + LINE } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, title),
          h('span', { style: ui.muted }, sub)),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, list.map(chip)))
      return Card('右键转盘', `已选 ${chosen.length}/${max}`,
        h('div', { style: { display: 'flex', gap: 18, alignItems: 'center' } },
          h(WheelPreview, { labels: [...chosen.map((id) => byId.get(id)?.label ?? id), ...(modeLabel ? [modeLabel] : []), '隐藏'], fixed: modeLabel ? 2 : 1 }),
          h('span', { style: { ...ui.muted, lineHeight: 1.7 } }, '右键她会弹出转盘，点一下就做。', h('br'), '从下面的「动作」和「表情」里挑常用的放进去；', h('br'), modeLabel ? '模式切换和隐藏一直都在。' : '隐藏一直都在。', h('br'), '平时她也会自己走走、坐坐，随机做些小动作、换换表情。')),
        group('动作', '挥手、点头、比耶……', choices.filter((c) => c.category !== '表情')),
        group('表情', '笑脸、惊讶、难过……', choices.filter((c) => c.category === '表情')))
    }

    function diagnostics(state) {
      const d = state.desktop
      return {
        client: CLIENT_VERSION,
        host: d?.version ?? null,
        page: { base: document.baseURI.replace(/token=[^&]+/, 'token=…'), ua: navigator.userAgent, screen: [window.screenX, window.screenY, window.outerWidth, window.outerHeight, window.innerWidth, window.innerHeight, window.devicePixelRatio] },
        desktop: d ? { supported: d.supported, reason: d.reason, running: d.running, ready: d.ready, runtime: d.runtime, download: d.download, lastExit: d.lastExit, enabled: d.enabled, error: d.error, hostInfo: d.host, tracking: d.tracking, anyWindow: d.anyWindow, lastRequest: d.lastRequest, lastStartRequest: d.lastStartRequest, events: d.events } : null,
        pet: state.pet ? { ...state.pet.state(), springs: undefined, anchor: state.pet.anchor, suspended: state.pet.suspended } : null,
        error: state.error,
      }
    }

    function Diagnostics({ store }) {
      const state = useStore(store)
      const [copied, setCopied] = React.useState(false)
      const text = JSON.stringify(diagnostics(state), null, 1)
      const stale = state.desktop?.version && state.desktop.version !== CLIENT_VERSION
      return h('details', { style: { fontSize: 12, opacity: 0.75 } },
        h('summary', { style: { cursor: 'pointer' } }, `诊断信息 · 版本 ${CLIENT_VERSION}${state.desktop?.version && state.desktop.version !== CLIENT_VERSION ? '（后台 ' + state.desktop.version + '）' : ''}`),
        stale && h('p', { style: { color: '#d05050', margin: '6px 0' } }, '前端和后台版本不一致：请完全退出并重新打开 Harness。'),
        h('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflow: 'auto', background: 'rgba(120,140,220,.08)', padding: 8, borderRadius: 8 } }, text),
        h('button', { type: 'button', onClick: () => { navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {}) }, style: ui.button }, copied ? '已复制' : '复制诊断信息'))
    }

    function SettingsSection({ store, desktop, setModel, avatarUrl }) {
      const { pet, error, desktop: d, models, modelId } = useStore(store)
      const [, force] = React.useState(0)
      const onDesktop = !!d?.running
      const s = pet?.state()
      const status = error ? '加载失败：' + error : !pet ? '正在加载…' : onDesktop ? '在桌面上陪你' : s?.visible === false ? '已隐藏' : s?.perch === 'composer' ? '坐在输入框上' : '在页面里'
      return h('div', { style: { display: 'grid', gap: 14, maxWidth: 600 } },
        h('header', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
          h('img', { src: avatarUrl, alt: '', width: 48, height: 48, style: { width: 48, height: 48, borderRadius: '50%', boxShadow: '0 0 0 2px rgba(91,111,214,.25)' } }),
          h('div', { style: { display: 'grid', gap: 2 } }, h('span', { style: { fontSize: 18, fontWeight: 700 } }, '希可儿mate'), h('span', { style: ui.muted }, status)),
          h('button', { type: 'button', disabled: !pet, onClick: () => { onDesktop ? desktop.recall() : pet.recall(); force((n) => n + 1) }, style: { ...ui.button, marginLeft: 'auto' } }, '叫她回来')),
        models?.length > 1 && h(ModelCard, { models, modelId, onPick: setModel }),
        h(ModeCard, { store, desktop }),
        pet && h(SizeCard, { pet, onSize: (px) => { pet.setSize(px); if (onDesktop) desktop.remote.setSize(pet.state().size); force((n) => n + 1) } }),
        pet?.motionChoices && h(WheelCard, { pet, modeLabel: d?.supported ? (onDesktop ? '窗口模式' : '桌面模式') : null, onChange: (ids) => { if (onDesktop) desktop.remote.setFavorites(ids) } }),
        h('div', { style: { display: 'grid', gap: 6 } },
          h('span', { style: ui.muted }, (models?.find((m) => m.id === modelId) ?? models?.[0])?.credit ?? ''),
          h(Diagnostics, { store })))
    }

    const MODEL_PREF = 'dsh-whale-mate.model'

    function apply(ctx) {
      const store = createStore()
      const base = new URL('whale-mate/', document.baseURI)
      let pet = null
      let hinted = 0
      let mod = null
      let generation = 0
      const savedModel = () => { try { return localStorage.getItem(MODEL_PREF) } catch { return null } }
      // The avatar: picked in Settings (bundled ones by file), else the one the host is configured with.
      const modelId = () => store.get().modelId ?? null
      const modelUrl = () => {
        const m = (store.get().models ?? []).find((x) => x.id === modelId())
        return new URL(m?.file ?? 'model.vrm', base).href
      }
      const desktop = createDesktop(base, store, () => pet, modelId)
      ctx.effect(() => () => desktop.dispose(), 'whale-mate: desktop mode')

      async function spawnPet() {
        const mine = ++generation
        mod ??= await import(new URL('pet.js', base).href)
        desktop.setFindHome(mod.defaultFindHome)
        const p = await mod.createPet({
          modelUrl: modelUrl(),
          storageKey: 'dsh-whale-mate',
          // The wheel offers the picked shortcuts, the mode switch and hide; where she sits is dragging.
          menuItems: () => (desktop.supported() ? [{ id: 'mode', label: '桌面模式', title: '切换到桌面模式', run: () => desktop.enable() }] : []),
          labels: { hide: '隐藏' },
          onEvent: (name) => {
            // Dragged against the window edge: she can't leave the page by herself — say how.
            if (name !== 'drag_edge' || !pet || hinted + 20000 > Date.now()) return
            hinted = Date.now()
            const st = store.get().desktop
            if (st?.supported) pet.say('想到窗口外面去吗？右键我，点「桌面模式」～', { expression: 'happy' })
            else pet.say(SHORT_REASONS[st?.reason] ?? '我出不了这个窗口……', { expression: 'sad' })
          },
        })
        if (mine !== generation) { p.destroy(); return }
        pet?.destroy()
        pet = p
        window.__whaleMate = p
        if (desktop.active()) p.setSuspended(true)
        store.set({ pet: p, error: null })
      }

      /** Settings → 形象: swap the avatar in the page (and restart the desktop window with it). */
      async function setModel(id) {
        if (!(store.get().models ?? []).some((m) => m.id === id) || id === modelId()) return
        try { localStorage.setItem(MODEL_PREF, id) } catch {}
        store.set({ modelId: id })
        const wasDesktop = desktop.active()
        try { await spawnPet() } catch (e) { store.set({ error: String(e?.message ?? e) }); return }
        pet?.say('换好啦，好看吗？', { expression: 'happy' })
        if (wasDesktop) { await desktop.disable({ quiet: true }); desktop.enable() }
      }

      ctx.effect(() => {
        let disposed = false
        fetch(new URL('models.json', base).href).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          .then((list) => {
            if (disposed) return
            const models = (list?.models ?? []).map((m) => ({ ...m, thumb: m.thumb ? new URL(m.thumb, base).href : null }))
            const wanted = savedModel()
            const id = models.some((m) => m.id === wanted) ? wanted : (models.find((m) => m.configured) ?? models[0])?.id ?? null
            store.set({ models, modelId: id })
            return spawnPet()
          })
          .catch((e) => {
            console.error('[whale-mate] failed to load', e)
            store.set({ error: String(e?.message ?? e) })
          })
        return () => {
          disposed = true
          generation++
          pet?.destroy()
          pet = null
          if (window.__whaleMate) delete window.__whaleMate
        }
      }, 'whale-mate: overlay')

      if (ctx.sessions) ctx.effect(() => followChat(ctx, () => (desktop.active() ? desktop.remote : pet)), 'whale-mate: follow chat')

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-whale-mate', order: 30, label: '希可儿' },
        (props) => h('button', {
          type: 'button',
          title: '显示 / 隐藏希可儿（隐藏后再点会把她叫回输入框）',
          onClick: () => {
            if (desktop.active()) desktop.toggleVisible()
            else if (pet) { if (pet.state().visible) pet.setVisible(false); else pet.recall() }
          },
          style: { width: '100%', minHeight: 36, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: '0 10px' },
        }, h('img', { src: new URL('thumbs/avatar.png', base).href, alt: '', width: 22, height: 22, style: { width: 22, height: 22, borderRadius: '50%', verticalAlign: 'middle', marginRight: props?.wide !== false ? 8 : 0 } }), props?.wide !== false ? '希可儿' : null),
      ))
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'dsh-whale-mate', order: 90, label: '希可儿mate' },
        () => h(SettingsSection, { store, desktop, setModel, avatarUrl: new URL('thumbs/avatar.png', base).href }),
      ))
    }

    return { name: 'dsh-plugin-whale-mate/client', inject: ['slots', 'sessions'], apply }
  },
})
