/**
 * workPlane.js — a manipulable construction plane; the comb's interaction space.
 *
 * Rhino's CPlane, applied to hair. The user parks a rectangular plane wherever
 * they want to work — through the fringe, along the parting, out in the air
 * where the tips hang — and the comb then operates ON that plane rather than on
 * the scalp. Two things follow, and both are the point:
 *
 *   DEPTH IS DECIDED IN ADVANCE. The pointer ray meets the plane at exactly one
 *   point, so a 2D mouse gives an unambiguous 3D cursor with no heuristics. The
 *   surface-anchored brush solved depth by demanding a scalp hit; this solves it
 *   by letting the user state where "here" is, once, and then forget about it.
 *
 *   THE PLANE IS THE COMB. Falloff is measured in plane space — a disc of
 *   `radius` across the plane, a slab of `thickness` through it — so a stroke
 *   grabs a SHEET of hair, exactly like dragging a real comb through it. Hair
 *   on the far side of the plane is untouched. Rotate the plane, comb a
 *   different layer. This is what makes layered styling tractable.
 *
 * Gizmo: three.js TransformControls, W/E/R for translate/rotate/scale, X/Y/Z to
 * constrain an axis, Q to toggle world/local space, with optional grid snapping.
 * Scale resizes the visual card only — the plane math is origin + normal, so a
 * scaled plane is the same infinite plane with a bigger window drawn on it.
 *
 * Alignment presets matter more than they look: getting a plane where you want
 * it by dragging a gizmo is slow, and 90% of real placements are "facing me",
 * "the head's midline", or "tangent to the scalp there". Those are one click.
 *
 * Public:
 *   object            THREE.Group — the plane card, added to the scene
 *   plane             THREE.Plane — world-space, kept in sync every frame
 *   frame()           { origin, u, v, n } world-space basis vectors
 *   raycast(ray, out) world point where a ray meets the plane, or null
 *   setMode / setSpace / setSnap / setSize / setVisible
 *   alignToView(camera) / alignToAxis('x'|'y'|'z') / alignToSurfaceHit(hit, mode)
 *   enableGizmo() / disableGizmo()   — driven by the tool mutex in main.js
 *   dispose()
 *
 * Lives in WORLD space, deliberately. The head can be reframed or moved without
 * the work plane sliding out from under the user; CombTool converts world
 * displacements into mesh-local guide edits at the point of use.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const DEF_SIZE = 0.35;

export class WorkPlane {
  /**
   * @param {object} o
   * @param {import('./viewer.js').Viewer} o.viewer
   * @param {THREE.Mesh} [o.mesh]   groomTarget, used by alignment presets
   */
  constructor({ viewer, mesh = null }) {
    this.viewer = viewer;
    this.mesh   = mesh;

    this.size = DEF_SIZE;
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    // --- visual card -------------------------------------------------------
    this.object = new THREE.Group();
    this.object.name = 'WorkPlane';
    this._fill = makeFill();
    this._grid = makeGrid(12);
    this._axes = makeAxisCross();
    this._norm = makeNormalStem();
    this.object.add(this._fill, this._grid, this._axes, this._norm);
    this.setSize(this.size);
    viewer.scene.add(this.object);

    // --- gizmo -------------------------------------------------------------
    this._tc = new TransformControls(viewer.camera, viewer.renderer.domElement);
    this._tc.setMode('translate');
    this._tc.setSpace('local');
    this._tc.attach(this.object);

    // three moved the gizmo's renderable out of the controller itself around
    // r169; support both so this doesn't hard-fail on a version bump.
    this._tcHelper = typeof this._tc.getHelper === 'function' ? this._tc.getHelper() : this._tc;
    viewer.scene.add(this._tcHelper);
    this._tcHelper.visible = false;
    this._tc.enabled = false;

    // The gizmo and OrbitControls both want the drag. Standard handshake.
    this._onDraggingChanged = (e) => { viewer.controls.enabled = !e.value; };
    this._tc.addEventListener('dragging-changed', this._onDraggingChanged);

    this._onKeyDown = this._onKeyDown.bind(this);

    // Keep the world-space THREE.Plane in step with the card's transform.
    this._stopUpdate = viewer.onUpdate(() => this._syncPlane());
    this._syncPlane();
  }

  // --- gizmo lifecycle ------------------------------------------------------

  enableGizmo() {
    if (this._tc.enabled) return;
    this._tc.enabled = true;
    this._tcHelper.visible = true;
    window.addEventListener('keydown', this._onKeyDown);
  }

  disableGizmo() {
    if (!this._tc.enabled) return;
    this._tc.enabled = false;
    this._tcHelper.visible = false;
    this.viewer.controls.enabled = true;
    window.removeEventListener('keydown', this._onKeyDown);
  }

  setMode(mode)  { this._tc.setMode(mode); }        // translate | rotate | scale
  setSpace(sp)   { this._tc.setSpace(sp); }         // world | local
  setVisible(v)  { this.object.visible = v; }

  /**
   * Grid snapping. Pass 0 / null to disable. Translation snap is in mesh units,
   * rotation snap in degrees (converted here — degrees is what a UI wants).
   */
  setSnap({ translate = null, rotateDeg = null } = {}) {
    this._tc.translationSnap = translate || null;
    this._tc.rotationSnap    = rotateDeg ? THREE.MathUtils.degToRad(rotateDeg) : null;
  }

  /** Resize the drawn card. Does not change the mathematical plane. */
  setSize(s) {
    this.size = Math.max(0.01, s);
    this._fill.scale.setScalar(this.size);
    this._grid.scale.setScalar(this.size);
    this._axes.scale.setScalar(this.size);
    this._norm.scale.setScalar(this.size * 0.4);
  }

  // --- placement ------------------------------------------------------------

  /** Face the camera, centred on the current target. The default working pose. */
  alignToView(camera = this.viewer.camera) {
    const n = camera.getWorldDirection(new THREE.Vector3()).negate();
    this.object.position.copy(this.viewer.controls.target);
    this._orientTo(n);
  }

  /**
   * Snap to a world axis plane, centred on the head. 'x' gives the SAGITTAL
   * plane — the one you want for setting a parting, since it slices the skull
   * down the midline.
   */
  alignToAxis(axis = 'x') {
    const n = axis === 'x' ? new THREE.Vector3(1, 0, 0)
            : axis === 'y' ? new THREE.Vector3(0, 1, 0)
            :                new THREE.Vector3(0, 0, 1);
    if (this.mesh) {
      const box = new THREE.Box3().setFromObject(this.mesh);
      box.getCenter(this.object.position);
    }
    this._orientTo(n);
  }

  /**
   * Place from a raycast hit on the head.
   *   'tangent' — plane lies flat ON the scalp (normal = surface normal).
   *              Combs the hair that sits against the skull.
   *   'slice'   — plane stands perpendicular to the scalp, facing the camera.
   *              Combs a cross-section of hair growing off that spot. This is
   *              the one you want most of the time.
   */
  alignToSurfaceHit(hit, mode = 'slice') {
    if (!hit) return;
    this.object.position.copy(hit.point);
    const surfN = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 1, 0);

    if (mode === 'tangent') { this._orientTo(surfN); return; }

    // Slice: the plane CONTAINS the surface normal (so hair growing straight
    // out lies in it) and turns as flat to the camera as that allows.
    const camDir = this.viewer.camera.getWorldDirection(new THREE.Vector3());
    let n = new THREE.Vector3().crossVectors(surfN, camDir);
    if (n.lengthSq() < 1e-8) n = new THREE.Vector3().crossVectors(surfN, new THREE.Vector3(0, 1, 0));
    this._orientTo(n.normalize(), surfN);
  }

  /** Point the card's +Z along `n`; optionally pin its +Y toward `up`. */
  _orientTo(n, up = null) {
    const q = new THREE.Quaternion();
    if (up) {
      const zAxis = n.clone().normalize();
      const yAxis = up.clone().addScaledVector(zAxis, -up.dot(zAxis)).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    } else {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
    }
    this.object.quaternion.copy(q);
    this.object.updateMatrixWorld(true);
    this._syncPlane();
  }

  // --- query ----------------------------------------------------------------

  get plane() { return this._plane; }

  /** World-space basis: origin + in-plane u,v + normal n. */
  frame(out = {}) {
    this.object.updateMatrixWorld();
    const m = this.object.matrixWorld;
    out.origin = (out.origin ?? new THREE.Vector3()).setFromMatrixPosition(m);
    out.u = (out.u ?? new THREE.Vector3()).setFromMatrixColumn(m, 0).normalize();
    out.v = (out.v ?? new THREE.Vector3()).setFromMatrixColumn(m, 1).normalize();
    out.n = (out.n ?? new THREE.Vector3()).setFromMatrixColumn(m, 2).normalize();
    return out;
  }

  /** Where does `ray` meet the plane? Returns `out` or null if parallel. */
  raycast(ray, out = new THREE.Vector3()) {
    return ray.intersectPlane(this._plane, out) ? out : null;
  }

  _syncPlane() {
    this.object.updateMatrixWorld();
    const n = new THREE.Vector3().setFromMatrixColumn(this.object.matrixWorld, 2).normalize();
    const o = new THREE.Vector3().setFromMatrixPosition(this.object.matrixWorld);
    this._plane.setFromNormalAndCoplanarPoint(n, o);
  }

  // --- keyboard -------------------------------------------------------------

  _onKeyDown(e) {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key.toLowerCase()) {
      case 'w': this._tc.setMode('translate'); break;
      case 'e': this._tc.setMode('rotate');    break;
      case 'r': this._tc.setMode('scale');     break;
      case 'q': this._tc.setSpace(this._tc.space === 'local' ? 'world' : 'local'); break;
      // Axis constraints: pressing an axis isolates it, pressing it again or
      // hitting another key restores all three.
      case 'x': this._isolate('X'); break;
      case 'y': this._isolate('Y'); break;
      case 'z': this._isolate('Z'); break;
      case 'escape': this._isolate(null); break;
      default: return;
    }
    e.preventDefault();
  }

  _isolate(axis) {
    const all = axis === null;
    this._tc.showX = all || axis === 'X';
    this._tc.showY = all || axis === 'Y';
    this._tc.showZ = all || axis === 'Z';
  }

  dispose() {
    this.disableGizmo();
    this._stopUpdate?.();
    this._tc.removeEventListener('dragging-changed', this._onDraggingChanged);
    this._tc.detach();
    this._tc.dispose();
    this._tcHelper.parent?.remove(this._tcHelper);
    this.object.parent?.remove(this.object);
    this._fill.geometry.dispose();
    this._fill.material.dispose();
    this._grid.geometry.dispose();
    this._grid.material.dispose();
    this._axes.geometry.dispose();
    this._axes.material.dispose();
    this._norm.geometry.dispose();
    this._norm.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Visuals. Unit-sized (±0.5 in XY, normal along +Z); scaled by setSize.

function makeFill() {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.06,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  return m;
}

function makeGrid(div) {
  const v = [];
  const h = 0.5;
  for (let i = 0; i <= div; i++) {
    const t = -h + (i / div);
    v.push(-h, t, 0,  h, t, 0);
    v.push(t, -h, 0,  t, h, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.22, depthWrite: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 2;
  return l;
}

/** Brighter cross through the origin, so the plane's centre is readable. */
function makeAxisCross() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0,  0.5, 0, 0,   0, -0.5, 0,  0, 0.5, 0], 3,
  ));
  const mat = new THREE.LineBasicMaterial({
    color: 0x99ddff, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 2;
  return l;
}

/** Short stem along +Z so you can tell which way the plane faces. */
function makeNormalStem() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffaa44, transparent: true, opacity: 0.8, depthWrite: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 2;
  return l;
}