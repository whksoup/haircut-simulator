/**
 * raycast.js — click/shift-click quads on the head mesh to select them.
 *
 * Single click  — exclusive select: clears the multi-selection, highlights
 *                 the clicked facet. Tracks `selectedFacetId` (last touched).
 * Shift+click   — toggle: adds the facet to `hairFacetIds` if absent,
 *                 removes and un-highlights it if already selected.
 * Miss (no hit) — no change to either selection.
 *
 * Public state:
 *   raycast.selectedFacetId   — most recently single-clicked facet (number | -1)
 *   raycast.hairFacetIds      — Set<number> of shift-selected "hair" facets
 *
 * Callbacks:
 *   raycast.onSelect(facetId)               — fired on single-click selection
 *   raycast.onHairChange(Set<hairFacetIds>) — fired when the hair set changes
 */

import * as THREE from 'three';

const HIGHLIGHT_COLOR = new THREE.Color(0xff6633); // single-select: vivid orange
const HAIR_COLOR      = new THREE.Color(0x44cc88); // shift-select: green
const BASE_COLOR      = new THREE.Color(0xc9a48a); // unselected skin tone

export class Raycast {
  /** @param {import('./viewer.js').Viewer} viewer */
  /** @param {THREE.Mesh} mesh — the groomTarget */
  constructor(viewer, mesh) {
    this.viewer  = viewer;
    this.mesh    = mesh;
    this.enabled = false;

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Mesh = { backfaceCulling: true };
    this._pointer   = new THREE.Vector2();

    /** Most recently single-clicked facet, or -1. */
    this.selectedFacetId = -1;

    /** Set of shift-clicked "hair" facets. */
    this.hairFacetIds = new Set();

    /** Callbacks — assign from outside. */
    this.onSelect    = null; // (facetId) => void
    this.onHairChange = null; // (Set<number>) => void

    // Map<facetId, Int32Array of vertex indices> — built once at construction.
    this._facetIndex = this._buildFacetIndex();

    this._ensureColorAttr();
    this._onPointerDown = this._onPointerDown.bind(this);
  }

  // -------------------------------------------------------------------------
  // Public API

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.mesh.material.vertexColors = true;
    this.mesh.material.needsUpdate  = true;
    this.viewer.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    console.info('[Raycast] enabled —', this._facetIndex ? 'quad mode' : 'triangle fallback');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.viewer.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._clearSingleSelect();
    this.mesh.material.vertexColors = false;
    this.mesh.material.needsUpdate  = true;
    console.info('[Raycast] disabled');
  }

  toggle() { this.enabled ? this.disable() : this.enable(); }
  dispose() { this.disable(); }

  // -------------------------------------------------------------------------
  // Internals

  _buildFacetIndex() {
    const facetAttr = this.mesh.geometry.attributes._facet;
    if (!facetAttr) {
      console.warn('[Raycast] no _facet attribute — falling back to triangle select');
      return null;
    }
    const index = new Map();
    const n = facetAttr.count;
    for (let i = 0; i < n; i++) {
      const id = facetAttr.getX(i);
      let arr = index.get(id);
      if (!arr) { arr = []; index.set(id, arr); }
      arr.push(i);
    }
    for (const [id, arr] of index) index.set(id, new Int32Array(arr));
    console.info(`[Raycast] facet index built — ${index.size} quads`);
    return index;
  }

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
      ((event.clientX - rect.left)  / rect.width)  * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    this._raycaster.setFromCamera(this._pointer, this.viewer.camera);
    const hits = this._raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return; // miss — keep everything as-is

    const hitVertex = hits[0].face.a;
    const facetId   = this._facetIndex
      ? this.mesh.geometry.attributes._facet.getX(hitVertex)
      : Math.floor(hitVertex / 3);

    if (event.shiftKey) {
      this._toggleHair(facetId);
    } else {
      this._selectSingle(facetId);
    }
  }

  /** Single click — exclusive highlight, clears previous single-select only. */
  _selectSingle(facetId) {
    if (facetId === this.selectedFacetId) return;
    this._clearSingleSelect();

    // Only paint orange if it isn't already green (hair facet).
    if (!this.hairFacetIds.has(facetId)) {
      this._paintFacet(facetId, HIGHLIGHT_COLOR);
    }

    this.selectedFacetId = facetId;
    this.onSelect?.(facetId);
    console.info(`[Raycast] selected facet ${facetId}`);
  }

  /** Shift+click — toggle facet in/out of the hair set. */
  _toggleHair(facetId) {
    if (this.hairFacetIds.has(facetId)) {
      this.hairFacetIds.delete(facetId);
      // Restore: orange if it's also the single-select, otherwise base.
      this._paintFacet(facetId,
        facetId === this.selectedFacetId ? HIGHLIGHT_COLOR : BASE_COLOR
      );
      console.info(`[Raycast] removed hair facet ${facetId} (${this.hairFacetIds.size} total)`);
    } else {
      this.hairFacetIds.add(facetId);
      this._paintFacet(facetId, HAIR_COLOR);
      console.info(`[Raycast] added hair facet ${facetId} (${this.hairFacetIds.size} total)`);
    }
    this.onHairChange?.(this.hairFacetIds);
  }

  /** Revert the single-select highlight; leave hair facets green. */
  _clearSingleSelect() {
    if (this.selectedFacetId < 0) return;
    // If the previously selected facet is also a hair facet, keep it green.
    this._paintFacet(this.selectedFacetId,
      this.hairFacetIds.has(this.selectedFacetId) ? HAIR_COLOR : BASE_COLOR
    );
    this.selectedFacetId = -1;
  }

  _paintFacet(facetId, color) {
    const colorAttr = this.mesh.geometry.attributes.color;
    const verts = this._facetIndex
      ? this._facetIndex.get(facetId)
      : [facetId * 3, facetId * 3 + 1, facetId * 3 + 2];
    if (!verts) return;
    for (let i = 0; i < verts.length; i++) {
      colorAttr.setXYZ(verts[i], color.r, color.g, color.b);
    }
    colorAttr.needsUpdate = true;
  }
}