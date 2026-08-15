/**
 * seamField.js — turns authored seam permeability into a DISTANCE PENALTY that
 * guide binding can spend.
 *
 * This is the consumer seams.js has been advertising as "(next)" since the
 * store was written. Everything upstream of here was already true — seams are
 * authored, serialised, drawn, selectable, and they stop flood fill — but
 * nothing had ever changed a strand. This file is the missing edge.
 *
 * THE MODEL: A SEAM IS EXTRA DISTANCE, NOT A BOOLEAN.
 *
 * Guide binding weights guides by 1/d², where d is (normal-penalised)
 * Euclidean distance from a strand root to a guide root. A part is exactly the
 * statement "those two points are further apart than they look" — the hair
 * does not know the skull is 3cm across, it knows the flow field is torn. So a
 * seam does not gate the binder; it ADDS to d:
 *
 *     d_eff = d_euclid · normalPenalty + detour(facet_strand, facet_guide)
 *
 * detour is the cheapest total cost of walking the facet graph from the
 * strand's facet to the guide's facet, where crossing the boundary between
 * facets a,b costs
 *
 *     scale · edgeLength · (1/p − 1)
 *
 * That expression is the whole design in one line:
 *
 *   p = 1    → cost 0. A fully permeable edge is free, so a groom with no
 *              seams produces bit-identical bindings to the pre-seam binder.
 *              This is the regression property that matters most: seams must
 *              cost nothing until someone authors one.
 *   p = 0.5  → cost = scale · edgeLength. Crossing is possible but the guide
 *              on the far side reads as further away, so its weight falls off
 *              — over a width you control, which is what a FADE is.
 *   p ≤ 0    → impassable. Not "very expensive": the edge is removed from the
 *              graph, so the far side is reachable only the long way round the
 *              head, which is far enough to zero the weight by itself.
 *
 * ADDITIVE, NOT MULTIPLICATIVE, and this is deliberate. A multiplier scales
 * with how far apart the two points already are, so a soft seam would barely
 * touch adjacent strands (where it should bite) and would violently reject
 * distant ones (which were irrelevant anyway). An additive detour in mesh
 * units is a length you can reason about against guide spacing: a detour of
 * roughly one guide spacing halves the influence, two spacings kills it.
 *
 * WHY A GRAPH WALK AND NOT A PER-EDGE TEST
 *
 * The tempting cheap version is "if the segment root→guide crosses a hard
 * edge, drop the guide". It needs a segment/edge intersection test in 3D on a
 * curved surface, it has no soft case at all, and it is wrong at exactly the
 * place seams exist — a part is a curve, and near its end the correct answer
 * is "you can get there, around the end, at a cost". Dijkstra over the facet
 * adjacency answers that for free, and the catalogue already carries every
 * input it needs (edgesOfFacet, getEdge, edge length).
 *
 * COST AND CACHING
 *
 * One Dijkstra per SOURCE facet, cached. Sources are hair-bearing facets
 * (hundreds), not strands (hundreds of thousands), because every strand on a
 * facet shares the answer — that ratio is the reason this is affordable at
 * all. Searches are bounded by `radius` (Euclidean, from the source centroid;
 * the binder sets it from its own grid cell size) and by `maxFacets`, so a
 * source's field is a few dozen entries, not the whole mesh.
 *
 * INVALIDATION IS THE FAILURE MODE. Every cached field is a function of the
 * seam values at the moment it was built, and SeamStore mutates in place. Any
 * seam edit MUST call invalidate() before the next bind or the cache will
 * cheerfully serve the pre-edit parting forever — which looks exactly like
 * "permeability does nothing", the bug this whole file exists to fix.
 * GpuHairR3.syncSeams() is the one call site that gets this right; route seam
 * edits through it.
 */

import { SEAM_HARD } from './seams.js';

/**
 * Multiplies the raw (1/p − 1) step cost. 1 is the honest geometric reading;
 * the default is higher because a single quad edge is small next to guide
 * spacing, and at scale 1 a soft seam is visible only under a microscope.
 * Tunable live (it is a binder constant, not model state — it does not
 * serialise and is not in history, same as normalPenalty).
 */
export const DEFAULT_SEAM_SCALE = 3;

/** Safety cap on one source's field. Hit only if `radius` is Infinity. */
const MAX_FIELD_FACETS = 4096;

export class SeamField {
  /**
   * @param {import('./facetWireframe.js').FacetCatalogue} catalogue
   * @param {import('./seams.js').SeamStore} seams   held by reference; SeamStore
   *        .copyFrom is in place, so this survives a load or an undo (same
   *        contract as GuideStore — see guides.js).
   * @param {object} [opts]
   * @param {number} [opts.scale=DEFAULT_SEAM_SCALE]
   * @param {number} [opts.radius=Infinity]  Euclidean search bound, mesh units
   */
  constructor(catalogue, seams, { scale = DEFAULT_SEAM_SCALE, radius = Infinity } = {}) {
    this._catalogue = catalogue ?? null;
    this._seams     = seams ?? null;
    this._scale     = scale;
    this._radius    = radius;
    /** @type {Map<number, Map<number, number>>} source facet → field */
    this._cache     = new Map();
    this._truncated = false;
  }

  /**
   * False when there is nothing to compute — no catalogue, no store, or no
   * authored seam anywhere. Callers check this to take the old fast path
   * verbatim rather than paying for a lookup that can only return 0.
   */
  get active() {
    return !!(this._catalogue && this._seams && this._seams.count > 0);
  }

  get scale() { return this._scale; }

  /** Drop every cached field. Call after ANY seam edit. */
  invalidate() { this._cache.clear(); this._truncated = false; }

  setScale(s) {
    const v = Math.max(0, s);
    if (v === this._scale) return;
    this._scale = v;
    this.invalidate();
  }

  /**
   * Bound the search. The binder calls this with a few grid cells' worth of
   * distance: guides further away than that lose on Euclidean distance alone,
   * so walking to them would only be for the pleasure of it.
   */
  setRadius(r) {
    const v = r > 0 ? r : Infinity;
    if (v === this._radius) return;
    this._radius = v;
    this.invalidate();
  }

  /**
   * Extra distance, in mesh units, for hair to get from facet `from` to facet
   * `to`. 0 when nothing blocks; Infinity when the only paths are hard seams
   * (or when `to` lies outside the search bound — see the note in
   * guideBinding.js on why that is safe).
   *
   * A facet id of -1 (a guide not rooted on any facet) returns 0 rather than
   * Infinity: unknown provenance must not silently delete a guide.
   */
  detour(from, to) {
    if (!this.active) return 0;
    if (from < 0 || to < 0 || from === to) return 0;
    let field = this._cache.get(from);
    if (!field) { field = this._build(from); this._cache.set(from, field); }
    const d = field.get(to);
    return d === undefined ? Infinity : d;
  }

  get stats() {
    return { cached: this._cache.size, scale: this._scale, radius: this._radius,
             truncated: this._truncated, active: this.active };
  }

  // --- internals ------------------------------------------------------------

  /** Dijkstra from one facet over the seam-weighted adjacency. */
  _build(src) {
    const cat  = this._catalogue;
    const dist = new Map([[src, 0]]);
    const heap = new MinHeap();
    heap.push(src, 0);

    const origin = this._radius === Infinity ? null : cat.getFacet(src)?.centroid ?? null;
    const r2 = this._radius * this._radius;

    while (heap.size > 0) {
      const { id, cost } = heap.pop();
      if (cost > (dist.get(id) ?? Infinity)) continue;   // stale heap entry
      if (dist.size >= MAX_FIELD_FACETS) {
        if (!this._truncated) {
          this._truncated = true;
          console.warn('[SeamField] field truncated at ' +
            `${MAX_FIELD_FACETS} facets — set a search radius`);
        }
        break;
      }

      for (const eid of cat.edgesOfFacet(id)) {
        const e = cat.getEdge(eid);
        if (!e || e.b < 0) continue;                     // mesh boundary
        const other = e.a === id ? e.b : e.a;

        const p = this._seams.get(e.a, e.b);
        if (p <= SEAM_HARD) continue;                    // a wall, not a cost

        // Free when p is 1, which keeps a seamless groom on the old path.
        const step = p >= 1 ? 0 : this._scale * e.length * (1 / p - 1);
        const next = cost + step;
        if (next >= (dist.get(other) ?? Infinity)) continue;

        if (origin) {
          const c = cat.getFacet(other)?.centroid;
          if (c) {
            const dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
            if (dx * dx + dy * dy + dz * dz > r2) continue;
          }
        }

        dist.set(other, next);
        heap.push(other, next);
      }
    }
    return dist;
  }
}

/**
 * Binary min-heap keyed by cost. Lazy deletion (a decrease-key pushes a second
 * entry and the stale one is skipped on pop) — the graph is small and sparse,
 * so an index-tracking heap would be more code for no measurable win.
 */
class MinHeap {
  constructor() { this._ids = []; this._cost = []; }
  get size() { return this._ids.length; }

  push(id, cost) {
    this._ids.push(id); this._cost.push(cost);
    let i = this._ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._cost[p] <= this._cost[i]) break;
      this._swap(p, i); i = p;
    }
  }

  pop() {
    const id = this._ids[0], cost = this._cost[0];
    const lastId = this._ids.pop(), lastCost = this._cost.pop();
    if (this._ids.length > 0) {
      this._ids[0] = lastId; this._cost[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this._ids.length && this._cost[l] < this._cost[m]) m = l;
        if (r < this._ids.length && this._cost[r] < this._cost[m]) m = r;
        if (m === i) break;
        this._swap(m, i); i = m;
      }
    }
    return { id, cost };
  }

  _swap(a, b) {
    const i = this._ids[a]; this._ids[a] = this._ids[b]; this._ids[b] = i;
    const c = this._cost[a]; this._cost[a] = this._cost[b]; this._cost[b] = c;
  }
}
