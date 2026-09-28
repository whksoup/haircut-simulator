import * as THREE from 'three';
import { HeadVisibility } from '../scene/headVisibility.js';
import { syncOrbitCamera, targetPlaneHalfHeight } from '../scene/groomingCamera.js';
import { StrokeSampler, brushGuide } from '../hair/rayBrushStroke.js';
import { guideFrame, liftGuide } from '../hair/guideFrame.js';

/** Hold-and-move camera-ray comb. Selection/visibility gate authored guides;
 * existing GPU guide interpolation can influence neighboring rendered hair. */
export class RayBrushTool {
  constructor({viewer, mesh, guides, onEdit, onStrokeBegin = null,
    onStrokeEnd = null, onStateChange = null, canStyle = () => true}) {
    Object.assign(this, {viewer, mesh, guides, onEdit, onStrokeBegin, onStrokeEnd, onStateChange, canStyle});
    this.enabled = false; this.active = false; this.radius = 0.025; this.mask = null;
    this._canvas = viewer.renderer.domElement;
    this._listeners = [];
    this._changed = new Set(); this._pending = new Set();
    this.cursor = document.createElement('div');
    this.cursor.setAttribute('aria-hidden', 'true');
    Object.assign(this.cursor.style, {position: 'fixed', display: 'none', pointerEvents: 'none',
      border: '2px solid #f4cf6b', borderRadius: '50%', transform: 'translate(-50%, -50%)',
      boxSizing: 'border-box', zIndex: '20', boxShadow: '0 0 0 1px #151515'});
    document.body.appendChild(this.cursor);
    this._listen(this._canvas, 'pointerdown', e => this._down(e));
    this._listen(this._canvas, 'pointermove', e => this._move(e));
    this._listen(this._canvas, 'pointerleave', () => { this.finishEditing('exit'); this.cursor.style.display = 'none'; });
    for (const name of ['pointercancel', 'lostpointercapture']) this._listen(this._canvas, name, () => this.finishEditing(name));
    this._listen(window, 'pointerup', e => { if (e.pointerId === this._pointer) this.finishEditing('release'); });
    this._listen(this._canvas, 'wheel', () => this.finishEditing('navigation'));
    this._listen(window, 'blur', () => this.finishEditing('blur'));
    this._listen(window, 'resize', () => { this.finishEditing('resize'); this.cursor.style.display = 'none'; });
    this._listen(document, 'visibilitychange', () => { if (document.hidden) this.finishEditing('hidden'); });
    this._listen(window, 'keydown', e => {
      if (e.key === 'Escape' && this.enabled && this.active) {
        this.finishEditing('escape'); e.preventDefault(); e.stopImmediatePropagation();
      }
    });
    this._offCamera = viewer.onCameraChange?.(() => { this.finishEditing('camera'); this.cursor.style.display = 'none'; });
  }

  _listen(target, name, fn) {
    target.addEventListener(name, fn, {capture: true});
    this._listeners.push(() => target.removeEventListener(name, fn, {capture: true}));
  }
  setEnabled(value) {
    if (!value) this.finishEditing('disable');
    this.enabled = !!value;
    if (!this.enabled) this.cursor.style.display = 'none';
    this.onStateChange?.();
  }
  setMask(mask) { this.finishEditing('mask'); this.mask = mask === null ? null : new Set(mask); this.onStateChange?.(); }
  setRadius(radius) {
    this.finishEditing('radius');
    if (Number.isFinite(radius)) this.radius = THREE.MathUtils.clamp(radius, 0.001, 0.5);
    this.onStateChange?.();
  }
  _inside(e, rect) { return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom; }
  _cursorAt(e) {
    if (!this.enabled || !this.canStyle()) { this.cursor.style.display = 'none'; return; }
    const rect = this._canvas.getBoundingClientRect();
    if (!this._inside(e, rect)) { this.cursor.style.display = 'none'; return; }
    const half = targetPlaneHalfHeight(this.viewer.camera, this.viewer.controls.target);
    const size = this.radius * rect.height / Math.max(half, 1e-8);
    Object.assign(this.cursor.style, {display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px`,
      width: `${size}px`, height: `${size}px`, borderColor: this.active ? '#ff8844' : '#f4cf6b',
      background: this.active ? '#ff88441c' : 'transparent'});
  }
  _down(e) {
    if (e.button !== 0) { this.finishEditing('navigation'); return; }
    if (!this.enabled || !this.canStyle() || this.active || e.isPrimary === false) return;
    const rect = this._canvas.getBoundingClientRect();
    if (!this._inside(e, rect)) return;
    syncOrbitCamera(this.viewer.controls, this.viewer.camera);
    this.viewer.camera.updateMatrixWorld(true);
    this.mesh.updateWorldMatrix(true, false);
    this._camera = this.viewer.camera.clone(); this._camera.updateMatrixWorld(true);
    this._inverse = this.mesh.matrixWorld.clone().invert();
    this._scale = Math.abs(this.mesh.getWorldScale(new THREE.Vector3()).x) || 1;
    this._rect = rect; this._strokeRadius = this.radius;
    this._strokeMask = this.mask === null ? null : new Set(this.mask);
    this._visibility = new HeadVisibility(this.mesh, this._camera);
    // Root reach encloses every valid deformation during the pass; also include
    // current vertices so an already-stretched imported guide cannot be missed.
    const box = new THREE.Box3();
    for (const g of this.guides.guides.values()) {
      const r = new THREE.Vector3(...g.root).applyMatrix4(this.mesh.matrixWorld);
      const reach = g.length * this._scale + this.radius * 2;
      box.expandByPoint(r.clone().addScalar(reach)); box.expandByPoint(r.clone().addScalar(-reach));
      const points = liftGuide(g, guideFrame(g));
      for (let i = 0; i < points.length; i += 3) {
        box.expandByPoint(new THREE.Vector3(points[i], points[i + 1], points[i + 2]).applyMatrix4(this.mesh.matrixWorld));
      }
    }
    this._sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 0) : box.getBoundingSphere(new THREE.Sphere());
    this._raycaster = new THREE.Raycaster(); this._lastAxis = null;
    this._changed.clear(); this._pending.clear();
    const half = targetPlaneHalfHeight(this._camera, this.viewer.controls.target);
    const spacing = Math.max(0.25, this.radius * rect.height / (2 * Math.max(half, 1e-8)) * 0.2);
    this._sampler = new StrokeSampler([e.clientX, e.clientY], spacing, p => this._sample(p));
    this._pointer = e.pointerId; this.active = true;
    this._controlsEnabled = this.viewer.controls.enabled;
    this.viewer.controls.enabled = false;
    this._canvas.setPointerCapture?.(e.pointerId);
    this.onStrokeBegin?.(); this._cursorAt(e); this.onStateChange?.();
    e.preventDefault(); e.stopImmediatePropagation();
  }
  _move(e) {
    this._cursorAt(e);
    if (!this.active || e.pointerId !== this._pointer) return;
    if (!this.canStyle() || !(e.buttons & 1) || !this._inside(e, this._rect)) { this.finishEditing('interruption'); return; }
    this._sampler.move([e.clientX, e.clientY]); this._publish();
    e.preventDefault(); e.stopImmediatePropagation();
  }
  _sample([x, y]) {
    const r = this._rect;
    this._raycaster.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, 1 - (y - r.top) / r.height * 2), this._camera);
    const ray = this._raycaster.ray, sphere = this._sphere;
    const reach = sphere.radius + this._strokeRadius;
    if (ray.distanceSqToPoint(sphere.center) > reach * reach) { this._lastAxis = null; return; }
    const depth = sphere.center.clone().sub(ray.origin).dot(ray.direction);
    const near = Math.max(0, depth - reach), far = depth + reach;
    if (far <= near) return;
    const a = ray.at(near, new THREE.Vector3()).applyMatrix4(this._inverse);
    const b = ray.at(far, new THREE.Vector3()).applyMatrix4(this._inverse);
    const middle = ray.at(Math.max(0, depth), new THREE.Vector3()).applyMatrix4(this._inverse);
    const tie = this._lastAxis ? middle.clone().sub(this._lastAxis) : new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion).transformDirection(this._inverse);
    this._lastAxis = middle;
    if (tie.lengthSq() < 1e-16) tie.set(1, 0, 0); tie.normalize();
    this._applyCapsule(a, b, tie);
  }
  _applyCapsule(a, b, tie) {
    const cap = {ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r: this._strokeRadius / this._scale};
    const axis = b.clone().sub(a), lengthSq = axis.lengthSq();
    for (const g of this.guides.guides.values()) {
      if (this._strokeMask && !this._strokeMask.has(g.facetId)) continue;
      const delta = new THREE.Vector3(...g.root).sub(a);
      delta.addScaledVector(axis, -THREE.MathUtils.clamp(delta.dot(axis) / lengthSq, 0, 1));
      if (delta.lengthSq() > (g.length + cap.r) ** 2) continue;
      if (brushGuide(g, cap, tie.toArray(),
        (points, pinned) => this._visibility.isVisible(points, pinned),
        points => this._visibility.protectedVertices(points))) {
        this._changed.add(g.id); this._pending.add(g.id);
      }
    }
  }
  _publish() {
    if (!this._pending.size) return;
    this.onEdit?.([...this._pending]); this._pending.clear();
  }
  finishEditing(reason = 'finish') {
    if (!this.active) return [];
    // Mark inactive before releasePointerCapture can synchronously re-enter.
    this.active = false;
    this._sampler.finish(); this._publish();
    const ids = [...this._changed], pointer = this._pointer;
    this._pointer = null; this._sampler = null;
    this.viewer.controls.enabled = this._controlsEnabled;
    if (this._canvas.hasPointerCapture?.(pointer)) this._canvas.releasePointerCapture(pointer);
    Object.assign(this.cursor.style, {borderColor: '#f4cf6b', background: 'transparent'});
    this.onStrokeEnd?.(ids); this.onStateChange?.(reason);
    return ids;
  }
  dispose() {
    this.finishEditing('dispose'); this.enabled = false;
    this._listeners.forEach(off => off()); this._listeners = [];
    this._offCamera?.(); this.cursor.remove();
  }
}

