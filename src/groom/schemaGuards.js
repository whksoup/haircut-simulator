/**
 * schemaGuards.js — the checks a groom file has to survive before anything
 * downstream is allowed to believe it.
 *
 * WHY THIS IS A MODULE AND NOT THREE COPIES OF `Number.isFinite`.
 *
 * A groom is a plain-JSON file the user can hand-edit, email, and keep across
 * a schema bump. The failure mode that matters is not a file that throws — it
 * is a file that LOADS and is subtly wrong: a guide with eight control points
 * instead of nine, a `NaN` root that puts a strand at the origin, a seam whose
 * permeability is missing and silently defaults to the most destructive value
 * in the range. None of those look like errors. They look like the app having
 * a bad day.
 *
 * So the rule throughout is: REJECT, DO NOT GUESS. Every helper here either
 * returns a value it can defend or throws with the field named. The only
 * things given defaults are fields whose absence has one obvious meaning
 * (`facetId` absent → free guide) or that a live constructor would derive
 * anyway (`tangent` absent → seeded from the normal, exactly as GuideStore.add
 * does).
 *
 * The counter-example the codebase already learned from is in ui.js: the
 * permeability field refuses to parse unparseable input rather than writing 0,
 * because 0 is a hard part and quietly hard-parting a head is the worst
 * available outcome. SeamStore.fromJSON had precisely that bug (`s.p ?? 0`);
 * `permeability()` below is the fix.
 *
 * Errors are thrown, not logged. ui.js already wraps the load in a try/catch
 * that surfaces `e.message` to the user, so a thrown error is the only channel
 * that actually reaches them — a console.warn during a file load is invisible.
 * Messages therefore name the record and the field, because "could not load
 * groom" on its own is not actionable on a file you cannot see.
 */

/** Namespaced so a thrown message reads as coming from the file format. */
export function fail(msg) {
  throw new Error(`Groom file: ${msg}`);
}

/** A finite number, or throw. Rejects NaN, Infinity, null, "3", undefined. */
export function number(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(`${where} must be a finite number, got ${describe(v)}`);
  }
  return v;
}

/**
 * A finite number, or `fallback` when the field is simply absent.
 *
 * ABSENT AND WRONG ARE NOT THE SAME THING. `undefined`/`null` means an older
 * or partial file and takes the default; anything else present but unusable is
 * an error. Folding the two together is how `s.p ?? 0` turned a missing field
 * into a hard part.
 */
export function numberOr(v, fallback, where) {
  if (v === undefined || v === null) return fallback;
  return number(v, where);
}

/** A finite number clamped to [lo, hi]. Out-of-range is clamped, not rejected —
 *  a hand-edited 1.2 means "fully open" unambiguously; a NaN does not. */
export function clamped(v, lo, hi, where) {
  const n = number(v, where);
  return n < lo ? lo : n > hi ? hi : n;
}

/** Permeability: present, finite, clamped to [0,1]. No default — see header. */
export function permeability(v, where) {
  return clamped(v, 0, 1, where);
}

/** A copy of a 3-element finite vector, or throw. */
export function vec3(v, where) {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) {
    fail(`${where} must be a 3-element array, got ${describe(v)}`);
  }
  if (v.length !== 3) fail(`${where} must have 3 elements, got ${v.length}`);
  return [number(v[0], `${where}[0]`), number(v[1], `${where}[1]`), number(v[2], `${where}[2]`)];
}

/**
 * A 3-vector that has to name a DIRECTION: finite, and not degenerate.
 *
 * DELIBERATELY NOT NORMALISED. Every consumer re-orthonormalises the frame
 * anyway (GuideStore.pointWorldLocal, CombTool._frame, the shader), so
 * normalising here buys nothing — and it would cost the round-trip identity,
 * which is the one property this whole file exists to protect. `x / hypot(x,y,z)`
 * on an already-unit vector is not guaranteed to be a fixed point in floating
 * point, so `fromJSON(toJSON(g))` could differ from `g` in the last ulp and
 * then differ AGAIN on the next pass. A load must not quietly edit the file.
 *
 * A ZERO vector is the one case that does throw: there is no direction to
 * recover, and every frame built from it would be silently degenerate.
 */
export function direction(v, where) {
  const [x, y, z] = vec3(v, where);
  if (Math.hypot(x, y, z) < 1e-9) {
    fail(`${where} is a zero-length direction; there is no frame to build from it`);
  }
  return [x, y, z];
}

/**
 * A flat float array of exactly `expect` elements, copied to a plain Array.
 *
 * THE LENGTH CHECK IS THE POINT. A guide polyline is SHAPE_POINTS*3 floats and
 * every consumer indexes it by hand — the shader row writer, the comb's lift,
 * the length audit. A short array does not throw anywhere; it reads
 * `undefined`, arithmetic turns that into NaN, and the strand vanishes from the
 * render with no error anywhere. This is the check that turns that into a
 * sentence.
 */
export function floatArray(v, expect, where) {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) {
    fail(`${where} must be an array of ${expect} numbers, got ${describe(v)}`);
  }
  if (v.length !== expect) {
    fail(`${where} must have exactly ${expect} numbers, got ${v.length}`);
  }
  const out = new Array(expect);
  for (let i = 0; i < expect; i++) out[i] = number(v[i], `${where}[${i}]`);
  return out;
}

/** An integer id, or throw. Facet ids index the mesh; a fractional one is a
 *  corrupt file, not a rounding question. */
export function integer(v, where) {
  const n = number(v, where);
  if (!Number.isInteger(n)) fail(`${where} must be an integer, got ${n}`);
  return n;
}

export function integerOr(v, fallback, where) {
  if (v === undefined || v === null) return fallback;
  return integer(v, where);
}

/** Short, safe rendering of whatever showed up, for the error message. */
function describe(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'nothing';
  if (typeof v === 'number') return String(v);          // covers NaN / Infinity
  if (Array.isArray(v)) return `an array of ${v.length}`;
  return typeof v;
}
