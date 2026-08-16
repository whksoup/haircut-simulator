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
 * WHY THE RESIDUAL IS PART OF THE FEATURE, NOT A DEBUG EXTRA. `segmentResidual`
 * and `assertSegmentLengths` below exist because inextensibility is not a thing
 * you can see. Everything downstream that reads `aT` as ARC LENGTH — the
 * arc-length resampler, the scissors commit, the time rewind's `uPhase` remap —
 * is only correct while |p[k+1] − p[k]| = restLen actually holds, and when it
 * stops holding the failure is silent: the render still looks like hair, the
 * rewound preview is just wrong by however far the strands have drifted. So the
 * invariant is measurable from the outside, and callers CHECK it rather than
 * assuming it. See combTool.lengthResidual() and guideLengthAudit.js.
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
 *
 * ROOT→TIP, and MEASURED that way rather than assumed. Alternating the sweep
 * direction is the textbook cure for Gauss-Seidel's reading-order bias and was
 * tried here; it converges strictly SLOWER on this chain at every iteration
 * count and every rootRamp (20% uniform stretch, 8 sweeps: 14.5% residual
 * forward, 16.2% alternating, 19.4% backward; ramp 1). The pinned root is why —
 * it is a fixed boundary condition, and sweeping away from a fixed end
 * propagates the correction with the sweep instead of against it. The bias
 * alternation would remove is also not the whip: the whip came from FABRIK
 * re-laying the chain rigidly, which inverse-mass weighting already fixes.
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
 * WHERE THE STROKE ENDS DECIDES WHICH REGIME YOU GET, and that is the part the
 * table above does not show. Sweep the bar fully PAST the strand and the last
 * few sub-steps have shrinking penetration and a free length solve, so the
 * strand relaxes on its own: 0.04% worst segment across a synthetic stroke.
 * Stop the bar at the far edge of the hair — releasing the drag while the comb
 * is still amongst it, which is a normal way to finish — and the accumulated
 * stretch is never collected: 6.3% worst segment, 4.2% total arc. Same solver,
 * same settings, two orders of magnitude apart, decided by where you let go.
 *
 * A 4.2% arc error is not a cosmetic difference. It is the difference between
 * `aT` being arc length and not, which is #6a's cut number being right or
 * wrong. `relaxStrand` below collects it, ONCE per stroke, on only the guides
 * that moved — see CombTool._relaxStroke.
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

/**
 * UNCONDITIONAL length relaxation for a strand you already know moved.
 *
 * The difference from solveStrand is the probe. solveStrand refuses to touch a
 * strand the capsule is not currently in contact with, and that refusal is
 * correct per sub-step — without it, every distance sweep would quietly relax
 * every guide in the groom on every gizmo event, including ones nobody combed.
 * But it also means the stretch a stroke leaves behind is never cleaned up: by
 * the time the bar has swept past, the probe finds nothing and the residual is
 * frozen in.
 *
 * That matters because a stroke that ENDS in contact never gets the free
 * relaxation a stroke that sweeps past gets for nothing — 6.3% worst segment
 * and 4.2% total arc, versus 0.04%, for the same solver and the same settings.
 *
 * So: relax ONCE at the stroke boundary, on ONLY the ids the stroke reported.
 * Nothing untouched is read or written. Measured on a synthetic stroke that
 * stops in the hair (the bad regime), worst segment / total arc:
 *
 *   relaxation sweeps      0        8       32      128      512
 *   worst segment      6.276%   3.009%   0.342%  0.0001%   0.000%
 *   total arc          4.159%   2.031%   0.234%  0.0000%   0.000%
 *
 * Convergence is asymptotic rather than sharp, which is why the default is
 * generous: this is a handful of guides once per stroke, so 128 sweeps is
 * cheaper than a single sub-step over the whole groom. Do not economise here —
 * the expensive knob is `iterations`, not this one.
 *
 * `capsule` is optional and should be the bar's FINAL pose. Pass it and the
 * relaxation cannot pull the strand back inside a bar that is still parked in
 * the hair; omit it (bar cleared, or you know it has swept past) and this is
 * pure inextensibility, which converges to machine precision. A genuinely
 * parked bar will NOT converge to zero — collision and length are in real
 * conflict there — and that residual is a true report of the state, not a
 * failure of this routine.
 *
 * @returns {number} the sweep count; there is nothing else meaningful to say.
 */
export function relaxStrand(points, {
  restLen, invMass, capsule = null, tie = UP, iterations = 128,
}) {
  for (let it = 0; it < iterations; it++) {
    projectDistance(points, restLen, invMass);
    if (capsule) projectCapsule(points, invMass, capsule, tie);
  }
  return iterations;
}

// ---------------------------------------------------------------------------
// The invariant, measured
//
// Plan item 2 ships the constraint AND a way to check it, because the things
// that depend on it (#4 resampler, #5 scissors commit, #6 uPhase remap) all
// read the strand parameter `aT` as ARC LENGTH, and that reading is only valid
// while every segment is at rest length. When it stops being valid nothing
// looks wrong — the hair still renders, the rewound length is just a lie. So:
// measure, don't assume.

/**
 * Per-segment length error for one strand, in the units `points` lives in.
 *
 * Relative figures are against `restLen`, so they are comparable across
 * strands of different length and across spaces (normalised vs mesh-local).
 *
 * `arcRel` is the headline number for #4/#5/#6: it is the error in TOTAL arc
 * length, i.e. exactly how wrong a parameter-based truncation would be. The
 * per-segment `maxRel` can be larger than `arcRel` when one long segment is
 * paid for by a short one — that cancellation is real for total length but not
 * for where along the strand a given `aT` actually lands, which is why both
 * are reported.
 *
 * @param {number[]|Float32Array} points  flat [x,y,z,...]
 * @param {number} restLen                target length of every segment
 * @param {object} [out]                  reused result object; no allocation
 */
export function segmentResidual(points, restLen, out = {}) {
  const count = points.length / 3;
  const segs  = count - 1;

  out.segments = segs;
  out.restLen  = restLen;

  if (segs <= 0 || !(restLen > 0)) {
    out.maxAbs = 0; out.maxRel = 0; out.rmsRel = 0; out.worstSegment = -1;
    out.arcLen = 0; out.restArc = 0; out.arcAbs = 0; out.arcRel = 0;
    out.minRel = 0; out.maxSegRel = 0;
    return out;
  }

  let maxAbs = 0, worst = -1, sum2 = 0, arc = 0;
  let minRel = Infinity, maxSegRel = -Infinity;

  for (let k = 0; k < segs; k++) {
    const i = k * 3, j = (k + 1) * 3;
    const len = Math.hypot(
      points[j]     - points[i],
      points[j + 1] - points[i + 1],
      points[j + 2] - points[i + 2],
    );
    arc += len;

    const abs = len - restLen;
    const rel = abs / restLen;
    if (Math.abs(abs) > maxAbs) { maxAbs = Math.abs(abs); worst = k; }
    if (rel < minRel)    minRel = rel;
    if (rel > maxSegRel) maxSegRel = rel;
    sum2 += rel * rel;
  }

  const restArc = restLen * segs;

  out.maxAbs       = maxAbs;                  // worst |segment − rest|
  out.maxRel       = maxAbs / restLen;        // ...as a fraction of rest
  out.rmsRel       = Math.sqrt(sum2 / segs);
  out.worstSegment = worst;
  out.minRel       = minRel;                  // most-compressed segment
  out.maxSegRel    = maxSegRel;               // most-stretched segment
  out.arcLen       = arc;
  out.restArc      = restArc;
  out.arcAbs       = arc - restArc;
  out.arcRel       = (arc - restArc) / restArc;
  return out;
}

/**
 * Throwing form, for tests and for the downstream commit paths that are only
 * correct under the invariant.
 *
 * Deliberately a hard throw rather than a console warning: a silently-wrong
 * rewind number is worse than a crash, because someone cuts hair by it. Call
 * it at COMMIT boundaries (a resample, a cut, a measurement readout), never
 * per frame — measuring is O(M) but throwing mid-drag would be useless noise.
 *
 * @param {number[]|Float32Array} points
 * @param {number} restLen
 * @param {number} [tol]    max allowed |segment − rest| / rest. 1e-3 is a
 *                          tenth of the residual 8 iterations leaves under
 *                          active contact, and far above float noise.
 * @param {string} [label]  what is being checked, for the message
 * @returns {object} the residual, when it passes
 */
export function assertSegmentLengths(points, restLen, tol = 1e-3, label = 'strand') {
  const r = segmentResidual(points, restLen);
  if (r.maxRel > tol) {
    throw new Error(
      `${label}: segment length invariant violated — worst segment ${r.worstSegment} ` +
      `is off by ${(r.maxRel * 100).toFixed(3)}% (tol ${(tol * 100).toFixed(3)}%), ` +
      `arc length off by ${(r.arcRel * 100).toFixed(3)}%. ` +
      `aT is not arc length here; any parameter-based truncation is wrong by this much.`,
    );
  }
  return r;
}