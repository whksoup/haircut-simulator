/**
 * strands.js — strand generator and CPU renderer (Phase 2 / fallback).
 *
 * Reads Groom.faces and the FacetCatalogue to grow hair strands from selected
 * facets. Renders with LineSegments2 + LineMaterial for real pixel-width lines.
 * Roots are sampled by the shared strandSampler so the CPU and GPU paths agree.
 *
 * Conforms to the renderer interface (see renderer.js): exposes `.object` to be
 * parented under the head mesh (no matrixWorld bake — the parent transform
 * places the strands, which also fixes "strands don't follow a moved head").
 * setShape / setGrowth / update are no-ops here: the CPU path stays STRAIGHT and
 * fully grown. Shape (curl) and growth are GPU-only features in the R2 model;
 * the CPU renderer is the simple fallback until it is retired (rev3 Step 4).
 *
 * Data layout — SoA typed arrays, per-facet offset+count slices:
 *
 *   rootPositions  Float32Array  [x,y,z] per strand root (mesh local space)
 *   rootNormals    Float32Array  [x,y,z] smooth interpolated vertex normal
 *   rootTangents   Float32Array  [x,y,z] arbitrary tangent in the normal plane
 *   segPositions   Float32Array  SEG_STRIDE floats per strand (fixed max stride)
 *
 * segPositions uses a FIXED stride of MAX_SEGMENTS * 2 * 3 floats per strand
 * regardless of the facet's actual `segments` value, so segOffset stays in the
 * same index space as rootOffset (both indexed by strand number).
 *
 * Per-facet slices are tracked in _slices Map<facetId, {offset, count, segments}>.
 */

import * as THREE from 'three';
import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial.js';
import { sampleFacetRoots, MAX_STRANDS } from './strandSampler.js';

// ---------------------------------------------------------------------------
// Constants

/**
 * Fixed stride for segPositions: MAX_SEGMENTS segment-pairs × 2 endpoints × 3
 * floats. All facets use this stride regardless of their actual `segments`
 * value so every strand's data starts at a predictable offset: i → i*SEG_STRIDE.
 */
const MAX_SEGMENTS  = 16;
const SEG_STRIDE    = MAX_SEGMENTS * 2 * 3; // 96 floats per strand

// ---------------------------------------------------------------------------

export class StrandGen {
  /**
   * @param {THREE.Mesh} mesh   — the groomTarget (must carry userData.catalogue)
   * @param {import('./groom.js').Groom} groom
   */
  constructor(mesh, groom, { color = 0xd4a96a } = {}) {
    this.mesh  = mesh;
    this.groom = groom;

    this._catalogue = mesh.userData.catalogue ?? null;

    // SoA root data.
    this._rootPositions = new Float32Array(MAX_STRANDS * 3);
    this._rootNormals   = new Float32Array(MAX_STRANDS * 3);
    this._rootTangents  = new Float32Array(MAX_STRANDS * 3);

    // Flat segment positions with fixed per-strand stride.
    this._segPositions = new Float32Array(MAX_STRANDS * SEG_STRIDE);

    /**
     * Map<facetId, { offset, count, segments }>
     *   offset   — strand index of first strand for this facet
     *   count    — number of strands
     *   segments — segment count used when this slice was built
     */
    this._slices = new Map();

    /** Total strands allocated across all slices. */
    this._totalStrands = 0;

    // --- Renderer ---
    this._material = new LineMaterial({
      color,
      linewidth   : 1.2,          // pixels; real width on all platforms
      vertexColors: false,
      resolution  : new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    this._onResize = () => {
      this._material.resolution.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);

    this._linesGeo = new LineSegmentsGeometry();
    this._lines    = new LineSegments2(this._linesGeo, this._material);
    this._lines.renderOrder = 1;

    /** Parented under the head mesh by main.js — positions stay mesh-local. */
    this.object = this._lines;
  }

  // ---------------------------------------------------------------------------
  // Public API (renderer interface)

  /** Full rebuild from groom.faces — call after load or masterSeed change. */
  rebuild() {
    this._slices.clear();
    this._totalStrands = 0;
    for (const [facetId, params] of this.groom.faces) {
      this._buildFacetSlice(facetId, params);
    }
    this._uploadGeometry();
    console.info(`[StrandGen] rebuild — ${this._totalStrands} strands, ${this._slices.size} facets`);
  }

  /**
   * Incremental update for one facet — called when its params change or it is
   * first added. Always compacts then rebuilds the facet (O(totalStrands),
   * acceptable at interactive rates) to keep the logic simple and correct.
   */
  updateFacet(facetId) {
    const params = this.groom.faces.get(facetId);
    if (!params) { this._removeFacetSlice(facetId); this._uploadGeometry(); return; }

    if (this._slices.has(facetId)) this._removeFacetSlice(facetId);
    this._buildFacetSlice(facetId, params);
    this._uploadGeometry();
  }

  /** Remove strands for a facet that left the hair region. */
  removeFacet(facetId) {
    if (!this._slices.has(facetId)) return;
    this._removeFacetSlice(facetId);
    this._uploadGeometry();
  }

  /** CPU path is straight-only: shape (curl) is ignored. GPU renderer handles it. */
  setShape(_facetId, _shape) { /* no-op — CPU renders straight */ }

  /** No growth ramp on the CPU path; strands render fully grown. */
  setGrowth(_g) { /* no-op */ }

  /** No per-frame work on the CPU path. */
  update(_dt, _ratePerSec = 0) { /* no-op */ }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.object.parent?.remove(this.object);
    this._linesGeo.dispose();
    this._material.dispose();
  }

  // ---------------------------------------------------------------------------
  // Slice management

  _buildFacetSlice(facetId, params) {
    if (!this._catalogue) return;

    const entry = this._catalogue.getFacet(facetId);
    if (!entry) return;

    const { length, segments } = params;
    const offset = this._totalStrands;

    // Roots / normals / tangents straight into our SoA at `offset` via the
    // shared sampler — same sequence the GPU path produces, no drift.
    const n = sampleFacetRoots({
      geometry: this.mesh.geometry,
      entry,
      params,
      masterSeed: this.groom.masterSeed,
      positions: this._rootPositions,
      normals: this._rootNormals,
      tangents: this._rootTangents,
      offset,
      maxStrands: MAX_STRANDS,
    });
    if (n === 0) return;

    // Segment positions: straight growth along the smooth root normal.
    // Each strand occupies SEG_STRIDE floats at index (offset+i); only the
    // first segCount*6 floats are meaningful, the rest stay zero.
    const segCount = Math.min(Math.max(segments | 0, 1), MAX_SEGMENTS);
    const step = length / segCount;
    for (let i = 0; i < n; i++) {
      const b3 = (offset + i) * 3;
      const px = this._rootPositions[b3];
      const py = this._rootPositions[b3 + 1];
      const pz = this._rootPositions[b3 + 2];
      const nx = this._rootNormals[b3];
      const ny = this._rootNormals[b3 + 1];
      const nz = this._rootNormals[b3 + 2];

      const segBase = (offset + i) * SEG_STRIDE;
      for (let seg = 0; seg < segCount; seg++) {
        const t0  = seg * step;
        const t1  = (seg + 1) * step;
        const out = segBase + seg * 6;
        this._segPositions[out]     = px + nx * t0;
        this._segPositions[out + 1] = py + ny * t0;
        this._segPositions[out + 2] = pz + nz * t0;
        this._segPositions[out + 3] = px + nx * t1;
        this._segPositions[out + 4] = py + ny * t1;
        this._segPositions[out + 5] = pz + nz * t1;
      }
    }

    this._slices.set(facetId, { offset, count: n, segments: segCount });
    this._totalStrands += n;
  }

  /**
   * Remove a facet slice and compact the SoA arrays by rebuilding all surviving
   * slices in insertion order (offsets are reassigned).
   */
  _removeFacetSlice(facetId) {
    if (!this._slices.has(facetId)) return;

    const surviving = [...this._slices.keys()].filter((id) => id !== facetId);
    this._slices.clear();
    this._totalStrands = 0;

    for (const id of surviving) {
      const params = this.groom.faces.get(id);
      if (params) this._buildFacetSlice(id, params);
    }
  }

  // ---------------------------------------------------------------------------
  // Geometry upload

  _uploadGeometry() {
    if (this._totalStrands === 0) {
      this._linesGeo.setPositions(new Float32Array(0));
      return;
    }

    // Collect segment-pair endpoints into a flat array for LineSegmentsGeometry.
    // Positions are MESH-LOCAL: the object is parented under the head, so the
    // parent transform places them — no matrixWorld bake here.
    let totalPairs = 0;
    for (const slice of this._slices.values()) totalPairs += slice.count * slice.segments;

    const out = new Float32Array(totalPairs * 6); // 2 endpoints × 3 floats
    let outIdx = 0;

    for (const slice of this._slices.values()) {
      const { offset, count, segments } = slice;
      for (let i = 0; i < count; i++) {
        const segBase = (offset + i) * SEG_STRIDE;
        for (let seg = 0; seg < segments; seg++) {
          const src = segBase + seg * 6;
          out[outIdx++] = this._segPositions[src];
          out[outIdx++] = this._segPositions[src + 1];
          out[outIdx++] = this._segPositions[src + 2];
          out[outIdx++] = this._segPositions[src + 3];
          out[outIdx++] = this._segPositions[src + 4];
          out[outIdx++] = this._segPositions[src + 5];
        }
      }
    }

    this._linesGeo.setPositions(out);
  }
}