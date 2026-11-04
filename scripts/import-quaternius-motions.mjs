// Retarget authored glTF curves with the author's A_TPose reference clip.
// Uses only existing Three.js. Run: node scripts/import-quaternius-motions.mjs SOURCE.gltf [output.json]
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import * as T from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
const [file,output='test/local-motions/quaternius.json']=process.argv.slice(2)
if(!file)throw Error('Missing source glTF')
const bytes=readFileSync(file),json=JSON.parse(bytes),hash=createHash('sha256').update(bytes)
for(const buffer of json.buffers){const bin=readFileSync(join(dirname(file),buffer.uri));hash.update(bin);buffer.uri='data:application/octet-stream;base64,'+bin.toString('base64')}
globalThis.ProgressEvent??=class {constructor(type,values){Object.assign(this,{type},values)}}
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(json),'')
const allNodes=await gltf.parser.getDependencies('node')
const mapping={hips:'hips',spine:'spine.001',chest:'spine.002',upperChest:'spine.003',neck:'neck',head:'head'}
for(const [side,s]of [['left','L'],['right','R']]){
 for(const [human,bone]of Object.entries({Shoulder:'shoulder',UpperArm:'upper_arm',LowerArm:'forearm',Hand:'hand',UpperLeg:'thigh',LowerLeg:'shin',Foot:'foot',Toes:'toe'}))mapping[side+human]=bone+'.'+s
 for(const [finger,bone]of Object.entries({Thumb:'thumb',Index:'f_index',Middle:'f_middle',Ring:'f_ring',Little:'f_pinky'})){
  const parts=finger==='Thumb'?['Metacarpal','Proximal','Distal']:['Proximal','Intermediate','Distal']
  parts.forEach((part,i)=>mapping[side+finger+part]=`${bone}.0${i+1}.${s}`)
 }
}
const nodes={},parents={},joints=new Set(json.skins[0].joints)
for(const [human,name]of Object.entries(mapping)){const i=json.nodes.findIndex(n=>n.name==='DEF-'+name);if(!joints.has(i))throw Error('Mapped bone not in source skin: '+human);nodes[human]=allNodes[i]}
for(const [human,node]of Object.entries(nodes)){let p=node.parent;while(p&&!Object.values(nodes).includes(p))p=p.parent;parents[human]=Object.keys(nodes).find(k=>nodes[k]===p)}
const mixer=new T.AnimationMixer(gltf.scene),reference=gltf.animations.find(c=>c.name==='A_TPose')
if(!reference)throw Error('Missing authored T-pose reference')
const pose=mixer.clipAction(reference);pose.play();mixer.setTime(0);gltf.scene.updateMatrixWorld(true)
const world=n=>n.getWorldPosition(new T.Vector3())
const faceRotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),world(nodes.leftUpperArm).x<world(nodes.rightUpperArm).x?Math.PI:0)
const rest={},positions={}
for(const k in nodes){rest[k]=nodes[k].getWorldQuaternion(new T.Quaternion());positions[k]=world(nodes[k]).applyQuaternion(faceRotation)}
const height=positions.head.y+.2,hipY=positions.hips.y
if(!(height>1&&height<3))throw Error('Unexpected source scale '+height)
// Prove reference arms are straight and legs point down, not just a clip named T-pose.
for(const side of ['left','right']){const d=positions[side+'LowerArm'].clone().sub(positions[side+'UpperArm']).normalize();if(Math.abs(d.x)<.98)throw Error('Reference arms are not T-posed');const leg=positions[side+'LowerLeg'].clone().sub(positions[side+'UpperLeg']).normalize();if(leg.y>-.98)throw Error('Reference legs are not straight')}
console.log('reference', {bones:Object.keys(nodes).length,height,hipY,sourceTurn:faceRotation.y})
const selected={Idle_Loop:['轻松待机','待机'],Idle_Talking_Loop:['站着聊天','交流'],Dance_Loop:['律动舞蹈','舞蹈'],Interact:['伸手互动','交流'],PickUp_Table:['伸手取物','交流'],Sitting_Idle_Loop:['坐姿待机','坐姿'],Sitting_Talking_Loop:['坐着聊天','坐姿'],Crouch_Idle_Loop:['蹲姿待机','姿态'],Walk_Formal_Loop:['端庄行走','行走'],Walk_Loop:['自然行走','行走']}
const pack={version:1,name:'Quaternius 本地动作适配',clips:{},reference:{name:reference.name,height,hipY,bones:Object.keys(nodes).length}}
const sha=hash.digest('hex')
for(const [sourceName,[label,category]]of Object.entries(selected)){
 const clip=gltf.animations.find(c=>c.name===sourceName);if(!clip)throw Error('Missing '+sourceName)
 mixer.stopAllAction();const act=mixer.clipAction(clip);act.setLoop(T.LoopOnce,1);act.clampWhenFinished=true;act.play()
 const count=Math.ceil(clip.duration*30)+1,frames=Object.fromEntries(Object.keys(nodes).map(n=>[n,[]])),rootY=[],deltas={};let peak=0
 for(let i=0;i<count;i++){
  mixer.setTime(Math.min(clip.duration-1e-6,i*clip.duration/(count-1)));gltf.scene.updateMatrixWorld(true)
  for(const k in nodes)deltas[k]=faceRotation.clone().multiply(nodes[k].getWorldQuaternion(new T.Quaternion()).multiply(rest[k].clone().invert())).multiply(faceRotation.clone().invert()).normalize()
  for(const k in nodes){const q=parents[k]?deltas[parents[k]].clone().invert().multiply(deltas[k]):deltas[k].clone();q.normalize();const first=frames[k].slice(0,4),prev=frames[k].slice(-4);if(prev.length&&q.dot(new T.Quaternion(...prev))<0)q.set(-q.x,-q.y,-q.z,-q.w);if(first.length)peak=Math.max(peak,q.angleTo(new T.Quaternion(...first).normalize()));frames[k].push(...q.toArray().map(v=>+v.toFixed(6)))}
  rootY.push(+((world(nodes.hips).y-hipY)/height).toFixed(6))
 }
 if(peak<.01)throw Error('Reject static clip '+sourceName)
 const id='q-'+sourceName.toLowerCase().replaceAll('_','-'),seated=sourceName.startsWith('Sitting_')
 pack.clips[id]={label,category,duration:clip.duration,loop:sourceName.endsWith('_Loop'),frames,rootY:seated?rootY.map(()=>0):rootY,...(seated?{posture:'sit'}:{}),source:{project:'Quaternius Universal Animation Library',path:sourceName,sha256:sha,url:'https://quaternius.itch.io/universal-animation-library',mirrorCommit:'e24c23cf2a1323488a3faa226ea7ea21f644b73e'},metrics:{maxRotationDegrees:peak*180/Math.PI},adaptation:'Authored A_TPose, 52 humanoid bones incl. fingers; 30 fps. Horizontal root motion omitted; seated pelvis position comes from the window seat.'}
 if(pack.clips[id].loop)pack.clips[id].playDuration=Math.max(3,clip.duration*2)
 console.log(id,clip.duration,count,'peak degrees',+(peak*180/Math.PI).toFixed(1))
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(pack));mixer.stopAllAction();mixer.uncacheRoot(gltf.scene)
if(process.argv.includes('--install')){
 const target='public/motions.json',current=JSON.parse(readFileSync(target))
 Object.assign(current.clips,pack.clips)
 current.defaults={...current.defaults,sit:'q-sitting-idle-loop',talk:'q-idle-talking-loop',dance:'q-dance-loop'}
 current.catalog=(current.catalog??[]).filter(e=>!e.id.startsWith('q-'))
 for(const [id,c]of Object.entries(pack.clips))current.catalog.push({id,label:c.label,category:c.category,status:'ready',kind:'gltf-animation',sha256:c.source.sha256,animation:c.source.path,sources:[{project:c.source.project,path:'glTF/AnimationLibrary_Godot_Standard.gltf#'+c.source.path}]})
 current.name='希可儿动作库 · GI / Mate / Quaternius'
 writeFileSync(target,JSON.stringify(current));console.log('Installed',Object.keys(pack.clips).length,'motions; total',Object.keys(current.clips).length)
}
