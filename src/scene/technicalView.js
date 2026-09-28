import * as THREE from 'three';
import { assignViewerCamera, syncOrbitCamera } from './groomingCamera.js';

const DIRECTIONS = {
  front: [0, 0, 1], back: [0, 0, -1],
  left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 1, 0], bottom: [0, -1, 0],
};

/** The negative half-space is hidden, in world coordinates for every material. */
export function technicalCutPlane(bounds, { axis = 'x', position = 0, flipped = false } = {}) {
  const key = ['x', 'y', 'z'].includes(axis) ? axis : 'x';
  const fraction = THREE.MathUtils.clamp(Number(position) || 0, -1, 1);
  const coordinate = THREE.MathUtils.lerp(bounds.min[key], bounds.max[key], (fraction + 1) / 2);
  const normal = new THREE.Vector3();
  normal[key] = flipped ? -1 : 1;
  return new THREE.Plane(normal, -coordinate * normal[key]);
}

/** Presentation only: no groom/store/renderer rebuild operations belong here. */
export function createTechnicalView({ viewer, head, hair, onChange = () => {} }) {
  const state = { active: false, view: 'free', planeEdges: false,
    cutaway: { enabled: false, axis: 'x', position: 0, flipped: false } };
  const meshes = [];
  head.traverse(object => {
    if (!object.isMesh || object === hair || object.isInstancedMesh) return;
    // App overlays live below the groom mesh, whereas GLB surfaces live
    // below scene/group nodes. Do not style or frame diagnostic children.
    for (let parent = object.parent; parent && parent !== head.parent; parent = parent.parent) {
      if (parent.isMesh || parent === hair) return;
    }
    meshes.push(object);
  });
  const hairMaterials = [];
  hair?.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material?.uniforms?.uTechnical) hairMaterials.push(material);
  });
  let saved = null;
  let bounds = null;
  let ortho = null;
  let changingCamera = false;
  const overlays = [];
  const technicalMaterials = [];
  const emit = () => onChange(state);
  const setCamera = (camera, options) => viewer.setCamera
    ? viewer.setCamera(camera, options) : assignViewerCamera(viewer, camera, options);
  // r169 OrbitControls caches this camera-up basis at construction. A camera
  // swap/up change must update both halves or top-view drags hit its Y pole.
  const syncOrbitBasis = camera => {
    syncOrbitCamera(viewer.controls, camera);
  };
  const cameraChanged = () => {
    if (!state.active || changingCamera || state.view === 'free') return;
    const direction = ortho.position.clone().sub(viewer.controls.target).normalize();
    if (direction.distanceTo(new THREE.Vector3(...DIRECTIONS[state.view])) > 0.001) {
      state.view = 'free';
      ortho.up.set(0, 1, 0);
      syncOrbitBasis(ortho);
      ortho.lookAt(viewer.controls.target);
      emit();
    }
  };
  viewer.controls.addEventListener('change', cameraChanged);

  function applyCutaway() {
    if (!state.active) return;
    const plane = technicalCutPlane(bounds, state.cutaway);
    for (const material of technicalMaterials) {
      const wasEnabled = material.clippingPlanes?.length > 0;
      material.clippingPlanes = state.cutaway.enabled ? [plane] : [];
      if (wasEnabled !== state.cutaway.enabled) material.needsUpdate = true;
    }
    for (const material of hairMaterials) {
      material.uniforms.uTechnicalClipping.value = state.cutaway.enabled;
      material.uniforms.uTechnicalPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    }
  }

  function enter() {
    if (state.active) return;
    syncOrbitCamera(viewer.controls, viewer.camera);
    head.updateWorldMatrix(true, true);
    bounds = new THREE.Box3();
    for (const mesh of meshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.01);
    saved = {
      camera: viewer.camera, target: viewer.controls.target.clone(),
      background: viewer.scene.background, environment: viewer.scene.environment,
      toneMapping: viewer.renderer.toneMapping, clipping: viewer.renderer.localClippingEnabled,
      damping: viewer.controls.enableDamping, buttons: { ...viewer.controls.mouseButtons },
      materials: meshes.map(mesh => mesh.material), lights: [],
      hair: hairMaterials.map(material => ({ technical: material.uniforms.uTechnical.value,
        clipping: material.uniforms.uTechnicalClipping.value, plane: material.uniforms.uTechnicalPlane.value.clone() })),
    };
    viewer.scene.traverse(object => {
      if (object.isLight) { saved.lights.push([object, object.visible]); object.visible = false; }
    });
    const illumination = new THREE.Group();
    illumination.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(1, 2, 3);
    illumination.add(key);
    viewer.scene.add(illumination);
    saved.illumination = illumination;
    const gradient = new THREE.DataTexture(new Uint8Array([85, 165, 245]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
    saved.gradient = gradient;
    for (const mesh of meshes) {
      const toon = new THREE.MeshToonMaterial({ color: 0xe7e7df, gradientMap: gradient, side: THREE.DoubleSide });
      mesh.material = toon;
      technicalMaterials.push(toon);
      const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x151719, side: THREE.BackSide });
      const thickness = radius * 0.003;
      outlineMaterial.onBeforeCompile = shader => {
        shader.uniforms.technicalOutlineWidth = { value: thickness };
        shader.vertexShader = 'uniform float technicalOutlineWidth;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed += normal * technicalOutlineWidth;');
      };
      const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
      outline.name = 'Technical silhouette';
      outline.raycast = () => {};
      mesh.add(outline);
      overlays.push(outline);
      technicalMaterials.push(outlineMaterial);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 18),
        new THREE.LineBasicMaterial({ color: 0x555852, transparent: true, opacity: 0.65 }));
      edges.name = 'Technical plane edges';
      edges.visible = state.planeEdges;
      edges.raycast = () => {};
      mesh.add(edges);
      overlays.push(edges);
      technicalMaterials.push(edges.material);
    }
    for (const material of hairMaterials) material.uniforms.uTechnical.value = true;
    viewer.scene.background = new THREE.Color(0xffffff);
    viewer.scene.environment = null;
    viewer.renderer.toneMapping = THREE.NoToneMapping;
    viewer.renderer.localClippingEnabled = true;
    ortho = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.001, radius * 100);
    ortho.userData.viewHalfHeight = radius * 1.25;
    ortho.position.copy(center).add(viewer.camera.position.clone().sub(saved.target).normalize().multiplyScalar(radius * 4));
    ortho.lookAt(center);
    setCamera(ortho, { target: center });
    // No residual damped grooming motion is allowed to displace a preset.
    viewer.controls.enableDamping = false;
    viewer.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    viewer._onResize();
    state.active = true;
    state.view = 'free';
    state.cutaway = { enabled: false, axis: 'x', position: 0, flipped: false };
    changingCamera = true;
    viewer.controls.update();
    changingCamera = false;
    applyCutaway();
    emit();
  }

  function exit() {
    if (!state.active) return;
    state.active = false;
    meshes.forEach((mesh, index) => { mesh.material = saved.materials[index]; });
    for (const overlay of overlays) {
      overlay.removeFromParent();
      if (overlay.isLineSegments) overlay.geometry.dispose();
    }
    overlays.length = 0;
    technicalMaterials.forEach(material => material.dispose());
    technicalMaterials.length = 0;
    saved.gradient.dispose();
    saved.illumination.removeFromParent();
    for (const [light, visible] of saved.lights) light.visible = visible;
    hairMaterials.forEach((material, index) => {
      material.uniforms.uTechnical.value = saved.hair[index].technical;
      material.uniforms.uTechnicalClipping.value = saved.hair[index].clipping;
      material.uniforms.uTechnicalPlane.value.copy(saved.hair[index].plane);
    });
    viewer.scene.background = saved.background;
    viewer.scene.environment = saved.environment;
    viewer.renderer.toneMapping = saved.toneMapping;
    viewer.renderer.localClippingEnabled = saved.clipping;
    setCamera(saved.camera, { target: saved.target });
    viewer.controls.enableDamping = saved.damping;
    viewer.controls.mouseButtons = saved.buttons;
    viewer._onResize();
    viewer.controls.update();
    saved = null;
    emit();
  }

  function setView(name) {
    if (!state.active || (name !== 'free' && !DIRECTIONS[name])) return;
    changingCamera = true;
    if (DIRECTIONS[name]) {
      const distance = ortho.position.distanceTo(viewer.controls.target);
      ortho.up.set(0, name === 'top' || name === 'bottom' ? 0 : 1, name === 'top' ? -1 : name === 'bottom' ? 1 : 0);
      ortho.position.copy(viewer.controls.target).addScaledVector(new THREE.Vector3(...DIRECTIONS[name]), distance);
      ortho.lookAt(viewer.controls.target);
    } else {
      // Reestablish the familiar world-up orbit after a top/bottom preset.
      ortho.up.set(0, 1, 0);
    }
    syncOrbitBasis(ortho);
    viewer.controls.update();
    changingCamera = false;
    state.view = name;
    emit();
  }

  function setCutaway(next) {
    const merged = { ...state.cutaway, ...next };
    state.cutaway = { enabled: Boolean(merged.enabled), axis: ['x', 'y', 'z'].includes(merged.axis) ? merged.axis : 'x',
      position: THREE.MathUtils.clamp(Number(merged.position) || 0, -1, 1), flipped: Boolean(merged.flipped) };
    applyCutaway();
    emit();
  }

  function setPlaneEdges(enabled) {
    state.planeEdges = Boolean(enabled);
    for (const overlay of overlays) if (overlay.isLineSegments) overlay.visible = state.planeEdges;
    emit();
  }

  return { state, enter, exit, setView, setCutaway, setPlaneEdges,
    dispose() { exit(); viewer.controls.removeEventListener('change', cameraChanged); } };
}
