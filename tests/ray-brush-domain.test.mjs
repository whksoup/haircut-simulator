import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GuideStore } from '../src/groom/guides.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';
import { brushGuide, StrokeSampler } from '../src/hair/rayBrushStroke.js';
import { HeadVisibility } from '../src/scene/headVisibility.js';
import { guideFrame, liftGuide } from '../src/hair/guideFrame.js';

const cap = {ax: 0.04, ay: 0.5, az: -2, bx: 0.04, by: 0.5, bz: 2, r: 0.08};
function guide() {
  const s = new GuideStore();
  const id = s.add({facetId: 1, root: [0, 0, 0], normal: [0, 1, 0], tangent: [1, 0, 0], length: 1});
  return {s, g: s.guides.get(id)};
}
test('brush useful contact keeps exact roots, tangent, length and settled segment lengths', () => {
  const {s, g} = guide(); const before = JSON.stringify(g);
  const moved = brushGuide(g, cap, [-1, 0, 0]);
  assert.equal(moved, true);
  assert.notEqual(JSON.stringify(g), before);
  assert.ok(Math.max(...g.points.map((x, i) => i % 3 === 0 ? Math.abs(x) : 0)) >= 0.005);
  assert.deepEqual(g.points.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(g.tangent, [1, 0, 0]); assert.equal(g.length, 1);
  assert.ok(auditGuideLengths(s).ok);
});
test('visibility rejection before or after solve never rewrites guide points', () => {
  for (const rejectAt of [1, 2]) {
    const {g} = guide(); const before = JSON.stringify(g); let calls = 0;
    assert.equal(brushGuide(g, cap, [-1, 0, 0], () => ++calls < rejectAt), false);
    assert.equal(JSON.stringify(g), before);
  }
});
test('carried spatial cadence is equal for 1, 8 and 64 events and drains long jumps', () => {
  const samples = n => { const out = []; const s = new StrokeSampler([0, 0], 0.03, p => out.push(p));
    for (let i = 1; i <= n; i++) s.move([i / n, 0]); s.finish(); return out; };
  const one = samples(1);
  assert.equal(one.length, 34);
  for (const n of [8, 64]) {
    const other = samples(n); assert.equal(other.length, one.length);
    other.forEach((p, i) => assert.ok(Math.abs(p[0] - one[i][0]) < 1e-12));
  }
});
test('head visibility clips segment interiors in both cameras, allows silhouette misses and transforms', () => {
  for (const perspective of [false, true]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2));
    mesh.position.set(0.2, 0.1, 0); mesh.scale.setScalar(2);
    const c = perspective ? new THREE.PerspectiveCamera(45, 1, 0.01, 20) : new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 20);
    c.position.set(0.2, 0.1, 4); c.lookAt(0.2, 0.1, 0); c.updateMatrixWorld(true);
    const v = new HeadVisibility(mesh, c);
    assert.equal(v.isVisible([-0.1, 0, 0.2, 0.1, 0, 0.2]), true);
    assert.equal(v.isVisible([-0.1, 0, -0.2, 0.1, 0, -0.2]), false);
    assert.equal(v.isVisible([-0.8, 0, -0.2, 0.8, 0, -0.2]), false, 'visible endpoints do not permit hidden segment interior');
    assert.equal(v.isVisible([0.8, 0, -0.2, 0.9, 0, -0.2]), true);
    mesh.geometry.dispose(); mesh.material.dispose();
  }
});

test('head shadow oracle agrees with actual head-only rays for rotated transformed geometry', () => {
  for (const perspective of [false, true]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.3), new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
    mesh.position.set(0.1, -0.2, 0.05); mesh.rotation.set(0.2, 0.4, 0.3); mesh.scale.setScalar(1.4);
    const c = perspective ? new THREE.PerspectiveCamera(45, 1, 0.01, 20) : new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 20);
    c.position.set(0.3, 0.2, 4); c.lookAt(0, 0, 0); c.updateMatrixWorld(true);
    const visibility = new HeadVisibility(mesh, c), ray = new THREE.Raycaster();
    let state = 1234;
    const rand = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32;};
    for (let i = 0; i < 300; i++) {
      const point = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      const world = point.clone().applyMatrix4(mesh.matrixWorld), projected = world.clone().project(c);
      ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), c);
      const first = ray.intersectObject(mesh, false)[0];
      const depth = world.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      const expected = !first || depth <= first.distance + visibility.tolerance;
      if (first && Math.abs(depth - first.distance) < visibility.tolerance * 4) continue;
      assert.equal(visibility.isVisible([...point, ...point]), expected, `projection=${perspective} candidate=${i}`);
    }
    mesh.geometry.dispose(); mesh.material.dispose();
  }
});

test('a hidden middle segment stays exact while the visible suffix receives a useful edit', () => {
  const store = new GuideStore();
  const id = store.add({root: [-0.5, 0, -0.2], normal: [1, 0, 0], tangent: [0, 1, 0], length: 1});
  const g = store.guides.get(id), before = [...g.points];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.1));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 3; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const visibility = new HeadVisibility(mesh, camera);
  const pinned = visibility.protectedVertices(liftGuide(g, guideFrame(g)));
  assert.deepEqual(pinned, [false, false, false, true, true, true, false, false, false]);
  const capsule = {ax: 0.375, ay: 0.04, az: -1, bx: 0.375, by: 0.04, bz: 1, r: 0.08};
  assert.equal(brushGuide(g, capsule, [0, -1, 0],
    (points, fixed) => visibility.isVisible(points, fixed), points => visibility.protectedVertices(points)), true);
  assert.deepEqual(g.points.slice(9, 18), before.slice(9, 18), 'all middle hidden-segment endpoints remain bitwise exact');
  assert.deepEqual(g.points.slice(0, 3), before.slice(0, 3));
  assert.ok(Math.max(...g.points.slice(18).map((v, i) => Math.abs(v - before[i + 18]))) >= 0.005);
  assert.ok(visibility.isVisible(liftGuide(g, guideFrame(g)), pinned));
  assert.ok(auditGuideLengths(store).ok);
  mesh.geometry.dispose(); mesh.material.dispose();
});
