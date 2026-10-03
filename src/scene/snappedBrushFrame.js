import * as THREE from 'three';

const STEP = Math.PI / 4;

/** Freeze a world-ground-parallel axis with heading snapped about world Y.
 * Camera/head tilt must never tip the cylinder. Scaling must be rigid/uniform because
 * existing guide capsule solvers use one mesh-local radius. */
export function createSnappedBrushFrame({mesh, camera}) {
  mesh.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld.clone();
  const x = new THREE.Vector3().setFromMatrixColumn(matrix, 0);
  const y = new THREE.Vector3().setFromMatrixColumn(matrix, 1);
  const z = new THREE.Vector3().setFromMatrixColumn(matrix, 2);
  const lengths = [x.length(), y.length(), z.length()];
  const scale = lengths[0], tolerance = Math.max(scale, 1e-12) * 1e-6;
  if (!(scale > 1e-9) || lengths.some(v => Math.abs(v - scale) > tolerance) ||
      Math.abs(x.dot(y)) > scale * scale * 1e-6 ||
      Math.abs(x.dot(z)) > scale * scale * 1e-6 ||
      Math.abs(y.dot(z)) > scale * scale * 1e-6 || matrix.determinant() <= 0) {
    throw new RangeError('Snapped brush requires a positive uniform head scale without shear.');
  }
  const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
  const direction = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const horizontal = Math.hypot(direction.x, direction.z);
  const originalHeading = horizontal < 1e-10 ? 0 : Math.atan2(direction.x, direction.z);
  const heading = Math.round(originalHeading / STEP) * STEP;
  const axis = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const localAxis = axis.clone().applyQuaternion(rotation.clone().invert()).normalize();
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
  return Object.freeze({axis: Object.freeze(axis), localAxis: Object.freeze(localAxis),
    center: Object.freeze(center), heading, originalHeading, elevation: 0, scale, matrix,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axis, center)});
}

/** A bounded forward ray/plane intersection. A rejected pose must break the
 * caller's stroke continuity, never turn into an arbitrarily distant point. */
export function mapRayToBrushPlane(ray, frame, maxDistance) {
  const denominator = frame.axis.dot(ray.direction);
  if (Math.abs(denominator) < 1e-6 || !(maxDistance > 0) || !Number.isFinite(maxDistance)) return null;
  const distance = frame.center.clone().sub(ray.origin).dot(frame.axis) / denominator;
  if (distance < 0 || !Number.isFinite(distance)) return null;
  const point = ray.at(distance, new THREE.Vector3());
  return point.distanceTo(frame.center) <= maxDistance ? point : null;
}


