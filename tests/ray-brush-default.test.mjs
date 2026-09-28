import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_GROOM } from '../src/app/defaultGroom.js';
import { GuideStore } from '../src/groom/guides.js';
import { guideFrame, liftGuide } from '../src/hair/guideFrame.js';
import { HeadVisibility } from '../src/scene/headVisibility.js';
import { brushGuide } from '../src/hair/rayBrushStroke.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';

test('default groom top-view sweep has a useful visible guide edit against actual GLB', async () => {
  const buffer = await fs.readFile(new URL('../public/models/head.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  let mesh;
  gltf.scene.traverse(o => {if (o.isMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o;});
  mesh.updateWorldMatrix(true, false);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 20);
  camera.position.set(0, 5, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const visibility = new HeadVisibility(mesh, camera), store = GuideStore.fromJSON(DEFAULT_GROOM.guides);
  const first = store.guides.values().next().value;
  const local = liftGuide(first, guideFrame(first));
  const before = [...first.points];
  const point = new THREE.Vector3(...local.slice(12, 15)).applyMatrix4(mesh.matrixWorld);
  const inverse = mesh.matrixWorld.clone().invert();
  let changed = false;
  console.log('default visibility', [...store.guides.values()].map(g => ({id: g.id, visible: visibility.isVisible(liftGuide(g, guideFrame(g)))})));
  for (let x = point.x - 0.2; x <= point.x + 0.3; x += 0.02) {
    const a = new THREE.Vector3(x, 4, point.z).applyMatrix4(inverse), b = new THREE.Vector3(x, -4, point.z).applyMatrix4(inverse);
    const cap = {ax:a.x, ay:a.y, az:a.z, bx:b.x, by:b.y, bz:b.z, r:0.1 / mesh.getWorldScale(new THREE.Vector3()).x};
    changed = brushGuide(first, cap, [1, 0, 0], (p, pinned) => visibility.isVisible(p, pinned), p => visibility.protectedVertices(p)) || changed;
  }
  assert.equal(changed, true);
  assert.deepEqual(first.points.slice(0, 6), before.slice(0, 6), 'embedded root segment remains exact');
  assert.ok(Math.max(...first.points.map((v, i) => Math.abs(v - before[i]))) >= 0.005);
  assert.ok(auditGuideLengths(store).ok);
  gltf.scene.traverse(o => {o.geometry?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();});
});
