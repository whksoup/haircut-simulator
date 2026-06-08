/**
 * hair.js — runtime store for hair-bearing facets and their per-facet params.
 *
 * Populated by the raycast shift-click selection. Consumed by the strand
 * generator (Phase 2) when it needs to know which facets carry hair and
 * what density/length/segments to use for each.
 *
 * Kept separate from groom.js (the serializable model) intentionally:
 * HairStore is the live runtime view; Groom is the save/load artefact.
 * They sync in one direction — Groom.fromHairStore() / HairStore.applyGroom()
 * will be added when serialization matters.
 *
 * Per-facet record shape (for reference):
 * {
 *   facetId : number,
 *   density : number,   // strands per unit area multiplier (inherits global default)
 *   length  : number,   // strand length in mesh units
 *   segments: number,   // polyline segments per strand
 * }
 */

export class HairStore {
  constructor(globals = {}) {
    /**
     * Global defaults — applied to any facet without an explicit override.
     * Matches the shape in Groom.globals.
     */
    this.globals = {
      density : 1.0,
      length  : 0.1,
      segments: 4,
      ...globals,
    };

    /** Map<facetId, per-facet record> — the hair region. */
    this._facets = new Map();
  }

  // ---------------------------------------------------------------------------
  // Selection sync — called by raycast.onHairChange

  /**
   * Sync the store to a Set<facetId> from the raycaster.
   * Adds new facets with global defaults; removes deselected ones.
   * Existing overrides on retained facets are preserved.
   */
  syncFromSelection(facetIdSet) {
    // Remove facets no longer selected.
    for (const id of this._facets.keys()) {
      if (!facetIdSet.has(id)) this._facets.delete(id);
    }
    // Add newly selected facets.
    for (const id of facetIdSet) {
      if (!this._facets.has(id)) {
        this._facets.set(id, {
          facetId : id,
          density : this.globals.density,
          length  : this.globals.length,
          segments: this.globals.segments,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read

  /** Returns the per-facet record, or undefined if facet has no hair. */
  getFacet(facetId) {
    return this._facets.get(facetId);
  }

  /** Iterate all hair facet records. */
  facets() {
    return this._facets.values();
  }

  /** Ordered array of facetIds — stable handle for the strand generator. */
  get facetIds() {
    return [...this._facets.keys()];
  }

  get size() {
    return this._facets.size;
  }

  // ---------------------------------------------------------------------------
  // Write

  /** Override one param on a specific facet. */
  setParam(facetId, key, value) {
    const rec = this._facets.get(facetId);
    if (rec) rec[key] = value;
  }

  /** Reset a facet's params back to current globals. */
  resetFacet(facetId) {
    const rec = this._facets.get(facetId);
    if (!rec) return;
    rec.density  = this.globals.density;
    rec.length   = this.globals.length;
    rec.segments = this.globals.segments;
  }
}