/**
 * combTool.js — the comb as a FINITE capsule bar, placed by two clicks on the
 * head and then dragged through the hair with a gizmo.
 *
 * Supersedes the work-plane comb entirely. workPlane.js is deleted.
 *
 * WHY THE BAR REPLACED THE PLANE
 *
 *   THE TOOL IS BOUNDED. The previous comb was an infinite cylinder normal to
 *   the work plane (`depth = Infinity`), so its true extent was invisible and
 *   it reached straight through the skull — hair on the far side of the head
 *   moved when you combed the near side. A capsule between two surface points
 *   is bounded in every direction: what you see is exactly what it touches.
 *
 *   DEPTH IS STILL DECIDED IN ADVANCE, but by two raycasts against the scalp
 *   instead of by parking a construction plane. Two clicks, no gizmo work, and
 *   the result is already in roughly the right place.
 *
 *   THE EJECTION MATH IS UNCHANGED. Distance to the capsule axis, push
 *   (R - d) outward along the radial. Continuous to zero at the wall, no
 *   falloff curve. That part worked; only the source of the axis changed — it
 *   now comes from stored endpoints rather than from the cursor's intersection
 *   with a plane.
 *
 * TWO PROPERTIES THE PREVIOUS HEADER OVERCLAIMED, corrected by measurement:
 *
 *   IDEMPOTENCE DEPENDS ON WHETHER THE BAR IS STILL TOUCHING. Once rootRamp
 *   became inverse mass rather than a push scale (see strandConstraints.js),
 *   the old root-stiffness asymmetry disappeared: a bar that has swept PAST
 *   the hair re-settles to a bitwise-identical result at every rootRamp,
 *   because the probe pass finds no contact and writes nothing. A bar left
 *   RESTING IN the hair is different — collision and length are still in
 *   conflict, so each settle relaxes a bit further (successive deltas 5.7e-3,
 *   3.5e-3, 2.3e-3, 1.6e-3 at rootRamp 1). That is a contraction, not a fixed
 *   point. It converges rather than diverging, which is the property that
 *   matters, but "park the bar and click settle repeatedly" is not a no-op.
 *
 *   FRAMERATE INDEPENDENCE IS NOT FREE — see `_onObjectChange`. Sub-stepping
 *   per event rather than per unit distance made a single stroke diverge by
 *   ~0.13 strand lengths between a 1-event drag and a 37-event drag. The fixed
 *   spatial cadence there brings that to ~1e-15, and it survives the move to
 *   edge collision unchanged.
 *
 * COST, measured: 46µs per gizmo event at 100 guides, 126µs at 400, 305µs at
 * 1000 — roughly 130x headroom at 400 guides and 60fps. It is dominated by the
 * broad-phase reject over ALL guides, not by the solve on the few in contact,
 * which is why `iterations` is nearly free (117µs at 4 vs 119µs at 8). If
 * guide counts ever grow enough for that to bite, the fix is a spatial hash
 * over guide roots, not a cheaper solver.
 *
 * COLLISION IS AGAINST EDGES, NOT CONTROL POINTS. Testing the 9 control points
 * alone let the bar pass between them: with a strand edge about half the bar's
 * diameter, a bar resting in the hair sat 78% buried in the segment it was
 * supposedly pushing (min edge clearance 0.0066 against a radius of 0.03).
 * Every strand EDGE is now tested against the capsule axis as a
 * segment-segment pair and the correction is distributed to both endpoints by
 * barycentric weight. See strandConstraints.js — and note that length
 * preservation is part of the same feature, not an option beside it: with
 * `constrain = 'none'` the same stroke stretches the worst edge by 842% and
 * STILL fails to keep the bar out.
 *
 * WHY A CAPSULE AND NOT A CUBOID
 *
 *   A box is the more comb-like shape, but ejecting to the nearest FACE has a
 *   discontinuity along the interior diagonals: a control point near a corner
 *   flips which way it is pushed under an arbitrarily small movement, which
 *   reads as popping. A capsule has a single well-defined radial everywhere
 *   except exactly on the axis. Cuboid is a later revision, once the
 *   interaction model is known-good and a new artefact can't be confused with
 *   a bad interaction.
 *
 *   A capsule also needs no roll. Two points give an axis and a length, and
 *   that is the complete specification — there is no "which way is the flat
 *   face pointing" question to answer from a camera direction or an averaged
 *   surface normal, which is a real and blind decision with a box.
 *
 * STANDOFF. Both clicked points lie ON the scalp, so a bar centred on them is
 * half-buried and would shove every strand it owns the instant it appeared.
 * The axis is lifted by `radius` along the averaged surface normal at
 * creation, so the bar is born tangent to the scalp, touching nothing.
 *
 * MOTION. The gizmo's `objectChange` drives everything. Each event interpolates
 * from the previous pose to the current one in sub-steps no larger than half a
 * radius and ejects at each — that is anti-tunnelling for translation AND for
 * rotation, which a single swept capsule between endpoints could not express.
 * Every sub-step is itself a positional eject, so the model stays positional:
 * the result is a function of the poses passed through, not of event count.
 *
 * A PARKED BAR DOES NOT EJECT. Below one cadence step of motion the event
 * banks and returns, so a bar sitting still moves nothing and can be left
 * resting in the hair as a prop. The end of every gizmo drag calls `settle()`,
 * which spends the banked remainder at the final pose — so a drag always
 * finishes resolved where the bar actually is. `settle()` is also a UI button,
 * for applying one eject to a bar you have not moved.
 *
 * All capsule maths runs in MESH-LOCAL space: the endpoints and radius are
 * pulled through the inverse mesh matrix once per sub-step, so the
 * per-control-point inner loop is pure arithmetic. Assumes uniform mesh scale.
 *
 * STILL SWITCHED OFF, unchanged from the previous revision — each is a flag,
 * not a deletion:
 *
 *   constrain = 'none'   solveLengths is a FORWARD-ONLY pass from the pinned
 *                        root, so a pushed mid-point rigidly re-lays the chain
 *                        below it and the tip whips. Off, strands elongate
 *                        under repeated strokes and nothing pulls them back —
 *                        expect drift. Set 'length' to restore it exactly.
 *
 *   reauthorTangent = false
 *                        g.points live in the frame spanned by g.normal and
 *                        g.tangent, so re-authoring the tangent ROTATES every
 *                        stored point about the normal. The bar now has a
 *                        stable axis direction, which is a far better flow
 *                        source than the old cursor velocity — worth revisiting
 *                        once the movement reads correctly.
 *
 * THE STROKE IS THE UNDO UNIT. `onEdit` fires many times per gizmo drag and is
 * the wrong granularity for history — nobody wants to press undo forty times
 * to reverse one sweep. `onStrokeBegin` / `onStrokeEnd` bracket the whole
 * drag instead, and onStrokeEnd reports the UNION of every guide touched
 * across it (`_strokeIds`), not just the last sub-step's. A drag that moved
 * nothing reports an empty set and records nothing.
 *
 * `settle()` is its own stroke when called standalone (the UI button), and is
 * NOT one when called from drag-end, where it is the tail of a stroke already
 * open. `_inStroke` is what keeps those apart.
 *
 * Tool settings — radius, length, strength, rootRamp, iterations — are
 * deliberately outside history. They are properties of the instrument, not of
 * the haircut; undoing a comb sweep should not silently resize your comb.
 *
 * Wiring (main.js):
 *   const comb = new CombTool({ viewer, mesh, guides, onEdit });
 *   comb.enable();                       // begins placement if no bar exists
 *   comb.beginPlacement();               // re-place: next two clicks rebuild it
 *   // onEdit(ids) → renderer.setGuides(ids): rewrites texture rows only.
 *   // NEVER rebind from here — see the gpuHairR3.js header.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { SHAPE_POINTS, SHAPE_REST } from './strandShape.js';
import { buildInvMass, solveStrand, closestPtSegmentSegment } from './strandConstraints.js';

const UNIT_Y   = new THREE.Vector3(0, 1, 0);
const MIN_LEN  = 0.005;
const MAX_SUBS = 64;
const CADENCE  = 0.25;   // eject every (radius * CADENCE) of path travelled

export class CombTool {
  /**
   * @param {object} o
   * @param {import('./viewer.js').Viewer} o.viewer
   * @param {THREE.Mesh} o.mesh                        the groomTarget
   * @param {import('./guides.js').GuideStore} o.guides
   * @param {(ids:number[]) => void} o.onEdit
   * @param {(pose:{a:THREE.Vector3,b:THREE.Vector3,radius:number}|null) => void} [o.onPose]
   *        Mesh-local capsule for the shader-side pushout. See _pushPose.
   * @param {() => void} [o.onStrokeBegin]
   *        A drag (or a standalone settle) is about to edit guides. The undo
   *        boundary opens here — see the header.
   * @param {(ids:number[]) => void} [o.onStrokeEnd]
   *        That edit is finished; `ids` is every guide touched across the
   *        whole stroke. Empty means nothing moved.
   */
  constructor({
    viewer, mesh, guides, onEdit, onPose = null,
    onStrokeBegin = null, onStrokeEnd = null,
  }) {
    this.viewer = viewer;
    this.mesh   = mesh;
    this.guides = guides;
    this.onEdit = onEdit;
    this.onPose = onPose;
    this.onStrokeBegin = onStrokeBegin;
    this.onStrokeEnd   = onStrokeEnd;

    this.enabled = false;

    // --- the bar --------------------------------------------------------------
    // Local frame: axis along +Y (matching CapsuleGeometry), origin at the
    // midpoint. `radius` and `length` are authoritative; the geometry is
    // rebuilt from them. Gizmo SCALE is deliberately unavailable — a scaled
    // object would make the capsule maths lie about its own dimensions.
    this.radius   = 0.05;   // world units
    this.length   = 0.25;   // world units, axis length between the cap centres
    this.strength = 1.0;    // 1 = solid wall, <1 = spongy
    this.rootRamp = 1.0;    // along-strand compliance exponent; 0 = rigid drag

    // Length is ON by default now. It is not optional decoration: a collision
    // correction with no length constraint just stretches the strand, and the
    // longer edges phase through the bar more easily next stroke. See the
    // strandConstraints.js header.
    this.constrain       = 'length';  // 'length' | 'none'
    // 8 rather than 4: measured cost is dominated by the broad-phase reject
    // over all guides, not by the solve on the few in contact (117µs/event at
    // 4 iterations vs 119µs at 8, 400 guides), while residual stretch under
    // contact drops from 1.5% to 0.07%. Iterations are effectively free here.
    this.iterations      = 8;         // PBD sweeps per sub-step
    this.reauthorTangent = false;

    this.hasBar = false;

    // --- placement state ------------------------------------------------------
    this._placing = false;
    this._p0      = new THREE.Vector3();
    this._n0      = new THREE.Vector3();
    this._haveP0  = false;
    // Dedicated hit scratch. NOT _tmp/_axis: those are reused inside
    // placeFromPoints, and passing them in as arguments would let the callee
    // overwrite its own inputs.
    this._hitP    = new THREE.Vector3();
    this._hitN    = new THREE.Vector3();
    this._inP     = new THREE.Vector3();
    this._inN     = new THREE.Vector3();

    // --- scratch --------------------------------------------------------------
    this._ray     = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this._invMesh   = new THREE.Matrix4();
    this._meshScale = 1;
    this._scale     = new THREE.Vector3();

    this._prevA = new THREE.Vector3();   // world endpoints, previous pose
    this._prevB = new THREE.Vector3();
    this._curA  = new THREE.Vector3();   // world endpoints, current pose
    this._curB  = new THREE.Vector3();
    this._stepA = new THREE.Vector3();
    this._stepB = new THREE.Vector3();

    this._a        = new THREE.Vector3();  // capsule start,  mesh-local
    this._ab       = new THREE.Vector3();  // capsule vector, mesh-local
    this._fallback = new THREE.Vector3();  // eject dir for on-axis points
    this._p        = new THREE.Vector3();
    this._o        = new THREE.Vector3();
    this._r        = new THREE.Vector3();
    this._tmp      = new THREE.Vector3();
    this._axis     = new THREE.Vector3();

    this._editedIds = new Set();

    // Undo unit. `_editedIds` is cleared per gizmo event; `_strokeIds` is the
    // union across the whole drag, which is what history needs.
    this._strokeIds = new Set();
    this._inStroke  = false;

    // --- solver working set ---------------------------------------------------
    // Guides store NORMALISED local-frame polylines, but the comb lives in
    // mesh-local space. Rather than round-trip every control point per test,
    // each guide is lifted into this scratch buffer once, solved in mesh-local
    // space where the capsule already is, and written back. That is also what
    // makes the length constraint meaningful: rest length is a real distance.
    this._local   = new Float64Array(SHAPE_POINTS * 3);
    this._invMass = buildInvMass(SHAPE_POINTS, this.rootRamp);
    this._invMassFor = this.rootRamp;
    this._cap = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 };
    this._tie = [0, 0, 1];
    this._motion = new THREE.Vector3();   // world travel dir of the last sub-step

    // --- visuals --------------------------------------------------------------
    this.object = new THREE.Group();
    this.object.name = 'CombBar';
    this.object.visible = false;
    this._fill = makeCapsuleFill();
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

    // three moved the gizmo's renderable out of the controller itself around
    // r169; support both so this doesn't hard-fail on a version bump.
    this._tcHelper = typeof this._tc.getHelper === 'function' ? this._tc.getHelper() : this._tc;
    viewer.scene.add(this._tcHelper);
    this._tcHelper.visible = false;
    this._tc.enabled = false;

    this._onDraggingChanged = (e) => {
      viewer.controls.enabled = !e.value;
      // Drag START: latch, so the first objectChange interpolates from the
      // real pose rather than a stale one.
      // Drag END: settle, so the sub-δ remainder banked by the cadence is
      // resolved and the bar always finishes consistent with where it sits.
      // The drag is also the undo unit. settle() below runs INSIDE the stroke
      // opened here, so it must not open one of its own — see _beginStroke.
      if (e.value) { this._beginStroke(); this._latchPose(); }
      else         { this.settle(); this._endStroke(); }
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
    // Switching tools mid-drag would otherwise leave the stroke open and its
    // pre-capture pinned in history forever.
    this._abortStroke();
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
    this._cancelPlacement();
    this._disableGizmo();
    this.viewer.controls.enabled = true;
  }

  /**
   * Remove the bar entirely: no gizmo, no geometry, no shader pushout.
   *
   * The counterpart to beginPlacement, and until now missing — a bar could be
   * created and re-placed but never actually got rid of, so a parked bar sat
   * in the scene occluding the hair with no way to dismiss it short of
   * reloading. Pushing a null pose matters as much as hiding the mesh: the
   * shader clamps every strand out of the capsule from `uCombA/B/R`
   * independently of anything the CPU solve did, so a bar that is merely
   * invisible still parts the hair around itself.
   */
  clearBar() {
    if (!this.hasBar) return false;
    this._cancelPlacement();
    this._disableGizmo();
    this.hasBar = false;
    this.object.visible = false;
    this._pushPose();        // null pose — releases the shader-side pushout
    return true;
  }

  /** True while waiting for the two placement clicks. */
  get isPlacing() { return this._placing; }

  /** Public cancel for an in-progress two-click placement. */
  cancelPlacement() {
    const was = this._placing;
    this._cancelPlacement();
    return was;
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

  // --- placement -------------------------------------------------------------

  /** Next two clicks on the head define the bar. Cancels any bar in progress. */
  beginPlacement() {
    if (!this.enabled) return;
    this._disableGizmo();
    this._placing = true;
    this._haveP0  = false;
    this._marker.visible = false;
    this._ghost.visible  = false;
    const el = this.viewer.renderer.domElement;
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointermove', this._onMove);
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
   * Build the bar from two world points and their surface normals. The axis is
   * lifted by `radius` along the averaged normal so the bar is born tangent to
   * the scalp and touching nothing — see the header.
   */
  placeFromPoints(p0, n0, p1, n1) {
    // Copy first: callers legitimately pass in scratch vectors that this
    // method is about to write through.
    const q0 = this._inP.copy(p0);
    const m0 = this._inN.copy(n0);
    const q1 = this._p.copy(p1);
    const m1 = this._r.copy(n1);

    this._axis.subVectors(q1, q0);
    const len = this._axis.length();
    if (len < MIN_LEN) return false;
    this._axis.multiplyScalar(1 / len);

    const up = this._tmp.copy(m0).add(m1).normalize();
    // Orthogonalise the lift against the axis: lifting along a component that
    // runs down the bar just slides it, which is not what standoff means.
    up.addScaledVector(this._axis, -up.dot(this._axis));
    if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
    else                      up.normalize();

    this.length = len;
    this.object.position.copy(q0).add(q1).multiplyScalar(0.5)
      .addScaledVector(up, this.radius);
    this.object.quaternion.setFromUnitVectors(UNIT_Y, this._axis);
    this.object.visible = true;
    this.object.updateMatrixWorld(true);

    this.hasBar = true;
    this._rebuildGeometry();
    this._latchPose();
    this._pushPose();
    this._cancelPlacement();
    return true;
  }

  /**
   * Drop a bar at one surface point: centred there, lying tangent to the scalp
   * and across the view. The fallback for "put a comb here" when you don't want
   * to click twice.
   */
  placeAtSurfacePoint(point, normal) {
    const camDir = this.viewer.camera.getWorldDirection(new THREE.Vector3());
    let axis = new THREE.Vector3().crossVectors(normal, camDir);
    if (axis.lengthSq() < 1e-8) axis = new THREE.Vector3().crossVectors(normal, UNIT_Y);
    axis.normalize();
    const half = this._tmp.copy(axis).multiplyScalar(this.length * 0.5);
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

  /** First hit on the head, as { point, normal } in world space, or null. */
  _hitHead(event, outPoint, outNormal) {
    this._setRay(event);
    const hits = this._ray.intersectObject(this.mesh, false);
    if (!hits.length) return false;
    const h = hits[0];
    outPoint.copy(h.point);
    if (h.face) {
      outNormal.copy(h.face.normal).transformDirection(this.mesh.matrixWorld).normalize();
    } else {
      outNormal.set(0, 1, 0);
    }
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
      this._marker.scale.setScalar(this.radius);
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

  /** Wheel = radius, Shift+wheel = strength. Length is a slider; it's not a
   *  quantity you adjust mid-gesture the way radius is. */
  _onWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    const f = event.deltaY > 0 ? 1 / 1.1 : 1.1;
    if (event.shiftKey) {
      this.strength = THREE.MathUtils.clamp(this.strength * f, 0.05, 1);
    } else {
      this.setRadius(this.radius * f);
    }
  }

  _onKeyDown(e) {
    if (e.target instanceof HTMLInputElement) return;
    // The axis hotkeys are bare letters, and one of them is 'z'. Without this
    // guard Ctrl/Cmd+Z would isolate the Z axis on its way to the undo
    // handler — and preventDefault() below would eat the browser's own undo
    // in any text field that bubbled here.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'w': this._tc.setMode('translate'); break;
      case 'e': this._tc.setMode('rotate');    break;
      case 'q': this._tc.setSpace(this._tc.space === 'local' ? 'world' : 'local'); break;
      case 'x': this._isolate('X'); break;
      case 'y': this._isolate('Y'); break;
      case 'z': this._isolate('Z'); break;
      case 'escape':
        if (this._placing) this._cancelPlacement();
        else this._isolate(null);
        break;
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

  setMode(mode)  { if (mode !== 'scale') this._tc.setMode(mode); }
  setSpace(sp)   { this._tc.setSpace(sp); }
  setVisible(v)  { this.object.visible = v && this.hasBar; this._pushPose(); }

  setSnap({ translate = null, rotateDeg = null } = {}) {
    this._tc.translationSnap = translate || null;
    this._tc.rotationSnap    = rotateDeg ? THREE.MathUtils.degToRad(rotateDeg) : null;
  }

  setRadius(r) {
    this.radius = THREE.MathUtils.clamp(r, 0.002, 0.4);
    this._rebuildGeometry();
    this._pushPose();
  }

  setLength(l) {
    this.length = THREE.MathUtils.clamp(l, MIN_LEN, 2);
    this._rebuildGeometry();
    this._pushPose();
  }

  _rebuildGeometry() {
    this._fill.geometry.dispose();
    this._fill.geometry = new THREE.CapsuleGeometry(this.radius, this.length, 6, 20);
    const h = this.length * 0.5;
    const pos = this._spine.geometry.attributes.position;
    pos.setXYZ(0, 0, -h, 0);
    pos.setXYZ(1, 0,  h, 0);
    pos.needsUpdate = true;
  }

  // --- pose ------------------------------------------------------------------

  /** World endpoints of the axis (cap centres) into out vectors. */
  _endpoints(outA, outB) {
    this.object.updateMatrixWorld();
    const m = this.object.matrixWorld;
    this._axis.setFromMatrixColumn(m, 1).normalize();  // local +Y in world
    this._tmp.setFromMatrixPosition(m);
    const h = this.length * 0.5;
    outA.copy(this._tmp).addScaledVector(this._axis, -h);
    outB.copy(this._tmp).addScaledVector(this._axis,  h);
  }

  /** Record the current pose as the "previous" one, without ejecting. */
  _latchPose() {
    this._endpoints(this._prevA, this._prevB);
  }

  /**
   * Publish the capsule in MESH-LOCAL space for the render-side pushout.
   *
   * Guides being clear of the bar is not sufficient: a render strand blends its
   * 3 nearest guides, so if those guides straddle the bar the blend dips
   * through it. No amount of CPU guide work fixes that — it is an artefact of
   * reconstruction, not of the guide solve — so the shader clamps each vertex
   * out of the same capsule. Cosmetic only; guides remain authoritative.
   *
   * radius 0 means "no bar", which the shader treats as disabled.
   */
  _pushPose() {
    if (!this.onPose) return;
    if (!this.hasBar || !this.object.visible) { this.onPose(null); return; }
    this.mesh.updateMatrixWorld();
    this._invMesh.copy(this.mesh.matrixWorld).invert();
    const scale = this.mesh.getWorldScale(this._scale).x || 1;
    this._endpoints(this._curA, this._curB);
    this.onPose({
      a: this._curA.clone().applyMatrix4(this._invMesh),
      b: this._curB.clone().applyMatrix4(this._invMesh),
      radius: this.radius / scale,
    });
  }

  /** One collision projection at the current pose, no motion. UI button. */
  settle() {
    if (!this.hasBar) return;
    // Standalone (the UI button) this is a whole edit and owns its own undo
    // entry; called from drag-end it is the tail of a stroke already open and
    // must fold into it. _beginStroke tells us which case we're in.
    const owns = this._beginStroke();
    this._endpoints(this._curA, this._curB);
    this._motion.set(0, 0, 0);          // stationary: tie-break falls back
    this._editedIds.clear();
    this._prepMesh();
    this._ejectSegment(this._curA, this._curB);
    this._flush();
    this._latchPose();
    this._pushPose();
    if (owns) this._endStroke();
  }

  /**
   * Eject at a FIXED SPATIAL CADENCE along the path, not once per event.
   *
   * This is the difference between a tool that behaves the same on a fast
   * machine and a slow one. Sub-stepping per event (`ceil(travel / δ)` samples
   * between the last event and this one) sounds equivalent but is not: a
   * pointer that delivers one big event gets `ceil` rounding once, while one
   * that delivers thirty small events gets it thirty times, so the same drag
   * applies roughly twice as many ejects at high event rates. Each eject is a
   * contraction toward the wall (see `_ejectGuide`), so twice the ejects is
   * visibly more displacement — measured at ~0.13 strand lengths of divergence
   * across a single tangential stroke.
   *
   * Instead: `_prevA/_prevB` hold the last pose actually EJECTED AT, and this
   * consumes the path in whole δ-sized bites, leaving the remainder banked for
   * the next event. Eject count then depends only on distance travelled. The
   * leftover is flushed by `settle()` on drag end so the bar always finishes
   * resolved at its final pose.
   */
  _onObjectChange() {
    if (!this.hasBar || !this._tc.enabled) return;
    this._endpoints(this._curA, this._curB);

    const travel = Math.max(
      this._tmp.subVectors(this._curA, this._prevA).length(),
      this._tmp.subVectors(this._curB, this._prevB).length(),
    );
    const delta = this.radius * CADENCE;
    if (travel < delta) return;                   // bank it; not enough motion yet

    const steps = Math.min(MAX_SUBS, Math.floor(travel / delta));
    const span  = (steps * delta) / travel;       // fraction of the path consumed

    // Direction of travel, for the degenerate contact normal in projectCapsule.
    this._motion.copy(this._curA).add(this._curB).multiplyScalar(0.5)
      .sub(this._tmp.copy(this._prevA).add(this._prevB).multiplyScalar(0.5));
    if (this._motion.lengthSq() > 1e-16) this._motion.normalize();

    this._editedIds.clear();
    this._prepMesh();
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * span;
      this._stepA.lerpVectors(this._prevA, this._curA, t);
      this._stepB.lerpVectors(this._prevB, this._curB, t);
      this._ejectSegment(this._stepA, this._stepB);
    }
    this._flush();

    // Latch to the last pose ejected at, NOT to the current pose — the unspent
    // remainder has to survive into the next event or the cadence leaks.
    this._prevA.lerpVectors(this._prevA, this._curA, span);
    this._prevB.lerpVectors(this._prevB, this._curB, span);
    this._pushPose();
  }

  _flush() {
    if (!this._editedIds.size) return;
    for (const id of this._editedIds) this._strokeIds.add(id);
    this.onEdit?.([...this._editedIds]);
  }

  // --- stroke boundary (undo unit) -------------------------------------------

  /**
   * Open a stroke. Re-entrant by design: `settle()` calls this too, and when
   * it runs as the tail of a gizmo drag the drag's stroke is already open, so
   * this returns false and the caller knows not to close it.
   *
   * @returns {boolean} true if THIS call opened the stroke.
   */
  _beginStroke() {
    if (this._inStroke) return false;
    this._inStroke = true;
    this._strokeIds.clear();
    this.onStrokeBegin?.();
    return true;
  }

  /** Close a stroke and report the union of everything it moved. */
  _endStroke() {
    if (!this._inStroke) return;
    this._inStroke = false;
    this.onStrokeEnd?.([...this._strokeIds]);
    this._strokeIds.clear();
  }

  /**
   * Abandon an open stroke without reporting it — the tool was switched away
   * or disabled mid-drag. History discards its pre-capture rather than
   * recording half a gesture.
   */
  _abortStroke() {
    if (!this._inStroke) return;
    this._inStroke = false;
    this._strokeIds.clear();
    this.onStrokeEnd?.([]);
  }

  // --- ejection --------------------------------------------------------------

  /**
   * Diagnostic: is edge collision actually running, and does this build see it?
   * Prints the module identity and probes one guide against the current pose.
   * Call from the console as `comb.diagnose()`.
   */
  diagnose() {
    const out = { edgeCollisionCompiled: typeof solveStrand === 'function' };
    out.hasBar = this.hasBar;
    out.constrain = this.constrain;
    out.iterations = this.iterations;
    out.radius = this.radius;
    out.guides = this.guides.guides.size;
    if (!this.hasBar) { console.table(out); return out; }

    this._endpoints(this._curA, this._curB);
    this._prepMesh();
    const a = new THREE.Vector3().copy(this._curA).applyMatrix4(this._invMesh);
    const b = new THREE.Vector3().copy(this._curB).applyMatrix4(this._invMesh);
    const cap = {
      ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
      r: this.radius / this._meshScale,
    };
    // Count edges currently overlapping the bar, WITHOUT moving anything.
    let edgesInside = 0, vertsInside = 0, nearest = Infinity, stretched = 0;
    const probe = new Float64Array(SHAPE_POINTS * 3);
    for (const g of this.guides.guides.values()) {
      const P = [];
      for (let k = 0; k < SHAPE_POINTS; k++) {
        P.push(this.guides.pointWorldLocal(g, k, new THREE.Vector3()).clone());
      }
      // Reject uses g.length; a strand stretched past it is invisible to the
      // broad phase. Flag that explicitly — it is the failure mode that looks
      // exactly like "collision does nothing".
      if (P[SHAPE_POINTS - 1].distanceTo(P[0]) > g.length * 1.02) stretched++;
      for (let k = 0; k < SHAPE_POINTS; k++) {
        const o = new THREE.Vector3().subVectors(P[k], a);
        const ab = new THREE.Vector3().subVectors(b, a);
        const s = Math.min(Math.max(o.dot(ab) / ab.lengthSq(), 0), 1);
        const d = o.addScaledVector(ab, -s).length();
        if (d < cap.r) vertsInside++;
        nearest = Math.min(nearest, d);
      }
      for (let k = 0; k < SHAPE_POINTS - 1; k++) {
        const r = closestPtSegmentSegment(
          P[k].x, P[k].y, P[k].z, P[k + 1].x, P[k + 1].y, P[k + 1].z,
          cap.ax, cap.ay, cap.az, cap.bx, cap.by, cap.bz, {},
        );
        const d = Math.hypot(r.c1x - r.c2x, r.c1y - r.c2y, r.c1z - r.c2z);
        if (d < cap.r) edgesInside++;
      }
      void probe;
    }
    out.edgesOverlappingBar = edgesInside;
    out.verticesOverlappingBar = vertsInside;
    out.nearestVertexDist = +nearest.toFixed(5);
    out.capsuleRadiusLocal = +cap.r.toFixed(5);
    out.stretchedGuides = stretched;
    out.verdict = !out.edgeCollisionCompiled ? 'OLD BUILD: solveStrand missing'
      : edgesInside > 0 && vertsInside === 0
        ? 'edges overlap but no vertices — this is the case edge collision must handle'
        : edgesInside === 0 ? 'bar is not touching any strand at this pose'
        : 'bar overlaps vertices too';
    console.table(out);
    return out;
  }

  _prepMesh() {
    this.mesh.updateMatrixWorld();
    this._invMesh.copy(this.mesh.matrixWorld).invert();
    this._meshScale = this.mesh.getWorldScale(this._scale).x || 1;
  }

  /**
   * Collide every guide against the capsule spanning world A→B.
   * `_prepMesh` must have run. Edited ids accumulate into `_editedIds`.
   */
  _ejectSegment(A, B) {
    const a = this._a.copy(A).applyMatrix4(this._invMesh);
    const b = this._tmp.copy(B).applyMatrix4(this._invMesh);
    const cap = this._cap;
    cap.ax = a.x; cap.ay = a.y; cap.az = a.z;
    cap.bx = b.x; cap.by = b.y; cap.bz = b.z;
    cap.r  = this.radius / this._meshScale;

    this._ab.subVectors(b, a);
    const abLenSq = this._ab.lengthSq();

    // Tie-break normal for an edge lying exactly on the axis, where the contact
    // direction is genuinely undefined. The bar's direction of travel is the
    // only non-arbitrary answer; with a stationary bar (settle) fall back to
    // any vector perpendicular to the axis, which at least stays stable across
    // sub-steps instead of picking a side at random.
    this._fallback.copy(this._motion).transformDirection(this._invMesh);
    if (this._fallback.lengthSq() < 1e-16) {
      if (abLenSq > 1e-16) {
        this._fallback.copy(this._ab).normalize();
        const alt = Math.abs(this._fallback.x) < 0.9 ? UNIT_Y : UNIT_X;
        this._fallback.crossVectors(this._fallback, alt);
      } else {
        this._fallback.set(0, 0, 1);
      }
    }
    if (this._fallback.lengthSq() < 1e-16) this._fallback.set(0, 0, 1);
    this._fallback.normalize();
    this._tie[0] = this._fallback.x;
    this._tie[1] = this._fallback.y;
    this._tie[2] = this._fallback.z;

    // Inverse mass is a pure function of rootRamp; rebuild only when it moves.
    if (this._invMassFor !== this.rootRamp) {
      buildInvMass(SHAPE_POINTS, this.rootRamp, this._invMass);
      this._invMassFor = this.rootRamp;
    }

    for (const g of this.guides.guides.values()) {
      if (this._collideGuide(g, a, cap)) this._editedIds.add(g.id);
    }
  }

  /**
   * Collide one guide against the capsule. Returns true if anything moved.
   *
   * Runs entirely in MESH-LOCAL space. The guide's normalised polyline is
   * lifted into `_local`, solved there, and written back — one frame build and
   * two passes over 9 points, versus the old per-point round trip.
   *
   * Reject: the root's distance to the axis segment against (R + length).
   * Sound because the capsule is finite in every direction.
   */
  _collideGuide(g, a, cap) {
    // --- reject ---------------------------------------------------------------
    this._o.set(g.root[0] - a.x, g.root[1] - a.y, g.root[2] - a.z);
    const abLenSq = this._ab.lengthSq();
    const s = abLenSq > 1e-16
      ? Math.min(Math.max(this._o.dot(this._ab) / abLenSq, 0), 1)
      : 0;
    this._r.copy(this._o).addScaledVector(this._ab, -s);
    const reach = cap.r + g.length;
    if (this._r.lengthSq() > reach * reach) return false;

    // --- guide frame (T re-orthogonalised against N, matching guides.js) -------
    const [nx, ny, nz] = g.normal;
    let [tx, ty, tz] = g.tangent;
    const dd = tx * nx + ty * ny + tz * nz;
    tx -= nx * dd; ty -= ny * dd; tz -= nz * dd;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

    const p    = g.points;
    const L    = g.length || 1;
    const loc  = this._local;
    const rx = g.root[0], ry = g.root[1], rz = g.root[2];

    // --- lift into mesh-local -------------------------------------------------
    for (let k = 0; k < SHAPE_POINTS; k++) {
      const i = k * 3;
      const lx = p[i], ly = p[i + 1], lz = p[i + 2];
      loc[i]     = rx + (tx * lx + bx * ly + nx * lz) * L;
      loc[i + 1] = ry + (ty * lx + by * ly + ny * lz) * L;
      loc[i + 2] = rz + (tz * lx + bz * ly + nz * lz) * L;
    }

    // --- solve ----------------------------------------------------------------
    const hit = solveStrand(loc, {
      restLen:       SHAPE_REST * L,
      invMass:       this._invMass,
      capsule:       cap,
      tie:           this._tie,
      iterations:    this.iterations,
      enforceLength: this.constrain === 'length',
    });
    if (hit === 0) return false;

    // --- write back to the normalised frame -----------------------------------
    const inv = 1 / L;
    for (let k = 1; k < SHAPE_POINTS; k++) {
      const i = k * 3;
      const vx = loc[i] - rx, vy = loc[i + 1] - ry, vz = loc[i + 2] - rz;
      p[i]     = (vx * tx + vy * ty + vz * tz) * inv;
      p[i + 1] = (vx * bx + vy * by + vz * bz) * inv;
      // Scalp guard. Still a per-guide tangent half-space, still wants a real
      // head SDF pushout once hair is long enough to drape — three-mesh-bvh is
      // the right tool for that, and it is the one dependency worth taking.
      const zn = (vx * nx + vy * ny + vz * nz) * inv;
      p[i + 2] = zn < 0 ? 0 : zn;
    }

    // --- flow field -----------------------------------------------------------
    // Off by default: g.points are expressed in this frame, so rotating the
    // tangent rotates the shape as a side effect. See the header.
    if (this.reauthorTangent && abLenSq > 1e-16) {
      const invAb = 1 / Math.sqrt(abLenSq);
      const dx = this._ab.x * invAb, dy = this._ab.y * invAb, dz = this._ab.z * invAb;
      const blend = 0.3;
      g.tangent[0] += (dx - g.tangent[0]) * blend;
      g.tangent[1] += (dy - g.tangent[1]) * blend;
      g.tangent[2] += (dz - g.tangent[2]) * blend;
    }

    return true;
  }
}

// ---------------------------------------------------------------------------

const UNIT_X = new THREE.Vector3(1, 0, 0);

function makeCapsuleFill() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 6, 20), mat);
  m.renderOrder = 2;
  return m;
}

/** The axis itself, drawn bright so the bar's orientation is unambiguous. */
function makeSpine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.125, 0, 0, 0.125, 0], 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffaa44, transparent: true, opacity: 0.9, depthTest: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 3;
  return l;
}

/** First-click marker during placement. */
function makeMarker() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, depthTest: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
  m.renderOrder = 4;
  return m;
}

/** Rubber-band line from the first click to the cursor. */
function makeGhost() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffaa44, transparent: true, opacity: 0.7, depthTest: false,
  });
  const l = new THREE.LineSegments(geo, mat);
  l.renderOrder = 4;
  return l;
}
