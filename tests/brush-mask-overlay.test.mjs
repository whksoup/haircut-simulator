import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BrushMaskOverlay } from '../src/debug/brushMaskOverlay.js';

function fixture(indexed = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
  ], 3));
  if (indexed) geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.userData.catalogue = {getFacet(id) { return {7: {triIndices: [0]}, 19: {triIndices: [1]}}[id]; }};
  const overlay = new BrushMaskOverlay({mesh});
  mesh.add(overlay.object);
  return {mesh, overlay};
}

test('copied mask remains highlighted after working selection changes without painting the head', () => {
  const {mesh, overlay} = fixture();
  const geometry = mesh.geometry, material = mesh.material;
  const original = Array.from(geometry.attributes.position.array);
  const selection = new Set([19]);
  overlay.setMask(selection);
  overlay.setVisible(true);
  selection.clear(); selection.add(7);
  assert.deepEqual(Array.from(overlay.object.geometry.getAttribute('position')?.array ?? []), original.slice(9));
  assert.equal(overlay.object.visible, true);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  assert.deepEqual(Array.from(geometry.attributes.position.array), original);
  assert.equal(geometry.getAttribute('color'), undefined);
  const hits = []; overlay.object.raycast({}, hits); assert.deepEqual(hits, []);
});

test('mask geometry handles indexed triangles, unknown facets, empty and All masks', () => {
  const {overlay} = fixture(true);
  overlay.setMask(new Set([7, 19, 999]));
  assert.equal(overlay.object.geometry.getAttribute('position')?.count, 6);
  const built = overlay.object.geometry;
  overlay.setMask(new Set([19, 7, 999]));
  assert.equal(overlay.object.geometry, built, 'unchanged mask must not rebuild on UI sync');
  for (const mask of [new Set(), null]) {
    overlay.setMask(mask); overlay.setVisible(true);
    assert.equal(overlay.object.geometry.getAttribute('position')?.count, 0);
    assert.equal(overlay.object.visible, false);
  }
});

test('overlay inherits head transforms and disposal leaves head resources intact', () => {
  const {mesh, overlay} = fixture();
  mesh.position.set(3, 4, 5); mesh.scale.setScalar(2);
  overlay.setMask(new Set([7]));
  mesh.updateMatrixWorld(true);
  assert.deepEqual(overlay.object.getWorldPosition(new THREE.Vector3()).toArray(), [3, 4, 5]);
  let headDisposed = false, overlayDisposed = false;
  mesh.geometry.addEventListener('dispose', () => { headDisposed = true; });
  overlay.object.geometry.addEventListener('dispose', () => { overlayDisposed = true; });
  overlay.dispose();
  assert.equal(overlay.object.parent, null);
  assert.equal(overlayDisposed, true);
  assert.equal(headDisposed, false);
});
