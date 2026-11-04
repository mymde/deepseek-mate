/* global pet */
import assert from 'node:assert/strict'
import { chromium, executablePath } from './browser.mjs'
import { serve } from './serve.mjs'
const server = await serve()
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const origin = `http://127.0.0.1:${server.address().port}`
  await page.goto(origin + '/test/motions.html')
  await page.waitForFunction(() => window.__loaded, null, { timeout: 60000 })
  assert.equal(await page.evaluate(() => pet.motionStatus.clips.length), 33)
  console.log('PASS real VRM loads GI motion tracks')
  const sample = async (loc, time, gesture = null) =>
    page.evaluate(
      ([loc, time, gesture]) => {
        cancelAnimationFrame(pet.raf)
        pet.nextIdle = 1e9
        pet.t = time
        pet.cursor = { x: -1e4, y: -1e4, at: -1e9 }
        pet.gesture = gesture
        pet.perch = null
        pet.anchor = { x: 900, y: 800 }
        pet.setLoc(loc, true)
        pet.walkPhase = time * 6.2
        for (let i = 0; i < 90; i++) pet.animate(1 / 60)
        pet.render()
        const joints = {}
        for (const k of [
          'leftUpperLeg',
          'rightUpperLeg',
          'leftFoot',
          'rightFoot',
          'rightUpperArm',
          'leftIndexProximal'
        ]) {
          const node = pet.rig.nodes[k]
          node.updateWorldMatrix(true, false)
          joints[k] = { q: node.quaternion.toArray(), position: node.matrixWorld.elements.slice(12, 15) }
        }
        return {
          joints,
          groundError:
            Math.min(joints.leftFoot.position[1], joints.rightFoot.position[1]) -
            (-pet.anchor.y / pet.ppm + pet.body.footHeight)
        }
      },
      [loc, time, gesture]
    )
  const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, x, i) => s + x * b[i], 0))))
  const w0 = await sample('walk', 0),
    w1 = await sample('walk', 0.5)
  assert.ok(angle(w0.joints.leftUpperLeg.q, w1.joints.leftUpperLeg.q) > 0.15)
  assert.ok(Math.abs(w0.groundError) < 0.002 && Math.abs(w1.groundError) < 0.002)
  console.log('PASS real walk changes leg pose and keeps the supporting foot on the floor')
  const seated = await sample('sit', 0.8),
    greeting = await sample('sit', 0.8, { name: 'wave', t0: 0, duration: 2.4, fade: 0.2 })
  assert.ok(angle(seated.joints.leftUpperLeg.q, greeting.joints.leftUpperLeg.q) < 0.005)
  assert.ok(angle(seated.joints.rightUpperArm.q, greeting.joints.rightUpperArm.q) > 0.3)
  console.log('PASS seated greeting changes the arm without replacing seated legs')
  const dance0 = await sample('stand', 0.2, { name: 'dance', t0: 0, duration: 3, fade: 0.1 }),
    dance1 = await sample('stand', 0.65, { name: 'dance', t0: 0, duration: 3, fade: 0.1 })
  assert.ok(angle(dance0.joints.rightUpperArm.q, dance1.joints.rightUpperArm.q) > 0.08)
  const seatCheck = await page.evaluate(() => {
    pet.perch = null
    pet.setLoc('stand', true)
    pet.action('q-sitting-talking-loop')
    pet.t = pet.gesture.t0 + 0.6
    for (let i = 0; i < 90; i++) pet.animate(1 / 60)
    const hip = pet.rig.nodes.hips
    hip.updateWorldMatrix(true, false)
    return {
      loc: pet.loc,
      perch: pet.state().perch,
      height: hip.matrixWorld.elements[13] + pet.anchor.y / pet.ppm,
      alias: pet.motions.get('sit').source.path
    }
  })
  assert.equal(seatCheck.loc, 'sit')
  assert.notEqual(seatCheck.perch, 'floor')
  assert.equal(seatCheck.alias, 'Sitting_Idle_Loop')
  assert.ok(Math.abs(seatCheck.height - 0.07) < 0.003, JSON.stringify(seatCheck))
  console.log(
    'PASS authored dance moves the arms and seated selection returns to a ledge without double hip displacement'
  )
  const ids = await page.evaluate(() => pet.motionStatus.clips)
  for (const id of ids) {
    const result = await page.evaluate((id) => {
      pet.setLoc('stand', true)
      pet.t = 0
      pet.play(id)
      const clip = pet.motions.get(id)
      pet.t = Math.min(clip.duration * 0.5, 0.8)
      for (let i = 0; i < 60; i++) pet.animate(1 / 60)
      pet.render()
      return {
        gesture: pet.gesture?.name,
        finite: Object.values(pet.rig.nodes).every((n) => n.quaternion.toArray().every(Number.isFinite)),
        y: pet.avatar.position.y
      }
    }, id)
    assert.equal(result.gesture, id)
    assert.ok(result.finite && Number.isFinite(result.y), id)
  }
  console.log('PASS all 33 clips play on the real VRM without invalid transforms')
  await page.evaluate(() => pet.openMotionMenu(50, 50))
  assert.equal(await page.locator('[data-motion]').count(), 33)
  await page.getByRole('searchbox', { name: '搜索动作名称' }).fill('比耶')
  await page.locator('[data-motion="gi-peace"]').click()
  assert.equal(await page.evaluate(() => pet.gesture.name), 'gi-peace')
  await page.evaluate(() => pet.openMotionMenu(50, 50))
  await page.getByRole('combobox', { name: '动作分类' }).selectOption('pending')
  assert.equal(await page.locator('[data-motion]:disabled').count(), 214)
  assert.equal(await page.locator('[data-motion]:disabled').filter({ hasText: '缺少主体动画' }).count(), 84)
  await page.getByRole('button', { name: '停止当前动作', exact: true }).click()
  assert.equal(await page.evaluate(() => pet.gesture), null)
  console.log('PASS searchable library plays selected actions, disables unconverted sources, and stops playback')
  const face = await page.evaluate(() => {
    const id = Object.keys(pet.motions.pack.clips).find((id) => pet.motions.get(id).label === '说话口型')
    pet.play(id)
    pet.t = pet.gesture.t0 + 0.5
    for (let i = 0; i < 60; i++) pet.animate(1 / 60)
    const active = Math.max(...['aa', 'ih', 'ou', 'ee', 'oh'].map((n) => pet.face.values[n] ?? 0))
    pet.gesture = null
    for (let i = 0; i < 120; i++) pet.animate(1 / 60)
    return { active, after: Math.max(...['aa', 'ih', 'ou', 'ee', 'oh'].map((n) => pet.face.values[n] ?? 0)) }
  })
  assert.ok(face.active > 0.2 && face.after < 0.01, JSON.stringify(face))
  console.log('PASS imported mouth curves drive the actual model and release after the clip')
  await page.goto(origin + '/test/harness.html')
  await page.waitForFunction(() => window.__loaded, null, { timeout: 60000 })
  assert.equal(await page.evaluate(() => pet.motionStatus.ready), true)
  console.log('PASS standard plugin engine loads the default motion asset without preview options')
  await page.route('**/public/motions.json', (r) => r.fulfill({ status: 404, body: 'missing' }))
  await page.reload()
  await page.waitForFunction(() => window.__loaded, null, { timeout: 60000 })
  assert.equal(await page.evaluate(() => pet.motionStatus.ready), false)
  assert.match(await page.evaluate(() => pet.motionStatus.error), /404/)
  assert.equal(await page.evaluate(() => pet.visible), true)
  assert.deepEqual(errors, [])
  console.log('PASS missing motion pack falls back to a visible procedural character, no page errors')
} finally {
  await browser.close()
  server.close()
}
