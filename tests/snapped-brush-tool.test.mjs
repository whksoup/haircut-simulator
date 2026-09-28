import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SnappedBrushTool } from '../src/tools/snappedBrushTool.js';
import { GuideStore } from '../src/groom/guides.js';
import { History } from '../src/app/history.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';

class Surface extends EventTarget {
  constructor() { super(); this.style = {}; this.captured = new Set(); }
  getBoundingClientRect() { return {left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000}; }
  setAttribute() {} remove() {}
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
function send(target, name, props = {}) {
  const e = new Event(name, {cancelable: true});
  Object.assign(e, {clientX: 400, clientY: 250, button: 0, buttons: 1, pointerId: 1, isPrimary: true}, props);
  target.dispatchEvent(e);
}
function fixture(perspective = false) {
  globalThis.window = new Surface(); globalThis.document = new Surface();
  document.createElement = () => new Surface(); document.body = {appendChild() {}};
  const canvas = new Surface();
  const camera = perspective ? new THREE.PerspectiveCamera(36.86989764584402, 1, 0.01, 10) : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 3; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2));
  const guides = new GuideStore();
  for (const [facetId, x, z] of [[1, 0, 0.2], [2, 0.12, 0.2], [1, 0, -0.3]]) guides.add({facetId,
    root: [x, 0, z], normal: [0, 1, 0], tangent: [1, 0, 0], length: z < 0 ? 0.1 : 1});
  const viewer = {scene: new THREE.Scene(), camera, renderer: {domElement: canvas}, controls: {target: new THREE.Vector3(), enabled: true,
    _quat: new THREE.Quaternion(), _quatInverse: new THREE.Quaternion(), _sphericalDelta: new THREE.Spherical(), _panOffset: new THREE.Vector3()},
    onCameraChange: () => () => {}};
  const stats = {begins: 0, ends: 0, edits: []};
  const captureGuides = ids => ({kind: 'guides', data: guides.toJSON().filter(g => ids === null || ids.includes(g.id))});
  const history = new History({snapshot: () => ({kind: 'snapshot', data: guides.toJSON()}), captureGuides,
    restore: patch => patch.data.forEach(g => Object.assign(guides.guides.get(g.id), structuredClone(g)))});
  const tool = new SnappedBrushTool({viewer, mesh, guides, onEdit: ids => stats.edits.push(ids),
    onStrokeBegin: () => {stats.begins++; history.beginStroke();},
    onStrokeEnd: ids => {stats.ends++; history.commitStroke('Brush', ids);}});
  tool.setRadius(0.06); tool.setEnabled(true);
  const dispose = () => {tool.dispose(); mesh.geometry.dispose(); mesh.material.dispose();};
  return {tool, canvas, guides, viewer, stats, history, dispose};
}


test('press displays cylinder without authoring; release reports idle and exact no-op history',()=>{
 const f=fixture(),before=JSON.stringify(f.guides.toJSON());
 send(f.canvas,'pointermove');assert.equal(f.tool.cylinder.visible,false);
 send(f.canvas,'pointerdown');assert.equal(f.tool.cylinder.visible,true);assert.ok(f.tool.strokeFrame);
 assert.equal(JSON.stringify(f.guides.toJSON()),before);
 send(window,'pointerup');assert.equal(f.tool.cylinder.visible,false);assert.equal(f.tool.strokeFrame,null);
 assert.doesNotMatch(f.tool.status,/^Brushing/);assert.equal(f.history.depth,0);f.dispose();
});
test('oblique drag edits selected visible hair usefully under both projections and preserves history/invariants',()=>{
 for(const perspective of [false,true]){
  const f=fixture(perspective),c=f.viewer.camera,yaw=32*Math.PI/180,tilt=25*Math.PI/180;
  c.position.set(3*Math.sin(yaw)*Math.cos(tilt),3*Math.sin(tilt),3*Math.cos(yaw)*Math.cos(tilt));
  c.lookAt(0,0,0);c.updateMatrixWorld(true);
  const p=new THREE.Vector3(0,0.5,0.2).project(c),x=(p.x+1)*500,y=(1-p.y)*500;
  const mask=new Set([1]);f.tool.setMask(mask);mask.clear();
  const rows=f.guides.toJSON(),before=JSON.stringify(rows);
  send(f.canvas,'pointerdown',{clientX:x-80,clientY:y});
  const frame=f.tool.strokeFrame;
  assert.ok(Math.abs(frame.heading/(Math.PI/4)-Math.round(frame.heading/(Math.PI/4)))<1e-10);
  send(f.canvas,'pointermove',{clientX:x+100,clientY:y});send(window,'pointerup');
  const next=f.guides.toJSON(),after=JSON.stringify(next);
  assert.ok(Math.max(...next[0].points.map((v,k)=>Math.abs(v-rows[0].points[k])))>=0.005);
  assert.deepEqual(next[0].points.slice(0,3),rows[0].points.slice(0,3));
  assert.deepEqual(next[1],rows[1]);assert.deepEqual(next[2],rows[2]);
  assert.ok(auditGuideLengths(f.guides).ok);assert.equal(f.history.depth,1);
  f.history.undo();assert.equal(JSON.stringify(f.guides.toJSON()),before);
  f.history.redo();assert.equal(JSON.stringify(f.guides.toJSON()),after);
  assert.equal(JSON.stringify(GuideStore.fromJSON(JSON.parse(after)).toJSON()),after);f.dispose();
 }
});
test('frame stays frozen across external camera/mesh changes and cylinder matches final capsule',()=>{
 const f=fixture(),c=f.viewer.camera;c.position.set(1.4,0.7,2.5);c.lookAt(0,0,0);c.updateMatrixWorld(true);
 send(f.canvas,'pointerdown');
 const frame=f.tool.strokeFrame,axis=frame.axis.toArray(),matrix=frame.matrix.clone(),cm=f.tool._camera.matrixWorld.toArray();
 let capsule;const apply=f.tool._applyCapsule.bind(f.tool);
 f.tool._applyCapsule=(a,b,tie)=>{capsule=[a.clone(),b.clone()];apply(a,b,tie);};
 c.position.set(-2,1,2);c.lookAt(0,0,0);c.updateMatrixWorld(true);
 f.tool.mesh.rotation.y=0.5;f.tool.mesh.updateMatrixWorld(true);
 send(f.canvas,'pointermove',{clientX:600});assert.equal(f.tool.strokeFrame,frame);
 assert.deepEqual(frame.axis.toArray(),axis);assert.deepEqual(f.tool._camera.matrixWorld.toArray(),cm);
 send(window,'pointerup');assert.ok(capsule);
 capsule.forEach((p,i)=>assert.ok(p.applyMatrix4(matrix).distanceTo(f.tool.cylinder.endpoints[i])<1e-10));
 assert.equal(f.tool.cylinder.radius,f.tool.radius);assert.equal(f.tool.cylinder.visible,false);
 assert.deepEqual(new THREE.Raycaster().intersectObject(f.tool.cylinder,true),[]);f.dispose();
});
test('all interruptions hide cylinder, finish once and do not resume a held pointer',()=>{
 for(const kind of ['pointerleave','pointercancel','lostpointercapture','blur','hidden','escape','navigation','wheel','disable','app','dispose']){
  const f=fixture();send(f.canvas,'pointerdown');send(f.canvas,'pointermove',{clientX:510});assert.equal(f.tool.cylinder.visible,true);
  if(kind==='blur')send(window,'blur');
  else if(kind==='hidden'){document.hidden=true;send(document,'visibilitychange');}
  else if(kind==='escape')send(window,'keydown',{key:'Escape'});
  else if(kind==='navigation')send(f.canvas,'pointerdown',{button:2});
  else if(kind==='disable')f.tool.setEnabled(false);
  else if(kind==='app')f.tool.finishEditing();
  else if(kind==='dispose')f.tool.dispose();
  else send(f.canvas,kind);
  const after=JSON.stringify(f.guides.toJSON());send(f.canvas,'pointermove',{clientX:600});send(window,'pointerup');
  assert.equal(f.tool.cylinder.visible,false,kind);assert.equal(f.tool.active,false,kind);assert.equal(f.stats.ends,1,kind);
  assert.equal(f.history.busy,false,kind);assert.equal(JSON.stringify(f.guides.toJSON()),after,kind);
  assert.doesNotMatch(f.tool.status,/^Brushing/,kind);if(kind!=='dispose')f.dispose();
 }
});
test('unsafe plane mapping authors nothing and cylinder resources release exactly once',()=>{
 const f=fixture(),before=JSON.stringify(f.guides.toJSON());send(f.canvas,'pointerdown');f.tool._maxPlaneDistance=1e-12;
 send(f.canvas,'pointermove',{clientX:600});assert.equal(f.tool.cylinder.visible,false);send(window,'pointerup');
 assert.equal(JSON.stringify(f.guides.toJSON()),before);assert.equal(f.history.depth,0);
 const counts=[0,0,0];[f.tool.cylinder.body.geometry,f.tool.cylinder.capA.geometry,f.tool.cylinder.body.material]
 .forEach((resource,i)=>resource.addEventListener('dispose',()=>counts[i]++));
 f.dispose();assert.deepEqual(counts,[1,1,1]);assert.equal(f.tool.cylinder.parent,null);
});
test('invalid head transform refuses press and retains useful status through inactive finish',()=>{
 const f=fixture();f.tool.mesh.scale.set(1,2,1);send(f.canvas,'pointerdown');
 assert.equal(f.tool.active,false);assert.equal(f.stats.begins,0);assert.match(f.tool.status,/uniform head scale/);
 f.tool.finishEditing();assert.match(f.tool.status,/uniform head scale/);assert.equal(f.tool.cylinder.visible,false);f.dispose();
});

