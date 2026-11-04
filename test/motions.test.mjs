import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { MotionLibrary, validateMotionPack } from '../src/pet/motions.js'
import { Rig } from '../src/pet/rig.js'
import { Face } from '../src/pet/face.js'

const q = (angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), angle).toArray()
const fixture = (extra = {}) => ({ version: 1, clips: { stand: { duration: 2, loop: false, frames: { hips: [...q(0), ...q(Math.PI / 2)] }, ...extra } } })
test('motion sampler interpolates the intended rotation and clamps non-looping clips', () => {
 const lib = new MotionLibrary(fixture())
 assert.ok(new THREE.Quaternion(...lib.sample('stand',1).quaternions.hips).angleTo(new THREE.Quaternion(...q(Math.PI/4))) < 1e-6)
 assert.deepEqual(lib.sample('stand',10),lib.sample('stand',2))
 assert.equal(lib.sample('missing',0),null)
})
test('loop boundaries close without a quaternion or root-position jump', () => {
 const lib = new MotionLibrary(fixture({loop:true,rootY:[0,.1]}))
 const before=lib.sample('stand',2-1e-6), after=lib.sample('stand',2)
 assert.ok(new THREE.Quaternion(...before.quaternions.hips).angleTo(new THREE.Quaternion(...after.quaternions.hips)) < 1e-4)
 assert.ok(Math.abs(before.root.y-after.root.y)<1e-4)
})
test('invalid, non-finite and unknown-bone data cannot replace a motion library', () => {
 for(const change of [c=>c.duration=Infinity,c=>c.frames.hips[0]=NaN,c=>c.frames.hips=[0,0,0,0,0,0,0,0],c=>c.frames.evil=c.frames.hips,c=>c.rootY=[0],c=>c.playDuration=-1]) {
  const pack=fixture();change(pack.clips.stand);assert.throws(()=>validateMotionPack(pack))
 }
})
function rig(version='1') {
 const nodes={hips:new THREE.Object3D(),head:new THREE.Object3D(),leftIndexProximal:new THREE.Object3D()}
 return new Rig({meta:{metaVersion:version},humanoid:{getNormalizedBoneNode:n=>nodes[n]}})
}
test('state mixing takes the short quaternion arc instead of flipping through zero', () => {
 const r=rig();r.addPose({bones:{hips:[0,Math.PI-.1,0]}},.5);r.addPose({bones:{hips:[0,-Math.PI+.1,0]}},.5);r.apply(1,100)
 assert.ok(r.nodes.hips.quaternion.angleTo(new THREE.Quaternion(...q(Math.PI)))<1e-5)
})
test('finger channels play and VRM0 applies its axis conversion exactly once', () => {
 const sample={quaternions:{leftIndexProximal:new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.4,.6)).toArray()}}
 const r=rig('0');r.addPose(sample,1);r.apply(1,100)
 const [x,y,z,w]=sample.quaternions.leftIndexProximal
 assert.ok(r.nodes.leftIndexProximal.quaternion.angleTo(new THREE.Quaternion(-x,y,-z,w))<1e-5)
})
test('GI conversion produces moving, normalized tracks with source provenance', () => {
 const pack=JSON.parse(readFileSync(new URL('../public/motions.json',import.meta.url)))
 const lib=new MotionLibrary(pack)
 for(const id of ['stand','walk','wave']) {
  const clip=lib.get(id);assert.match(clip.source.sha256,/^[a-f0-9]{64}$/)
  assert.equal(Object.keys(clip.frames).length,51)
  let peak=0
  for(const track of Object.values(clip.frames))for(let i=4;i<track.length;i+=4)peak=Math.max(peak,new THREE.Quaternion(...track.slice(0,4)).angleTo(new THREE.Quaternion(...track.slice(i,i+4))))
  assert.ok(peak>.05,`${id} is not a held pose`)
 }
 assert.ok(lib.get('wave').playDuration>lib.get('wave').duration)
})
test('full catalog distinguishes playable tracks from Unity, source-rig and non-animation files', () => {
 const pack=JSON.parse(readFileSync(new URL('../public/motions.json',import.meta.url)))
 const lib=new MotionLibrary(pack), catalog=lib.catalog()
 assert.equal(catalog.length,260)
 const original=catalog.filter(e=>e.kind!=='gltf-animation')
 assert.equal(original.reduce((n,e)=>n+e.sources.length,0),484)
 assert.equal(new Set(original.map(e=>e.sha256)).size,250)
 assert.equal(catalog.filter(e=>e.status==='ready').length,33)
 assert.equal(catalog.filter(e=>e.status==='needs-unity').length,130)
 assert.equal(catalog.filter(e=>e.status==='needs-rig').length,0)
 assert.equal(catalog.filter(e=>e.status==='missing-body').length,84)
 assert.equal(catalog.filter(e=>e.status==='source-asset').length,13)
 for (const e of catalog.filter(e=>e.status==='missing-body')) {
  assert.equal(e.evidence.bodyRotationPaths.length,0)
  assert.equal(e.evidence.humanoidAttributes.length,0)
  assert.equal(e.evidence.rotationTracks,63)
 }
 for (const e of catalog) assert.equal(!!lib.get(e.id),e.status==='ready')
 assert.equal(lib.get('constructor'),undefined)
 for (const id of Object.keys(pack.clips)) for (const t of [0,.13,.59,1,20]) {
  const p=lib.sample(id,t)
  assert.ok(Object.values(p.quaternions).flat().every(Number.isFinite))
  assert.ok(Object.values(p.face).every(v=>v>=0 && v<=1))
 }
})
test('new body animations really move; defaults use authored sitting and dance clips', () => {
 const pack=JSON.parse(readFileSync(new URL('../public/motions.json',import.meta.url))),lib=new MotionLibrary(pack)
 assert.equal(lib.get('sit'),lib.get('q-sitting-idle-loop'))
 assert.equal(lib.get('dance'),lib.get('q-dance-loop'))
 assert.equal(lib.get('talk'),lib.get('q-idle-talking-loop'))
 for(const [id,c]of Object.entries(pack.clips).filter(([id])=>id.startsWith('q-'))) {
  assert.equal(Object.keys(c.frames).length,52)
  let peak=0
  for(const name of ['hips','spine','chest','head','leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg']) {
   const values=c.frames[name],first=new THREE.Quaternion(...values.slice(0,4)).normalize()
   for(let i=4;i<values.length;i+=4)peak=Math.max(peak,first.angleTo(new THREE.Quaternion(...values.slice(i,i+4)).normalize()))
  }
  assert.ok(peak>.015,id+' must animate the body, not only fingers or hair')
  if(c.posture==='sit') assert.ok(c.rootY.every(y=>y===0),'seat owns pelvis height')
 }
 const bad=fixture();bad.defaults={sit:'missing'};assert.throws(()=>validateMotionPack(bad))
 bad.defaults={sit:'stand'};assert.doesNotThrow(()=>validateMotionPack(bad))
 bad.defaults={constructor:'stand'};assert.throws(()=>validateMotionPack(bad))
})
test('face-only curves interpolate, reject invalid channels, and decay after playback', () => {
 const pack={version:1,clips:{'face-test':{duration:1,frames:{},expressions:{aa:[0,1],blinkLeft:[0,1]}}}}
 assert.equal(new MotionLibrary(pack).sample('face-test',.5).face.aa,.5)
 const values={}
 const face=new Face({expressionManager:{expressions:['aa','blinkLeft','blink'].map(expressionName=>({expressionName})),setValue:(k,v)=>values[k]=v}})
 face.nextBlink=1e9
 for(let i=0;i<60;i++)face.update(1/60,i/60,{aa:1,blinkLeft:1})
 assert.ok(values.aa>.99 && values.blinkLeft>.99)
 for(let i=0;i<90;i++)face.update(1/60,1+i/60,{})
 assert.ok(values.aa<.001 && values.blinkLeft<.001)
 pack.clips['face-test'].expressions.aa=[0,NaN];assert.throws(()=>validateMotionPack(pack))
 pack.clips['face-test'].expressions.aa=[0,1];pack.clips['face-test'].expressions.evil=[0,1];assert.throws(()=>validateMotionPack(pack))
})
