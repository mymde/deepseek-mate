// Idle behaviour: she never hops onto the composer or a window by herself. Walking, sitting down,
// standing up and small motions or expressions are allowed. Usage: node scripts/check-idle.mjs
import { chromium, executablePath } from './browser.mjs'
import assert from 'node:assert/strict'
import { serve } from './serve.mjs'
const server = await serve()
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/test/harness.html`)
  await page.waitForFunction(() => window.__loaded === true, null, { timeout: 120000 })
  const run = (setup) =>
    page.evaluate((setup) => {
      const p = window.pet
      if (setup === 'floor') {
        p.perch = null
        p.atHome = false
        p.anchor = { x: 300, y: innerHeight - 2 }
        p.setLoc('stand', true)
      } else {
        p.recall()
        p.setLoc('sit', true)
      }
      const start = { loc: p.loc, perch: p.perch }
      const calls = {
        loc: p.loc,
        perch: p.state().perch,
        jumpTo: 0,
        goHome: 0,
        walkTo: 0,
        standUp: 0,
        sitDown: 0,
        play: [],
        expression: []
      }
      for (const k of ['jumpTo', 'goHome', 'walkTo', 'standUp', 'sitDown']) {
        const f = p[k].bind(p)
        p[k] = (...a) => {
          calls[k]++
          return f(...a)
        }
      }
      const play = p.play.bind(p)
      p.play = (id) => {
        calls.play.push(id)
        return play(id)
      }
      const expr = p.expression.bind(p)
      p.expression = (id, ...a) => {
        calls.expression.push(id)
        return expr(id, ...a)
      }
      // Ten simulated idle minutes, one decision step at a time.
      // (no frames run, so put her back where she was after each decision)
      for (let i = 0; i < 6000; i++) {
        p.gesture = null
        p.walkTarget = null
        p.lastActivity = p.t
        p.perch = start.perch
        p.loc = start.loc
        p.idleBrain(0.1)
      }
      return calls
    }, setup)
  for (const where of ['floor', 'seat']) {
    const c = await run(where)
    assert.equal(c.jumpTo + c.goHome, 0, JSON.stringify(c))
    if (where === 'floor') assert.ok(c.walkTo > 0, 'still walks around')
    assert.ok(
      c.play.length > 5 && c.expression.length + c.play.filter((id) => id.startsWith('face-')).length > 5,
      JSON.stringify(c)
    )
    console.log(
      `PASS idle on the ${where} (${c.loc}, ${c.perch}): no jumping; walks ${c.walkTo}, stands up ${c.standUp}, sits ${c.sitDown}, ${c.play.length} motions, ${c.expression.length} expressions`
    )
  }
} finally {
  await browser.close()
  server.close()
}
