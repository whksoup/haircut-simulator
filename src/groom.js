/**
 * Groom — the serializable data model (schema v5, seams).
 *
 * Everything that defines the haircut lives here as plain, JSON-able state.
 * Nothing in here touches Three.js.
 *
 * The three axes, and the thing to hold onto when reading this file:
 *
 *   faces   — WHERE hair grows. Per-facet density / length. Drives sampling.
 *   guides  — WHAT SHAPE it is. A GuideStore of authored strands. Drives the
 *             rendered curve of every strand via k-nearest blending.
 *   seams   — WHERE THE STYLE BREAKS. Per-facet-boundary permeability. Drives
 *             how far blending is allowed to reach across a parting.
 *
 * These are independent: you can add hair to a facet with no guide on it (it
 * borrows nearby guides), and a guide influences strands well beyond its own
 * facet. Facet resolution no longer limits style fidelity — guide density does.
 *
 * Changes from v4:
 *   - `seams` is a SeamStore: a sparse map from facet PAIR to permeability.
 *     Sparse and pair-keyed on purpose — see the seams.js header. A v4 groom
 *     migrates to an empty SeamStore, which is behaviourally identical to
 *     having no seams at all, so nothing about an old file changes on load.
 *
 * Changes from v3:
 *   - `guides` is now a GuideStore (was an unused plain array).
 *   - Per-facet `shape` is VESTIGIAL: still stored so v3 files round-trip and
 *     so GuideStore.seedFromGroom can read it during migration, but nothing
 *     renders from it in the R3 path. Left in place rather than deleted so an
 *     old groom can still be opened and converted.
 *   - `segments` likewise only matters to the retiring CPU renderer.
 *
 * Carried over:
 *   - `faces` keyed by facetId; per-facet seeds derived from masterSeed.
 *   - Per-facet records are self-contained snapshots of globals at add time.
 */

import { straightShape, cloneShape } from './strandShape.js';
import { GuideStore } from './guides.js';
import { SeamStore }  from './seams.js';

export const GROOM_SCHEMA_VERSION = 5;

export class Groom {
  constructor() {
    /** Global defaults copied into a facet record at addFacet time. */
    this.globals = {
      density:  0.02,  // strands per unit area multiplier
      length:   0.5,  // strand length in mesh units
      segments: 4,    // polyline segments per strand (CPU path only)
    };

    /** Master seed. Per-facet seeds are derived; only this is serialised. */
    this.masterSeed = 1337;

    /**
     * Map<facetId, { density, length, segments, shape }> — the hair region.
     * Absence of a record means the facet has no hair. `shape` is vestigial
     * in v4 (see the header).
     */
    this.faces = new Map();

    /** Authored guide strands — the hairstyle itself. */
    this.guides = new GuideStore();

    /** Authored seam permeability across facet boundaries. Sparse. */
    this.seams = new SeamStore();
  }

  // --- hair region mutators -------------------------------------------------

  /** True iff facetId is currently in the hair region. */
  hasFacet(facetId) {
    return this.faces.has(facetId);
  }

  /**
   * Add facetId to the hair region, inheriting a snapshot of current globals.
   * No-op if the facet already has a record (preserves per-facet edits).
   * Does NOT create a guide — main.js decides that, since it needs the
   * catalogue for the root frame.
   */
  addFacet(facetId) {
    if (this.faces.has(facetId)) return;
    this.faces.set(facetId, {
      density:  this.globals.density,
      length:   this.globals.length,
      segments: this.globals.segments,
      shape:    straightShape(),
    });
  }

  /**
   * Remove facetId from the hair region. Guides rooted on it are removed too —
   * leaving orphan guides floating over bald scalp would keep bending the hair
   * of neighbouring facets, which reads as a bug.
   *
   * SEAMS ARE DELIBERATELY LEFT ALONE. A guide is hair and dies with the hair;
   * a seam is a property of the SCALP — where the hairline is, where the ear
   * meets the skull — and that is still true of a facet you have shaved. Wiping
   * them here would mean removing hair and putting it back silently destroyed
   * an authored parting, and would make the dihedral seeding pass non-idempotent
   * with respect to the hair region.
   */
  removeFacet(facetId) {
    this.faces.delete(facetId);
    for (const g of this.guides.byFacet(facetId)) this.guides.remove(g.id);
  }

  // --- serialization -------------------------------------------------------

  toJSON() {
    return {
      version:    GROOM_SCHEMA_VERSION,
      masterSeed: this.masterSeed,
      globals:    { ...this.globals },
      faces: [...this.faces.entries()].map(([facetId, p]) => ({
        facetId,
        density:  p.density,
        length:   p.length,
        segments: p.segments,
        shape:    cloneShape(p.shape),
      })),
      guides: this.guides.toJSON(),
      seams:  this.seams.toJSON(),
    };
  }

  /** Builds a Groom from a plain object (e.g. parsed JSON), with migration. */
  static fromJSON(raw) {
    const data  = migrate(raw);
    const groom = new Groom();
    groom.globals    = { ...groom.globals, ...data.globals };
    groom.masterSeed = data.masterSeed ?? groom.masterSeed;
    groom.faces      = new Map(
      (data.faces ?? []).map(({ facetId, density, length, segments, shape }) => [
        facetId,
        { density, length, segments, shape: cloneShape(shape) },
      ])
    );
    groom.guides = GuideStore.fromJSON(data.guides ?? []);
    groom.seams  = SeamStore.fromJSON(data.seams ?? []);
    return groom;
  }

  /** Pretty JSON string for download. */
  serialize() {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  /** Parse a JSON string into a new Groom. Throws on malformed input. */
  static deserialize(text) {
    return Groom.fromJSON(JSON.parse(text));
  }

  /**
   * Copy another Groom's state into this instance (keeps the reference).
   * Deep-copies everything so the two Grooms never share mutable state.
   *
   * `guides` is copied IN PLACE rather than replaced. Three long-lived objects
   * capture `groom.guides` at construction and never re-read it — see
   * GuideStore.copyFrom. Replacing the store here silently detached all of
   * them on every file load; undo, which restores through this same path,
   * would have hit it on every structural step.
   */
  copyFrom(other) {
    this.globals    = { ...other.globals };
    this.masterSeed = other.masterSeed;
    this.faces      = new Map(
      [...other.faces.entries()].map(([id, p]) => [
        id,
        { density: p.density, length: p.length, segments: p.segments, shape: cloneShape(p.shape) },
      ])
    );
    this.guides.copyFrom(other.guides);
    this.seams.copyFrom(other.seams);
    return this;
  }

  // --- summary -------------------------------------------------------------

  get stats() {
    return {
      hairFaces: this.faces.size,
      guides:    this.guides.count,
      seams:     this.seams.count,
    };
  }
}

/**
 * Upgrade an older serialised Groom to the current schema.
 * Cases chain: a v1 blob runs 1→2, 2→3, 3→4. Unknown/future versions pass
 * through untouched.
 *
 * v1 → v2  faceIndex → facetId; drop per-face seed; backfill params; drop
 *          the top-level `selected` array.
 * v2 → v3  drop per-face `comb`; default `shape` to a straight strand.
 * v4 → v5  emit an empty seams array — behaviourally identical to v4, since
 *          an absent seam means full permeability.
 * v3 → v4  emit an empty guides array. Guides are NOT derived here because
 *          seeding needs facet centroids and normals from the catalogue,
 *          which the data model can't see. main.js calls
 *          GuideStore.seedFromGroom after load when guides come back empty —
 *          that's where a v3 groom actually becomes a v4 one.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Groom: cannot deserialise non-object');
  }

  let data = { ...raw };
  if (typeof data.version !== 'number') data.version = 1;

  if (data.version === 1) {
    const g = data.globals ?? {};
    data = {
      ...data,
      version: 2,
      faces: (data.faces ?? []).map(({ faceIndex, seed, ...rest }) => ({
        facetId:  faceIndex,
        density:  rest.density  ?? g.density  ?? 1.0,
        length:   rest.length   ?? g.length   ?? 0.1,
        segments: rest.segments ?? g.segments ?? 4,
        comb:     rest.comb     ?? [0, 0, 0],
      })),
    };
    delete data.selected;
  }

  if (data.version === 2) {
    data = {
      ...data,
      version: 3,
      faces: (data.faces ?? []).map(({ comb, shape, ...rest }) => ({
        ...rest,
        shape: shape ?? straightShape(),
      })),
    };
  }

  if (data.version === 3) {
    // A v3 `guides` field, if present, was the unused placeholder array of
    // arbitrary objects — discard it rather than feed it to GuideStore.
    data = { ...data, version: 4, guides: [] };
  }

  if (data.version === 4) {
    // No seams is the same as every boundary fully permeable, which is exactly
    // how v4 behaved. Nothing to derive, nothing to warn about.
    data = { ...data, version: 5, seams: [] };
  }

  return data;
}
