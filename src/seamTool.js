/**
 * seamTool.js — select seam edges and set their permeability.
 *
 * A peer of Raycast and CombTool in main.js's tool arbitration: exactly one of
 * the three owns the pointer at a time. Enable it and clicks pick EDGES of the
 * facet graph instead of facets.
 *
 * THE SELECTION IS A SET, ALWAYS
 *
 * Even when you have clicked exactly one edge. There is no "current edge" and
 * no single-edge code path, because the thing being built toward is authoring
 * a PARTING — a run of seam across the scalp — and a parting is the normal
 * case, not the advanced one. Making the set the primitive means loop select,
 * path select, hand-picked runs and the single edge all converge on one apply
 * path (`setPermeability`), so a change to how seams are written lands in one
 * place rather than four.
 *
 * GESTURES
 *   click            replace selection with the nearest edge to the click
 *   shift+click      add / remove that edge (toggle)
 *   alt+click        replace selection with the whole EDGE LOOP through it
 *   ctrl/cmd+click   extend along the shortest path from the last pick to here
 *
 * The last one is the workhorse for a parting: click where it starts, ctrl+click
 * where it ends, and the mesh works out the run between. `_anchor` is what
 * makes it chainable — each ctrl+click re-anchors, so a curved part is three or
 * four clicks rather than forty.
 *
 * PICKING HAS NO DISTANCE THRESHOLD. A click anywhere on a facet resolves to
 * that facet's nearest boundary edge (see nearestEdgeOfFacet). An edge is a
 * one-pixel target; a gesture that silently does nothing when you miss is worse
 * than one that occasionally picks the neighbour, which costs one more click.
 *
 * PERMEABILITY IS APPLIED UNIFORMLY across the whole selection. Per-edge
 * gradients along a run are a later thing and deliberately not modelled here —
 * see the note on `setPermeability`.
 *
 * HISTORY. Dragging the slider fires continuously, so this uses the same
 * mark/commitMark coalescing as the globals sliders: `beginEdit` on the first
 * change of a drag, `endEdit` when it settles, one undo entry per drag. Seams
 * are structural (they change what the binder may blend), so the entry is a
 * whole-groom snapshot rather than the cheap guide scope.
 *
 * Wiring (main.js):
 *   const seamTool = new SeamTool({
 *     viewer, mesh, catalogue, seams: groom.seams,
 *     onSelectionChange: (ids) => overlay.setSelection(ids),
 *     onEdit: () => overlay.refresh(),
 *     onBeginEdit: () => history.mark('seams'),
 *     onEndEdit:   () => history.commitMark('seams', 'seam permeability'),
 *   });
 */

import * as THREE from 'three';

/** Distance from a point to a segment, all in 2D. */
function segmentDistance2D(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const denom = abx * abx + aby * aby;
  let t = denom > 0 ? (apx * abx + apy * aby) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx * t, apy - aby * t);
}

export class SeamTool {
  /**
   * @param {object} o
   * @param {import('./viewer.js').Viewer} o.viewer
   * @param {THREE.Mesh} o.mesh                                  the groomTarget
   * @param {import('./facetWireframe.js').FacetCatalogue} o.catalogue
   * @param {import('./seams.js').SeamStore} o.seams
   * @param {(ids:number[]) => void} [o.onSelectionChange]
   * @param {(ids:number[]) => void} [o.onEdit]      seams were written
   * @param {(id:number) => void}    [o.onHover]     edge under the cursor, -1 for none
   * @param {() => void} [o.onBeginEdit]  open a coalescing history transaction
   * @param {() => void} [o.onEndEdit]    close it
   */
  constructor({
    viewer, mesh, catalogue, seams,
    onSelectionChange = null, onEdit = null, onHover = null,
    onBeginEdit = null, onEndEdit = null,
  }) {
    this.viewer    = viewer;
    this.mesh      = mesh;
    this.catalogue = catalogue;
    this.seams     = seams;

    this.onSelectionChange = onSelectionChange;
    this.onEdit            = onEdit;
    this.onHover           = onHover;
    this.onBeginEdit       = onBeginEdit;
    this.onEndEdit         = onEndEdit;

    this.enabled = false;

    /** @type {Set<number>} selected edge ids. The only selection state. */
    this.selection = new Set();

    /** Last picked edge — the anchor for ctrl+click path extension. */
    this.anchor = -1;

    /** Edge under the cursor, or -1. Presentation only. */
    this.hovered = -1;

    /** True between onBeginEdit and onEndEdit. */
    this._editing = false;

    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2();
    this._local     = new THREE.Vector3();
    // Scratch for screen-space edge projection — reused per pick, and pointer
    // moves call this on every event, so allocating here is not optional.
    this._pa = new THREE.Vector3();
    this._pb = new THREE.Vector3();

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
  }

  // --- lifecycle ------------------------------------------------------------

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const el = this.viewer.renderer.domElement;
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    console.info('[SeamTool] enabled — click picks an edge, alt=loop, ctrl=path');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    const el = this.viewer.renderer.domElement;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    // A slider left mid-drag when the tool is switched away would otherwise
    // pin its pre-capture in history forever.
    this.endEdit();
    this._setHover(-1);
  }

  toggle()  { this.enabled ? this.disable() : this.enable(); }
  dispose() { this.disable(); }

  // --- selection ------------------------------------------------------------

  get selected() { return [...this.selection]; }
  get count()    { return this.selection.size; }

  clearSelection() {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.anchor = -1;
    this._changed();
  }

  /** Replace the selection with these edge ids. */
  select(ids) {
    this.selection = new Set(ids);
    this.anchor = ids.length ? ids[ids.length - 1] : -1;
    this._changed();
  }

  /** Add without disturbing what's there. */
  addToSelection(ids) {
    let added = 0;
    for (const id of ids) if (!this.selection.has(id)) { this.selection.add(id); added++; }
    if (ids.length) this.anchor = ids[ids.length - 1];
    if (added) this._changed();
    return added;
  }

  /**
   * Select the edge between two adjacent facets. The second half of the UX:
   * you can arrive at a seam either by clicking it or by having the two facets
   * either side already selected.
   * @returns {boolean} false if the facets do not share an edge
   */
  selectBetweenFacets(a, b, { additive = false } = {}) {
    const eid = this.catalogue?.edgeBetween(a, b) ?? -1;
    if (eid < 0) return false;
    if (additive) this.addToSelection([eid]); else this.select([eid]);
    return true;
  }

  /**
   * Select every edge that borders the given facet set from outside it — the
   * outline. This is the bridge from the facet selection the user may already
   * have: select a region with Raycast, switch here, and the parting around it
   * is one click away.
   */
  selectBorderOfFacets(facetIds, { additive = false } = {}) {
    if (!this.catalogue) return 0;
    const inside = facetIds instanceof Set ? facetIds : new Set(facetIds);
    const out = new Set();
    for (const id of inside) {
      for (const eid of this.catalogue.edgesOfFacet(id)) {
        const e = this.catalogue.getEdge(eid);
        if (e.b < 0) continue;
        if (inside.has(e.a) !== inside.has(e.b)) out.add(eid);
      }
    }
    const ids = [...out];
    if (additive) this.addToSelection(ids); else this.select(ids);
    return ids.length;
  }

  /** Replace the selection with the full edge loop through the anchor. */
  selectLoop(edgeId = this.anchor, { additive = false } = {}) {
    if (!this.catalogue || edgeId < 0) return 0;
    const { edges, closed, truncated } = this.catalogue.edgeLoop(edgeId);
    if (additive) this.addToSelection(edges); else this.select(edges);
    this.anchor = edgeId;
    console.info(
      `[SeamTool] loop: ${edges.length} edges` +
      `${closed ? ' (closed)' : ''}${truncated ? ' (truncated)' : ''}`
    );
    return edges.length;
  }

  /** Extend the selection along the shortest run from the anchor to an edge. */
  extendPathTo(edgeId) {
    if (!this.catalogue || this.anchor < 0 || edgeId < 0) return 0;
    const path = this.catalogue.edgePath(this.anchor, edgeId);
    if (path.length === 0) {
      console.warn('[SeamTool] no path — the edges are on disconnected shells');
      return 0;
    }
    const added = this.addToSelection(path);
    this.anchor = edgeId;   // chainable: the next ctrl+click continues the run
    return added;
  }

  /** Grow the selection by one edge in each direction along its loops. */
  growSelection() {
    if (!this.catalogue) return 0;
    const add = [];
    for (const id of this.selection) {
      const e = this.catalogue.getEdge(id);
      for (const v of [e.v0, e.v1]) {
        const next = this.catalogue.continueLoop(id, v);
        if (next >= 0 && !this.selection.has(next)) add.push(next);
      }
    }
    return this.addToSelection(add);
  }

  /** Select every edge that currently carries a non-default permeability. */
  selectAllSeams() {
    if (!this.catalogue) return 0;
    const ids = [];
    for (const e of this.catalogue.edges()) {
      if (e.b >= 0 && this.seams.get(e.a, e.b) < 1) ids.push(e.id);
    }
    this.select(ids);
    return ids.length;
  }

  // --- editing --------------------------------------------------------------

  /**
   * Mean permeability over the selection — what the slider should read when a
   * selection is made. Returns 1 for an empty selection, matching the default.
   *
   * Mean, not first: a run assembled from several clicks can straddle edges
   * with different values, and showing one member's value would make the
   * slider jump on selection and then write that jumped-to value over the rest
   * on the first nudge.
   */
  meanPermeability() {
    if (this.selection.size === 0 || !this.catalogue) return 1;
    let sum = 0, n = 0;
    for (const id of this.selection) {
      const e = this.catalogue.getEdge(id);
      if (!e || e.b < 0) continue;
      sum += this.seams.get(e.a, e.b);
      n++;
    }
    return n ? sum / n : 1;
  }

  /** True if any selected edge differs from the mean — the slider is a summary. */
  isMixed(tolerance = 1e-4) {
    if (this.selection.size < 2 || !this.catalogue) return false;
    const m = this.meanPermeability();
    for (const id of this.selection) {
      const e = this.catalogue.getEdge(id);
      if (e && e.b >= 0 && Math.abs(this.seams.get(e.a, e.b) - m) > tolerance) return true;
    }
    return false;
  }

  /** Open a coalescing history transaction. Idempotent — safe per slider tick. */
  beginEdit() {
    if (this._editing) return;
    this._editing = true;
    this.onBeginEdit?.();
  }

  /** Close it. No-op if none is open. */
  endEdit() {
    if (!this._editing) return;
    this._editing = false;
    this.onEndEdit?.();
  }

  /**
   * Write one permeability across the entire selection.
   *
   * UNIFORM ON PURPOSE. A gradient along a run — a part that fades out toward
   * the crown — is a real thing to want, but it needs an ordered run and a
   * falloff curve, and `selection` is a Set with no order. Rather than half-
   * model it, this writes flat and leaves room: `edgeLoop` and `edgePath`
   * already return ORDERED arrays, so a future setPermeabilityRamp(from, to)
   * takes that array directly and nothing here has to change.
   *
   * @returns {number} edges written
   */
  setPermeability(p, { transient = false } = {}) {
    if (!this.catalogue || this.selection.size === 0) return 0;
    if (!transient) this.beginEdit();

    let n = 0;
    for (const id of this.selection) {
      const e = this.catalogue.getEdge(id);
      if (!e || e.b < 0) continue;       // mesh boundary has no facet pair
      this.seams.set(e.a, e.b, p);
      n++;
    }
    if (n) this.onEdit?.(this.selected);
    return n;
  }

  /** Restore the selection to fully permeable, dropping the overrides. */
  clearPermeability() {
    if (!this.catalogue || this.selection.size === 0) return 0;
    this.beginEdit();
    let n = 0;
    for (const id of this.selection) {
      const e = this.catalogue.getEdge(id);
      if (e && e.b >= 0 && this.seams.clear(e.a, e.b)) n++;
    }
    if (n) this.onEdit?.(this.selected);
    return n;
  }

  // --- pointer --------------------------------------------------------------

  /**
   * Screen position → { facetId, edgeId, point } or null on a miss.
   *
   * PICKED IN SCREEN SPACE, not in 3D. The catalogue can answer "nearest edge
   * of this facet to this point" in mesh space, and that is the obvious thing
   * to use — but it disagrees with the cursor at grazing angles, which is
   * exactly where you do most seam work: the side of a skull seen from the
   * front is nearly edge-on, and there the 3D-nearest edge can be the one
   * furthest from the pointer on screen. Projecting the facet's own edges and
   * comparing pixel distances is what makes the pick land where you aimed.
   *
   * Still no distance threshold: a click anywhere on a facet resolves to that
   * facet's nearest boundary. An edge is a one-pixel target, and a gesture
   * that silently does nothing when you miss is worse than one that
   * occasionally takes the neighbour — that costs one more click.
   */
  pickAt(event) {
    if (!this.catalogue) return null;
    const canvas = this.viewer.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    this._pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.viewer.camera);
    const hits = this._raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return null;

    const facetId = this.catalogue.facetIdByTri(hits[0].faceIndex);
    if (facetId < 0) return null;

    // Edge endpoints are stored mesh-local; the hit comes back into that space
    // for the geometric fallback below.
    this._local.copy(hits[0].point);
    this.mesh.worldToLocal(this._local);

    const edgeId = this._nearestEdgeOnScreen(facetId)
                ?? this.catalogue.nearestEdgeOfFacet(facetId, this._local).edgeId;
    return edgeId < 0 ? null : { facetId, edgeId, point: this._local.clone() };
  }

  /**
   * Nearest edge of a facet to the current pointer, measured in normalised
   * device coordinates. Returns null if nothing projected in front of the
   * camera, in which case pickAt falls back to the mesh-space test.
   *
   * Aspect correction matters: NDC is square but the viewport usually is not,
   * so an uncorrected comparison biases toward horizontal edges on a wide
   * canvas.
   */
  _nearestEdgeOnScreen(facetId) {
    const cam = this.viewer.camera;
    if (!cam) return null;
    const canvas = this.viewer.renderer.domElement;
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);

    let bestId = -1, bestD = Infinity, projected = 0;

    for (const eid of this.catalogue.edgesOfFacet(facetId)) {
      const e = this.catalogue.getEdge(eid);

      this._pa.copy(e.p0);
      this.mesh.localToWorld(this._pa);
      this._pa.project(cam);
      this._pb.copy(e.p1);
      this.mesh.localToWorld(this._pb);
      this._pb.project(cam);

      // z outside [-1,1] means behind the camera or past the far plane; the
      // projected x/y are meaningless there.
      if (Math.abs(this._pa.z) > 1 || Math.abs(this._pb.z) > 1) continue;
      projected++;

      const d = segmentDistance2D(
        this._pointer.x * aspect, this._pointer.y,
        this._pa.x * aspect, this._pa.y,
        this._pb.x * aspect, this._pb.y,
      );
      if (d < bestD) { bestD = d; bestId = eid; }
    }

    return projected > 0 ? bestId : null;
  }

  _onPointerDown(event) {
    if (!this.enabled || event.button !== 0) return;
    const pick = this.pickAt(event);
    if (!pick) return;

    // Deliberately does NOT stopPropagation, matching Raycast: OrbitControls
    // keeps the event, so dragging from the head still rotates the view. The
    // cost is that a drag also selects whatever edge it started on, which is
    // the same minor wart the pick tool has and is far cheaper than losing
    // orbit-from-the-model.

    const { edgeId } = pick;
    if (event.altKey) {
      this.selectLoop(edgeId, { additive: event.shiftKey });
    } else if (event.ctrlKey || event.metaKey) {
      if (this.anchor < 0) this.select([edgeId]);
      else this.extendPathTo(edgeId);
    } else if (event.shiftKey) {
      if (this.selection.has(edgeId)) {
        this.selection.delete(edgeId);
        if (this.anchor === edgeId) this.anchor = -1;
        this._changed();
      } else {
        this.addToSelection([edgeId]);
      }
    } else {
      this.select([edgeId]);
    }
  }

  _onPointerMove(event) {
    if (!this.enabled || !this.onHover) return;
    const pick = this.pickAt(event);
    this._setHover(pick ? pick.edgeId : -1);
  }

  _setHover(edgeId) {
    if (this.hovered === edgeId) return;
    this.hovered = edgeId;
    this.onHover?.(edgeId);
  }

  _changed() {
    this.onSelectionChange?.(this.selected);
  }
}
