import * as THREE from 'three';

export const GROOMING_VIEWS = Object.freeze({
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0],
  right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0],
});

/** Narrow adapter for the cached up basis and residual motion in r169. */
export function syncOrbitCamera(controls, camera) {
  controls._quat.setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
  controls._quatInverse.copy(controls._quat).invert();
  controls._sphericalDelta.set(0, 0, 0);
  controls._panOffset.set(0, 0, 0);
  controls._scale = 1;
  controls._performCursorZoom = false;
}

export function resizeCamera(camera, aspect) {
  if (camera.isOrthographicCamera) {
    const halfHeight = camera.userData.viewHalfHeight ?? (camera.top - camera.bottom) / 2;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
  } else camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

export function assignViewerCamera(viewer, camera, { target = viewer.controls.target } = {}) {
  viewer.camera = camera;
  viewer.controls.object = camera;
  viewer.controls.target.copy(target);
  syncOrbitCamera(viewer.controls, camera);
  viewer._onResize();
  camera.updateMatrixWorld(true);
  for (const fn of viewer._cameraListeners ?? []) fn(camera);
}

export function targetPlaneHalfHeight(camera, target) {
  return camera.isOrthographicCamera ? (camera.top - camera.bottom) / (2 * camera.zoom)
    : camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
}

/** Runtime camera state only. Callers finish active tools before changing it. */
export function createGroomingCamera({ viewer, onChange = () => {} }) {
  const perspective = viewer.camera;
  const orthographic = new THREE.OrthographicCamera();
  let activeCamera = perspective;
  let changing = false;
  const state = { projection: 'perspective', view: 'free' };
  const emit = () => onChange({ ...state });
  const ownsCamera = () => viewer.camera === activeCamera;

  function setProjection(projection) {
    if (!ownsCamera() || !['perspective', 'orthographic'].includes(projection) || projection === state.projection) return;
    const source = activeCamera;
    const target = viewer.controls.target;
    const height = targetPlaneHalfHeight(source, target);
    const next = projection === 'orthographic' ? orthographic : perspective;
    next.position.copy(source.position);
    next.quaternion.copy(source.quaternion);
    next.up.copy(source.up);
    next.near = source.near;
    next.far = source.far;
    if (next.isOrthographicCamera) {
      next.zoom = 1;
      next.userData.viewHalfHeight = height;
    } else {
      // r169 OrbitControls pans using fov without accounting for camera.zoom.
      // Encode the effective FOV directly, retaining pose/distance and avoiding
      // distance clamps while keeping pan speed consistent across projections.
      next.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / source.position.distanceTo(target)));
      next.zoom = 1;
    }
    changing = true;
    activeCamera = next;
    viewer.setCamera(next);
    changing = false;
    state.projection = projection;
    emit();
  }

  function setView(name) {
    if (!ownsCamera() || (name !== 'free' && !GROOMING_VIEWS[name])) return;
    changing = true;
    if (name !== 'free') setProjection('orthographic');
    changing = true;
    const camera = activeCamera;
    if (name !== 'free') {
      const distance = camera.position.distanceTo(viewer.controls.target);
      camera.up.set(0, name === 'top' || name === 'bottom' ? 0 : 1, name === 'top' ? -1 : name === 'bottom' ? 1 : 0);
      camera.position.copy(viewer.controls.target).addScaledVector(new THREE.Vector3(...GROOMING_VIEWS[name]), distance);
    } else camera.up.set(0, 1, 0);
    camera.lookAt(viewer.controls.target);
    syncOrbitCamera(viewer.controls, camera);
    viewer.controls.update();
    camera.updateMatrixWorld(true);
    changing = false;
    state.view = name;
    emit();
  }

  function cameraMoved() {
    if (!ownsCamera() || changing || state.view === 'free') return;
    const direction = activeCamera.position.clone().sub(viewer.controls.target).normalize();
    if (direction.distanceTo(new THREE.Vector3(...GROOMING_VIEWS[state.view])) <= 1e-5) return;
    state.view = 'free';
    activeCamera.up.set(0, 1, 0);
    // Preserve the already-applied movement while adopting world-up orbit.
    syncOrbitCamera(viewer.controls, activeCamera);
    activeCamera.lookAt(viewer.controls.target);
    emit();
  }
  viewer.controls.addEventListener('change', cameraMoved);
  return { state, setProjection, setView,
    dispose() { viewer.controls.removeEventListener('change', cameraMoved); } };
}
