/** Behavioral regressions for open-boundary continuity and shared-frame shape
 * reconstruction. Authored guide coordinates and deterministic roots stay intact. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindStrandsToGuides } from '../src/rendering/gpu/guideBinding.js';
import { SeamField } from '../src/rendering/gpu/seamField.js';
import { SeamStore } from '../src/groom/seams.js';
import { Groom } from '../src/groom/groom.js';
import { GpuHairR3 } from '../src/rendering/gpu/gpuHairR3.js';
const shape = (x,y,z) => Array.from({length:9},(_,k)=>[x*k/8,y*k/8,z*k/8]).flat();
const guide = (x,points=shape(0,0,1)) => ({root:[x,0,0],normal:[0,0,1],tangent:[1,0,0],points,length:1});
function bind(gs,x,normal=[0,0,1]) {
  const rows=new Float32Array(3),weights=new Float32Array(3);
  bindStrandsToGuides({rootPositions:Float32Array.from([x,0,0]),rootNormals:Float32Array.from(normal),total:1,guideList:gs,outRows:rows,outWeights:weights});
  const result=gs.map(()=>0); rows.forEach((r,j)=>result[r]+=weights[j]); return result;
}
test('a local seam in a cycle pays for going around its endpoint',()=>{
  const edges=[{a:0,b:1,length:1},{a:1,b:2,length:1},{a:2,b:0,length:1}];
  const cat={edgesOfFacet:id=>edges.flatMap((e,i)=>e.a===id||e.b===id?[i]:[]),getEdge:i=>edges[i]};
  const seams=new SeamStore(),field=new SeamField(cat,seams);
  const values=[1,.9,.5,0].map(p=>{seams.set(0,1,p);field.invalidate();return field.detour(0,1)});
  assert.equal(values[0],0); assert.ok(values[1]>0); assert.ok(values[2]>=values[1]); assert.equal(values[3],1);
});
test('opposed guide shapes still blend across a fully open boundary',()=>{
  const gs=[guide(-1,shape(1,0,0)),guide(1,shape(-1,0,0))];
  const a=bind(gs,-1e-6),b=bind(gs,1e-6);
  assert.ok(a.every(w=>w>.49)&&b.every(w=>w>.49));
  assert.ok(Math.abs(a[0]-b[0])<1e-4);
});
test('split facet normals do not change an open shape blend',()=>{
  const gs=[guide(-1),{...guide(1),normal:[0,1,0],tangent:[1,0,0]}];
  assert.deepEqual(bind(gs,0,[0,0,1]),bind(gs,0,[0,1,0]));
});
test('a changing third nearest guide fades out instead of popping',()=>{
  const gs=[guide(-.2),guide(.2),guide(-1),guide(1),guide(100)];
  const a=bind(gs,-1e-6),b=bind(gs,1e-6);
  assert.ok(Math.max(...a.map((w,i)=>Math.abs(w-b[i])))<1e-4);
});
test('texture offsets match authored guides and tangent edits only update rows',()=>{
  const groom=new Groom(),mesh=new THREE.Mesh(new THREE.BufferGeometry());
  const id=groom.guides.add({facetId:0,root:[7,8,9],normal:[0,0,1],tangent:[0,1,0],points:shape(1,0,0),length:.4});
  const hair=new GpuHairR3(mesh,groom,groom.guides); hair.rebuild();
  const g=groom.guides.get(id),row=hair._guideRow.get(id);
  const tip=()=>Array.from(hair._shapeData.slice((row*9+8)*4,(row*9+8)*4+3));
  assert.ok(Math.abs(tip()[1]-.4)<1e-6); assert.ok(Math.abs(tip()[0])<1e-6);
  hair._rebind=()=>assert.fail('combing must not rebind');
  g.tangent=[1,0,0]; const saved=groom.serialize(); hair.setGuides([id]);
  assert.ok(Math.abs(tip()[0]-.4)<1e-6); assert.ok(Math.abs(tip()[1])<1e-6);
  assert.equal(groom.serialize(),saved);
  assert.deepEqual(Array.from(hair._shapeData.slice(row*36,row*36+3)),[0,0,0]);
  hair.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('binding does not depend on mutable guide shape or frame',()=>{
  const gs=[guide(-1),guide(1),guide(2),guide(-3)];
  const before=bind(gs,.1);
  gs[1].points=shape(0,-1,0);gs[1].tangent=[0,1,0];gs[1].normal=[1,0,0];
  assert.deepEqual(bind(gs,.1),before);
});

test('coincident guide roots remain finite and deterministic',()=>{
  const gs=[guide(0),guide(0),guide(0),guide(0)];
  const a=bind(gs,0),b=bind(gs,0);
  assert.deepEqual(a,b);assert.ok(a.every(Number.isFinite));
  assert.ok(Math.abs(a.reduce((s,v)=>s+v,0)-1)<1e-6);
});

test('equivalent curves in different authored frames produce identical texture offsets',()=>{
  const groom=new Groom(),mesh=new THREE.Mesh(new THREE.BufferGeometry());
  groom.guides.add({facetId:0,root:[0,0,0],normal:[0,0,1],tangent:[1,0,0],points:shape(1,0,0),length:.2});
  groom.guides.add({facetId:1,root:[1,0,0],normal:[0,0,1],tangent:[0,1,0],points:shape(0,-1,0),length:.2});
  const hair=new GpuHairR3(mesh,groom,groom.guides);hair.rebuild();
  for(let k=0;k<9;k++) for(let a=0;a<3;a++) assert.equal(hair._shapeData[k*4+a],hair._shapeData[(9+k)*4+a]);
  hair.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
