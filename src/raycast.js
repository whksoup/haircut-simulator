/**
 * raycast.js — click / shift-click to build a facet selection on the head.
 *
 * Selection is a pure working set. It does NOT decide whether a facet has hair.
 * Hair is applied to the selected region later via explicit calls (e.g. a
 * "Add hair to selection" action that writes Groom.faces records). Selecting
 * or deselecting a facet never adds or removes its hair.
 *
 * Interaction:
 *   Shift+click  — add the facet to the selection (toggle: shift-clicking an
 *                  already-selected facet removes it).
 *   Plain click  — replace the selection with just this facet (deselects all
 *                  others) and highlight it.
 *   Miss (no hit)— no change.
 *
 * Public state:
 *   raycast.selection      — Set<facetId>, the current working selection
 *   raycast.activeFacetId  — most recently clicked facet (number | -1)
 *
 * Topological ops (need mesh.userData.catalogue's adjacency graph):
 *   growSelection / shrinkSelection   — morphological dilate / erode
 *   fillFromFacet / fillFromActive    — flood fill, stopping at hard seams
 *   invertSelection / selectSeamFacets
 *   interiorEdgesOfSelection / boundaryEdgesOfSelection — for the seam tool
 *
 * Grow and fill are SEAM-AWARE by default. That ordering is the point: author
 * the hairline once, then one click inside it selects the scalp and stops
 * dead at the boundary instead of leaking down the face.
 *
 * Callbacks (assign from outside):
 *   raycast.onSelect(facetId)              — fired on any click landing on a facet
 *   raycast.onSelectionChange(Set<facetId>)— fired whenever the selection changes
 */

import * as THREE from 'three';

const SELECT_COLOR = new THREE.Color(0xff6633); // selected: vivid orange
const BASE_COLOR   = new THREE.Color(0xc9a48a); // unselected skin tone

export class Raycast {
  /** @param {import('./viewer.js').Viewer} viewer */
  /** @param {THREE.Mesh} mesh — the groomTarget */
  /** @param {import('./seams.js').SeamStore} [seams] — enables seam-aware growth */
  constructor(viewer, mesh, seams = null) {
    this.viewer  = viewer;
    this.mesh    = mesh;
    this.enabled = false;

    /**
     * Authored seam permeability. Optional: without it the topological
     * selection ops still work, they just cross partings freely.
     */
    this.seams = seams;

    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2();

    /** Current working selection. Purely transient; unrelated to hair. */
    this.selection = new Set();

    /** Most recently clicked facet, or -1. */
    this.activeFacetId = -1;

    /** Callbacks — assign from outside. */
    this.onSelect          = null; // (facetId) => void
    this.onSelectionChange = null; // (Set<number>) => void

    this._catalogue = mesh.userData.catalogue ?? null;

    if (this._catalogue) {
      console.info(`[Raycast] FacetCatalogue — ${this._catalogue.facetCount} quad facets`);
    } else {
      console.warn('[Raycast] no catalogue on mesh — triangle fallback');
    }

    this._ensureColorAttr();
    this._onPointerDown = this._onPointerDown.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.mesh.material.vertexColors = true;
    this.mesh.material.needsUpdate  = true;
    this.viewer.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    console.info('[Raycast] enabled —', this._catalogue ? 'quad mode' : 'triangle fallback');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.viewer.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    // Drop the selection highlight; hair (strands) is unaffected.
    for (const id of this.selection) this._paintFacet(id, BASE_COLOR);
    this.selection.clear();
    this.activeFacetId = -1;
    this.mesh.material.vertexColors = false;
    this.mesh.material.needsUpdate  = true;
    console.info('[Raycast] disabled');
  }

  /** Clear the selection programmatically (no hair change). */
  clearSelection() {
    if (this.selection.size === 0) return;
    for (const id of this.selection) this._paintFacet(id, BASE_COLOR);
    this.selection.clear();
    this.activeFacetId = -1;
    this.onSelectionChange?.(this.selection);
  }

  toggle()  { this.enabled ? this.disable() : this.enable(); }
  dispose() { this.disable(); }

  // ---------------------------------------------------------------------------
  // Topological selection — the adjacency graph's first consumer.
  //
  // Clicking facets one at a time stops being viable somewhere around thirty
  // of them, which is well below the size of a hair region. These are the
  // operations that make a facet-resolution selection practical, and every one
  // of them is a walk over catalogue.neighbours().
  //
  // SEAM AWARENESS. grow and fill treat a hard seam as a wall by default. That
  // is the point of authoring seams before selecting: mark the hairline once,
  // then one click inside it fills the scalp and stops dead at the boundary
  // instead of leaking down the face. Pass { respectSeams: false } for the
  // purely topological version.

  /** True if blending — and therefore selection growth — may cross a boundary. */
  _canCross(a, b, respectSeams) {
    if (!respectSeams || !this.seams) return true;
    return !this.seams.isHard(a, b);
  }

  /**
   * Expand the selection by one ring of neighbours.
   * @returns {number} facets added
   */
  growSelection({ rings = 1, respectSeams = true } = {}) {
    if (!this._catalogue || this.selection.size === 0) return 0;
    let added = 0;
    for (let r = 0; r < rings; r++) {
      const frontier = [...this.selection];
      for (const id of frontier) {
        for (const n of this._catalogue.neighbours(id)) {
          if (this.selection.has(n)) continue;
          if (!this._canCross(id, n, respectSeams)) continue;
          this.selection.add(n);
          this._paintFacet(n, SELECT_COLOR);
          added++;
        }
      }
    }
    if (added) this.onSelectionChange?.(this.selection);
    return added;
  }

  /**
   * Contract the selection by one ring: drop any facet with a neighbour that
   * is NOT selected. Deliberately ignores seams — shrink is a morphological
   * operation on the set you already have, and a facet on the far side of a
   * seam is still, factually, outside the selection.
   * @returns {number} facets removed
   */
  shrinkSelection({ rings = 1 } = {}) {
    if (!this._catalogue || this.selection.size === 0) return 0;
    let removed = 0;
    for (let r = 0; r < rings; r++) {
      const doomed = [];
      for (const id of this.selection) {
        const ns = this._catalogue.neighbours(id);
        // A facet on the mesh boundary has fewer neighbours than edges; treat
        // the missing side as "outside", which erodes inward from a hole.
        const exposed = ns.length < this._catalogue.edgesOfFacet(id).length
          || ns.some((n) => !this.selection.has(n));
        if (exposed) doomed.push(id);
      }
      if (doomed.length === this.selection.size) break;   // would erase it all
      for (const id of doomed) {
        this.selection.delete(id);
        this._paintFacet(id, BASE_COLOR);
        removed++;
      }
    }
    if (removed) {
      if (!this.selection.has(this.activeFacetId)) this.activeFacetId = -1;
      this.onSelectionChange?.(this.selection);
    }
    return removed;
  }

  /**
   * Flood fill outward from a facet, stopping at hard seams. With the hairline
   * seeded from creases, this is "select the scalp" in one click.
   *
   * `maxFacets` is a guard, not a feature: on a mesh whose seams do not close
   * a loop, the fill reaches the whole head, and doing that silently on a
   * 5000-facet mesh feels like a hang. It reports truncation instead.
   *
   * @returns {{added:number, truncated:boolean}}
   */
  fillFromFacet(facetId, { respectSeams = true, additive = false, maxFacets = 20000 } = {}) {
    if (!this._catalogue || facetId < 0) return { added: 0, truncated: false };
    if (!additive) this.clearSelection();

    const queue = [facetId];
    const seen  = new Set([facetId]);
    let added = 0, truncated = false;

    while (queue.length) {
      const id = queue.pop();
      if (!this.selection.has(id)) {
        this.selection.add(id);
        this._paintFacet(id, SELECT_COLOR);
        added++;
      }
      if (seen.size >= maxFacets) { truncated = true; break; }
      for (const n of this._catalogue.neighbours(id)) {
        if (seen.has(n)) continue;
        if (!this._canCross(id, n, respectSeams)) continue;
        seen.add(n);
        queue.push(n);
      }
    }

    this.activeFacetId = facetId;
    this.onSelectionChange?.(this.selection);
    if (truncated) {
      console.warn(
        `[Raycast] fill stopped at ${maxFacets} facets — the seams around ` +
        `facet ${facetId} do not enclose a region.`
      );
    }
    return { added, truncated };
  }

  /** Fill from the last-clicked facet. The UI's one-button form of the above. */
  fillFromActive(opts) {
    if (this.activeFacetId < 0) return { added: 0, truncated: false };
    return this.fillFromFacet(this.activeFacetId, opts);
  }

  /** Replace the selection with every facet NOT in it. */
  invertSelection() {
    if (!this._catalogue) return 0;
    const next = new Set();
    for (const id of this._catalogue.facetIds()) {
      if (!this.selection.has(id)) next.add(id);
    }
    for (const id of this.selection) this._paintFacet(id, BASE_COLOR);
    for (const id of next)           this._paintFacet(id, SELECT_COLOR);
    this.selection = next;
    if (!next.has(this.activeFacetId)) this.activeFacetId = -1;
    this.onSelectionChange?.(this.selection);
    return next.size;
  }

  /**
   * Select every facet with an authored seam on it. The fastest way to see
   * what a crease-seeding pass actually did, and to clean it up afterwards.
   */
  selectSeamFacets() {
    if (!this._catalogue || !this.seams) return 0;
    this.clearSelection();
    for (const e of this._catalogue.edges()) {
      if (e.b < 0 || this.seams.get(e.a, e.b) >= 1) continue;
      for (const id of [e.a, e.b]) {
        if (this.selection.has(id)) continue;
        this.selection.add(id);
        this._paintFacet(id, SELECT_COLOR);
      }
    }
    this.onSelectionChange?.(this.selection);
    return this.selection.size;
  }

  /**
   * Every edge with both facets inside the selection. This is the set a
   * "mark selection border as a seam" action operates on — or rather, its
   * complement is: see boundaryEdgesOfSelection.
   */
  interiorEdgesOfSelection() {
    if (!this._catalogue) return [];
    const out = [];
    for (const id of this.selection) {
      for (const eid of this._catalogue.edgesOfFacet(id)) {
        const e = this._catalogue.getEdge(eid);
        if (e.b < 0) continue;
        if (e.a < e.b && this.selection.has(e.a) && this.selection.has(e.b)) out.push(eid);
      }
    }
    return [...new Set(out)];
  }

  /**
   * Every edge with exactly one facet inside the selection — the selection's
   * outline. Marking these as impermeable is how you draw a part by hand:
   * select a region, then wall it off.
   */
  boundaryEdgesOfSelection() {
    if (!this._catalogue) return [];
    const out = new Set();
    for (const id of this.selection) {
      for (const eid of this._catalogue.edgesOfFacet(id)) {
        const e = this._catalogue.getEdge(eid);
        if (e.b < 0) continue;
        const inA = this.selection.has(e.a), inB = this.selection.has(e.b);
        if (inA !== inB) out.add(eid);
      }
    }
    return [...out];
  }

  // ---------------------------------------------------------------------------
  // Internals

  _ensureColorAttr() {
    const geo = this.mesh.geometry;
    if (geo.attributes.color) return;
    const n    = geo.attributes.position.count;
    const data = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      data[i * 3]     = BASE_COLOR.r;
      data[i * 3 + 1] = BASE_COLOR.g;
      data[i * 3 + 2] = BASE_COLOR.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(data, 3));
  }

  _onPointerDown(event) {
    if (event.button !== 0) return;

    const canvas = this.viewer.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    this._pointer.set(
      ( (event.clientX - rect.left) / rect.width)  * 2 - 1,
      -((event.clientY - rect.top)  / rect.height) * 2 + 1
    );

    this._raycaster.setFromCamera(this._pointer, this.viewer.camera);
    const hits = this._raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return; // miss — no change

    const facetId = this._catalogue
      ? this._catalogue.facetIdByTri(hits[0].faceIndex)
      : hits[0].faceIndex & ~1;

    if (event.shiftKey) {
      this._toggleSelect(facetId);
    } else {
      this._selectSingle(facetId);
    }
  }

  /** Plain click — replace the selection with just this facet. */
  _selectSingle(facetId) {
    // Repaint everything currently selected (except the new pick) back to base.
    for (const id of this.selection) {
      if (id !== facetId) this._paintFacet(id, BASE_COLOR);
    }
    this.selection.clear();
    this.selection.add(facetId);
    this._paintFacet(facetId, SELECT_COLOR);

    this.activeFacetId = facetId;
    this.onSelect?.(facetId);
    this.onSelectionChange?.(this.selection);
    console.info(`[Raycast] select facet ${facetId} (selection = 1)`);
  }

  /** Shift+click — toggle this facet in/out of the selection. */
  _toggleSelect(facetId) {
    if (this.selection.has(facetId)) {
      this.selection.delete(facetId);
      this._paintFacet(facetId, BASE_COLOR);
      console.info(`[Raycast] deselect facet ${facetId} (selection = ${this.selection.size})`);
    } else {
      this.selection.add(facetId);
      this._paintFacet(facetId, SELECT_COLOR);
      console.info(`[Raycast] add facet ${facetId} to selection (selection = ${this.selection.size})`);
    }
    this.activeFacetId = facetId;
    this.onSelect?.(facetId);
    this.onSelectionChange?.(this.selection);
  }

  _paintFacet(facetId, color) {
    const colorAttr = this.mesh.geometry.attributes.color;
    if (!colorAttr) return;

    if (this._catalogue) {
      const entry = this._catalogue.getFacet(facetId);
      if (!entry) return;
      for (const t of entry.triIndices) {
        colorAttr.setXYZ(t * 3,     color.r, color.g, color.b);
        colorAttr.setXYZ(t * 3 + 1, color.r, color.g, color.b);
        colorAttr.setXYZ(t * 3 + 2, color.r, color.g, color.b);
      }
    } else {
      const triCount = Math.floor(colorAttr.count / 3);
      for (const t of [facetId, facetId + 1]) {
        if (t < 0 || t >= triCount) continue;
        colorAttr.setXYZ(t * 3,     color.r, color.g, color.b);
        colorAttr.setXYZ(t * 3 + 1, color.r, color.g, color.b);
        colorAttr.setXYZ(t * 3 + 2, color.r, color.g, color.b);
      }
    }
    colorAttr.needsUpdate = true;
  }
}