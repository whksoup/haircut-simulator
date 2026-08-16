/**
 * arcResample.js — plan item 4: the arc-length resampler.
 *
 * One primitive, shared by everything that changes how much strand there is:
 *
 *     resample(points, length, fromArc, toArc) → { points, length, ... }
 *
 * `points` is a normalised SHAPE_POINTS×3 control polyline (strandShape.js
 * convention: root at the origin, straight = (0,0,t), total arc 1). `fromArc`
 * and `toArc` are positions along that arc as FRACTIONS of it, so `(0, 0.4)`
 * means "keep the root 40% of the hair" — a cut — and `(0, 1)` is the identity.
 * The result is another normalised SHAPE_POINTS×3 polyline plus the mesh-units
 * length that now goes with it, ready to write straight onto a guide.
 *
 * WHY THIS IS ITS OWN ITEM. It has a crisp, falsifiable invariant and getting
 * it wrong is silent:
 *
 *   ABSOLUTE GEOMETRY OF THE RETAINED PORTION IS PRESERVED.
 *
 * Absolute position of control point k is `p[k] · L`. Keep `[0, s·L]`,
 * resample, store `p' = q/(s·L)` and `length = s·L`, and rendering gives back
 * `q` — the same curve in the same place, just described in new units.
 * Normalisation is a change of units, not a loss of information, so curl
 * radius, wavelength and lean all survive a cut untouched. Resolution goes UP:
 * nine points over 40% of the arc is finer sampling per unit length than nine
 * over 100%.
 *
 * Note the scale factor cancels. `p' = (q − q₀)/((t₁−t₀)·A)` has no `L` in it:
 * a cut is a pure operation on the normalised polyline plus a scalar update of
 * `length`. `length` is still a parameter here, because the DIAGNOSTICS have to
 * come back in mesh units — #6e compares a drift against a growth margin and
 * the two must not be in different units — but it never touches the geometry.
 *
 * THE INPUT MUST ALREADY SATISFY THE LENGTH INVARIANT, and this checks rather
 * than assumes. Per #2, `fromArc`/`toArc` are only arc fractions while every
 * segment sits at SHAPE_REST; on a strand left stretched by a stroke that
 * ended in the hair (6.3% worst segment) "keep 40%" keeps some other amount and
 * nothing looks wrong afterwards. `assertSegmentLengths` at the top of the
 * commit path is where that gets caught, so it is on by default.
 *
 * WHAT IS *NOT* EXACT — AND THE SURPRISE IN IT. Every output point lies
 * exactly on the input polyline: sampling is a lerp inside one existing
 * segment, so no new curve is invented. But the output CHORDS cut corners
 * wherever an input control point falls strictly INSIDE an output step, so the
 * resampled polyline is fractionally shorter than the arc it was asked for and
 * its segments are no longer all equal.
 *
 * The surprise is that this is not monotone in how much you cut. Output samples
 * sit at k·span/8 of the input arc and input corners at j/8, so every corner is
 * also a sample exactly when 1/span is an integer — and there the resample is
 * bit-exact. Elsewhere it is not. On a ringlet (one full turn over the strand):
 *
 *   span            1/2    1/3    1/4     0.40    0.60    0.75    0.91
 *   arc lost        0      0      0       1.71%   2.27%   3.03%   4.76%
 *   worst segment   0      0      0       6.84%   6.05%   6.05%   6.75%
 *
 * A gentle wave is two orders of magnitude better (0.02% / 0.08%), as curvature
 * says it should be. But 6.8% is 68× the audit tolerance, and the sawtooth means
 * you cannot reason about it from "how much was cut" — hence the default below
 * is on, not a judgement call at the call site.
 *
 * THAT IS THE ARGUMENT FOR `equalise`. Left alone the routine hands back a
 * strand shorter than the `length` it claims, on which `aT` is not arc length —
 * i.e. an output that fails the very invariant its input was required to pass,
 * and which the NEXT cut would reject with the blame pointing at whatever ran
 * in between. The equalisation is #2's `relaxStrand` with no capsule, in the
 * output's own normalised space, which restores both the total and the
 * per-segment identity (6.84% → 1e-14 in 128 sweeps over nine points).
 *
 * It pays for that by moving control points off the sampled curve, by at most
 * the arc it had to put back: 6e-4 mesh units, 0.74% of the cut strand, in the
 * ringlet case above. That is `drift`, reported in mesh units so it can be
 * compared with the audit's `worstArcAbs` and #6e's growth margin — the same
 * kind of quantity, and confusing them is exactly the failure this item is
 * defended against.
 *
 * RESAMPLING IS DIFFUSIVE — each pass lerps between control points, so shape
 * detail erodes a little every time. Apply it ONCE PER COMMITTED EDIT and never
 * per frame: #5's scissors previews by shrinking the blended length only and
 * resamples on stroke end; #6's rewind is a shader parameter and does not
 * resample at all. Chaining N cuts costs N passes, which is correct — the user
 * did cut N times — but re-deriving the same cut every mouse move would not be.
 */

import { SHAPE_POINTS, SHAPE_REST } from './strandShape.js';
import {
  relaxStrand, buildInvMass, segmentResidual, assertSegmentLengths,
} from './strandConstraints.js';
import { LENGTH_TOL } from './guideLengthAudit.js';

/** Below this span a "cut" is a request to delete the strand, not shorten it.
 *  Refuse rather than return a degenerate polyline the solver has to guess at. */
export const MIN_SPAN = 1e-4;

/** How far outside [0,1] an arc bound may stray before it stops being float
 *  noise and starts being a different request. */
export const BOUND_EPS = 1e-9;

/** Root-pinned, uniform: corrections distribute symmetrically down the chain
 *  rather than re-laying it from the root (#2's finding, same reasoning). */
const _invMass = buildInvMass(SHAPE_POINTS, 0);

/**
 * Cumulative arc length to each control point, in the units `points` lives in.
 * `arc[0]` is 0 and `arc[M-1]` is the total — which under the invariant is 1
 * for a normalised polyline, but is MEASURED here rather than assumed, so a
 * fraction means a fraction of the strand that actually exists.
 */
export function cumulativeArc(points, out = new Float64Array(points.length / 3)) {
  const count = points.length / 3;
  out[0] = 0;
  for (let k = 1; k < count; k++) {
    const i = k * 3, h = (k - 1) * 3;
    out[k] = out[k - 1] + Math.hypot(
      points[i]     - points[h],
      points[i + 1] - points[h + 1],
      points[i + 2] - points[h + 2],
    );
  }
  return out;
}

/**
 * The point at arc position `s` along the polyline, by linear interpolation
 * inside the segment that contains it. The result lies exactly ON the polyline
 * — this introduces no approximation of its own; the corner-cutting happens
 * later, between two sampled points, not here.
 *
 * `s` is clamped to [0, total]. The scan is linear because M is 9.
 */
export function pointAtArc(points, arcs, s, out = [0, 0, 0]) {
  const count = arcs.length;
  const total = arcs[count - 1];
  if (!(total > 0)) { out[0] = points[0]; out[1] = points[1]; out[2] = points[2]; return out; }
  if (s <= 0)     s = 0;
  if (s >= total) s = total;

  let k = 1;
  while (k < count - 1 && arcs[k] < s) k++;      // segment [k-1, k] contains s
  const seg = arcs[k] - arcs[k - 1];
  const f   = seg > 0 ? (s - arcs[k - 1]) / seg : 0;

  const h = (k - 1) * 3, i = k * 3;
  out[0] = points[h]     + (points[i]     - points[h])     * f;
  out[1] = points[h + 1] + (points[i + 1] - points[h + 1]) * f;
  out[2] = points[h + 2] + (points[i + 2] - points[h + 2]) * f;
  return out;
}

/**
 * Resample the arc span [fromArc, toArc] of a normalised strand back onto
 * SHAPE_POINTS evenly-spaced control points.
 *
 * @param {number[]|Float32Array} points  normalised SHAPE_POINTS*3 polyline
 * @param {number} length                 strand length in mesh units
 * @param {number} [fromArc]              start, as a fraction of total arc
 * @param {number} [toArc]                end, as a fraction of total arc
 * @param {object} [opts]
 * @param {boolean} [opts.checkInput]  assert the #2 invariant first (default true)
 * @param {number}  [opts.tol]         tolerance for that assertion
 * @param {boolean} [opts.equalise]    restore the invariant on the OUTPUT (default true)
 * @param {number}  [opts.iterations]  equalisation sweeps (relaxStrand, no capsule)
 * @param {string}  [opts.label]       what is being cut, for error messages
 * @returns {{points:number[], length:number, ...}} the new shape plus diagnostics:
 *   `span`           the fraction kept
 *   `arcIn`          measured total arc of the input (1 under the invariant)
 *   `rootOffset`     [x,y,z] mesh-units translation applied (zero for a tip cut)
 *   `requestedArc`   arc asked for, mesh units
 *   `sampledArc`     arc the resampled polyline actually spans, mesh units
 *   `shrink`         (requested − sampled) / requested — the corner-cutting loss
 *   `residualBefore` segmentResidual of the raw sampling
 *   `residualAfter`  segmentResidual after equalisation (=== before if off)
 *   `drift`          worst control-point movement caused by equalisation, mesh units
 *   `ok`             the output satisfies the invariant at `tol`
 */
export function resample(points, length, fromArc = 0, toArc = 1, {
  checkInput = true,
  tol        = LENGTH_TOL,
  equalise   = true,
  iterations = 128,
  label      = 'resample',
} = {}) {
  const M = SHAPE_POINTS;

  if (!points || points.length !== M * 3) {
    throw new Error(`${label}: expected ${M * 3} floats, got ${points ? points.length : points}`);
  }
  if (!Number.isFinite(fromArc) || !Number.isFinite(toArc)) {
    throw new Error(`${label}: non-finite arc bounds (${fromArc}, ${toArc})`);
  }
  // Callers arrive here from arithmetic — `1 − rate·t/L`, a drag fraction, a
  // slider — and land on 1 + 3e-16 often enough that throwing on it would be a
  // bug report about scissors that stop working at full length. Snap the float
  // noise; anything past that is a real request to grow hair, which is #6.
  if (fromArc < 0 && fromArc > -BOUND_EPS) fromArc = 0;
  if (toArc   > 1 && toArc   <  1 + BOUND_EPS) toArc = 1;
  if (fromArc < 0 || toArc > 1) {
    throw new Error(`${label}: arc bounds [${fromArc}, ${toArc}] outside [0, 1]. ` +
      `This routine only removes strand; growing one is #6's job and is a different operation.`);
  }
  const span = toArc - fromArc;
  if (span < MIN_SPAN) {
    throw new Error(`${label}: span ${span} is below MIN_SPAN (${MIN_SPAN}). ` +
      `Cutting a strand to nothing is a delete, not a resample.`);
  }
  if (!(length > 0)) throw new Error(`${label}: length must be positive, got ${length}`);

  // The invariant this whole routine's meaning rests on. Cheap, and the one
  // place a stretched strand can still be caught before it becomes a wrong
  // number someone cuts hair by.
  if (checkInput) assertSegmentLengths(points, SHAPE_REST, tol, `${label} input`);

  const arcs  = cumulativeArc(points);
  const arcIn = arcs[M - 1];
  if (!(arcIn > 0)) throw new Error(`${label}: input polyline has zero arc length`);

  const s0   = fromArc * arcIn;
  const s1   = toArc   * arcIn;
  const step = (s1 - s0) / (M - 1);

  // Sample on the curve, then express in the NEW normalised units. The new
  // strand is `span · arcIn · length` mesh units long, so dividing the
  // normalised-space offsets by (span · arcIn) is exactly the change of units
  // that leaves absolute geometry where it was.
  const scale = 1 / (span * arcIn);
  const out   = new Array(M * 3);
  const q     = [0, 0, 0];
  pointAtArc(points, arcs, s0, q);
  const [ox, oy, oz] = q;                        // new root, in input units

  for (let k = 0; k < M; k++) {
    pointAtArc(points, arcs, s0 + k * step, q);
    out[k * 3]     = (q[0] - ox) * scale;
    out[k * 3 + 1] = (q[1] - oy) * scale;
    out[k * 3 + 2] = (q[2] - oz) * scale;
  }
  out[0] = 0; out[1] = 0; out[2] = 0;            // root is the origin, exactly

  const newLength = span * arcIn * length;

  const residualBefore = segmentResidual(out, SHAPE_REST);
  const sampledArc     = residualBefore.arcLen * newLength;   // mesh units
  const requestedArc   = newLength;                           // by construction
  const shrink         = (requestedArc - sampledArc) / requestedArc;

  let drift = 0;
  let residualAfter = residualBefore;
  if (equalise && residualBefore.maxRel > 0) {
    const before = out.slice();
    // Same routine as #2's stroke-end relaxation, with no capsule: this is
    // pure inextensibility in the output's own normalised space, and it
    // converges to machine precision. 128 sweeps over nine points, once per
    // committed cut — do not economise here either.
    relaxStrand(out, { restLen: SHAPE_REST, invMass: _invMass, capsule: null, iterations });
    for (let k = 1; k < M; k++) {
      const i = k * 3;
      drift = Math.max(drift, Math.hypot(
        out[i] - before[i], out[i + 1] - before[i + 1], out[i + 2] - before[i + 2],
      ));
    }
    drift *= newLength;                          // report in mesh units
    residualAfter = segmentResidual(out, SHAPE_REST);
  }

  return {
    points: out,
    length: newLength,
    span,
    arcIn,
    rootOffset: [ox * length, oy * length, oz * length],
    requestedArc,
    sampledArc,
    shrink,
    residualBefore,
    residualAfter,
    drift,
    ok: residualAfter.maxRel <= tol,
  };
}

/**
 * Throwing form for commit paths: the same call, but a result that fails the
 * invariant is an error rather than a flag on an object nobody reads.
 *
 * #5 writes `points` + `length` onto a guide and pushes an undo entry; a shape
 * that is off arc length at that moment poisons every later cut and the #6a
 * readout, so this is the boundary to fail at.
 */
export function resampleOrThrow(points, length, fromArc, toArc, opts = {}) {
  const r = resample(points, length, fromArc, toArc, opts);
  if (!r.ok) {
    throw new Error(
      `${opts.label ?? 'resample'}: output violates the length invariant — worst segment ` +
      `${r.residualAfter.worstSegment} off by ${(r.residualAfter.maxRel * 100).toFixed(4)}% ` +
      `(tol ${((opts.tol ?? LENGTH_TOL) * 100).toFixed(3)}%) after equalisation. ` +
      `The retained span was ${(r.span * 100).toFixed(1)}%; corner-cutting lost ` +
      `${(r.shrink * 100).toFixed(4)}% of it. aT would not be arc length on this result.`,
    );
  }
  return r;
}
