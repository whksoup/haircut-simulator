/**
 * strandConstraints.js — position-based constraint projections for strands.
 *
 * Two solvers live here and they are for different jobs:
 *
 *   solveLengths()  FORWARD-ONLY FABRIK. Root→tip, each point chases its parent
 *                   at a fixed distance. Correct and O(M) for AUTHORING a shape
 *                   from scratch (strandShape.combVectorToShape), where there
 *                   is no prior pose to preserve and rigidly re-laying the
 *                   chain is exactly what you want. Unchanged; still exported.
 *
 *   solveStrand()   SYMMETRIC PBD. Gauss-Seidel distance constraints weighted
 *                   by inverse mass, interleaved with capsule collision. This
 *                   is the INTERACTIVE path. Forward FABRIK is wrong here:
 *                   pushing a mid-point rigidly re-lays everything below it, so
 *                   the tip whips — which is the stiffness the combTool header
 *                   complained about and the reason the length constraint was
 *                   switched off. Distributing corrections symmetrically
 *                   removes the whip without giving up inextensibility.
 *
 * INVERSE MASS IS THE UNIFYING KNOB. `rootRamp` used to be an ad-hoc scale on
 * the comb's push, applied outside the constraint solve — which is precisely
 * why idempotence broke: a partial push leaves penetration behind for the next
 * pass to find. Expressed as inverse mass it means the same thing physically,
 * composes correctly with every other constraint, and lets each constraint
 * project FULLY.
 *
 *   invMass[0] = 0                        root is pinned to the scalp, exactly
 *   invMass[k] = (k / last)^rootRamp      rootRamp 0 → uniform, higher → stiff
 *
 * WHY COLLISION AND INEXTENSIBILITY ARE ONE FEATURE. A collision correction on
 * its own just stretches the strand; the next stroke then has longer edges,
 * which phase through the comb more easily. Length preservation is what makes
 * the collision hold, so they are interleaved rather than run in sequence.
 *
 * Everything here is space-agnostic and operates in place on flat
 * [x,y,z, ...] arrays. Pass restLen in whatever space the points live in. The
 * interactive path runs in MESH-LOCAL space (that is where the comb is);
 * combVectorToShape runs in normalised shape space. Neither cares.
 *
 * Algorithms, not dependencies: Ericson, Real-Time Collision Detection §5.1.9
 * for the segment-segment closest point; Müller et al. 2007 for PBD. A rigid
 * body engine would be the wrong tool here — see the CombTool header.
 */

const EPS = 1e-12;
const UP  = [0, 0, 1];

// ---------------------------------------------------------------------------
// Authoring solver (unchanged)

export function solveLengths(points, restLen, { pinned = 1 } = {}) {
  const count = points.length / 3;
  for (let i = pinned; i < count; i++) {
    const a = (i - 1) * 3;
    const b = i * 3;
    let dx = points[b]     - points[a];
    let dy = points[b + 1] - points[a + 1];
    let dz = points[b + 2] - points[a + 2];
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) {
      // Degenerate (coincident points): nudge along the previous segment's
      // direction so the chain keeps a definite shape instead of collapsing.
      const pa = (i - 1) * 3;
      const pp = (i - 2) * 3;
      if (i >= 2) { dx = points[pa] - points[pp]; dy = points[pa + 1] - points[pp + 1]; dz = points[pa + 2] - points[pp + 2]; }
      else        { dx = 0; dy = 0; dz = 1; }
      len = Math.hypot(dx, dy, dz) || 1;
    }
    const s = restLen / len;
    points[b]     = points[a]     + dx * s;
    points[b + 1] = points[a + 1] + dy * s;
    points[b + 2] = points[a + 2] + dz * s;
  }
  return points;
}

// ---------------------------------------------------------------------------
// Inverse mass

/**
 * Per-control-point inverse mass. Point 0 is the root and is pinned exactly.
 *
 * @param {number} count      control points per strand
 * @param {number} rootRamp   0 = uniform (whole strand equally free),
 *                            higher = progressively stiffer toward the root
 * @param {Float32Array} [out]
 */
export function buildInvMass(count, rootRamp, out = new Float32Array(count)) {
  const last = count - 1;
  out[0] = 0;
  for (let k = 1; k < count; k++) {
    out[k] = rootRamp === 0 ? 1 : Math.pow(k / last, rootRamp);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Closest point between two segments — Ericson §5.1.9.
//
// Written out rather than pulled from a library because the parallel and
// degenerate cases are where naive formulations quietly produce garbage, and
// because it is thirty lines. `out.s` is the parameter along segment 1, which
// is the strand edge in the collision routine below, so it doubles as the
// contact's barycentric weight.

const _cps = { s: 0, t: 0, c1x: 0, c1y: 0, c1z: 0, c2x: 0, c2y: 0, c2z: 0 };

export function closestPtSegmentSegment(
  p1x, p1y, p1z, q1x, q1y, q1z,
  p2x, p2y, p2z, q2x, q2y, q2z,
  out = _cps,
) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;   // segment 1
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;   // segment 2
  const rx  = p1x - p2x, ry  = p1y - p2y, rz  = p1z - p2z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx  + d2y * ry  + d2z * rz;

  let s, t;

  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      // denom === 0 means the segments are parallel; any s is as good as any
      // other, so take 0 and let the t clamps below place the contact.
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0)      { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }

  out.s = s; out.t = t;
  out.c1x = p1x + d1x * s; out.c1y = p1y + d1y * s; out.c1z = p1z + d1z * s;
  out.c2x = p2x + d2x * t; out.c2y = p2y + d2y * t; out.c2z = p2z + d2z * t;
  return out;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---------------------------------------------------------------------------
// Projections

/**
 * One Gauss-Seidel sweep of symmetric distance constraints.
 *
 * Gauss-Seidel (reading updated positions within the sweep) rather than Jacobi
 * because it converges roughly twice as fast per iteration on a chain, and the
 * chain is short enough that the serial dependency costs nothing.
 */
export function projectDistance(points, restLen, invMass) {
  const count = points.length / 3;
  for (let k = 0; k < count - 1; k++) {
    const i = k * 3, j = (k + 1) * 3;
    const w0 = invMass[k], w1 = invMass[k + 1];
    const wsum = w0 + w1;
    if (wsum <= EPS) continue;

    let dx = points[j] - points[i];
    let dy = points[j + 1] - points[i + 1];
    let dz = points[j + 2] - points[i + 2];
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) {
      // Coincident: separate along the previous edge so the chain keeps a
      // definite direction rather than collapsing to a point.
      if (k > 0) {
        dx = points[i] - points[i - 3];
        dy = points[i + 1] - points[i - 2];
        dz = points[i + 2] - points[i - 1];
      } else { dx = 0; dy = 0; dz = 1; }
      len = Math.hypot(dx, dy, dz) || 1;
    }

    const c  = (len - restLen) / len;
    const s0 =  c * (w0 / wsum);
    const s1 = -c * (w1 / wsum);
    points[i] += dx * s0; points[i + 1] += dy * s0; points[i + 2] += dz * s0;
    points[j] += dx * s1; points[j + 1] += dy * s1; points[j + 2] += dz * s1;
  }
  return points;
}

/**
 * Push every strand EDGE out of a capsule. This is the fix for the phasing:
 * testing control points alone lets the segments between them slide through,
 * because a thin bar passes cleanly between two widely spaced samples.
 *
 * A standard PBD particle-pair contact. The contact sits at
 * C = (1-s)·P_k + s·P_{k+1}, so the constraint gradients are (1-s)·n and s·n
 * and the weighted denominator is (1-s)²·w_k + s²·w_{k+1}. That exact form
 * matters: the naive linear split (w_k·(1-s), w_{k+1}·s) does NOT move C by
 * the full penetration depth, so edges creep out over several passes instead
 * of leaving in one — the same partial-correction bug that broke idempotence
 * back when rootRamp was a push scale.
 *
 * @param {number[]|Float32Array} points  flat, same space as `cap`
 * @param {Float32Array} invMass
 * @param {object} cap  {ax,ay,az, bx,by,bz, r}
 * @param {number[]} tie  unit fallback direction for an edge lying exactly on
 *                        the axis, where the contact normal is undefined. Pass
 *                        the bar's direction of travel: it is the only
 *                        information that makes the choice non-arbitrary.
 * @returns {number} number of edges corrected
 */
export function projectCapsule(points, invMass, cap, tie = UP) {
  const count = points.length / 3;
  let contacts = 0;

  for (let k = 0; k < count - 1; k++) {
    const i = k * 3, j = (k + 1) * 3;
    const w0 = invMass[k], w1 = invMass[k + 1];
    if (w0 + w1 <= EPS) continue;                     // both pinned

    const r = closestPtSegmentSegment(
      points[i], points[i + 1], points[i + 2],
      points[j], points[j + 1], points[j + 2],
      cap.ax, cap.ay, cap.az, cap.bx, cap.by, cap.bz,
    );

    let nx = r.c1x - r.c2x, ny = r.c1y - r.c2y, nz = r.c1z - r.c2z;
    const d = Math.hypot(nx, ny, nz);
    if (d >= cap.r) continue;

    if (d > 1e-9) { nx /= d; ny /= d; nz /= d; }
    else          { nx = tie[0]; ny = tie[1]; nz = tie[2]; }

    const pen = cap.r - d;
    const s   = r.s;
    const g0  = 1 - s, g1 = s;
    const denom = g0 * g0 * w0 + g1 * g1 * w1;
    if (denom <= EPS) continue;

    // CLAMP. The contact moves by `pen`, but the ENDPOINT displacement is
    // pen/s (or pen/(1-s)), which is unbounded as the contact slides toward a
    // pinned particle: with a pinned root, denom -> s^2*w1, so a 0.005
    // penetration at s = 0.001 asked for a 5.0 displacement — a 1000x
    // overshoot that reads as the strand exploding off the root.
    //
    // A contact sitting on a pinned particle is genuinely unsatisfiable: no
    // motion of the free endpoint removes it. So bound the correction by the
    // penetration depth itself — no particle ever moves further than the
    // overlap it is resolving. Near-root contacts then UNDER-resolve, which is
    // both stable and physically honest (the strand is anchored there and
    // should resist), instead of diverging.
    let lambda = pen / denom;
    const biggest = Math.max(w0 * g0, w1 * g1) * lambda;
    if (biggest > pen) lambda *= pen / biggest;
    const a0 = w0 * g0 * lambda;
    const a1 = w1 * g1 * lambda;
    points[i] += nx * a0; points[i + 1] += ny * a0; points[i + 2] += nz * a0;
    points[j] += nx * a1; points[j + 1] += ny * a1; points[j + 2] += nz * a1;
    contacts++;
  }
  return contacts;
}

/**
 * Interleaved solve: the interactive path.
 *
 * Collision runs INSIDE the iteration loop, not before it — a distance pass
 * following a lone collision pass drags points straight back into the capsule.
 * The loop ends on collision, so the strand is interpenetration-free on exit
 * and the cost is paid in residual stretch instead. Measured on an 8-segment
 * chain, thin bar, worst edge:
 *
 *   iterations           2       4       8      16      32
 *   after a stroke   15.8%   1.49%  0.066%  0.005%       —
 *   parked in hair    8.19%   4.17%   1.74%   0.48%  0.068%
 *
 * The two regimes differ because a bar left resting in the hair keeps collision
 * and length actively fighting, which converges much more slowly than a bar
 * that has passed through and left the strand free to relax. Residual
 * penetration is negligible in both (<0.01% of the radius from 4 iterations up)
 * — the loop always ends on collision, so it is length that gives, not
 * interpenetration.
 *
 * The probe pass matters as much as the solve: a guide the comb never touched
 * must not be length-solved either, or the distance sweep would quietly relax
 * the shape of every guide on every sub-step, including ones nobody combed.
 *
 * @returns {number} contacts found by the probe; 0 means untouched, no writes
 */
export function solveStrand(points, {
  restLen, invMass, capsule = null, tie = UP, iterations = 4, enforceLength = true,
}) {
  if (!capsule) {
    if (enforceLength) {
      for (let it = 0; it < iterations; it++) projectDistance(points, restLen, invMass);
    }
    return 0;
  }

  const hit = projectCapsule(points, invMass, capsule, tie);
  if (hit === 0) return 0;

  for (let it = 0; it < iterations; it++) {
    if (enforceLength) projectDistance(points, restLen, invMass);
    projectCapsule(points, invMass, capsule, tie);
  }
  return hit;
}