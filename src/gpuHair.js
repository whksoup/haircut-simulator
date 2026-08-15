/**
 * gpuHair.js — GPU-instanced strand renderer (R2 shape model).
 *
 * Reads Groom.faces + the FacetCatalogue, samples roots per facet (via the
 * shared strandSampler), and uploads them as instanced attributes. ONE draw
 * call renders every strand. Each facet's SHAPE (a normalised control-point
 * polyline) lives in one row of a float data texture; the vertex shader
 * (hairShader.js) reads the strand's facet row, transforms the shape by the
 * strand's frame, and applies growth. Combing or regrowing one facet only
 * rewrites that facet's instances + its one texture row — the same
 * incrementality strands.js has.
 *
 * Parent `gpuHair.object` under the head mesh so its transform applies:
 *     groomTarget.add(gpuHair.object);
 *
 * Public API (renderer interface — see renderer.js):
 *     rebuild() / updateFacet(id) / removeFacet(id)
 *     setShape(id, shape)    — set one facet's shape (flat SHAPE_POINTS*3), no resample
 *     setGrowth(0..1)        — set growth directly
 *     update(dt, ratePerSec) — animate growth toward 1 (call from viewer.onUpdate)
 *     object / dispose()
 */

import * as THREE from 'three';
import { makeHairMaterial } from './hairShader.js';
import { sampleFacetRoots, MAX_STRANDS } from './strandSampler.js';
import { SHAPE_POINTS, straightShape } from './strandShape.js';

// Curve resolution of the template strand = segments between control points.
// Must equal SHAPE_POINTS-1 so each vertex lands on a control point.
const TEMPLATE_SEGMENTS = SHAPE_POINTS - 1;

// Max distinct facet shapes (rows in the shape texture). Hair-bearing facets
// only, so a few hundred in practice; capped well under GL texture limits.
const MAX_SHAPE_ROWS = 4096;

export class GpuHair {
  /**
   * @param {THREE.Mesh} mesh   the groomTarget (must carry userData.catalogue)
   * @param {import('./groom.js').Groom} groom
   */
  constructor(mesh, groom, { color = 0xd4a96a } = {}) {
    this.mesh = mesh;
    this.groom = groom;
    this._catalogue = mesh.userData.catalogue ?? null;
    if (!this._catalogue) console.warn('[GpuHair] no catalogue on mesh — nothing to grow');

    // Instanced SoA, preallocated once (mirrors strands.js — no per-edit GC).
    this._iRoot     = new Float32Array(MAX_STRANDS * 3);
    this._iNormal   = new Float32Array(MAX_STRANDS * 3);
    this._iTangent  = new Float32Array(MAX_STRANDS * 3);
    this._iLength   = new Float32Array(MAX_STRANDS);
    this._iShapeRow = new Float32Array(MAX_STRANDS);

    /** Map<facetId, {offset, count}> — strand index range per facet. */
    this._slices = new Map();
    /** Map<facetId, row> — this facet's row in the shape texture. */
    this._facetRow = new Map();
    this._total = 0;
    this._nextRow = 0;

    this._material = makeHairMaterial({ color });

    // --- Shape data texture: SHAPE_POINTS (wide) × rows (tall), RGBA float. ---
    // One row per facet; texel.xyz = a control point in (T,B,N) coords.
    const rows = Math.min(Math.max(this._catalogue?.facetCount ?? 1, 1), MAX_SHAPE_ROWS);
    this._rows = rows;
    this._shapeData = new Float32Array(SHAPE_POINTS * rows * 4);
    this._shapeTex = new THREE.DataTexture(
      this._shapeData, SHAPE_POINTS, rows, THREE.RGBAFormat, THREE.FloatType,
    );
    this._shapeTex.minFilter = THREE.NearestFilter;
    this._shapeTex.magFilter = THREE.NearestFilter;
    this._shapeTex.generateMipmaps = false;
    this._shapeTex.needsUpdate = true;
    this._material.uniforms.uShapeTex.value = this._shapeTex;
    this._material.uniforms.uShapeTexSize.value.set(SHAPE_POINTS, rows);

    // --- Template: TEMPLATE_SEGMENTS segment-pairs drawn as GL_LINES. --------
    // Positions are unused (the shader builds them); only aT carries meaning.
    const geo = new THREE.InstancedBufferGeometry();
    const verts = TEMPLATE_SEGMENTS * 2;
    const aT = new Float32Array(verts);
    const tmpl = new Float32Array(verts * 3);
    for (let s = 0; s < TEMPLATE_SEGMENTS; s++) {
      aT[s * 2] = s / TEMPLATE_SEGMENTS;
      aT[s * 2 + 1] = (s + 1) / TEMPLATE_SEGMENTS;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(tmpl, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));

    // --- Instanced attributes -----------------------------------------------
    this._aiRoot     = new THREE.InstancedBufferAttribute(this._iRoot, 3);
    this._aiNormal   = new THREE.InstancedBufferAttribute(this._iNormal, 3);
    this._aiTangent  = new THREE.InstancedBufferAttribute(this._iTangent, 3);
    this._aiLength   = new THREE.InstancedBufferAttribute(this._iLength, 1);
    this._aiShapeRow = new THREE.InstancedBufferAttribute(this._iShapeRow, 1);
    this._allInstanced = [this._aiRoot, this._aiNormal, this._aiTangent, this._aiLength, this._aiShapeRow];
    for (const a of this._allInstanced) a.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('iRoot', this._aiRoot);
    geo.setAttribute('iNormal', this._aiNormal);
    geo.setAttribute('iTangent', this._aiTangent);
    geo.setAttribute('iLength', this._aiLength);
    geo.setAttribute('iShapeRow', this._aiShapeRow);

    this._geo = geo;
    this._geo.instanceCount = 0;

    this.object = new THREE.LineSegments(geo, this._material);
    // Displaced strands fall outside the template's (empty) bounds; rather than
    // recompute an instanced bounding volume, lean on the head being on-screen.
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
  }

  // --- Build / edit --------------------------------------------------------

  /** Full rebuild from groom.faces — call after load or masterSeed change. */
  rebuild() {
    this._slices.clear();
    this._facetRow.clear();
    this._total = 0;
    this._nextRow = 0;
    for (const [facetId, params] of this.groom.faces) this._buildFacet(facetId, params);
    this._commit();
    console.info(`[GpuHair] rebuild — ${this._total} strands, ${this._slices.size} facets`);
  }

  /** Resample one facet (density/length change, or first add). */
  updateFacet(facetId) {
    const params = this.groom.faces.get(facetId);
    if (!params) return this.removeFacet(facetId);
    if (this._slices.has(facetId)) this._rebuildExcept(facetId);
    this._buildFacet(facetId, params);
    this._commit();
  }

  /** Drop one facet's strands. */
  removeFacet(facetId) {
    if (!this._slices.has(facetId)) return;
    this._rebuildExcept(facetId);
    this._commit();
  }

  /**
   * Set one facet's shape in place — no resample. `shape` is a flat
   * SHAPE_POINTS*3 array of control points in (T,B,N) local coords, normalised
   * so a straight strand spans z in [0,1] (see strandShape.js). Writes the
   * facet's texture row; the instances already point at it via iShapeRow.
   */
  setShape(facetId, shape) {
    const row = this._facetRow.get(facetId);
    if (row === undefined) return;
    this._writeShapeRow(row, shape);
    // Whole-texture re-upload — fine at prototype sizes. To upload only this
    // row, use a partial DataTexture update (texSubImage via .addUpdateRange /
    // a per-row sub-texture) before setting needsUpdate.
    this._shapeTex.needsUpdate = true;
  }

  /** Set growth directly, 0..1. */
  setGrowth(g) {
    this._material.uniforms.uGrowth.value = Math.max(0, Math.min(1, g));
  }

  /** Per-frame growth: ramp uGrowth toward 1 at `ratePerSec`. No-op if rate<=0. */
  update(dt, ratePerSec = 0) {
    if (ratePerSec <= 0) return;
    const u = this._material.uniforms.uGrowth;
    u.value = Math.min(1, u.value + ratePerSec * dt);
  }

  dispose() {
    this.object.parent?.remove(this.object);
    this._geo.dispose();
    this._shapeTex.dispose();
    this._material.dispose();
  }

  // --- Internals -----------------------------------------------------------

  _rebuildExcept(facetId) {
    const survivors = [...this._slices.keys()].filter((id) => id !== facetId);
    this._slices.clear();
    this._facetRow.clear();
    this._total = 0;
    this._nextRow = 0;
    for (const id of survivors) {
      const p = this.groom.faces.get(id);
      if (p) this._buildFacet(id, p);
    }
  }

  _buildFacet(facetId, params) {
    if (!this._catalogue) return;
    const entry = this._catalogue.getFacet(facetId);
    if (!entry) return;
    if (this._nextRow >= this._rows) {
      console.warn(`[GpuHair] MAX_SHAPE_ROWS reached — facet ${facetId} not shaped`);
      return;
    }

    const offset = this._total;
    const row = this._nextRow++;
    this._facetRow.set(facetId, row);

    // Roots / normals / tangents from the shared sampler — identical sequence
    // to the CPU path, so the two renderers can't drift.
    const n = sampleFacetRoots({
      geometry: this.mesh.geometry,
      entry,
      params,
      masterSeed: this.groom.masterSeed,
      positions: this._iRoot,
      normals: this._iNormal,
      tangents: this._iTangent,
      offset,
      maxStrands: MAX_STRANDS,
    });
    if (n === 0) { this._nextRow--; this._facetRow.delete(facetId); return; }
    if (offset + n >= MAX_STRANDS) {
      console.warn(`[GpuHair] MAX_STRANDS reached — clipped facet ${facetId}`);
    }

    // Per-instance length + shape row are uniform across the facet (shared-shape
    // model): every strand in the facet renders the same polyline at its length.
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      this._iLength[idx] = params.length;
      this._iShapeRow[idx] = row;
    }

    // Write the facet's shape into its texture row (straight by default).
    this._writeShapeRow(row, params.shape ?? straightShape());

    this._slices.set(facetId, { offset, count: n });
    this._total += n;
  }

  /** Write a flat SHAPE_POINTS*3 shape into texture row `row` (rgb, a=1). */
  _writeShapeRow(row, shape) {
    const base = row * SHAPE_POINTS * 4;
    for (let k = 0; k < SHAPE_POINTS; k++) {
      const s = k * 3;
      const d = base + k * 4;
      this._shapeData[d]     = shape[s];
      this._shapeData[d + 1] = shape[s + 1];
      this._shapeData[d + 2] = shape[s + 2];
      this._shapeData[d + 3] = 1.0;
    }
  }

  _commit() {
    this._geo.instanceCount = this._total;
    for (const a of this._allInstanced) a.needsUpdate = true;
    this._shapeTex.needsUpdate = true;
  }
}