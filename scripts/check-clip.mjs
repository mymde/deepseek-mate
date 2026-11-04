// Regression: a pet dropped onto a bar at the very top of the page must not perch there with her
// body cut off (and become impossible to grab); recall() must bring her back.
import { chromium, executablePath } from './browser.mjs'
import { serve } from './serve.mjs'

const server = await serve()
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`http://127.0.0.1:${server.address().port}/test/harness.html`)
await page.waitForFunction(() => window.__loaded === true, null, { timeout: 120000 })
await page.evaluate(() => {
  const bar = document.createElement('div')
  bar.id = 'titlebar'
  Object.assign(bar.style, {
    position: 'fixed',
    left: '0',
    top: '6px',
    width: '100%',
    height: '40px',
    background: '#eef',
    border: '1px solid #99a',
    zIndex: 1
  })
  document.body.appendChild(bar)
})
await page.waitForTimeout(2500)
const st = () =>
  page.evaluate(() => ({ ...window.pet.state(), anchor: window.pet.anchor, head: window.pet.headScreen }))
let s = await st()
const results = []
const check = (name, ok, info) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, JSON.stringify(info ?? ''))
}
// Grab her by the chest and drop her right on top of the bar.
await page.mouse.move(s.anchor.x, s.anchor.y - 80)
await page.mouse.down()
for (let k = 1; k <= 15; k++) {
  await page.mouse.move(
    s.anchor.x + ((500 - s.anchor.x) * k) / 15,
    s.anchor.y - 80 + ((8 - (s.anchor.y - 80)) * k) / 15
  )
  await page.waitForTimeout(30)
}
await page.waitForTimeout(300)
await page.mouse.up()
await page.mouse.move(980, 700)
await page.waitForTimeout(2500)
s = await st()
check('does not perch on a bar with no headroom', s.anchor.y > 300, { perch: s.perch, anchor: s.anchor })
check('head stays inside the window', s.head.y > 0, s.head)
// Reachable again: grab and recall both work.
await page.evaluate(() => window.pet.recall())
await page.waitForTimeout(800)
s = await st()
check('recall() puts her back on the composer', s.perch === 'composer' && s.visible, {
  perch: s.perch,
  anchor: s.anchor
})
check('no page errors', errors.length === 0, errors)
await browser.close()
server.close()
process.exit(results.every(Boolean) ? 0 : 1)
