/**
 * gpuHairR3.js — GPU-instanced strand renderer, guide-blend model (R3).
 *
 * Successor to gpuHair.js. The rendering skeleton is unchanged — preallocated
 * instanced SoA, per-facet {offset,count} slices, one draw call, a float data
 * texture of normalised control-point polylines — but the texture is re-keyed:
 *
 *     R2:  one row per FACET.  Each strand reads exactly one row (iShapeRow).
 *     R3:  one row per GUIDE.  Each strand blends THREE rows by weight
 *          (iGuideRow / iGuideW), so the shape field is smooth across facet
 *          boundaries instead of piecewise-constant.
 *
 * Two independent index spaces, and keeping them straight is the whole trick:
 *
 *   FACETS  own strand allocation. _slices : Map<facetId,{offset,count}> over
 *           the instanced attributes. Density/length/add/remove edits resample
 *           one facet — same incrementality R2 had.
 *   GUIDES  own the texture. _guideRow : Map<guideId,row>. Combing rewrites
 *           rows and touches no instance data at all.
 *
 * The bridge between them is the BINDING (guideBinding.js), recomputed only
 * when the guide SET or the strand SET changes. Combing edits guide *points*;
 * binding depends on guide *roots*; therefore combing never rebinds. That is
 * the entire performance argument for this design — interaction cost scales
 * with guides (~10²) while rendering scales with strands (~10⁵) — so do not
 * call rebind() from a comb stroke's onEdit.
 *
 * Per-facet `length` is retired as an instanced attribute: length now lives in
 * the guide texture (texel(row,0).w) and is blended alongside the shape, which
 * is what gives smooth length gradients (layered cuts) between long and short
 * guides. groom.faces.length still seeds new guides; it no longer renders.
 *
 * Requires (see integration notes):
 *   - strandSampler.sampleFacetRoots accepting an optional `seeds` view.
 *   - guideBinding.bindStrandsToGuides accepting `outTangents` (in-place,
 *     sampler tangent as fallback).
 *
 * Public API — the renderer.js interface, plus guide/look extensions:
 *     rebuild() / updateFacet(id) / removeFacet(id)
 *     syncGuides()                 — re-read the GuideStore (rows + rebind)
 *     setGuide(id, points, length) — rewrite one guide's row, no resample
 *     setLook({clump, jitter, lenVar})
 *     setComb({a, b, radius} | null)   mesh-local comb capsule, vertex pushout
 *     setGrowth(0..1) / update(dt, ratePerSec)
 *     object / dispose()
 *
 * Parent under the head mesh so strand data stays in clean mesh-local space:
 *     groomTarget.add(hair.object);
 */

import * as THREE from 'three';
import { makeHairMaterialR3 } from './hairShaderGuides.js';
import { bindStrandsToGuides, GUIDES_PER_STRAND } from './guideBinding.js';
import { sampleFacetRoots, MAX_STRANDS } from './strandSampler.js';
import { SHAPE_POINTS, straightShape } from './strandShape.js';

/** Curve resolution of the template strand; vertices land on control points. */
const TEMPLATE_SEGMENTS = SHAPE_POINTS - 1;

/** Texture rows are grown geometrically from here, capped at MAX_GUIDE_ROWS. */
const INITIAL_GUIDE_ROWS = 256;
const MAX_GUIDE_ROWS     = 8192;

export class GpuHairR3 {
  /**
   * @param {THREE.Mesh} mesh   the groomTarget (must carry userData.catalogue)
   * @param {import('./groom.js').Groom} groom
   * @param {import('./guides.js').GuideStore} guides
   */
  constructor(mesh, groom, guides, { color = 0xd4a96a } = {}) {
    this.mesh   = mesh;
    this.groom  = groom;
    this.guides = guides;

    this._catalogue = mesh.userData.catalogue ?? null;
    if (!this._catalogue) console.warn('[GpuHairR3] no catalogue on mesh — nothing to grow');

    // --- Instanced SoA, preallocated once (no per-edit GC) -------------------
    this._iRoot     = new Float32Array(MAX_STRANDS * 3);
    this._iNormal   = new Float32Array(MAX_STRANDS * 3);
    this._iTangent  = new Float32Array(MAX_STRANDS * 3);
    this._iGuideRow = new Float32Array(MAX_STRANDS * 3);
    this._iGuideW   = new Float32Array(MAX_STRANDS * 3);
    this._iSeed     = new Float32Array(MAX_STRANDS);

    /** Map<facetId, {offset, count}> — strand index range per facet. */
    this._slices = new Map();
    this._total  = 0;

    /** Map<guideId, row> and its inverse, in row order (the binder needs it). */
    this._guideRow  = new Map();
    this._guideList = [];

    this._material = makeHairMaterialR3({ color });

    // --- Guide texture: SHAPE_POINTS wide × rows tall, RGBA float ------------
    // texel(row, k).xyz = control point k in that guide's (T,B,N) coords.
    // texel(row, 0).w   = guide length in mesh units (point 0 is the origin,
    //                     so its alpha is free real estate).
    this._rows = 0;
    this._shapeData = null;
    this._shapeTex  = null;
    this._ensureRows(Math.max(guides?.count ?? 0, INITIAL_GUIDE_ROWS));

    // --- Template geometry: segment-pairs drawn as GL_LINES ------------------
    // Positions are unused (the shader builds them); only aT carries meaning.
    const geo   = new THREE.InstancedBufferGeometry();
    const verts = TEMPLATE_SEGMENTS * 2;
    const aT    = new Float32Array(verts);
    const tmpl  = new Float32Array(verts * 3);
    for (let s = 0; s < TEMPLATE_SEGMENTS; s++) {
      aT[s * 2]     = s / TEMPLATE_SEGMENTS;
      aT[s * 2 + 1] = (s + 1) / TEMPLATE_SEGMENTS;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(tmpl, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));

    // --- Instanced attributes ------------------------------------------------
    this._aiRoot     = new THREE.InstancedBufferAttribute(this._iRoot, 3);
    this._aiNormal   = new THREE.InstancedBufferAttribute(this._iNormal, 3);
    this._aiTangent  = new THREE.InstancedBufferAttribute(this._iTangent, 3);
    this._aiGuideRow = new THREE.InstancedBufferAttribute(this._iGuideRow, 3);
    this._aiGuideW   = new THREE.InstancedBufferAttribute(this._iGuideW, 3);
    this._aiSeed     = new THREE.InstancedBufferAttribute(this._iSeed, 1);
    this._allInstanced = [
      this._aiRoot, this._aiNormal, this._aiTangent,
      this._aiGuideRow, this._aiGuideW, this._aiSeed,
    ];
    for (const a of this._allInstanced) a.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('iRoot',     this._aiRoot);
    geo.setAttribute('iNormal',   this._aiNormal);
    geo.setAttribute('iTangent',  this._aiTangent);
    geo.setAttribute('iGuideRow', this._aiGuideRow);
    geo.setAttribute('iGuideW',   this._aiGuideW);
    geo.setAttribute('iSeed',     this._aiSeed);

    this._geo = geo;
    this._geo.instanceCount = 0;

    this.object = new THREE.LineSegments(geo, this._material);
    // Displaced strands fall outside the template's (empty) bounds; rather than
    // maintain an instanced bounding volume, lean on the head being on-screen.
    this.object.frustumCulled = false;
    this.object.renderOrder   = 1;
  }

  // --- Build / edit ---------------------------------------------------------

  /**
   * Full rebuild: guide rows, then every facet's strands, then bind.
   * Call after load, after a masterSeed change, or after a groom swap.
   */
  rebuild() {
    this._syncGuideRows();
    this._slices.clear();
    this._total = 0;
    for (const [facetId, params] of this.groom.faces) this._buildFacet(facetId, params);
    this._rebind();
    this._commit();
    console.info(
      `[GpuHairR3] rebuild — ${this._total} strands, ${this._slices.size} facets, ` +
      `${this._guideList.length} guides`
    );
  }

  /** Resample one facet (density change, or first add). Rebinds: new strands. */
  updateFacet(facetId) {
    const params = this.groom.faces.get(facetId);
    if (!params) return this.removeFacet(facetId);
    if (this._slices.has(facetId)) this._rebuildExcept(facetId);
    this._buildFacet(facetId, params);
    this._rebind();
    this._commit();
  }

  /** Drop one facet's strands. Does NOT remove guides rooted on it — the UI
   *  decides whether "remove hair" should also delete that facet's guides. */
  removeFacet(facetId) {
    if (!this._slices.has(facetId)) return;
    this._rebuildExcept(facetId);
    this._rebind();
    this._commit();
  }

  /**
   * Re-read the GuideStore: reassign rows, rewrite the texture, rebind.
   * Call after guides are ADDED or REMOVED (not after they are combed).
   */
  syncGuides() {
    this._syncGuideRows();
    this._rebind();
    this._commit();
  }

  /**
   * Rewrite one guide's texture row in place — the comb stroke's hot path.
   * No resample, no rebind, no instance data touched.
   *
   * @param {number}   guideId
   * @param {number[]|Float32Array} points  flat SHAPE_POINTS*3, normalised
   * @param {number}   length               mesh units
   */
  setGuide(guideId, points, length) {
    const row = this._guideRow.get(guideId);
    if (row === undefined) return;
    this._writeGuideRow(row, points, length);
    // Whole-texture re-upload. At realistic guide counts this is small — 2048
    // guides × SHAPE_POINTS × 4 floats ≈ 0.5 MB — and a stroke dirties many
    // rows at once anyway, so batching beats per-row calls. If this ever shows
    // up in a profile, track dirty rows here and flush them with
    // renderer.copyTextureToTexture over a one-row staging texture.
    this._shapeTex.needsUpdate = true;
  }

  /** Batch form of setGuide — what CombTool.onEdit should call. */
  setGuides(guideIds) {
    for (const id of guideIds) {
      const g = this.guides.get(id);
      if (!g) continue;
      const row = this._guideRow.get(id);
      if (row === undefined) continue;
      this._writeGuideRow(row, g.points, g.length);
    }
    this._shapeTex.needsUpdate = true;
  }

  /** Live look controls — pure uniforms, no rebuild, no rebind. */
  setLook({ clump, jitter, lenVar } = {}) {
    const u = this._material.uniforms;
    if (clump  !== undefined) u.uClump.value  = Math.max(1, clump);
    if (jitter !== undefined) u.uJitter.value = Math.max(0, jitter);
    if (lenVar !== undefined) u.uLenVar.value = Math.max(0, lenVar);
  }

  /**
   * Publish the comb capsule for the vertex-side pushout. Mesh-local, matching
   * the space strand positions are built in. Pass null (or radius <= 0) to
   * disable. Pure uniform write — no rebuild, no rebind, no resample.
   */
  setComb(pose) {
    const u = this._material.uniforms;
    if (!pose || !(pose.radius > 0)) { u.uCombR.value = 0; return; }
    u.uCombA.value.copy(pose.a);
    u.uCombB.value.copy(pose.b);
    u.uCombR.value = pose.radius;
  }

  /** Set growth directly, 0..1. */
  setGrowth(g) {
    this._material.uniforms.uGrowth.value = Math.max(0, Math.min(1, g));
  }

  /** Per-frame growth ramp toward 1 at `ratePerSec`. No-op if rate <= 0. */
  update(dt, ratePerSec = 0) {
    if (ratePerSec <= 0) return;
    const u = this._material.uniforms.uGrowth;
    u.value = Math.min(1, u.value + ratePerSec * dt);
  }

  /** CPU-path parity no-op: per-facet shapes are superseded by guides. */
  setShape(_facetId, _shape) { /* R2 API; guides own shape now */ }

  dispose() {
    this.object.parent?.remove(this.object);
    this._geo.dispose();
    this._shapeTex.dispose();
    this._material.dispose();
  }

  // --- Guide rows -----------------------------------------------------------

  /**
   * Assign a texture row to every guide in the store and write them all.
   * Rows are reassigned wholesale: row identity is not stable across a sync,
   * which is exactly why _rebind() must follow (bindings store rows).
   */
  _syncGuideRows() {
    const list = [...this.guides.guides.values()];
    if (list.length > MAX_GUIDE_ROWS) {
      console.warn(`[GpuHairR3] ${list.length} guides exceeds MAX_GUIDE_ROWS — truncating`);
      list.length = MAX_GUIDE_ROWS;
    }
    this._ensureRows(Math.max(list.length, 1));

    this._guideRow.clear();
    this._guideList = list;
    for (let row = 0; row < list.length; row++) {
      const g = list[row];
      this._guideRow.set(g.id, row);
      this._writeGuideRow(row, g.points ?? straightShape(), g.length);
    }
    // Unused rows keep stale data; nothing indexes them, so leave them be.
    this._shapeTex.needsUpdate = true;
    this._material.uniforms.uGuideTexSize.value.set(SHAPE_POINTS, this._rows);
  }

  /** Grow the guide texture to hold at least `need` rows (geometric, ×2). */
  _ensureRows(need) {
    if (this._shapeTex && need <= this._rows) return;
    let rows = Math.max(this._rows || INITIAL_GUIDE_ROWS, 1);
    while (rows < need) rows *= 2;
    rows = Math.min(rows, MAX_GUIDE_ROWS);

    const data = new Float32Array(SHAPE_POINTS * rows * 4);
    if (this._shapeData) data.set(this._shapeData.subarray(0, Math.min(this._shapeData.length, data.length)));
    this._shapeTex?.dispose();

    const tex = new THREE.DataTexture(data, SHAPE_POINTS, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this._rows      = rows;
    this._shapeData = data;
    this._shapeTex  = tex;
    this._material.uniforms.uGuideTex.value = tex;
    this._material.uniforms.uGuideTexSize.value.set(SHAPE_POINTS, rows);
  }

  /** Write a normalised polyline + its length into texture row `row`. */
  _writeGuideRow(row, points, length) {
    const base = row * SHAPE_POINTS * 4;
    for (let k = 0; k < SHAPE_POINTS; k++) {
      const s = k * 3;
      const d = base + k * 4;
      this._shapeData[d]     = points[s];
      this._shapeData[d + 1] = points[s + 1];
      this._shapeData[d + 2] = points[s + 2];
      this._shapeData[d + 3] = k === 0 ? length : 1.0; // length rides in texel 0's alpha
    }
  }

  // --- Strands --------------------------------------------------------------

  _rebuildExcept(facetId) {
    const survivors = [...this._slices.keys()].filter((id) => id !== facetId);
    this._slices.clear();
    this._total = 0;
    for (const id of survivors) {
      const p = this.groom.faces.get(id);
      if (p) this._buildFacet(id, p);
    }
  }

  _buildFacet(facetId, params) {
    if (!this._catalogue) return;
    const entry = this._catalogue.getFacet(facetId);
    if (!entry) return;

    const offset = this._total;

    // Roots / normals / tangents / seeds from the shared sampler. The tangent
    // written here is the sampler's arbitrary in-plane frame; _rebind()
    // overwrites it with the blended guide flow where a binding exists, so
    // this value survives only for strands with no guide near them.
    const n = sampleFacetRoots({
      geometry:   this.mesh.geometry,
      entry,
      params,
      masterSeed: this.groom.masterSeed,
      positions:  this._iRoot,
      normals:    this._iNormal,
      tangents:   this._iTangent,
      seeds:      this._iSeed,
      offset,
      maxStrands: MAX_STRANDS,
    });
    if (n === 0) return;
    if (offset + n >= MAX_STRANDS) {
      console.warn(`[GpuHairR3] MAX_STRANDS reached — clipped facet ${facetId}`);
    }

    this._slices.set(facetId, { offset, count: n });
    this._total += n;
  }

  /**
   * Recompute strand→guide bindings over ALL strands.
   *
   * Cost is O(strands); at 200k strands this is a few ms, which is fine for
   * add/remove/resample but NOT for a 60fps comb stroke. Combing must not
   * reach this function — see the class header.
   */
  _rebind() {
    if (this._total === 0) return;
    if (this._guideList.length === 0) {
      // No guides: neutral binding — row 0, full weight on a straight default.
      this._iGuideRow.fill(0, 0, this._total * 3);
      for (let i = 0; i < this._total; i++) {
        this._iGuideW[i * 3] = 1; this._iGuideW[i * 3 + 1] = 0; this._iGuideW[i * 3 + 2] = 0;
      }
      this._writeGuideRow(0, straightShape(), this.groom.globals.length);
      this._shapeTex.needsUpdate = true;
      return;
    }

    bindStrandsToGuides({
      rootPositions: this._iRoot,
      rootNormals:   this._iNormal,
      total:         this._total,
      guideList:     this._guideList,   // MUST be in texture-row order
      outRows:       this._iGuideRow,
      outWeights:    this._iGuideW,
      outTangents:   this._iTangent,    // in place: sampler value is the fallback
    });
  }

  _commit() {
    this._geo.instanceCount = this._total;
    for (const a of this._allInstanced) a.needsUpdate = true;
    this._shapeTex.needsUpdate = true;
  }

  // --- Introspection (UI / debug) -------------------------------------------

  get stats() {
    return {
      strands: this._total,
      facets:  this._slices.size,
      guides:  this._guideList.length,
      rows:    this._rows,
      perStrandGuides: GUIDES_PER_STRAND,
    };
  }
}