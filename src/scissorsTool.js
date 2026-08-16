/**
 * scissorsTool.js — plan item 5. A blade you place on the head and drag through
 * the hair; everything past it comes off.
 *
 * The stroke bookkeeping — snapshots, the running minimum, the abort restore —
 * lives in cutSession.js, which has no Three.js and is therefore testable
 * without a viewport (`cut_test.mjs` drives a whole stroke headlessly). What is
 * left here is placement, the gizmo, and turning a pose into a mesh-local
 * capsule. Same split as guideLengthAudit.js vs CombTool, for the same reason:
 * a check reachable only by constructing a gizmo is a check nobody runs.
 *
 * ═══ WHY THIS FILE IS A THIRD THE SIZE OF combTool.js ═══
 *
 * Not because it is less careful. Because A CUT IS MONOTONE and a comb stroke
 * is not, and almost every hard-won mechanism in CombTool exists to manage that
 * difference.
 *
 * The comb ACCUMULATES: each sub-step displaces hair a little further, so the
 * result depends on how many sub-steps ran, which is why it needs a fixed
 * spatial cadence, a banked remainder, and a settle() to spend it. Get that
 * wrong and the same drag gives different hair on a fast machine than a slow
 * one — measured at ~0.13 strand lengths of divergence before the cadence
 * landed.
 *
 * The scissors COMPOSE BY MINIMUM: `cut = min(cut, thisPose)`. Minimum is
 * associative, commutative and idempotent, so the result depends only on the
 * SET of poses the blade passed through, not on their order, their count, or
 * how finely the path was sampled. Framerate independence is not something
 * this tool has to achieve; it is something it cannot fail at. There is
 * therefore no cadence, no banked remainder, and no settle — sub-stepping here
 * is purely anti-tunnelling, and over-sampling is free rather than harmful.
 *
 * That is also why cutting is genuinely idempotent where combing is only a
 * contraction: dragging the blade back out restores nothing, which is both the
 * mathematically stable answer and what scissors actually do.
 *
 * ═══ THE PREVIEW AND THE COMMIT ARE THE SAME CODE ═══
 *
 * The plan proposed a cheap approximate preview during the drag (shrink the
 * blended length, no resample) and a real resample on stroke end. That split
 * exists to avoid resampling per frame — but resampling is only dangerous
 * because it is DIFFUSIVE, and it is only diffusive when applied to its own
 * output. Applied to a PRISTINE SNAPSHOT it is a pure function of the cut
 * fraction: scrub the blade in and out and the strand returns bit-for-bit.
 *
 * So the session keeps a pristine snapshot — each touched guide's points and
 * length as they were when the stroke opened — and every frame recomputes the
 * whole cut from that. One code path, so preview and commit cannot disagree, and no
 * accumulation however long the drag runs. The cost is an equal-chord
 * bisection per touched guide per event, which is single-digit microseconds
 * (see strandResample.js).
 *
 * The approximate preview would also have been WRONG in a way that matters:
 * shrinking `length` without resampling compresses the whole normalised curve,
 * so a curl would tighten as you trimmed it. You would be previewing a
 * different haircut from the one you were about to commit.
 *
 * ═══ THE CUT FRACTION IS MEASURED AGAINST THE PRISTINE STRAND ═══
 *
 * Every pose tests the blade against the SNAPSHOT geometry, not the live
 * (already-shortened) geometry. That sounds wrong and is exactly right: a cut
 * only ever removes a suffix, so the live strand is a prefix of the pristine
 * one, and any entry point beyond the current cut is discarded by the minimum
 * anyway. Testing the pristine strand gives the same answer and keeps every
 * fraction measured against the same denominator — which is what makes the
 * minimum meaningful at all.
 *
 * ═══ WHAT IT DELIBERATELY DOES NOT DO ═══
 *
 *   NO SHADER PUSHOUT. CombTool publishes its capsule so the fragment path can
 *   clamp render strands out of the bar, because a bar that hair visibly
 *   passes through reads as broken. A blade is different: hair is SUPPOSED to
 *   end at it, so there is nothing to push and a pushout would part the hair
 *   around a tool whose whole job is to remove it.
 *
 *   NO TANGENT RE-AUTHORING. A cut changes how long A is, not how it hangs —
 *   see #6d's corollary. The frame is untouched, which is also what lets the
 *   pristine snapshot store only points and length.
 *
 *   NO REBIND. Roots do not move, so which guides a render strand blends is
 *   unchanged. `onEdit` rewrites texture rows and nothing else, exactly as the
 *   comb's does.
 *
 * ═══ MINIMUM LENGTH IS LOAD-BEARING, NOT COSMETIC ═══
 *
 * #3's loader rejects a guide with `length <= 0`, and history's structural
 * restore path runs through `GuideStore.fromJSON`. A cut that took a strand to
 * zero would therefore make its own undo throw. `minLength` clamps it, and
 * shaving to the scalp is #7's remove-guide operation rather than a cut of
 * length zero — those are different edits and only one of them is reversible
 * by growing it back.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CutSession, DEFAULT_MIN_LENGTH } from './cutSession.js';

const UNIT_Y  = new THREE.Vector3(0, 1, 0);
const MIN_LEN = 0.005;
const MAX_SUBS = 64;
/** Anti-tunnelling only. Finer is free — see the header on monotonicity. */
const SUBSTEP = 0.5;   // fraction of the blade radius per interpolated pose

export class ScissorsTool {
  /**
   * @param {object} o
   * @param {import('./viewer.js').Viewer} o.viewer
   * @param {THREE.Mesh} o.mesh                        the groomTarget
   * @param {import('./guides.js').GuideStore} o.guides
   * @param {(ids:number[]) => void} o.onEdit
   * @param {() => void} [o.onStrokeBegin]
   * @param {(ids:number[]) => void} [o.onStrokeEnd]
   */
  constructor({ viewer, mesh, guides, onEdit, onStrokeBegin = null, onStrokeEnd = null }) {
    this.viewer = viewer;
    this.mesh   = mesh;
    this.guides = guides;
    this.onEdit = onEdit;
    this.onStrokeBegin = onStrokeBegin;
    this.onStrokeEnd   = onStrokeEnd;

    this.enabled = false;
    this.hasBar  = false;

    // --- the blade ------------------------------------------------------------
    // Thin by default: the radius is the cut's fuzziness, and a blade you can
    // see the far side of is easier to aim than a fat one. Same capsule the
    // comb uses, for the reasons in strandCut.js — two clicks give an axis and
    // a length with no roll to decide.
    this.radius = 0.012;
    this.length = 0.25;

    /** @type {Set<number>|null} facets the blade is confined to, or null. */
    this.mask = null;

    // --- stroke state ---------------------------------------------------------
    // All of it, including the abort restore, lives in the session.
    this.session = new CutSession({ guides, minLength: DEFAULT_MIN_LENGTH });
    this._inMaskBound = (g) => this._inMask(g);
    /** Ids shortened by the CURRENT event, for one onEdit call per event. The
     *  stroke-wide union lives in the session. */
    this._editedIds = new Set();

    // --- placement ------------------------------------------------------------
    this._placing = false;
    this._haveP0  = false;
    this._p0 = new THREE.Vector3();
    this._n0 = new THREE.Vector3();
    this._hitP = new THREE.Vector3();
    this._hitN = new THREE.Vector3();
    this._inP  = new THREE.Vector3();
    this._inN  = new THREE.Vector3();

    // --- scratch --------------------------------------------------------------
    this._ray     = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._invMesh = new THREE.Matrix4();
    this._scale   = new THREE.Vector3();
    this._meshScale = 1;

    this._prevA = new THREE.Vector3();
    this._prevB = new THREE.Vector3();
    this._curA  = new THREE.Vector3();
    this._curB  = new THREE.Vector3();
    this._stepA = new THREE.Vector3();
    this._stepB = new THREE.Vector3();
    this._a    = new THREE.Vector3();
    this._ab   = new THREE.Vector3();
    this._o    = new THREE.Vector3();
    this._r    = new THREE.Vector3();
    this._tmp  = new THREE.Vector3();
    this._axis = new THREE.Vector3();

    this._cap = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 };

    // --- visuals --------------------------------------------------------------
    this.object = new THREE.Group();
    this.object.name = 'ScissorBlade';
    this.object.visible = false;
    this._fill  = makeBladeFill();
    this._spine = makeSpine();
    this.object.add(this._fill, this._spine);
    viewer.scene.add(this.object);
    this._rebuildGeometry();

    this._marker = makeMarker();
    this._marker.visible = false;
    viewer.scene.add(this._marker);

    this._ghost = makeGhost();
    this._ghost.visible = false;
    viewer.scene.add(this._ghost);

    // --- gizmo ----------------------------------------------------------------
    this._tc = new TransformControls(viewer.camera, viewer.renderer.domElement);
    this._tc.setMode('translate');
    this._tc.setSpace('local');
    this._tc.attach(this.object);
    this._tcHelper = typeof this._tc.getHelper === 'function' ? this._tc.getHelper() : this._tc;
    viewer.scene.add(this._tcHelper);
    this._tcHelper.visible = false;
    this._tc.enabled = false;

    this._onDraggingChanged = (e) => {
      viewer.controls.enabled = !e.value;
      if (e.value) { this._beginStroke(); this._latchPose(); }
      else {
        // No settle(). The comb needs one because its cadence banks an unspent
        // remainder; a cut has nothing to spend — the final pose was already
        // applied by the last objectChange, and re-applying it is a no-op by
        // idempotence. See the header.
        this._endStroke();
      }
    };
    this._onObjectChange = this._onObjectChange.bind(this);
    this._tc.addEventListener('dragging-changed', this._onDraggingChanged);
    this._tc.addEventListener('objectChange', this._onObjectChange);

    this._onDown    = this._onDown.bind(this);
    this._onMove    = this._onMove.bind(this);
    this._onWheel   = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  // --- lifecycle -------------------------------------------------------------

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const el = this.viewer.renderer.domElement;
    el.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    if (this.hasBar) this._enableGizmo();
    else             this.beginPlacement();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._abortStroke();
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    this._cancelPlacement();
    this._disableGizmo();
    this.viewer.controls.enabled = true;
  }

  dispose() {
    this.disable();
    this._tc.removeEventListener('dragging-changed', this._onDraggingChanged);
    this._tc.removeEventListener('objectChange', this._onObjectChange);
    this._tc.detach();
    this._tc.dispose();
    this._tcHelper.parent?.remove(this._tcHelper);
    for (const o of [this.object, this._marker, this._ghost]) o.parent?.remove(o);
    for (const m of [this._fill, this._spine, this._marker, this._ghost]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }

  /** Remove the blade. Unlike the comb there is no shader pose to release. */
  clearBar() {
    if (!this.hasBar) return false;
    this._cancelPlacement();
    this._disableGizmo();
    this.hasBar = false;
    this.object.visible = false;
    return true;
  }

  // --- mask ------------------------------------------------------------------
  // Same contract as CombTool.setMask: an owned copy, instrument state rather
  // than model state, tested before the geometric reject so a masked stroke is
  // strictly cheaper. A masked blade is even more worth having than a masked
  // comb, because the mistake it prevents is destructive.

  setMask(ids) {
    const next = ids ? new Set(ids) : null;
    this.mask = next && next.size ? next : null;
    return this.mask ? this.mask.size : 0;
  }

  clearMask() { return this.setMask(null); }
  get maskSize() { return this.mask ? this.mask.size : 0; }
  _inMask(g) { return this.mask ? this.mask.has(g.facetId) : true; }

  get isPlacing() { return this._placing; }

  /** Proxied so the panel can bind straight to the tool while the value lives
   *  where the cut actually happens. */
  get minLength()  { return this.session.minLength; }
  set minLength(v) { this.session.minLength = Math.max(v, 1e-6); }

  cancelPlacement() {
    const was = this._placing;
    this._cancelPlacement();
    return was;
  }

  // --- placement -------------------------------------------------------------

  beginPlacement() {
    if (!this.enabled) return false;
    this._disableGizmo();
    this._placing = true;
    this._haveP0  = false;
    this._marker.visible = false;
    this._ghost.visible  = false;
    const el = this.viewer.renderer.domElement;
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointermove', this._onMove);
    return true;
  }

  _cancelPlacement() {
    if (!this._placing) return;
    this._placing = false;
    this._haveP0  = false;
    this._marker.visible = false;
    this._ghost.visible  = false;
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointermove', this._onMove);
    if (this.hasBar) this._enableGizmo();
  }

  /**
   * Build the blade from two surface points.
   *
   * STANDOFF IS LARGER THAN THE COMB'S, and deliberately so. The comb lifts by
   * one radius so it is born tangent to the scalp, touching nothing. A blade
   * born tangent to the scalp would be born at the roots — the first drag would
   * shave the head. It is lifted clear of the local hair length instead, so it
   * appears above the hair and has to be pushed DOWN into it. The destructive
   * tool does not get to start already touching.
   */
  placeFromPoints(p0, n0, p1, n1) {
    const q0 = this._inP.copy(p0);
    const m0 = this._inN.copy(n0);
    const q1 = this._tmp.copy(p1);
    const m1 = this._r.copy(n1);

    this._axis.subVectors(q1, q0);
    const len = this._axis.length();
    if (len < MIN_LEN) return false;
    this._axis.multiplyScalar(1 / len);

    const up = this._o.copy(m0).add(m1).normalize();
    up.addScaledVector(this._axis, -up.dot(this._axis));
    if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
    else                      up.normalize();

    this.length = len;
    this.object.position.copy(q0).add(q1).multiplyScalar(0.5)
      .addScaledVector(up, this.radius + this._localHairLength());
    this.object.quaternion.setFromUnitVectors(UNIT_Y, this._axis);
    this.object.visible = true;
    this.object.updateMatrixWorld(true);

    this.hasBar = true;
    this._rebuildGeometry();
    this._latchPose();
    this._cancelPlacement();
    return true;
  }

  /** Longest guide in the groom, in WORLD units — the standoff above. Cheap
   *  enough at a few hundred guides, and it only runs on placement. */
  _localHairLength() {
    let max = 0;
    for (const g of this.guides.guides.values()) if (g.length > max) max = g.length;
    this.mesh.updateMatrixWorld();
    return max * (this.mesh.getWorldScale(this._scale).x || 1);
  }

  placeAtSurfacePoint(point, normal) {
    const camDir = this.viewer.camera.getWorldDirection(new THREE.Vector3());
    let axis = new THREE.Vector3().crossVectors(normal, camDir);
    if (axis.lengthSq() < 1e-8) axis = new THREE.Vector3().crossVectors(normal, UNIT_Y);
    axis.normalize();
    const half = new THREE.Vector3().copy(axis).multiplyScalar(this.length * 0.5);
    const a = new THREE.Vector3().copy(point).sub(half);
    const b = new THREE.Vector3().copy(point).add(half);
    return this.placeFromPoints(a, normal, b, normal);
  }

  // --- pointer ---------------------------------------------------------------

  _setRay(event) {
    const canvas = this.viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._pointer, this.viewer.camera);
  }

  _hitHead(event, outPoint, outNormal) {
    this._setRay(event);
    const hits = this._ray.intersectObject(this.mesh, false);
    if (!hits.length) return false;
    const h = hits[0];
    outPoint.copy(h.point);
    if (h.face) outNormal.copy(h.face.normal).transformDirection(this.mesh.matrixWorld).normalize();
    else        outNormal.set(0, 1, 0);
    return true;
  }

  _onDown(event) {
    if (event.button !== 0 || !this._placing) return;
    if (!this._hitHead(event, this._hitP, this._hitN)) return;
    if (!this._haveP0) {
      this._p0.copy(this._hitP);
      this._n0.copy(this._hitN);
      this._haveP0 = true;
      this._marker.position.copy(this._p0);
      this._marker.scale.setScalar(Math.max(this.radius, 0.01));
      this._marker.visible = true;
      return;
    }
    this.placeFromPoints(this._p0, this._n0, this._hitP, this._hitN);
  }

  _onMove(event) {
    if (!this._placing || !this._haveP0) return;
    if (!this._hitHead(event, this._hitP, this._hitN)) { this._ghost.visible = false; return; }
    const pos = this._ghost.geometry.attributes.position;
    pos.setXYZ(0, this._p0.x, this._p0.y, this._p0.z);
    pos.setXYZ(1, this._hitP.x, this._hitP.y, this._hitP.z);
    pos.needsUpdate = true;
    this._ghost.visible = true;
  }

  /** Wheel = blade thickness. No shift-modifier twin: a blade has no strength,
   *  it either reaches a strand or it does not. */
  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.setRadius(this.radius * (event.deltaY > 0 ? 1 / 1.1 : 1.1));
  }

  _onKeyDown(e) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'w': this._tc.setMode('translate'); break;
      case 'e': this._tc.setMode('rotate');    break;
      case 'q': this._tc.setSpace(this._tc.space === 'local' ? 'world' : 'local'); break;
      case 'escape': if (this._placing) this._cancelPlacement(); else return; break;
      default: return;
    }
    e.preventDefault();
  }

  // --- gizmo -----------------------------------------------------------------

  _enableGizmo() {
    if (this._tc.enabled || !this.hasBar) return;
    this._tc.enabled = true;
    this._tcHelper.visible = true;
    this._latchPose();
  }

  _disableGizmo() {
    if (!this._tc.enabled) return;
    this._tc.enabled = false;
    this._tcHelper.visible = false;
    this.viewer.controls.enabled = true;
  }

  setMode(mode) { if (mode !== 'scale') this._tc.setMode(mode); }
  setSpace(sp)  { this._tc.setSpace(sp); }
  setVisible(v) { this.object.visible = v && this.hasBar; }

  setRadius(r) {
    this.radius = THREE.MathUtils.clamp(r, 0.001, 0.2);
    this._rebuildGeometry();
  }

  setLength(l) {
    this.length = THREE.MathUtils.clamp(l, MIN_LEN, 2);
    this._rebuildGeometry();
  }

  _rebuildGeometry() {
    this._fill.geometry.dispose();
    this._fill.geometry = new THREE.CapsuleGeometry(this.radius, this.length, 4, 16);
    const h = this.length * 0.5;
    const pos = this._spine.geometry.attributes.position;
    pos.setXYZ(0, 0, -h, 0);
    pos.setXYZ(1, 0,  h, 0);
    pos.needsUpdate = true;
  }

  // --- pose ------------------------------------------------------------------

  _endpoints(outA, outB) {
    this.object.updateMatrixWorld();
    const m = this.object.matrixWorld;
    this._axis.setFromMatrixColumn(m, 1).normalize();
    this._tmp.setFromMatrixPosition(m);
    const h = this.length * 0.5;
    outA.copy(this._tmp).addScaledVector(this._axis, -h);
    outB.copy(this._tmp).addScaledVector(this._axis,  h);
  }

  _latchPose() { this._endpoints(this._prevA, this._prevB); }

  _prepMesh() {
    this.mesh.updateMatrixWorld();
    this._invMesh.copy(this.mesh.matrixWorld).invert();
    this._meshScale = this.mesh.getWorldScale(this._scale).x || 1;
  }

  /**
   * Sub-step from the last pose to this one and cut at each.
   *
   * NO CADENCE, NO BANKED REMAINDER — unlike CombTool._onObjectChange, and the
   * asymmetry is the whole point of the header. Because the accumulator is a
   * minimum, applying the same pose twice, or sampling the path twice as
   * finely, changes nothing. Sub-steps exist ONLY so a fast drag cannot jump
   * the blade over a strand without touching it, and `ceil` here is safe where
   * in the comb it was a bug.
   */
  _onObjectChange() {
    if (!this.hasBar || !this._tc.enabled) return;
    this._endpoints(this._curA, this._curB);

    const travel = Math.max(
      this._tmp.subVectors(this._curA, this._prevA).length(),
      this._tmp.subVectors(this._curB, this._prevB).length(),
    );
    const steps = Math.min(MAX_SUBS, Math.max(1, Math.ceil(travel / (this.radius * SUBSTEP))));

    this._editedIds.clear();
    this._prepMesh();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._stepA.lerpVectors(this._prevA, this._curA, t);
      this._stepB.lerpVectors(this._prevB, this._curB, t);
      this._cutAt(this._stepA, this._stepB);
    }
    this._flush();
    this._prevA.copy(this._curA);
    this._prevB.copy(this._curB);
  }

  /**
   * Apply one cut at the current pose without moving the blade. The panel
   * button, and the whole interaction for "place it and press cut".
   *
   * Its own stroke when standalone; folds into an open one when it is not.
   */
  cut() {
    if (!this.hasBar) return 0;
    const owns = this._beginStroke();
    this._editedIds.clear();
    this._prepMesh();
    this._endpoints(this._curA, this._curB);
    this._cutAt(this._curA, this._curB);
    const n = this._editedIds.size;
    this._flush();
    this._latchPose();
    if (owns) this._endStroke();
    return n;
  }

  // --- the cut ---------------------------------------------------------------

  /** Cut every in-scope guide against the capsule spanning world A→B. */
  _cutAt(A, B) {
    const cap = this._capsuleFor(A, B);
    for (const id of this.session.applyCapsule(cap, this.mask ? this._inMaskBound : null)) {
      this._editedIds.add(id);
    }
  }

  /** World endpoints → the mesh-local capsule everything downstream wants.
   *  `_prepMesh` must have run. */
  _capsuleFor(A, B) {
    const a = this._a.copy(A).applyMatrix4(this._invMesh);
    const b = this._tmp.copy(B).applyMatrix4(this._invMesh);
    const cap = this._cap;
    cap.ax = a.x; cap.ay = a.y; cap.az = a.z;
    cap.bx = b.x; cap.by = b.y; cap.bz = b.z;
    cap.r  = this.radius / this._meshScale;
    return cap;
  }

  /** The session owns the stroke-wide union; this only reports the pose. */
  _flush() {
    if (!this._editedIds.size) return;
    this.onEdit?.([...this._editedIds]);
  }

  // --- stroke boundary (undo unit) -------------------------------------------

  _beginStroke() {
    if (!this.session.begin()) return false;
    this.onStrokeBegin?.();
    return true;
  }

  _endStroke() {
    if (!this.session.isOpen) return;
    // Nothing to commit: the live guides ARE the commit, and have been since
    // the first pose. end() only releases the snapshots.
    this.onStrokeEnd?.(this.session.end());
  }

  /**
   * Abandon mid-stroke — the tool was switched away or disabled during a drag.
   *
   * UNLIKE THE COMB, THIS RESTORES. See cutSession.js: a half-finished
   * displacement leaves all the hair present, a half-finished cut does not.
   */
  _abortStroke() {
    if (!this.session.isOpen) return;
    const restored = this.session.abort();
    if (restored.length) this.onEdit?.(restored);
    this.onStrokeEnd?.([]);
  }

  // --- diagnostics -----------------------------------------------------------

  /**
   * What would this blade cut right now, without cutting it? Console tool,
   * same role as comb.diagnose(): a blade that correctly does nothing looks
   * exactly like a blade that is broken.
   */
  diagnose() {
    const out = {
      hasBar: this.hasBar,
      radius: this.radius,
      minLength: this.minLength,
      guides: this.guides.guides.size,
      maskedToFacets: this.maskSize || 'none (cuts everywhere)',
    };
    if (!this.hasBar) { out.verdict = 'no blade placed'; console.table(out); return out; }

    this._prepMesh();
    this._endpoints(this._curA, this._curB);
    const cap = this._capsuleFor(this._curA, this._curB);
    const p = this.session.preview(cap, this.mask ? this._inMaskBound : null);

    out.guidesTheBladeMeets = p.meets;
    out.wouldHitMinLength   = p.wouldClamp;
    out.shortestResult      = +p.shortestResult.toFixed(5);
    out.totalLengthRemoved  = +p.lengthRemoved.toFixed(5);
    out.verdict = p.meets === 0
      ? (this.mask ? 'blade meets nothing INSIDE THE MASK — it may be touching hair outside it'
                   : 'blade is not touching any strand at this pose')
      : p.wouldClamp === p.meets ? `all ${p.meets} would clamp to minLength — the blade is at the roots`
      : `would shorten ${p.meets} guide(s)`;
    console.table(out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Visuals. Cool steel rather than the comb's warm blue, because the two tools
// look identical in silhouette and confusing them is destructive in one
// direction only.

function makeBladeFill() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdfe6ee, transparent: true, opacity: 0.3,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.25, 4, 16), mat);
  m.renderOrder = 2;
  return m;
}

function makeSpine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.125, 0, 0, 0.125, 0], 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xff5d5d, transparent: true, opacity: 0.95, depthTest: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 3;
  return l;
}

function makeMarker() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5d5d, depthTest: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
  m.renderOrder = 4;
  return m;
}

function makeGhost() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xff5d5d, transparent: true, opacity: 0.7, depthTest: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 4;
  return l;
}
