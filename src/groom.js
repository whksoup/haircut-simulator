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
 * THE ROUND TRIP IS A TESTED INVARIANT, not an aspiration:
 *
 *     Groom.fromJSON(g.toJSON()).toJSON()   deep-equals   g.toJSON()
 *
 * for every schema version, and one further pass changes nothing. See
 * persistence_test.mjs. That identity is what makes it safe for #5 and #6 to
 * add fields: a new field is correct exactly when it still holds, which is a
 * one-line addition to a test rather than a judgement call.
 *
 * LOADING VALIDATES, AND VALIDATION THROWS. A groom file is plain JSON the
 * user can hand-edit and keep across a schema bump, so the failure that
 * matters is not a file that throws — it is a file that loads and is subtly
 * wrong. Every field goes through schemaGuards.js on the way in; see that
 * header for why the rule is reject-don't-guess. ui.js already surfaces
 * `e.message` from this path, so a thrown error is the only channel that
 * reaches the person holding the bad file.
 *
 * A FILE FROM A NEWER BUILD IS REFUSED. `migrate` used to pass unknown and
 * future versions through untouched, which meant a v6 file opened in a v5
 * build produced a v5 groom with whatever v6 added silently dropped — and then
 * SAVED over it. Forward compatibility is not something a schema gets for
 * free, and pretending otherwise costs the user their work rather than an
 * error message.
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

import { straightShape, cloneShape, SHAPE_POINTS } from './strandShape.js';
import { GuideStore } from './guides.js';
import { SeamStore }  from './seams.js';
import { fail, number, numberOr, integer, floatArray } from './schemaGuards.js';

export const GROOM_SCHEMA_VERSION = 5;

/** The oldest version `migrate` knows how to walk forward from. */
export const GROOM_OLDEST_SUPPORTED = 1;

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

  /**
   * Builds a Groom from a plain object (e.g. parsed JSON), with migration.
   * Throws — with the offending field named — on anything it cannot defend.
   */
  static fromJSON(raw) {
    const data  = migrate(raw);
    const groom = new Groom();

    if (data.globals !== undefined && data.globals !== null) {
      if (typeof data.globals !== 'object') fail('globals must be an object');
      groom.globals = {
        density:  numberOr(data.globals.density,  groom.globals.density,  'globals.density'),
        length:   numberOr(data.globals.length,   groom.globals.length,   'globals.length'),
        segments: numberOr(data.globals.segments, groom.globals.segments, 'globals.segments'),
      };
    }
    groom.masterSeed = numberOr(data.masterSeed, groom.masterSeed, 'masterSeed');

    const faces = data.faces ?? [];
    if (!Array.isArray(faces)) fail('faces must be an array');
    groom.faces = new Map();
    faces.forEach((f, i) => {
      if (f == null || typeof f !== 'object') fail(`faces[${i}] must be an object`);
      const facetId = integer(f.facetId, `faces[${i}].facetId`);
      if (groom.faces.has(facetId)) {
        // A Map silently keeps the last write, so a duplicated facet would
        // load as "the second one won" with no indication the first existed.
        fail(`faces[${i}] repeats facetId ${facetId}`);
      }
      groom.faces.set(facetId, {
        density:  numberOr(f.density,  groom.globals.density,  `faces[${i}].density`),
        length:   numberOr(f.length,   groom.globals.length,   `faces[${i}].length`),
        segments: numberOr(f.segments, groom.globals.segments, `faces[${i}].segments`),
        // Vestigial, but it round-trips and seedFromGroom still reads it, so it
        // gets the same length check the live polylines get.
        shape: f.shape === undefined || f.shape === null
          ? straightShape()
          : floatArray(f.shape, SHAPE_POINTS * 3, `faces[${i}].shape`),
      });
    });

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
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      // JSON.parse's own message ("Unexpected token < in JSON at position 0")
      // is about bytes; this says what the file was supposed to be, which is
      // the more useful half when someone has picked the wrong file.
      fail(`not valid JSON — ${e.message}`);
    }
    return Groom.fromJSON(raw);
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
 * Cases chain: a v1 blob runs 1→2, 2→3, 3→4, 4→5.
 *
 * v1 → v2  faceIndex → facetId; drop per-face seed; backfill params; drop
 *          the top-level `selected` array.
 * v2 → v3  drop per-face `comb`; default `shape` to a straight strand.
 * v3 → v4  emit an empty guides array. Guides are NOT derived here because
 *          seeding needs facet centroids and normals from the catalogue,
 *          which the data model can't see. main.js calls
 *          GuideStore.seedFromGroom after load when guides come back empty —
 *          that's where a v3 groom actually becomes a v4 one.
 * v4 → v5  emit an empty seams array — behaviourally identical to v4, since
 *          an absent seam means full permeability.
 *
 * VERSIONS ARE BOUNDED IN BOTH DIRECTIONS.
 *
 * Below the floor there is nothing to do: v1 predates the version field, so an
 * absent version IS v1 and is migrated. But a version field that is present
 * and not a number is not a legacy file, it is a corrupt one, and quietly
 * treating "5" or null as v1 would run the v1→v2 rename over a v5 groom and
 * destroy every facet record.
 *
 * Above the ceiling the file is from a NEWER BUILD. It used to pass through
 * untouched, which is the worst of the three options: the load appears to
 * succeed, whatever the newer schema added is dropped on the floor, and the
 * next save writes the truncated version back over the user's file. There is
 * no way to guess the meaning of a field that did not exist when this code was
 * written, so the only honest answer is to refuse. This matters more from here
 * on, not less — #5 and #6 both add fields, so a v6 file in a v5 build stops
 * being hypothetical the moment the scissors land.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('cannot deserialise a non-object');
  }

  let data = { ...raw };

  if (data.version === undefined || data.version === null) {
    data.version = 1;                       // predates the field; genuinely v1
  } else {
    number(data.version, 'version');
    if (!Number.isInteger(data.version)) fail(`version must be a whole number, got ${data.version}`);
  }

  if (data.version < GROOM_OLDEST_SUPPORTED) {
    fail(`version ${data.version} is below the oldest supported (v${GROOM_OLDEST_SUPPORTED})`);
  }
  if (data.version > GROOM_SCHEMA_VERSION) {
    fail(
      `this file is schema v${data.version}, but this build only understands up to ` +
      `v${GROOM_SCHEMA_VERSION}. Loading it would silently drop whatever v${data.version} ` +
      `added, and the next save would write that loss back over the file. Update the app.`,
    );
  }

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