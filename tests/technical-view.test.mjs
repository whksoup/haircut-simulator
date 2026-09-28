import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTechnicalView, technicalCutPlane } from '../src/scene/technicalView.js';
import { makeHairMaterialR3 } from '../src/rendering/gpu/hairShaderGuides.js';

function fixture() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x123456);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshStandardMaterial());
  head.position.set(3, 4, 5);
  const hair = new THREE.LineSegments(new THREE.BufferGeometry(), makeHairMaterialR3());
  head.add(hair);
  scene.add(head);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 4, 15);
  const controls = new OrbitControls(camera);
  Object.assign(controls, { object: camera, target: new THREE.Vector3(3, 4, 5),
    enableDamping: true, mouseButtons: { LEFT: null, MIDDLE: 1, RIGHT: 0 } });
  const viewer = { scene, camera, controls,
    renderer: { toneMapping: THREE.ACESFilmicToneMapping, localClippingEnabled: false }, _onResize() {} };
  const controller = createTechnicalView({ viewer, head, hair });
  return { viewer, head, hair, controller };
}

test('cut planes divide translated bounds along every axis, with complementary sides', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(2, 2, 2), new THREE.Vector3(4, 6, 8));
  for (const axis of ['x', 'y', 'z']) {
    for (const position of [-1, 0, 1]) {
      const plane = technicalCutPlane(bounds, { axis, position });
      const flipped = technicalCutPlane(bounds, { axis, position, flipped: true });
      const point = bounds.getCenter(new THREE.Vector3());
      point[axis] = THREE.MathUtils.lerp(bounds.min[axis], bounds.max[axis], (position + 1) / 2);
      assert.equal(plane.distanceToPoint(point), 0);
      point[axis] += 0.5;
      assert.equal(plane.distanceToPoint(point), 0.5);
      assert.equal(flipped.distanceToPoint(point), -0.5);
    }
  }
});

test('technical entry and repeated return preserve material, geometry, camera identity and scene settings', () => {
  const { viewer, head, hair, controller } = fixture();
  const original = { camera: viewer.camera, material: head.material, geometry: head.geometry,
    background: viewer.scene.background, position: viewer.camera.position.clone(), hair: hair.material };
  for (let cycle = 0; cycle < 3; cycle++) {
    controller.enter();
    assert.equal(controller.state.cutaway.enabled, false);
    assert.equal(controller.state.cutaway.axis, 'x');
    assert.equal(viewer.camera.isOrthographicCamera, true);
    assert.equal(head.material.isMeshToonMaterial, true);
    assert.equal(hair.material.uniforms.uTechnical.value, true);
    controller.setCutaway({ enabled: true, axis: 'z', position: 0.3, flipped: true });
    controller.setView('top');
    controller.exit();
    assert.equal(viewer.camera, original.camera);
    assert.equal(viewer.controls.object, original.camera);
    assert.ok(viewer.camera.position.distanceTo(original.position) < 1e-10);
    assert.equal(head.material, original.material);
    assert.equal(head.geometry, original.geometry);
    assert.equal(hair.material, original.hair);
    assert.equal(viewer.scene.background, original.background);
    assert.equal(viewer.renderer.localClippingEnabled, false);
    assert.equal(viewer.renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(hair.material.uniforms.uTechnical.value, false);
    assert.equal(hair.material.uniforms.uTechnicalClipping.value, false);
    assert.deepEqual(head.children, [hair]);
  }
});

test('head and reconstructed hair share a world-space clipping half-space for every axis and side', () => {
  const { head, hair, controller } = fixture();
  controller.enter();
  for (const axis of ['x', 'y', 'z']) for (const flipped of [false, true]) {
    controller.setCutaway({ enabled: true, axis, flipped, position: 0.25 });
    const plane = head.material.clippingPlanes[0];
    const uniform = hair.material.uniforms.uTechnicalPlane.value;
    assert.deepEqual(uniform.toArray(), [...plane.normal.toArray(), plane.constant]);
    assert.equal(hair.material.uniforms.uTechnicalClipping.value, true);
    for (const child of head.children.filter(child => child !== hair)) {
      assert.equal(child.material.clippingPlanes[0], plane);
    }
  }
  controller.setCutaway({ enabled: false });
  assert.equal(head.material.clippingPlanes.length, 0);
  assert.equal(hair.material.uniforms.uTechnicalClipping.value, false);
  controller.exit();
});

test('six presets are axis aligned and orbiting away marks free view', () => {
  const { viewer, controller } = fixture();
  controller.enter();
  const directions = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0],
    right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
  for (const [name, direction] of Object.entries(directions)) {
    controller.setView(name);
    const actual = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
    assert.ok(actual.distanceTo(new THREE.Vector3(...direction)) < 0.00001);
    assert.equal(controller.state.view, name);
  }
  viewer.camera.position.x += 1;
  viewer.controls.update();
  assert.equal(controller.state.view, 'free');
  controller.exit();
});

test('a downward orbit gesture leaves both pole presets without hitting a polar clamp', () => {
  const { viewer, controller } = fixture();
  controller.enter();
  for (const name of ['top', 'bottom']) {
    controller.setView(name);
    const before = viewer.camera.position.clone();
    // Same angular deltas consumed by OrbitControls for a down/right drag.
    viewer.controls._rotateUp(0.2);
    viewer.controls._rotateLeft(0.2);
    viewer.controls.update();
    assert.ok(viewer.camera.position.distanceTo(before) > 0.1, `${name} must orbit away`);
    assert.equal(controller.state.view, 'free');
  }
  controller.exit();
});
