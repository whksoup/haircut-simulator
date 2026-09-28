import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Viewer } from '../src/scene/viewer.js';
import { createGroomingCamera, resizeCamera, GROOMING_VIEWS } from '../src/scene/groomingCamera.js';
import { createTechnicalView } from '../src/scene/technicalView.js';

function fixture() {
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.01, 100);
  camera.position.set(0.3, 0.4, 2);
  const controls = new OrbitControls(camera);
  controls.target.set(0.1, 0.2, 0);
  controls.update();
  const viewer = Object.assign(Object.create(Viewer.prototype), { camera, controls,
    aspect: 1.6, _cameraListeners: new Set(), _onResize() { resizeCamera(this.camera, this.aspect); } });
  return viewer;
}

test('camera assignment updates rendering, picking and subscribers atomically', () => {
  const viewer = fixture();
  const next = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  next.position.copy(viewer.camera.position);
  let observed;
  viewer.onCameraChange?.(camera => { observed = [camera, viewer.camera, viewer.controls.object]; });
  viewer.setCamera?.(next);
  assert.equal(viewer.camera, next, 'rendering and picking must receive the new camera');
  assert.deepEqual(observed, [next, next, next]);
});

function landmarkPixels(viewer, width, height) {
  viewer.camera.updateMatrixWorld(true);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(viewer.camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewer.camera.quaternion);
  return [[0, 0], [0.2, 0.1], [-0.15, 0.25]].map(([x, y]) => {
    const point = viewer.controls.target.clone().addScaledVector(right, x).addScaledVector(up, y).project(viewer.camera);
    return [point.x * width / 2, point.y * height / 2];
  });
}

test('twenty projection round trips preserve target-plane landmarks with pan, zoom and resize', () => {
  const viewer = fixture();
  const controller = createGroomingCamera({ viewer });
  const original = viewer.camera;
  original.zoom = 1.7;
  original.updateProjectionMatrix();
  for (let round = 0; round < 20; round++) {
    const [width, height] = round % 2 ? [1024, 768] : [1440, 900];
    viewer.aspect = width / height;
    viewer._onResize();
    const before = landmarkPixels(viewer, width, height);
    controller.setProjection('orthographic');
    const after = landmarkPixels(viewer, width, height);
    assert.ok(before.every((point, i) => Math.hypot(point[0] - after[i][0], point[1] - after[i][1]) < 1));
    viewer.camera.zoom *= 1.01;
    viewer.camera.updateProjectionMatrix();
    const pan = new THREE.Vector3(0.003, -0.002, 0.001);
    viewer.camera.position.add(pan);
    viewer.controls.target.add(pan);
    const zoomed = landmarkPixels(viewer, width, height);
    controller.setProjection('perspective');
    const returned = landmarkPixels(viewer, width, height);
    assert.equal(viewer.camera, original);
    assert.ok(zoomed.every((point, i) => Math.hypot(point[0] - returned[i][0], point[1] - returned[i][1]) < 1));
  }
});

test('six grooming presets are orthographic and both pole presets escape into free orbit', () => {
  const viewer = fixture();
  const controller = createGroomingCamera({ viewer });
  for (const [name, direction] of Object.entries(GROOMING_VIEWS)) {
    controller.setView(name);
    assert.equal(viewer.camera.isOrthographicCamera, true);
    assert.ok(viewer.camera.position.clone().sub(viewer.controls.target).normalize().distanceTo(new THREE.Vector3(...direction)) <= 1e-5);
    assert.equal(controller.state.view, name);
  }
  for (const name of ['top', 'bottom']) {
    controller.setView(name);
    const before = viewer.camera.position.clone();
    viewer.controls._rotateUp(0.2);
    viewer.controls._rotateLeft(0.2);
    viewer.controls.update();
    assert.ok(viewer.camera.position.distanceTo(before) > 0.1);
    assert.equal(controller.state.view, 'free');
  }
});

test('Technical borrows the camera and returns orthographic identity, pose, zoom and target', () => {
  const viewer = fixture();
  viewer.scene = new THREE.Scene();
  viewer.renderer = { toneMapping: THREE.ACESFilmicToneMapping, localClippingEnabled: false };
  const head = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  viewer.scene.add(head);
  const grooming = createGroomingCamera({ viewer });
  grooming.setView('top');
  viewer.camera.zoom = 2.3;
  viewer.camera.updateProjectionMatrix();
  const saved = { camera: viewer.camera, position: viewer.camera.position.clone(), quaternion: viewer.camera.quaternion.clone(),
    up: viewer.camera.up.clone(), target: viewer.controls.target.clone(), zoom: viewer.camera.zoom };
  const technical = createTechnicalView({ viewer, head });
  let notifications = 0;
  viewer.onCameraChange(() => notifications++);
  for (let cycle = 0; cycle < 3; cycle++) {
    technical.enter();
    technical.setView('bottom');
    grooming.setProjection('perspective');
    assert.equal(grooming.state.projection, 'orthographic');
    assert.equal(grooming.state.view, 'top');
    viewer.aspect = 4 / 3;
    viewer._onResize();
    technical.exit();
    assert.equal(viewer.camera, saved.camera);
    assert.ok(viewer.camera.position.distanceTo(saved.position) < 1e-10);
    assert.ok(viewer.camera.quaternion.angleTo(saved.quaternion) < 1e-7);
    assert.deepEqual(viewer.camera.up, saved.up);
    assert.ok(viewer.controls.target.distanceTo(saved.target) < 1e-12);
    assert.equal(viewer.camera.zoom, saved.zoom);
  }
  assert.equal(notifications, 6);
});

test('camera swaps discard residual damping without moving the saved pose', () => {
  const viewer = fixture();
  const controller = createGroomingCamera({ viewer });
  viewer.controls.enableDamping = true;
  viewer.controls._rotateUp(0.2);
  viewer.controls._panOffset.set(0.2, 0.1, 0);
  const position = viewer.camera.position.clone();
  const target = viewer.controls.target.clone();
  controller.setProjection('orthographic');
  viewer.controls.update();
  assert.ok(viewer.camera.position.distanceTo(position) < 1e-10);
  assert.ok(viewer.controls.target.distanceTo(target) < 1e-12);
});

test('real OrbitControls pan moves the same CSS distance after magnified projection changes', () => {
  for (const zoom of [4, 0.25]) {
    const viewer = fixture();
    viewer.aspect = 1440 / 900;
    viewer.controls.domElement = { clientWidth: 1440, clientHeight: 900 };
    const controller = createGroomingCamera({ viewer });
    controller.setProjection('orthographic');
    viewer.camera.zoom = zoom;
    viewer.camera.updateProjectionMatrix();
    const landmark = viewer.controls.target.clone();
    const panPixels = () => {
      viewer.camera.updateMatrixWorld(true);
      const before = landmark.clone().project(viewer.camera).x * 720;
      viewer.controls._pan(20, 0);
      viewer.controls.update();
      viewer.camera.updateMatrixWorld(true);
      return landmark.clone().project(viewer.camera).x * 720 - before;
    };
    assert.ok(Math.abs(panPixels() - 20) < 1e-8);
    controller.setProjection('perspective');
    assert.ok(Math.abs(panPixels() - 20) < 1e-8, `perspective pan at prior orthographic zoom ${zoom}`);
  }
});
