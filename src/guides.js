/**
 * guides.js — guide-strand data model (R3, schema v4 direction). SKETCH.
 *
 * A GUIDE is one authored strand: a root frame on the scalp plus a normalised
 * local-frame control polyline (same convention as strandShape.js — x along T,
 * y along B, z along N, straight = (0,0,t), z spans [0,1]). Render strands do
 * not store shapes any more; each blends its k nearest guides (guideBinding.js
 * + hairShaderGuides.js). Guides are the hairstyle; strands reconstruct it.
 *
 * Design notes:
 *  - `tangent` is AUTHORED, not derived: it's captured from the first comb
 *    stroke over the guide (or seeded from shapeBasis). This replaces the
 *    arbitrary tangent rule as the source of frame coherence across the scalp.
 *  - `points` stay normalised so `length` remains a pure scale and the
 *    solveLengths invariant (SHAPE_REST per segment) is unchanged.
 *  - Migration: seedFromGroom() drops one guide per hair-bearing facet at its
 *    centroid, initialised from that facet's existing v3 `shape`, so a v3
 *    groom renders identically under the guide model.
 *
 * LOADING IS CHECKED, BECAUSE A BAD GUIDE DOES NOT THROW ANYWHERE ELSE.
 *
 * `points` is a flat SHAPE_POINTS*3 buffer that every consumer indexes by hand
 * — the texture row writer, the comb's lift into mesh-local, the length audit.
 * A short array does not fail: it reads `undefined`, arithmetic turns that into
 * NaN, and the strand quietly disappears from a render of two hundred thousand
 * others. Nothing logs. `fromJSON` therefore checks the length rather than
 * trusting it, and names the guide when it doesn't match. Same for a zero
 * normal, which yields a degenerate frame and a strand pointing nowhere.
 *
 * The one field that is DERIVED rather than rejected is `tangent`: `add()`
 * already seeds it from the normal via shapeBasis when a caller omits it, so a
 * file that omits it is under-specified, not corrupt, and gets the same
 * treatment. Everything else is reject-don't-guess — see schemaGuards.js.
 */

import * as THREE from 'three';
import {
  SHAPE_POINTS, SHAPE_REST, straightShape, cloneShape, shapeBasis,
} from './strandShape.js';
import { fail, number, numberOr, integerOr, direction, vec3, floatArray } from './schemaGuards.js';

/**
 * @typedef {Object} Guide
 * @property {number}   id       — stable id (row assignment is the renderer's job)
 * @property {number}   facetId  — facet the root sits on (for region ops); -1 if free
 * @property {number[]} root     — [x,y,z] mesh-local root position
 * @property {number[]} normal   — [x,y,z] unit growth normal at the root
 * @property {number[]} tangent  — [x,y,z] unit authored flow tangent (⊥ normal)
 * @property {number[]} points   — flat SHAPE_POINTS*3 normalised local polyline
 * @property {number}   length   — strand length in mesh units
 */

export const GUIDE_SCHEMA_VERSION = 4;

/** Default when a file omits `length` entirely. Matches `add()`. */
const DEFAULT_LENGTH = 0.1;

export class GuideStore {
  constructor() {
    /** @type {Map<number, Guide>} */
    this.guides = new Map();
    this._nextId = 1;
  }

  get count() { return this.guides.size; }

  /** Add a guide; fills defaults; returns its id. */
  add({ facetId = -1, root, normal, tangent = null, points = null, length = DEFAULT_LENGTH }) {
    const id = this._nextId++;
    const [nx, ny, nz] = normal;
    let t = tangent;
    if (!t) {
      const b = shapeBasis(nx, ny, nz);       // seed frame; comb stroke re-authors it
      t = [b.tx, b.ty, b.tz];
    }
    this.guides.set(id, {
      id, facetId,
      root:    [...root],
      normal:  [...normal],
      tangent: [...t],
      points:  points ? cloneShape(points) : straightShape(),
      length,
    });
    return id;
  }

  remove(id) { return this.guides.delete(id); }
  get(id)    { return this.guides.get(id); }

  /** All guides rooted on a facet (for "remove hair from selection" etc.). */
  byFacet(facetId) {
    return [...this.guides.values()].filter((g) => g.facetId === facetId);
  }

  /**
   * v3 → v4 migration / bootstrap: one guide per hair-bearing facet, at the
   * facet centroid, carrying the facet's existing shape + length. Call once
   * after load when groom.guides is empty but groom.faces is not.
   *
   * @param {import('./groom.js').Groom} groom
   * @param {import('./facetWireframe.js').FacetCatalogue} catalogue
   */
  seedFromGroom(groom, catalogue) {
    for (const [facetId, params] of groom.faces) {
      const entry = catalogue.getFacet(facetId);
      if (!entry) continue;
      this.add({
        facetId,
        root:   entry.centroid.toArray(),
        normal: entry.normal.toArray(),
        points: params.shape ?? straightShape(),
        length: params.length,
      });
    }
    console.info(`[GuideStore] seeded ${this.count} guides from ${groom.faces.size} facets`);
  }

  // --- serialization (embeds under Groom.toJSON().guides in schema v4) -----

  toJSON() {
    return [...this.guides.values()].map((g) => ({
      id: g.id, facetId: g.facetId,
      root: [...g.root], normal: [...g.normal], tangent: [...g.tangent],
      points: cloneShape(g.points), length: g.length,
    }));
  }

  /**
   * Replace this store's contents with another's, IN PLACE.
   *
   * The identity of the GuideStore object must survive a load or an undo:
   * CombTool, GpuHairR3 and GuideDebugView each capture `groom.guides` once at
   * construction and hold it forever. Swapping in a fresh store (which
   * `Groom.copyFrom` used to do) left all three pointing at an orphan — the
   * comb would go on editing guides nothing rendered. Everything is deep-copied
   * so the two stores never share mutable state.
   */
  copyFrom(other) {
    this.guides.clear();
    this._nextId = 1;
    for (const g of other.guides.values()) {
      this.guides.set(g.id, {
        id: g.id, facetId: g.facetId,
        root: [...g.root], normal: [...g.normal], tangent: [...g.tangent],
        points: cloneShape(g.points), length: g.length,
      });
      this._nextId = Math.max(this._nextId, g.id + 1);
    }
    return this;
  }

  static fromJSON(arr) {
    if (arr === undefined || arr === null) arr = [];
    if (!Array.isArray(arr)) fail('guides must be an array');

    const store = new GuideStore();
    arr.forEach((g, i) => {
      if (g == null || typeof g !== 'object') fail(`guides[${i}] must be an object`);

      // The id is the key everything else refers to — history patches, the
      // renderer's row map, the comb's stroke set — so a missing or duplicated
      // one is not a field to default, it is a broken file.
      const id = number(g.id, `guides[${i}].id`);
      if (!Number.isInteger(id)) fail(`guides[${i}].id must be an integer, got ${id}`);
      if (store.guides.has(id)) fail(`guides[${i}] repeats id ${id}`);

      const normal = direction(g.normal, `guides[${i}].normal`);

      // Under-specified rather than corrupt: `add()` seeds the tangent from
      // the normal when a caller omits it, so a file may omit it too. A
      // tangent that is PRESENT and unusable still throws.
      let tangent;
      if (g.tangent === undefined || g.tangent === null) {
        const b = shapeBasis(normal[0], normal[1], normal[2]);
        tangent = [b.tx, b.ty, b.tz];
      } else {
        tangent = direction(g.tangent, `guides[${i}].tangent`);
      }

      const length = numberOr(g.length, DEFAULT_LENGTH, `guides[${i}].length`);
      if (length <= 0) fail(`guides[${i}].length must be positive, got ${length}`);

      store.guides.set(id, {
        id,
        facetId: integerOr(g.facetId, -1, `guides[${i}].facetId`),
        root:    vec3(g.root, `guides[${i}].root`),
        normal,
        tangent,
        // THE LENGTH CHECK THAT MATTERS. See the header: a short polyline is
        // silent everywhere downstream.
        points: g.points === undefined || g.points === null
          ? straightShape()
          : floatArray(g.points, SHAPE_POINTS * 3, `guides[${i}].points`),
        length,
      });
      store._nextId = Math.max(store._nextId, id + 1);
    });
    return store;
  }

  // --- convenience ----------------------------------------------------------

  /**
   * Mesh-local world position of guide control point k (for hit-testing and
   * the guide overlay renderer). out is an optional THREE.Vector3.
   */
  pointWorldLocal(guide, k, out = new THREE.Vector3()) {
    const { root, normal, tangent, points, length } = guide;
    const [nx, ny, nz] = normal;
    // Orthonormalise T against N (mirrors the shader's re-orthogonalisation).
    const [txr, tyr, tzr] = tangent;
    const d = txr * nx + tyr * ny + tzr * nz;
    let tx = txr - nx * d, ty = tyr - ny * d, tz = tzr - nz * d;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

    const s = k * 3;
    const lx = points[s], ly = points[s + 1], lz = points[s + 2];
    return out.set(
      root[0] + (tx * lx + bx * ly + nx * lz) * length,
      root[1] + (ty * lx + by * ly + ny * lz) * length,
      root[2] + (tz * lx + bz * ly + nz * lz) * length,
    );
  }
}

export { SHAPE_POINTS, SHAPE_REST };