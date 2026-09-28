import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSnappedBrushFrame, mapRayToBrushPlane} from '../src/scene/snappedBrushFrame.js';

function fixture(perspective, heading = 30, tilt = 25) {
  const parent = new THREE.Group(); parent.position.set(2, -1, 3); parent.rotation.set(0.2, 0.4, -0.3); parent.scale.setScalar(1.7);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.8));
  mesh.position.set(0.1, 0.2, -0.1); mesh.rotation.y = 0.2; parent.add(mesh); parent.updateMatrixWorld(true);
  const local = new THREE.Vector3(Math.sin(heading * Math.PI / 180) * Math.cos(tilt * Math.PI / 180),
    Math.sin(tilt * Math.PI / 180), Math.cos(heading * Math.PI / 180) * Math.cos(tilt * Math.PI / 180));
  const direction = local.clone().applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
  const center = new THREE.Vector3().applyMatrix4(mesh.matrixWorld);
  const camera = perspective ? new THREE.PerspectiveCamera(50, 1, 0.01, 100) : new THREE.OrthographicCamera(-3, 3, 3, -3, 0.01, 100);
  camera.position.copy(center).addScaledVector(direction, -7); camera.lookAt(center); camera.updateMatrixWorld(true);
  return {mesh, camera, local};
}

test('nearest local-Y heading snaps to 45 degrees while tilt stays exact in both camera types and transformed parents', () => {
  for (const perspective of [false, true]) for (const heading of [-179, -70, -20, 20, 30, 89, 170]) {
    const f = fixture(perspective, heading), before = f.camera.matrixWorld.toArray();
    const frame = createSnappedBrushFrame(f);
    assert.ok(Math.abs(frame.heading - Math.round(heading / 45) * Math.PI / 4) < 1e-10);
    assert.ok(Math.abs(frame.localAxis.y - f.local.y) < 1e-12);
    assert.deepEqual(f.camera.matrixWorld.toArray(), before);
    assert.ok(frame.axis.length() > 0.999999999);
    f.mesh.geometry.dispose(); f.mesh.material.dispose();
  }
});
test('poles are finite and deterministic, with unchanged elevation', () => {
  for (const tilt of [-90, 90]) {
    const f = fixture(false, 80, tilt), frame = createSnappedBrushFrame(f);
    assert.equal(frame.heading, 0); assert.ok(Math.abs(frame.localAxis.y - Math.sign(tilt)) < 1e-12);
    f.mesh.geometry.dispose(); f.mesh.material.dispose();
  }
});
test('mapping intersects the snapped head-centered plane, including oblique camera rays', () => {
  const f = fixture(true), frame = createSnappedBrushFrame(f);
  const origin = f.camera.position.clone();
  const target = frame.center.clone().add(new THREE.Vector3(0.3, -0.1, 0.2));
  const ray = new THREE.Ray(origin, target.clone().sub(origin).normalize());
  const mapped = mapRayToBrushPlane(ray, frame, 10);
  assert.ok(mapped); assert.ok(Math.abs(frame.plane.distanceToPoint(mapped)) < 1e-10);
  assert.ok(ray.distanceToPoint(mapped) < 1e-10);
  const cameraPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.camera.getWorldDirection(new THREE.Vector3()), frame.center);
  assert.ok(Math.abs(cameraPlane.distanceToPoint(mapped)) > 1e-4, 'mapping does not silently use a camera-facing plane');
  assert.equal(mapRayToBrushPlane(new THREE.Ray(frame.center.clone().add(frame.axis), frame.axis.clone()), frame, 10), null);
  const parallel = new THREE.Vector3(1, 0, 0).cross(frame.axis).normalize();
  assert.equal(mapRayToBrushPlane(new THREE.Ray(frame.center.clone().add(frame.axis), parallel), frame, 10), null);
  assert.equal(mapRayToBrushPlane(ray, frame, 0.001), null);
  f.mesh.geometry.dispose(); f.mesh.material.dispose();
});
test('nonuniform, singular, mirrored and sheared head transforms reject explicitly', () => {
  const f = fixture(false);
  for (const scale of [[1,2,1], [0,0,0], [-1,1,1]]) {
    f.mesh.scale.set(...scale);
    assert.throws(() => createSnappedBrushFrame(f), /uniform head scale/);
  }
  f.mesh.matrixAutoUpdate = false;
  f.mesh.matrix.set(1, 0.2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  assert.throws(() => createSnappedBrushFrame(f), /uniform head scale/);
  f.mesh.geometry.dispose(); f.mesh.material.dispose();
});


