/**
 * Groom — the serializable data model.
 *
 * Everything that defines the haircut lives here as plain, JSON-able state:
 * the selected face set, per-face params, guides, global defaults, and RNG
 * seeds. Nothing in here touches Three.js. This is what enables save/load,
 * undo/redo, and deterministic regeneration down the line.
 *
 * Runtime uses richer structures (Set, Map) for ergonomics; serialization
 * flattens them to arrays. Keep the two in sync via toJSON / fromJSON only.
 */

export const GROOM_SCHEMA_VERSION = 1;

export class Groom {
  constructor() {
    /** Global defaults, applied to any face without an override. */
    this.globals = {
      density: 1.0, // strands per unit area multiplier
      length: 0.1, // strand length in mesh units
      segments: 4, // polyline segments per strand
    };

    /** Master seed; per-face seeds derive from this for determinism. */
    this.masterSeed = 1337;

    /** Set<faceIndex> — which triangles are hair-bearing. (Phase 1) */
    this.selected = new Set();

    /**
     * Map<faceIndex, { seed, density?, length? }> — per-face overrides and the
     * stable seed used for root sampling. (Phase 1/2)
     */
    this.faces = new Map();

    /** Guide curves for styling. (Phase 3) */
    this.guides = [];
  }

  // --- serialization -------------------------------------------------------

  /** Returns a plain JSON-able snapshot. */
  toJSON() {
    return {
      version: GROOM_SCHEMA_VERSION,
      globals: { ...this.globals },
      masterSeed: this.masterSeed,
      selected: [...this.selected],
      faces: [...this.faces.entries()].map(([faceIndex, params]) => ({
        faceIndex,
        ...params,
      })),
      guides: this.guides.map((g) => ({ ...g })),
    };
  }

  /** Builds a Groom from a plain object (e.g. parsed JSON), with migration. */
  static fromJSON(raw) {
    const data = migrate(raw);
    const groom = new Groom();
    groom.globals = { ...groom.globals, ...data.globals };
    groom.masterSeed = data.masterSeed ?? groom.masterSeed;
    groom.selected = new Set(data.selected ?? []);
    groom.faces = new Map(
      (data.faces ?? []).map(({ faceIndex, ...params }) => [faceIndex, params])
    );
    groom.guides = (data.guides ?? []).map((g) => ({ ...g }));
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

  /** Copy another groom's state into this instance (keeps the reference). */
  copyFrom(other) {
    this.globals = { ...other.globals };
    this.masterSeed = other.masterSeed;
    this.selected = new Set(other.selected);
    this.faces = new Map(other.faces);
    this.guides = other.guides.map((g) => ({ ...g }));
    return this;
  }

  // --- summary -------------------------------------------------------------

  get stats() {
    return {
      selectedFaces: this.selected.size,
      guides: this.guides.length,
    };
  }
}

/**
 * Upgrade an older serialized groom to the current schema. Add new cases as
 * the schema evolves; unknown/future versions pass through untouched.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Groom: cannot deserialize non-object');
  }
  let data = raw;
  // Example placeholder for future migrations:
  // if (data.version === 1) { data = { ...data, version: 2, newField: ... }; }
  if (typeof data.version !== 'number') {
    // Treat versionless blobs as the earliest known schema.
    data = { ...data, version: 1 };
  }
  return data;
}
