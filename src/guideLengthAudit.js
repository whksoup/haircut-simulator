/**
 * guideLengthAudit.js — is `aT` actually arc length?
 *
 * Plan item 2 is two things: turn the length constraint back on, and make the
 * invariant it restores CHECKABLE from outside the solver. This module is the
 * second half, lifted out of CombTool because the callers who most need it are
 * not the comb:
 *
 *   #4 arc-length resampler  its whole identity ("absolute geometry of the
 *                            retained portion is preserved exactly") is stated
 *                            in arc length. Resampling a strand whose segments
 *                            have drifted silently redistributes shape.
 *   #5 scissors commit       writes `points` + `length` from a truncation at a
 *                            fractional arc position.
 *   #6 time rewind           truncates by SHADER PARAMETER. Parameter
 *                            truncation equals arc-length truncation ONLY under
 *                            this invariant, and 6a's output is a number a
 *                            barber cuts hair by.
 *
 * None of those go through the comb, so the check cannot live in the comb.
 *
 * WHY IT MEASURES THE NORMALISED POINTS DIRECTLY. A guide's control points are
 * stored normalised in its own {T,B,N} frame; the comb lifts them to mesh-local
 * by an orthonormal rotation, a uniform scale by `g.length`, and a translation
 * to the root. Rotation and translation preserve distance and the scale is
 * uniform, so
 *
 *   |P[k+1] − P[k]|_meshlocal  =  |p[k+1] − p[k]|_normalised · L
 *
 * exactly. Measuring normalised segments against SHAPE_REST is therefore the
 * same test as measuring mesh-local segments against SHAPE_REST·L, minus the
 * frame build and the round trip — cheap enough to run over every guide in the
 * groom without thinking about it. (Assumes uniform mesh scale, which the comb
 * already assumes.)
 *
 * WHAT IT WILL LEGITIMATELY CATCH. The comb's write-back clamps local z to ≥ 0
 * — the per-guide scalp guard — AFTER the solve. That clamp is a position edit
 * outside the constraint, so it can and does push a strand off the invariant
 * near the root. Reporting it is the point: it is exactly the kind of drift
 * that is invisible in the render and fatal to a length readout. It is also the
 * argument for #10 (a real head SDF inside the solve) having a measurable
 * payoff rather than being a taste call.
 */

import { SHAPE_POINTS, SHAPE_REST } from './strandShape.js';
import { segmentResidual } from './strandConstraints.js';

/** Default tolerance: a tenth of the residual 8 iterations leaves under active
 *  contact, and ~4 orders of magnitude above float noise on a 9-point chain. */
export const LENGTH_TOL = 1e-3;

const _scratch = {};

/**
 * Audit every guide's segment lengths.
 *
 * @param {{guides: Map<number, object>}} store  a GuideStore (or anything with
 *        a `guides` Map of {id, points, length})
 * @param {object}   [o]
 * @param {(g:object)=>boolean} [o.filter]  restrict the audit (e.g. a comb mask)
 * @param {number}   [o.tol]      pass/fail threshold on per-segment maxRel
 * @param {number}   [o.worstN]   how many worst offenders to list (default 3)
 * @returns {object} summary; `ok` is the assertion, everything else is why
 */
export function auditGuideLengths(store, { filter = null, tol = LENGTH_TOL, worstN = 3 } = {}) {
  const out = {
    tol,
    guides: 0,
    skipped: 0,
    failing: 0,
    maxRel: 0,          // worst per-segment error anywhere in the groom
    maxArcRel: 0,       // worst total-arc error, signed by magnitude
    meanRel: 0,         // mean per-guide maxRel — is this one guide or all of them
    worstGuideId: -1,
    worst: [],          // [{id, maxRel, arcRel, worstSegment, length}]
    ok: true,
  };

  const worst = [];
  let sumRel = 0;

  for (const g of store.guides.values()) {
    if (filter && !filter(g)) { out.skipped++; continue; }
    const p = g.points;
    // A guide whose buffer is the wrong size is a different bug, but it would
    // make the residual meaningless rather than merely large — say so loudly
    // instead of folding it into the statistics.
    if (!p || p.length !== SHAPE_POINTS * 3) {
      out.malformed = (out.malformed ?? 0) + 1;
      out.ok = false;
      continue;
    }

    const r = segmentResidual(p, SHAPE_REST, _scratch);
    out.guides++;
    sumRel += r.maxRel;

    if (r.maxRel > out.maxRel) { out.maxRel = r.maxRel; out.worstGuideId = g.id; }
    if (Math.abs(r.arcRel) > Math.abs(out.maxArcRel)) out.maxArcRel = r.arcRel;
    if (r.maxRel > tol) out.failing++;

    worst.push({
      id: g.id,
      maxRel: r.maxRel,
      arcRel: r.arcRel,
      worstSegment: r.worstSegment,
      length: g.length,
      // Absolute arc error in mesh units — the number that matters to #6a,
      // because that one is compared against a rate in cm/week.
      arcAbs: r.arcRel * (g.length || 0),
    });
  }

  out.meanRel = out.guides ? sumRel / out.guides : 0;
  worst.sort((a, b) => b.maxRel - a.maxRel);
  out.worst = worst.slice(0, worstN);
  out.ok = out.ok && out.failing === 0;

  // The absolute number a length readout would be wrong by, worst case. #6e's
  // validity reporting should compare this against `rate · t` before it claims
  // a cut length is unreachable — a 3mm arc drift and a 3mm unreachability
  // margin are the same size and must not be confused.
  out.worstArcAbs = out.worst.length
    ? out.worst.reduce((m, w) => Math.max(m, Math.abs(w.arcAbs)), 0)
    : 0;

  return out;
}

/**
 * Throwing form, for the commit paths in #4/#5/#6.
 *
 * Hard throw, same reasoning as assertSegmentLengths: a silently wrong cut
 * length is worse than a crash. Call at commit boundaries, not per frame.
 */
export function assertGuideLengths(store, opts = {}) {
  const a = auditGuideLengths(store, opts);
  if (!a.ok) {
    const w = a.worst[0];
    throw new Error(
      `guide length invariant violated: ${a.failing}/${a.guides} guides off by more than ` +
      `${(a.tol * 100).toFixed(3)}%. Worst is guide ${a.worstGuideId} at ` +
      `${(a.maxRel * 100).toFixed(3)}% on segment ${w?.worstSegment}, ` +
      `arc length off by ${(a.maxArcRel * 100).toFixed(3)}% ` +
      `(${a.worstArcAbs.toFixed(4)} mesh units). aT is not arc length; ` +
      `resampling or parameter truncation would be wrong by that much.`,
    );
  }
  return a;
}
