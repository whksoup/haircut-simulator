/**
 * growthModel.js — plan item 6a and 6e: the number someone cuts hair by, and
 * the reasons not to believe it.
 *
 * THE WHOLE FEATURE IS ONE LINE OF ARITHMETIC:
 *
 *     L_cut(guide) = L_target(guide) − rate · t
 *
 * Author the target hairstyle A with the comb and the scissors, ask "what
 * should I cut today so it looks like A in three weeks", and this subtracts.
 * There is no shape reasoning here, no resampling and no representation
 * question — #6d settled all three by ruling out root-first retraction, and #5
 * already established that a cut writes `points` and `length` and touches
 * nothing else. Everything else in item 6 exists so that you can look at the
 * viewport and believe this subtraction.
 *
 * IT LIVES OUTSIDE ANY TOOL, for the reason guideLengthAudit.js and
 * cutSession.js do: this is the one deliverable in the plan that is not judged
 * by looking at it. A number that can only be produced by constructing a
 * Three.js gizmo and dragging it is a number nobody can test, and an untested
 * cut length is worse than no cut length at all.
 *
 * ═══ WHY VALIDITY REPORTING IS PART OF THE ITEM, NOT A FOLLOW-UP ═══
 *
 * With a uniform rate, rewinding subtracts a constant ABSOLUTE length from
 * every patch. Differences between patches survive; ratios do not. The plan's
 * own example: targets of 4cm and 12cm both lose 3.75cm over three months and
 * become 0.25cm and 8.25cm — the long patch is trimmed, the short patch has
 * effectively vanished. Nothing about that is a bug, and nothing about it is
 * visible either: the shader clamps `f` to 0 and the strand collapses to the
 * scalp, which reads as a rendering glitch rather than as "your target is
 * unreachable at this horizon".
 *
 * So every guide comes back with a STATE, not just a number:
 *
 *   ok               the cut is a length you could actually ask for
 *   unreachable      L_target < rate·t. The target or the horizon is wrong.
 *   marginal         the cut is inside the measurement noise — see below
 *   exceeds-measured cut > what the client's hair measures today. You can only
 *                    remove length, so this asks for hair that is not there.
 *
 * ═══ THE COMPARISON THIS MODULE EXISTS TO GET RIGHT ═══
 *
 * `rate · t` and the length invariant's residual drift are the SAME KIND OF
 * QUANTITY — absolute lengths in mesh units — and confusing a 3mm drift for a
 * 3mm margin is precisely the failure item 6 is defended against. #2 exposed
 * `auditGuideLengths().worstArcAbs` in mesh units for exactly this call site,
 * so `planRewind` audits before it subtracts and refuses to call anything
 * reachable-by-a-hair reachable: a cut within `drift` of zero is reported
 * `marginal`, because the arithmetic cannot tell it apart from unreachable.
 *
 * A guide sitting at the scissors' `minLength` gets `clampedTarget: true`
 * alongside its state. It is a second floor of the same kind: that guide was
 * CLAMPED by #5 rather than authored, so its length is not a deliberate target
 * and rewinding from it is rewinding from an artefact.
 *
 * ═══ UNITS ═══
 *
 * `rate` is mesh units per unit time and `t` is in the same time unit; nothing
 * here cares which, because both cancel into a length. The UI calls the unit a
 * week. The mesh has no absolute scale, so `calibrateRate` is the only place
 * real-world numbers enter, and it is deliberately a separate call rather than
 * a constant baked into the model.
 */

import { auditGuideLengths } from './guideLengthAudit.js';

/**
 * Mesh units of growth per week, applied to every guide until 6c's per-guide
 * field is authored away from its default.
 *
 * Sized against the model, not against a head: a guide seeded from
 * `globals.length` is 0.1–0.5 mesh units long, so 0.004/week puts a season's
 * growth in the same range as a typical strand — which is the range where the
 * rewind is interesting and where `unreachable` starts to bite. Use
 * `calibrateRate` for anything that has to agree with a tape measure.
 */
export const DEFAULT_GROWTH_RATE = 0.004;

/**
 * Real hair grows about 1.25 cm/month. Turning that into a rate needs the one
 * number the model genuinely does not have — how many mesh units a centimetre
 * is — so it is an argument rather than an assumption.
 *
 * @param {number} unitsPerCm     mesh units per real centimetre
 * @param {number} [cmPerMonth]
 * @returns {number} mesh units per week
 */
export function calibrateRate(unitsPerCm, cmPerMonth = 1.25) {
  return (unitsPerCm * cmPerMonth * 12) / 52;
}

/**
 * The retained fraction of a strand after rewinding by `t` — the CPU twin of
 * the shader's `f` (6b), character for character:
 *
 *     float f = clamp((len - rate * uPhase) / max(len, 1e-6), 0.0, 1.0);
 *
 * Exported because the two MUST agree: `growth_test.mjs` asserts that
 * truncating by this parameter and cutting by arc through #4 land in the same
 * place. If a rewound preview ever looks subtly different from a committed cut
 * of the same length, the disagreement is between this function and that line
 * of GLSL, and nowhere else.
 */
export function phaseFraction(length, rate, t) {
  const f = (length - rate * t) / Math.max(length, 1e-6);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * `L_target − rate · t`, unclamped and unjudged. Item 6a in one expression.
 *
 * Deliberately allowed to go negative: the sign IS the unreachability signal,
 * and clamping it here would throw away the only evidence that the horizon is
 * too long before anything gets a chance to report it. `planRewind` is what
 * turns the sign into a sentence.
 */
export function cutLength(targetLength, rate, t) {
  return targetLength - rate * t;
}

/** Severity order, worst first. `state` reports the first one that applies. */
const SEVERITY = ['unreachable', 'exceeds-measured', 'marginal', 'ok'];

/**
 * Derive today's cut for every guide, and say which of those numbers are
 * trustworthy.
 *
 * @param {object} o
 * @param {{guides: Map<number, object>}} o.guides   a GuideStore
 * @param {number} o.t                    horizon, in the rate's time unit
 * @param {(g:object)=>boolean} [o.filter]          restrict to a patch
 * @param {number} [o.minLength]          the scissors' floor (#5), for
 *                                        `clampedTarget`
 * @param {number} [o.drift]              absolute arc error to treat as noise.
 *                                        Defaults to the measured
 *                                        `worstArcAbs` over the audited set —
 *                                        pass a number only to override it.
 * @param {number|((g:object)=>number)} [o.measured]  the client's hair TODAY,
 *                                        in mesh units. Absent means the check
 *                                        is skipped and said to be skipped.
 * @returns {object} the plan
 */
export function planRewind({
  guides, t, filter = null, minLength = 0, drift = null, measured = null,
} = {}) {
  if (!guides) throw new Error('planRewind: no guide store');
  if (!Number.isFinite(t)) throw new Error(`planRewind: t must be finite, got ${t}`);

  // Audit FIRST. The residual is not a diagnostic here, it is an input: it
  // sets the threshold below which a cut length is indistinguishable from
  // zero. Reusing the caller's filter keeps the drift figure about the guides
  // actually being planned.
  const audit = auditGuideLengths(guides, filter ? { filter } : {});
  const noise = drift === null ? audit.worstArcAbs : drift;

  const measureOf = typeof measured === 'function'
    ? measured
    : (measured === null || measured === undefined ? null : () => measured);

  const out = {
    t,
    drift: noise,
    minLength,
    audit,
    measuredKnown: measureOf !== null,
    guides: [],
    counts: { ok: 0, unreachable: 0, marginal: 0, exceedsMeasured: 0, clampedTarget: 0 },
    totalRemoved: 0,
    shortestCut: Infinity,
    longestCut: 0,
    ok: false,
    verdict: '',
  };

  for (const g of guides.guides.values()) {
    if (filter && !filter(g)) continue;

    const target = g.length;
    const rate   = Number.isFinite(g.rate) ? g.rate : DEFAULT_GROWTH_RATE;
    const cut    = cutLength(target, rate, t);
    const grew   = rate * t;

    // A guide the scissors clamped is not a target anyone chose. Reported
    // alongside the state rather than as one, because it is a fact about where
    // the number came from and stays true whatever the horizon is.
    const clampedTarget = minLength > 0 && target <= minLength * (1 + 1e-9);

    let state = 'ok';
    if (cut < 0)                          state = 'unreachable';
    else if (Math.abs(cut) <= noise)      state = 'marginal';

    let measuredNow = null;
    if (measureOf) {
      measuredNow = measureOf(g);
      // You can only remove length. A cut longer than what is on the head
      // today is not a cut, and it is worth catching here rather than at the
      // chair: it means the target, the horizon or the measurement is wrong.
      if (Number.isFinite(measuredNow) && cut > measuredNow + noise) {
        state = SEVERITY.indexOf('exceeds-measured') < SEVERITY.indexOf(state)
          ? 'exceeds-measured' : state;
      }
    }

    const rec = {
      id: g.id, facetId: g.facetId,
      target, rate, grew,
      cut, state, clampedTarget,
      measured: measuredNow,
    };
    out.guides.push(rec);

    if (state === 'ok') out.counts.ok++;
    else if (state === 'unreachable') out.counts.unreachable++;
    else if (state === 'marginal') out.counts.marginal++;
    else if (state === 'exceeds-measured') out.counts.exceedsMeasured++;
    if (clampedTarget) out.counts.clampedTarget++;

    // Removal is what a person actually does with a pair of scissors, so it is
    // reported as a length to take off — and only for cuts that mean anything.
    if (cut >= 0) {
      out.totalRemoved += Math.min(grew, target);
      if (cut < out.shortestCut) out.shortestCut = cut;
      if (cut > out.longestCut)  out.longestCut  = cut;
    }
  }

  if (!Number.isFinite(out.shortestCut)) out.shortestCut = 0;
  out.ok = out.guides.length > 0
    && out.counts.unreachable === 0
    && out.counts.marginal === 0
    && out.counts.exceedsMeasured === 0;
  out.verdict = verdictOf(out);
  return out;
}

/**
 * One sentence for the panel and the log.
 *
 * Named conditions, not adjectives: "12 guides unreachable at t=8" is
 * actionable — shorten the horizon or lengthen the target — where "the preview
 * looks wrong" is the state this whole item exists to avoid shipping.
 */
function verdictOf(p) {
  const n = p.guides.length;
  if (n === 0) return 'no guides in scope';
  const c = p.counts;
  const bits = [];
  if (c.unreachable) {
    bits.push(`${c.unreachable}/${n} unreachable at t=${p.t} — target shorter than ` +
              `rate·t, so there is no cut that grows into it`);
  }
  if (c.exceedsMeasured) {
    bits.push(`${c.exceedsMeasured}/${n} ask for MORE length than measured today ` +
              `— a cut can only remove`);
  }
  if (c.marginal) {
    bits.push(`${c.marginal}/${n} within the ${p.drift.toFixed(5)} length-invariant ` +
              `drift of zero — indistinguishable from unreachable`);
  }
  if (c.clampedTarget) {
    bits.push(`${c.clampedTarget}/${n} sit at minLength (clamped by a cut, not authored)`);
  }
  if (!p.audit.ok) {
    bits.push(`length invariant FAILING (worst ${(p.audit.maxRel * 100).toFixed(3)}%) — ` +
              `aT is not arc length, so every number here is suspect`);
  }
  if (!bits.length) {
    return `${n} guide(s) ok — cut ${p.shortestCut.toFixed(4)}…${p.longestCut.toFixed(4)}, ` +
           `removing ${p.totalRemoved.toFixed(4)} in total`;
  }
  return bits.join('; ');
}

/**
 * The largest horizon at which every guide in scope is still reachable.
 *
 * The inverse of the unreachability check, and the more useful half in
 * practice: "this target supports 5.2 weeks" answers the question the failing
 * plan raises, where the list of failures only states it. Drift is subtracted
 * for the same reason `marginal` exists — a horizon that is only reachable
 * within the noise is not reachable.
 */
export function maxHorizon({ guides, filter = null, drift = null } = {}) {
  const audit = auditGuideLengths(guides, filter ? { filter } : {});
  const noise = drift === null ? audit.worstArcAbs : drift;
  let best = Infinity;
  for (const g of guides.guides.values()) {
    if (filter && !filter(g)) continue;
    const rate = Number.isFinite(g.rate) ? g.rate : DEFAULT_GROWTH_RATE;
    if (!(rate > 0)) continue;               // a guide that never grows never expires
    const t = (g.length - noise) / rate;
    if (t < best) best = t;
  }
  return Number.isFinite(best) ? Math.max(best, 0) : Infinity;
}
