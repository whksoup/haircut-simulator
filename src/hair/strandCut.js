/**
 * strandCut.js — where does a blade meet a strand?
 *
 * Pure geometry, no Three.js, no tool state. Split out of ScissorsTool for the
 * same reason guideLengthAudit.js is split out of CombTool: it is the part with
 * an answer that can be checked, and a check reachable only through a tool is a
 * check nobody runs.
 *
 * THE RULE IS "FIRST CONTACT FROM THE ROOT", not "closest approach".
 *
 * A blade laid across a curl can meet the same strand two or three times. Which
 * crossing you pick is the whole behaviour of the tool: the first one from the
 * root is the only choice that makes cutting monotone in blade depth — push the
 * blade further in and you remove more, never less. Picking the nearest
 * crossing instead would make a strand grow back as you pushed, which is not a
 * thing scissors do.
 *
 * IT RETURNS AN ARC LENGTH, NOT A CONTROL-POINT INDEX. Cutting at a control
 * point would quantise every haircut to eight steps, the same quantisation
 * #6b's shader remap exists to avoid. The entry point is located to the
 * fraction of an edge, and #2's invariant is what makes the conversion exact:
 * arc to point k is `k · SHAPE_REST · L`, so arc to a point u of the way along
 * edge k is `(k + u) · SHAPE_REST · L` with no integration.
 *
 * That dependency is worth stating plainly: if #2's invariant does not hold,
 * this returns an arc length that is wrong by however far the strand has
 * drifted, and the cut lands somewhere other than the blade. The cumulative
 * length is therefore MEASURED here rather than assumed — see `entryArc` — so a
 * drifted strand still cuts where the blade is, even though everything
 * downstream of it will be reasoning in a parameter that is no longer arc.
 */

import { closestPtSegmentSegment } from './strandConstraints.js';
import { SHAPE_POINTS } from './strandShape.js';

const M   = SHAPE_POINTS;
const EPS = 1e-12;

/** Distance from a point to the capsule's axis SEGMENT (not its infinite line). */
export function distToAxis(px, py, pz, cap) {
  const abx = cap.bx - cap.ax, aby = cap.by - cap.ay, abz = cap.bz - cap.az;
  const apx = px - cap.ax,     apy = py - cap.ay,     apz = pz - cap.az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > EPS ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

/**
 * Arc length from the root to where the polyline FIRST enters the blade.
 *
 * @param {number[]|Float64Array} local  flat M*3, absolute, same space as `cap`
 * @param {object} cap  {ax,ay,az, bx,by,bz, r}
 * @returns {number} arc length in the units of `local`, or -1 for no contact.
 *
 * The blade is a capsule because that is the shape the rest of this app already
 * knows how to place, draw and reason about — two clicks on the scalp give an
 * axis and a length, with no roll to decide (see the CombTool header). A real
 * blade is a plane, and a plane is the obvious later revision; a capsule is a
 * plane with a thickness and rounded ends, which cuts identically and cannot
 * produce the corner discontinuity a box would.
 */
export function entryArc(local, cap) {
  // The root itself inside the blade means the whole strand goes. Reported as
  // arc 0 rather than "no contact", which are opposite answers.
  if (distToAxis(local[0], local[1], local[2], cap) < cap.r) return 0;

  let arc = 0;
  for (let k = 0; k < M - 1; k++) {
    const i = k * 3, j = (k + 1) * 3;
    const ax = local[i], ay = local[i + 1], az = local[i + 2];
    const bx = local[j], by = local[j + 1], bz = local[j + 2];
    const segLen = Math.hypot(bx - ax, by - ay, bz - az);

    // Broad phase per edge: closest approach between the strand edge and the
    // blade axis. Above the radius, this edge cannot enter.
    const r = closestPtSegmentSegment(ax, ay, az, bx, by, bz,
                                      cap.ax, cap.ay, cap.az, cap.bx, cap.by, cap.bz);
    const d = Math.hypot(r.c1x - r.c2x, r.c1y - r.c2y, r.c1z - r.c2z);

    if (d < cap.r) {
      // The edge enters somewhere in [0, r.s]: distance-to-axis falls from
      // outside-the-radius at u=0 (guaranteed, since the previous edge did not
      // enter and the root is outside) to `d` at the closest point. One sign
      // change, so bisection is exact and cannot land on the wrong crossing.
      let lo = 0, hi = r.s;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) * 0.5;
        const px = ax + (bx - ax) * mid, py = ay + (by - ay) * mid, pz = az + (bz - az) * mid;
        if (distToAxis(px, py, pz, cap) < cap.r) hi = mid; else lo = mid;
      }
      return arc + hi * segLen;
    }
    arc += segLen;
  }
  return -1;
}

/**
 * The same answer as a FRACTION of the strand's own length, which is the form
 * the tool accumulates in.
 *
 * A fraction rather than an absolute length because a cut has to compose with
 * itself across a drag: `cut = min(cut, thisPose)` is only meaningful between
 * two numbers measured against the same strand, and the strand's absolute
 * length changes underneath as the stroke proceeds.
 *
 * @returns {number} in [0,1], or -1 for no contact.
 */
export function entryFraction(local, cap) {
  const s = entryArc(local, cap);
  if (s < 0) return -1;
  let total = 0;
  for (let k = 0; k < M - 1; k++) {
    const i = k * 3, j = (k + 1) * 3;
    total += Math.hypot(local[j] - local[i], local[j + 1] - local[i + 1], local[j + 2] - local[i + 2]);
  }
  return total > EPS ? Math.min(s / total, 1) : 0;
}
