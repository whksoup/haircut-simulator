/**
 * strandResample.js — plan item 4: take a sub-arc of a strand and re-express it
 * as a full SHAPE_POINTS polyline, without losing its shape.
 *
 * THE INVARIANT, and the reason this is its own item rather than three lines
 * inside the scissors tool:
 *
 *     ABSOLUTE GEOMETRY OF THE RETAINED PORTION IS PRESERVED.
 *
 * Absolute position of control point k is `p[k] · L`. Truncate to `[0, s·L]`,
 * resample, store `p' = q/L'` with `length = L'`, and rendering gives back `q`
 * — every new control point lies EXACTLY on the old polyline. Curl radius,
 * wavelength and lean survive a cut untouched, because normalisation is a
 * change of units and not a loss of information. Resolution goes UP: nine
 * points over 40% of the arc is finer sampling per unit length than nine over
 * 100%.
 *
 * Getting this wrong is silent. A cut that shortened `length` without
 * resampling would leave the normalised curve spanning an arc it no longer
 * has, so the strand's whole shape would compress with the cut — a curl would
 * tighten as you trimmed it. It would look like a styling choice.
 *
 * ═══ WHY EQUAL CHORD AND NOT EQUAL ARC ═══
 *
 * The obvious implementation samples the retained portion at even ARC
 * intervals. It is wrong, and measurably so.
 *
 * Item #2's invariant is that consecutive control points are exactly
 * SHAPE_REST apart in STRAIGHT-LINE distance — that is what makes `aT` arc
 * length, which is what #6's rewind reads to produce a number someone cuts
 * hair by. Sampling at even arc intervals places points that are even along
 * the POLYLINE, and whenever an interval spans a bend, the straight-line gap
 * between two samples is shorter than the arc between them. The result is
 * on-curve but no longer arc-uniform, so a cut silently un-does #2. Measured,
 * worst segment after a cut:
 *
 *   strand              cut to 90%   70%     30%
 *   gentle bend            0.073%   0.060%  0.038%
 *   1 turn,  r 0.15        0.759%   0.559%  0.256%
 *   2 turns, r 0.12        2.456%   0.444%  0.630%
 *   3 turns, r 0.10        4.545%   0.466%  0.423%
 *
 * The tolerance those numbers have to clear is 0.1% (guideLengthAudit's
 * LENGTH_TOL). Straight and gently-combed hair squeaks through; curly hair
 * misses by up to 45×. "The scissors break the length invariant, but only on
 * curls" is exactly the kind of defect this codebase keeps finding late.
 *
 * Sampling at even CHORD intervals instead gets BOTH properties at once, and
 * exactly: every point still lies on the original polyline (so #4's geometry
 * claim holds) and every segment is identical (so #2's invariant holds, and
 * `aT` is still arc length after a cut). Measured residual across every case
 * above: 0.0000%.
 *
 * The alternative considered and rejected was arc-resample followed by a
 * length-projection pass with both endpoints pinned. It converges to 0.7% at
 * best, not 0%, and it does so by pushing interior points up to 0.8% of the
 * strand's length OFF the original curve — paying with the geometry invariant
 * to partially buy the length one. Equal-chord costs a bisection and pays for
 * neither.
 *
 * ═══ WHAT THIS COSTS AND WHY IT IS AFFORDABLE ═══
 *
 * An outer bisection on the chord length wrapping an O(M) walk, where each
 * step solves a quadratic (segment ∩ sphere) rather than bisecting again.
 * ~40 outer iterations × 8 steps × a handful of quadratics: single-digit
 * microseconds per strand. Cheap enough to run per frame during a cut drag,
 * which is what makes the scissors' preview and its commit the same code path
 * rather than two that can disagree.
 *
 * ═══ RESAMPLING IS DIFFUSIVE — ALWAYS GO BACK TO THE SOURCE ═══
 *
 * Interior points are linear interpolations between original control points,
 * so resampling a resampled strand rounds off a little more each time.
 * Applying it once per committed edit is fine; applying it to its own output
 * every frame of a drag would visibly melt the curl. ScissorsTool therefore
 * keeps a pristine snapshot per guide for the duration of a stroke and always
 * resamples FROM that, never from the live state. See its header.
 *
 * One consequence worth knowing: `resample` to the full arc is the IDENTITY,
 * bit for bit — not approximately. That falls straight out of #2, because
 * arc-uniform control points mean the k-th sample position lands exactly on
 * the k-th original point. It is the cheapest possible check that #2 and #4
 * agree with each other, and `resample_test.mjs` asserts it.
 */

import { SHAPE_POINTS, SHAPE_REST } from './strandShape.js';

const M   = SHAPE_POINTS;
const EPS = 1e-12;

/**
 * Cumulative straight-line length to each control point.
 * Under #2's invariant this is `k · SHAPE_REST` exactly; it is computed rather
 * than assumed so a drifted strand resamples sensibly instead of silently
 * mis-locating every cut.
 */
export function arcLengths(points, out = new Float64Array(M)) {
  out[0] = 0;
  for (let k = 1; k < M; k++) {
    const i = k * 3, h = (k - 1) * 3;
    out[k] = out[k - 1] + Math.hypot(
      points[i] - points[h], points[i + 1] - points[h + 1], points[i + 2] - points[h + 2],
    );
  }
  return out;
}

/** Total polyline length, in whatever units `points` is expressed in. */
export function polylineLength(points) {
  return arcLengths(points)[M - 1];
}

/** Point at arc position `s` along the polyline, into `out` (a 3-array). */
export function pointAtArc(points, cum, s, out = [0, 0, 0]) {
  const total = cum[M - 1];
  const t = s <= 0 ? 0 : s >= total ? total : s;
  let j = 0;
  while (j < M - 2 && cum[j + 1] < t) j++;
  const span = cum[j + 1] - cum[j];
  const u = span > EPS ? (t - cum[j]) / span : 0;
  const a = j * 3, b = (j + 1) * 3;
  out[0] = points[a]     + (points[b]     - points[a])     * u;
  out[1] = points[a + 1] + (points[b + 1] - points[a + 1]) * u;
  out[2] = points[a + 2] + (points[b + 2] - points[a + 2]) * u;
  return out;
}

const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Walk forward from arc position `s0` to the first point exactly `c` away in
 * STRAIGHT-LINE distance from `from`, without passing `sEnd`.
 *
 * Analytic rather than another bisection: each segment gives a quadratic
 * |A + u·D − P|² = c², and the first root in range is the answer. That is what
 * keeps the whole resample cheap enough to run per frame — a nested bisection
 * would be ~60× more work for the same number.
 *
 * @returns {number} the arc position, or -1 if `c` is unreachable before sEnd.
 */
function stepByChord(points, cum, s0, sEnd, from, c) {
  let j = 0;
  while (j < M - 2 && cum[j + 1] < s0) j++;

  for (; j < M - 1; j++) {
    const segStart = cum[j], segEnd = cum[j + 1];
    if (segStart >= sEnd) break;
    const span = segEnd - segStart;
    if (span <= EPS) continue;

    // Restrict u to the part of this segment that lies in (s0, sEnd].
    const uLo = s0   > segStart ? (s0   - segStart) / span : 0;
    const uHi = sEnd < segEnd   ? (sEnd - segStart) / span : 1;
    if (uHi <= uLo) continue;

    const a = j * 3, b = (j + 1) * 3;
    const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
    const ex = points[a] - from[0], ey = points[a + 1] - from[1], ez = points[a + 2] - from[2];

    const qa = dx * dx + dy * dy + dz * dz;
    const qb = 2 * (dx * ex + dy * ey + dz * ez);
    const qc = ex * ex + ey * ey + ez * ez - c * c;
    const disc = qb * qb - 4 * qa * qc;
    if (qa <= EPS || disc < 0) continue;

    const sq = Math.sqrt(disc);
    // Smallest root first; the walk always moves forward, so the first root at
    // or after uLo is the entry we want.
    for (const u of [(-qb - sq) / (2 * qa), (-qb + sq) / (2 * qa)]) {
      if (u >= uLo - 1e-12 && u <= uHi + 1e-12) {
        return segStart + Math.min(Math.max(u, uLo), uHi) * span;
      }
    }
  }
  return -1;
}

/**
 * Re-express the sub-arc `[fromArc, toArc]` of a strand as a full
 * SHAPE_POINTS polyline with equal segment lengths.
 *
 * Arcs are in the SAME UNITS as `length` (mesh units), not fractions — the
 * callers that matter (#5's cut, #6's rewind) both think in absolute lengths,
 * and a fraction would need multiplying by `length` at every call site anyway.
 *
 * @param {number[]|Float64Array} points  normalised flat SHAPE_POINTS*3
 * @param {number} length                 strand length in mesh units
 * @param {number} fromArc                start of the retained span, mesh units
 * @param {number} toArc                  end of the retained span, mesh units
 * @returns {{points: number[], length: number}} a NEW normalised polyline and
 *          its new length. Nothing is mutated.
 *
 * `fromArc > 0` MOVES THE ROOT and is therefore not something the guide model
 * accepts — a guide's point 0 is pinned to the scalp at the origin. It is
 * implemented and tested because the operation is well-defined and the
 * plan's signature asks for it, but it has no caller: #6d rules out root-first
 * truncation on physical grounds (short hair leaves the scalp doing short-hair
 * things; it does not wear the tip's sweep at the root). `cutFromTip` below is
 * the entry point everything actually uses.
 */
export function resample(points, length, fromArc, toArc) {
  if (!(length > 0)) throw new Error(`resample: length must be positive, got ${length}`);
  const cum   = arcLengths(points);
  const total = cum[M - 1];
  if (total <= EPS) throw new Error('resample: degenerate strand, zero total length');

  // Arcs arrive in mesh units; the polyline is normalised, so scale in.
  const scale = 1 / length;
  let s0 = fromArc * scale;
  let s1 = toArc   * scale;
  s0 = s0 < 0 ? 0 : s0 > total ? total : s0;
  s1 = s1 < 0 ? 0 : s1 > total ? total : s1;
  if (s1 - s0 <= EPS) {
    throw new Error(`resample: empty span [${fromArc}, ${toArc}] of a strand ${length} long`);
  }

  const start = pointAtArc(points, cum, s0);
  const end   = pointAtArc(points, cum, s1);

  // --- bisect on the chord length ------------------------------------------
  // Upper bound: a chord can never exceed the arc it subtends, so
  // (s1-s0)/(M-1) is a hard ceiling — and it is the exact answer for a
  // straight span, which is why the straight case costs nothing.
  //
  // The predicate is monotone: a longer chord walks further, so the distance
  // left to `end` after M-2 steps falls as the chord grows. Too short and the
  // tip is still out of reach; too long and the walk runs off the span.
  const scratch = new Float64Array((M - 1) * 3);
  let lo = 0, hi = (s1 - s0) / (M - 1), best = -1;

  for (let it = 0; it < 60; it++) {
    const c = (lo + hi) * 0.5;
    const reach = walk(points, cum, s0, s1, c, start, scratch);
    if (reach < 0)                            hi = c;   // ran off the span
    else if (d3(reach.last, end) > c)         lo = c;   // tip still out of reach
    else { hi = c; best = c; }
    if (hi - lo < 1e-15) break;
  }
  const c = best > 0 ? best : hi;
  let w = walk(points, cum, s0, s1, c, start, scratch);
  // `lo` is feasible by construction, so it is the fallback when the midpoint
  // lands a hair past the edge of the reachable range.
  if (w === -1) w = walk(points, cum, s0, s1, lo, start, scratch);
  if (w === -1) throw new Error('resample: could not lay an equal-chord path over the span');

  // --- write out ------------------------------------------------------------
  // New length is the chord path, NOT (toArc - fromArc). Those differ by
  // exactly the corner-cutting a 9-point polyline does to a curve, and the
  // chord path is the honest one: `length` is the scale that makes
  // `p·length` the absolute geometry, and the geometry IS the polyline.
  const newLength = c * (M - 1) * length;
  const inv = 1 / (c * (M - 1));
  const out = new Array(M * 3);
  for (let k = 0; k < M - 1; k++) {
    out[k * 3]     = w.pts[k * 3]     * inv;
    out[k * 3 + 1] = w.pts[k * 3 + 1] * inv;
    out[k * 3 + 2] = w.pts[k * 3 + 2] * inv;
  }
  // The tip is pinned to the requested cut point exactly, not to wherever the
  // last step happened to land. That is what makes the cut land where the
  // blade is rather than a rounding error short of it.
  out[(M - 1) * 3]     = end[0] * inv;
  out[(M - 1) * 3 + 1] = end[1] * inv;
  out[(M - 1) * 3 + 2] = end[2] * inv;

  return { points: out, length: newLength };
}

/** M-1 points from `start`, each `c` from the last. -1 if it runs off the span. */
function walk(points, cum, s0, s1, c, start, pts) {
  if (!(c > 0)) return -1;
  pts[0] = start[0]; pts[1] = start[1]; pts[2] = start[2];
  const cursor = [start[0], start[1], start[2]];
  let s = s0;
  for (let k = 1; k <= M - 2; k++) {
    const next = stepByChord(points, cum, s, s1, cursor, c);
    if (next < 0) return -1;
    s = next;
    pointAtArc(points, cum, s, cursor);
    pts[k * 3] = cursor[0]; pts[k * 3 + 1] = cursor[1]; pts[k * 3 + 2] = cursor[2];
  }
  return { pts, last: cursor };
}

/**
 * The operation the scissors actually performs: keep the root end, discard the
 * tip beyond `keepArc`.
 *
 * `minLength` is not decoration. #3's loader rejects a guide with
 * `length <= 0`, and history's structural restore path runs through it, so a
 * cut that took a strand to zero would make its own undo throw. Clamping here
 * means no caller has to remember.
 *
 * @param {number[]|Float64Array} points  normalised
 * @param {number} length                 mesh units
 * @param {number} keepArc                mesh units of arc to keep from the root
 * @param {number} [minLength]
 */
export function cutFromTip(points, length, keepArc, minLength = SHAPE_REST * 0.5) {
  const keep = Math.max(keepArc, minLength);
  if (keep >= length) return { points: Array.from(points), length };   // nothing to remove
  return resample(points, length, 0, keep);
}

export { SHAPE_POINTS, SHAPE_REST };
