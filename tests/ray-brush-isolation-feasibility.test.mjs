import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GuideStore } from '../src/groom/guides.js';
import { SHAPE_POINTS, SHAPE_REST } from '../src/hair/strandShape.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';
import { bindStrandsToGuides } from '../src/rendering/gpu/guideBinding.js';

// Negative feasibility characterization, NOT a brush acceptance test. The CPU
// reconstruction below specializes fullStrandVertex to identity frames,
// clump=1, jitter=0, lenVar=0 and equal guide lengths. Production binding and
// authored stores are real; GPU readback and pointer behavior are not claimed.
function fixture(roots = [-0.2, 0, 0.2]) {
  const store = new GuideStore();
  roots.forEach((x, facetId) => store.add({
    facetId, root: [x, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0], length: 1,
  }));
  return store;
}
function binding(store, roots, facets) {
  const rows = new Float32Array(roots.length);
  const weights = new Float32Array(roots.length);
  const normals = new Float32Array(roots.length);
  for (let i = 2; i < roots.length; i += 3) normals[i] = 1;
  bindStrandsToGuides({rootPositions: new Float32Array(roots), rootNormals: normals,
    total: facets.length, guideList: [...store.guides.values()],
    strandFacets: new Int32Array(facets), outRows: rows, outWeights: weights});
  return {rows, weights, roots};
}
function vertex(store, b, strand, k) {
  const list = [...store.guides.values()];
  const p = b.roots.slice(strand * 3, strand * 3 + 3);
  const sum = b.weights.slice(strand * 3, strand * 3 + 3).reduce((a, v) => a + v, 0);
  for (let j = 0; j < 3; j++) {
    const index = strand * 3 + j;
    const guide = list[b.rows[index]];
    for (let axis = 0; axis < 3; axis++) p[axis] += b.weights[index] / sum * guide.points[k * 3 + axis];
  }
  return p;
}
function bend(guide) {
  // Leave the first segment/flow exactly unchanged, preserving reload binding.
  for (let k = 2; k < SHAPE_POINTS; k++) {
    guide.points[k * 3] = (k - 1) * SHAPE_REST * Math.sin(0.2);
    guide.points[k * 3 + 2] = SHAPE_REST + (k - 1) * SHAPE_REST * Math.cos(0.2);
  }
}
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('feasibility: useful single-facet guide bend necessarily moves excluded blended strands, including after reload', () => {
  const store = fixture();
  const roots = [-0.19, 0, 0, -0.05, 0, 0];
  const b = binding(store, roots, [0, 1]);
  const protectedBefore = JSON.stringify(store.toJSON().slice(1));
  const before = [vertex(store, b, 0, 8), vertex(store, b, 1, 8)];
  bend(store.guides.get(1));
  assert.equal(JSON.stringify(store.toJSON().slice(1)), protectedBefore);
  assert.deepEqual(store.guides.get(1).points.slice(0, 3), [0, 0, 0]);
  assert.ok(auditGuideLengths(store).ok);
  const selectedMove = distance(before[0], vertex(store, b, 0, 8));
  const excludedMove = distance(before[1], vertex(store, b, 1, 8));
  assert.ok(selectedMove >= 0.005);
  assert.ok(excludedMove > 1e-6 * 2, 'excluded strand violates even a generous head-diagonal tolerance');
  const restored = GuideStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  const rebound = binding(restored, roots, [0, 1]);
  assert.deepEqual(vertex(restored, rebound, 1, 8), vertex(store, b, 1, 8));
  console.log(JSON.stringify({fixture: 'single-facet', selectedMove, excludedMove,
    rows: [...b.rows], weights: [...b.weights], lengthResidual: auditGuideLengths(store).maxRel}));
});

test('feasibility: real head occlusion cannot isolate two strands sharing one guide', () => {
  const store = fixture([0]);
  const roots = [0, 0, 0.2, 0, 0, -0.5];
  const b = binding(store, roots, [0, 0]);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2), new THREE.MeshBasicMaterial());
  head.updateMatrixWorld(true);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const visible = p => {
    const point = new THREE.Vector3(...p);
    const ndc = point.clone().project(camera);
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = ray.intersectObject(head, false)[0];
    return !hit || ray.ray.origin.distanceTo(point) <= hit.distance + 1e-7;
  };
  const near = vertex(store, b, 0, 2), far = vertex(store, b, 1, 2);
  assert.ok(visible(near)); assert.ok(!visible(far));
  bend(store.guides.get(1));
  const nearMove = distance(near, vertex(store, b, 0, 2));
  const hiddenMove = distance(far, vertex(store, b, 1, 2));
  assert.ok(nearMove > 0.005);
  assert.ok(Math.abs(nearMove - hiddenMove) < 1e-15);
  assert.ok(!visible(vertex(store, b, 1, 2)));
  assert.ok(auditGuideLengths(store).ok);
  console.log(JSON.stringify({fixture: 'shared-guide-occlusion', nearMove, hiddenMove}));
  head.geometry.dispose(); head.material.dispose();
});
