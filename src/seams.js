/**
 * seams.js — authored seam permeability across facet boundaries.
 *
 * A SEAM is not an object you place. It is a scalar on an edge of the facet
 * graph saying how freely hair may blend across that boundary:
 *
 *     1.0  invisible. The default for every edge, stored nowhere.
 *     0.5  a soft transition — a fade. Weight still crosses, but attenuated.
 *     0.0  a hard part. Nothing blends across; the two sides are independent.
 *
 * ONE PARAMETER GIVES YOU BOTH KINDS OF TRANSITION, which is the whole reason
 * to model it as a continuous permeability rather than a boolean "is a part".
 * A partially permeable edge makes the effective distance across it larger but
 * finite, so guide weight falls off over a controllable width — that is what a
 * fade IS. A boolean can only produce the hard case.
 *
 * WHY KEYED BY FACET PAIR AND NOT BY EDGE ID
 *
 * Edge ids come from the catalogue's build order, which is deterministic for a
 * given geometry and meaningless across a re-export from Blender. Facet ids
 * are already the thing this whole system bets on — groom.faces is keyed by
 * them — so seams ride the same bet rather than adding a second, weaker one.
 * The cost is that a facet pair sharing two distinct edges gets one shared
 * permeability. That case does not occur on a well-formed quad head, and the
 * alternative silently invalidates every saved groom on re-export.
 *
 * WHY THIS IS NOT ON FacetEdge
 *
 * The catalogue is DERIVED from the mesh and must be rebuildable at any
 * moment with nothing authored inside it. Permeability is authored, so it
 * lives in the Groom and serialises with it. That separation is also what
 * keeps groom.js free of Three.js: this file imports nothing but the guards.
 *
 * A MISSING PERMEABILITY IS NOT ZERO. `fromJSON` used to read `s.p ?? 0`,
 * which turned any seam record missing its value into a HARD PART — the single
 * most destructive value in the range, applied silently, at load time. ui.js
 * had already learned this lesson on the same field and refuses to parse
 * unparseable input rather than writing 0; the loader now agrees with it. A
 * record without a `p` is a broken file and says so.
 *
 * CONSUMERS
 *   - raycast.js       flood-fill selection stops at seams
 *   - seamOverlay.js   draws them
 *   - seamField.js     turns permeability into a graph distance penalty:
 *                      crossing an edge costs scale · length · (1/p − 1), and
 *                      a hard seam is removed from the graph outright
 *   - guideBinding.js  spends that penalty, so a seam attenuates (or stops)
 *                      the guide weight crossing it. This is the consumer that
 *                      makes an authored part show up in the hair; every seam
 *                      edit therefore has to reach renderer.syncSeams(), which
 *                      main.js funnels through seamsChanged().
 */

import { fail, integer, permeability } from './schemaGuards.js';

/** Below this, an edge is treated as fully impermeable by consumers. */
export const SEAM_HARD = 0.02;

/** Default seeding threshold, degrees of dihedral angle. */
export const DEFAULT_CREASE_DEG = 40;

export class SeamStore {
  constructor() {
    /** @type {Map<string, number>} "a_b" (a<b) → permeability in [0,1]. */
    this.seams = new Map();
  }

  /** Number of edges with an explicit (non-default) permeability. */
  get count() { return this.seams.size; }

  /** Canonical key for an unordered facet pair. Matches FacetCatalogue. */
  static key(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

  /**
   * Permeability across the boundary between two facets.
   * Unrecorded pairs return 1 — absence means "fully blended", so a groom with
   * no seams behaves exactly as it did before seams existed.
   */
  get(a, b) {
    const v = this.seams.get(SeamStore.key(a, b));
    return v === undefined ? 1 : v;
  }

  /**
   * Set permeability. Writing 1 DELETES the entry rather than storing it: the
   * map is a sparse override table, and keeping explicit 1s would bloat every
   * saved file with the default and make `count` useless as a "how much have I
   * authored" readout.
   */
  set(a, b, p_) {
    const p = p_ < 0 ? 0 : p_ > 1 ? 1 : p_;
    const k = SeamStore.key(a, b);
    if (p >= 1) this.seams.delete(k);
    else        this.seams.set(k, p);
    return p;
  }

  /** True if this boundary blocks blending outright. */
  isHard(a, b) { return this.get(a, b) <= SEAM_HARD; }

  /** Remove an override, restoring the default. */
  clear(a, b) { return this.seams.delete(SeamStore.key(a, b)); }

  /** Remove every override. */
  clearAll() { this.seams.clear(); }

  // --- serialization (embeds under Groom.toJSON().seams in schema v5) -------

  toJSON() {
    return [...this.seams.entries()].map(([key, p]) => {
      const [a, b] = key.split('_');
      return { a: +a, b: +b, p };
    });
  }

  /**
   * Note the round-trip asymmetry, which is intentional and bounded: `set`
   * deletes any entry at p >= 1, so a hand-written file containing `p: 1` loads
   * as no entry at all. `toJSON` never emits one, so this only ever bites on
   * the first load of a hand-edited file, and the second pass is stable —
   * which is exactly the property persistence_test.mjs asserts.
   */
  static fromJSON(arr) {
    if (arr === undefined || arr === null) arr = [];
    if (!Array.isArray(arr)) fail('seams must be an array');

    const store = new SeamStore();
    arr.forEach((s, i) => {
      if (s == null || typeof s !== 'object') fail(`seams[${i}] must be an object`);
      const a = integer(s.a, `seams[${i}].a`);
      const b = integer(s.b, `seams[${i}].b`);
      if (a === b) fail(`seams[${i}] joins facet ${a} to itself`);
      // NO DEFAULT. See the header: `?? 0` here silently hard-parted the head.
      const p = permeability(s.p, `seams[${i}].p`);
      const k = SeamStore.key(a, b);
      if (store.seams.has(k)) fail(`seams[${i}] repeats the pair ${k}`);
      // Route through set() so the >= 1 deletion rule applies to hand-edited
      // files too.
      store.set(a, b, p);
    });
    return store;
  }

  /**
   * Replace contents IN PLACE. Same reasoning as GuideStore.copyFrom — long
   * lived consumers capture `groom.seams` once and must not be orphaned by a
   * load or an undo.
   */
  copyFrom(other) {
    this.seams.clear();
    for (const [k, v] of other.seams) this.seams.set(k, v);
    return this;
  }
}

// ---------------------------------------------------------------------------

/**
 * Seed seams from surface creases.
 *
 * The catalogue already computes a dihedral angle and a convexity flag per
 * edge, so "mark every boundary sharper than N degrees" is a filter, not an
 * algorithm. On a head this lights up the hairline, the ear/skull junction and
 * the jaw — which is a very good first guess at where hair stops blending, and
 * a bad enough guess in places that it must remain editable afterwards. Treat
 * it as a starting point you then clean up, never as ground truth.
 *
 * MODE, and why it exists. Hair parts along VALLEYS (concave folds — behind
 * the ear, under the jaw) far more often than along RIDGES (convex bulges —
 * the brow, the crown). Seeding both is noisier than seeding valleys alone,
 * so 'concave' is the default even though 'both' is the obvious behaviour.
 *
 * FALLOFF. A crease is rarely a step. `softness` widens the response: edges at
 * exactly the threshold get permeability 1, edges `softness` degrees past it
 * get 0, and anything sharper stays 0. Setting softness to 0 restores the hard
 * binary behaviour.
 *
 * REPLACES rather than merges: seeding twice with different thresholds should
 * give the second threshold's result, not the union. Pass `keepExisting` to
 * layer instead, in which case the strictest (lowest) value wins per edge.
 *
 * @param {import('./facetWireframe.js').FacetCatalogue} catalogue
 * @param {SeamStore} store
 * @param {object} [opts]
 * @param {number}  [opts.thresholdDeg=40]
 * @param {number}  [opts.softness=15]      degrees over which 1 → 0
 * @param {'concave'|'convex'|'both'} [opts.mode='concave']
 * @param {boolean} [opts.keepExisting=false]
 * @returns {{marked:number, examined:number, hard:number}}
 */
export function seedSeamsFromCreases(catalogue, store, {
  thresholdDeg = DEFAULT_CREASE_DEG,
  softness     = 15,
  mode         = 'concave',
  keepExisting = false,
} = {}) {
  if (!catalogue) return { marked: 0, examined: 0, hard: 0 };
  if (!keepExisting) store.clearAll();

  const threshold = (thresholdDeg * Math.PI) / 180;
  const soft      = Math.max((softness * Math.PI) / 180, 1e-6);

  let marked = 0, examined = 0, hard = 0;

  for (const e of catalogue.edges()) {
    if (e.b < 0 || e.dihedral < 0) continue;      // mesh boundary: no pair
    examined++;

    if (mode === 'concave' && e.convex) continue;
    if (mode === 'convex' && !e.convex) continue;
    if (e.dihedral <= threshold) continue;

    // 1 at the threshold, 0 by threshold + softness.
    const over = (e.dihedral - threshold) / soft;
    const p = over >= 1 ? 0 : 1 - over;

    if (keepExisting && p >= store.get(e.a, e.b)) continue;  // strictest wins
    store.set(e.a, e.b, p);
    marked++;
    if (p <= SEAM_HARD) hard++;
  }

  console.info(
    `[seams] seeded ${marked} of ${examined} edges from creases ` +
    `(> ${thresholdDeg}deg, ${mode}, softness ${softness}deg); ${hard} fully hard.`
  );
  return { marked, examined, hard };
}