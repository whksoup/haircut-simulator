import * as THREE from 'three';
import { RayBrushTool } from './rayBrushTool.js';
import { createSnappedBrushFrame, mapRayToBrushPlane } from '../scene/snappedBrushFrame.js';
import { SnappedBrushCylinder } from '../debug/snappedBrushCylinder.js';

/** Isolated experiment: heading snaps around head-local Y; camera tilt and
 * actual-camera head visibility remain unchanged. Shared lifecycle/solver is
 * inherited from the ordinary ray brush, with a frozen mouse workplane. */
export class SnappedBrushTool extends RayBrushTool {
  constructor(options) {
    super(options);
    this.cylinder = new SnappedBrushCylinder();
    this.viewer.scene.add(this.cylinder);
    this.strokeFrame = null; this.status = 'Hold and drag: heading snaps to 45 degrees; tilt stays unchanged.';
    this._needsReanchor = false;
  }
  _down(event) {
    if (event.button !== 0) { super._down(event); return; }
    if (!this.enabled || !this.canStyle() || this.active || event.isPrimary === false) return;
    try { createSnappedBrushFrame({mesh: this.mesh, camera: this.viewer.camera}); }
    catch (error) { this.status = error.message; this.cylinder.visible = false; this.onStateChange?.(); return; }
    super._down(event);
    if (!this.active) return;
    this.strokeFrame = createSnappedBrushFrame({mesh: this.mesh, camera: this._camera});
    const offset = Math.abs(this._sphere.center.clone().sub(this.strokeFrame.center).dot(this.strokeFrame.axis));
    this._extent = this._sphere.radius + offset + this._strokeRadius * 2;
    this._maxPlaneDistance = Math.max(this._extent, this._sphere.radius, this._strokeRadius) * 8;
    this._needsReanchor = false; this._lastAxis = null;
    const pose = this._pose([event.clientX, event.clientY]);
    if (!pose) { this.finishEditing('invalid plane intersection'); return; }
    this._lastAxis = pose.centerLocal;
    this.status = 'Brushing on the frozen heading plane.';
    this.onStateChange?.();
  }
  _pose([x, y]) {
    if (!this.strokeFrame) return null;
    const r = this._rect;
    this._raycaster.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1, 1-(y-r.top)/r.height*2), this._camera);
    const center = mapRayToBrushPlane(this._raycaster.ray, this.strokeFrame, this._maxPlaneDistance);
    if (!center) {
      this.cylinder.visible = false; this._lastAxis = null; this._needsReanchor = true;
      this.status = 'Pointer ray does not safely intersect the brush plane.';
      return null;
    }
    const aWorld = center.clone().addScaledVector(this.strokeFrame.axis, -this._extent);
    const bWorld = center.clone().addScaledVector(this.strokeFrame.axis, this._extent);
    this.cylinder.setPose(aWorld, bWorld, this._strokeRadius);
    this.cylinder.visible = this.active;
    return {a: aWorld.clone().applyMatrix4(this._inverse), b: bWorld.clone().applyMatrix4(this._inverse),
      centerLocal: center.clone().applyMatrix4(this._inverse)};
  }
  _sample(point) {
    const pose = this._pose(point);
    if (!pose) return;
    if (this._needsReanchor) { this._needsReanchor = false; this._lastAxis = pose.centerLocal; return; }
    const tie = this._lastAxis ? pose.centerLocal.clone().sub(this._lastAxis) : new THREE.Vector3(1, 0, 0);
    this._lastAxis = pose.centerLocal;
    if (tie.lengthSq() < 1e-16) return;
    tie.normalize(); this._applyCapsule(pose.a, pose.b, tie);
  }
  _move(event) {
    super._move(event);
    // Display follows the actual held pointer, even between fixed authoring
    // samples. It is the same frozen-axis capsule, never a cosmetic hair force.
    if (this.active && event.pointerId === this._pointer) this._pose([event.clientX, event.clientY]);
  }
  finishEditing(reason = 'finish') {
    if (this.cylinder) this.cylinder.visible = false;
    if (this.status === 'Brushing on the frozen heading plane.') {
      this.status = 'Hold and drag: heading snaps to 45 degrees; tilt stays unchanged.';
    }
    const ids = super.finishEditing(reason);
    // Base finish drains remaining samples; hide AFTER that drain as well.
    if (this.cylinder) this.cylinder.visible = false;
    this.strokeFrame = null;
    this.onStateChange?.();
    return ids;
  }
  dispose() {
    super.dispose(); this.cylinder.dispose();
  }
}


