/**
 * Historical physical growth/rewind planning and schema compatibility tests.
 * The parameter-remap fixtures below characterize growthModel's independent
 * weeks-based math. They are NOT an oracle for the current rendered preview.
 * Current fraction/prefix behavior lives in growth-preview.test.mjs and GPU
 * capture evidence; only the final renderer metadata/API block here uses R3.
 * Run: node --test tests/growth.test.mjs
 */
import assert from 'node:assert';
import * as THREE from 'three';
import { GuideStore } from '../src/groom/guides.js';
import { GpuHairR3 } from '../src/rendering/gpu/gpuHairR3.js';
import { Groom, GROOM_SCHEMA_VERSION } from '../src/groom/groom.js';
import { SHAPE_POINTS as M, SHAPE_REST as REST, straightShape } from '../src/hair/strandShape.js';
import { relaxStrand, buildInvMass } from '../src/hair/strandConstraints.js';
import { cutFromTip, polylineLength } from '../src/hair/strandResample.js';
import {
  phaseFraction, cutLength, planRewind, maxHorizon, calibrateRate, DEFAULT_GROWTH_RATE,
} from '../src/hair/growthModel.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --- fixtures: arc-uniform, so #2's invariant holds before we rewind anything
function exact(p) {
  const im = buildInvMass(M, 0); im[0] = 0;
  relaxStrand(p, { restLen: REST, invMass: im, iterations: 4000 });
  return Array.from(p);
}
const straight = () => exact((() => {
  const p = new Float64Array(M * 3);
  for (let k = 0; k < M; k++) p[k * 3 + 2] = k * REST;
  return p;
})());
const curl = (turns, r) => exact((() => {
  const p = new Float64Array(M * 3);
  for (let k = 0; k < M; k++) {
    const t = k * REST, a = turns * 2 * Math.PI * t;
    p[k * 3] = r * Math.cos(a) - r;
    p[k * 3 + 1] = r * Math.sin(a);
    p[k * 3 + 2] = t;
  }
  return p;
})());

const L = 0.3;
const CASES = [
  ['straight',     straight()],
  ['1 turn r.15',  curl(1, 0.15)],
  ['2 turns r.12', curl(2, 0.12)],
  ['3 turns r.10', curl(3, 0.10)],
];

/** Historical parameter-remap sampling, retained for the physical model. */
function physicalRewindVertex(points, len, rate, phase, aT) {
  const f  = phaseFraction(len, rate, phase);
  const u  = aT * f * (M - 1);
  const k0 = Math.floor(u);
  const k1 = Math.min(k0 + 1, M - 1);
  const fr = u - k0;
  return [0, 1, 2].map((i) =>
    (points[k0 * 3 + i] + (points[k1 * 3 + i] - points[k0 * 3 + i]) * fr) * len);
}

/** Nine samples of the historical physical rewind model, absolute. */
function physicalRewindSamples(points, len, rate, phase) {
  const out = [];
  for (let k = 0; k < M; k++) out.push(physicalRewindVertex(points, len, rate, phase, k / (M - 1)));
  return out;
}

/** A committed cut, lifted to the same absolute space for comparison. */
function cutStrand(points, len, keepArc) {
  const c = cutFromTip(points, len, keepArc, 1e-9);
  const out = [];
  for (let k = 0; k < M; k++) {
    out.push([c.points[k * 3] * c.length, c.points[k * 3 + 1] * c.length, c.points[k * 3 + 2] * c.length]);
  }
  return { pts: out, length: c.length };
}

const chordPath = (pts) => {
  let s = 0;
  for (let k = 1; k < pts.length; k++) s += d3(pts[k], pts[k - 1]);
  return s;
};

/** Distance from a point to the polyline, in absolute units. */
function offCurve(points, len, v) {
  let best = Infinity;
  for (let j = 0; j < M - 1; j++) {
    const a = j * 3, b = (j + 1) * 3;
    const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
    const ex = v[0] / len - points[a], ey = v[1] / len - points[a + 1], ez = v[2] / len - points[a + 2];
    let t = (ex * dx + ey * dy + ez * dz) / (dx * dx + dy * dy + dz * dz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(ex - dx * t, ey - dy * t, ez - dz * t) * len);
  }
  return best;
}

/** Arc position of a point known to lie in segment k0, as a fraction. */
function arcFractionOf(points, u) {
  const k0 = Math.floor(u), k1 = Math.min(k0 + 1, M - 1), fr = u - k0;
  const pt = [0, 1, 2].map((i) => points[k0 * 3 + i] + (points[k1 * 3 + i] - points[k0 * 3 + i]) * fr);
  let arc = 0;
  for (let j = 0; j < k0; j++) {
    const a = j * 3, b = (j + 1) * 3;
    arc += Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]);
  }
  arc += Math.hypot(pt[0] - points[k0 * 3], pt[1] - points[k0 * 3 + 1], pt[2] - points[k0 * 3 + 2]);
  return arc / polylineLength(points);
}

function store1(points = straight(), length = L, rate = 0.004, n = 1) {
  const s = new GuideStore();
  for (let i = 0; i < n; i++) {
    s.add({ facetId: i, root: [i * 0.5, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0],
            points, length, rate });
  }
  return s;
}

// ===========================================================================
// 1. 6a — the arithmetic, and the thing about it that surprises people
// ===========================================================================

assert.equal(cutLength(0.3, 0.004, 5), 0.3 - 0.02);
assert.equal(cutLength(0.3, 0, 100), 0.3, 'a guide with rate 0 never needs cutting');
assert.ok(cutLength(0.1, 0.05, 5) < 0, 'unclamped: the SIGN is the unreachability signal');

{
  // THE PLAN'S OWN EXAMPLE, and the reason 6e exists. A uniform rate removes a
  // constant ABSOLUTE length, so differences between patches survive and
  // RATIOS DO NOT. 4 and 12 are 1:3; after three months of growth is taken off
  // they are 1:33, and the short patch has effectively vanished.
  const rate = 0.2885, t = 13;              // ≈1.25cm/month, ≈3 months, in cm
  const shortCut = cutLength(4,  rate, t);
  const longCut  = cutLength(12, rate, t);
  assert.ok(Math.abs(shortCut - 0.25) < 0.02, `short patch → ${shortCut}`);
  assert.ok(Math.abs(longCut  - 8.25) < 0.02, `long patch → ${longCut}`);
  const before = 12 / 4, after = longCut / shortCut;
  assert.ok(after > 10 * before,
    'ratios are NOT preserved by a uniform rate — this is the finding 6e reports on');
  console.log(`  6a: 4 and 12 (1:${before.toFixed(0)}) rewind to ` +
              `${shortCut.toFixed(2)} and ${longCut.toFixed(2)} (1:${after.toFixed(0)})`);
}

// calibrateRate is the only place real-world numbers enter the model.
assert.ok(Math.abs(calibrateRate(1, 1.25) - (1.25 * 12) / 52) < 1e-12);

// ===========================================================================
// 2. 6b — phase 0 must be BIT-EXACT identity with the authored target
// ===========================================================================
// Not "visually identical". The rewind is a live uniform on the only render
// path there is, so if it perturbed the groom at rest, every other test in the
// project would silently be measuring a slightly different model.

for (const [name, p] of CASES) {
  const s = physicalRewindSamples(p, L, 0.004, 0);
  for (let k = 0; k < M; k++) {
    const want = [p[k * 3] * L, p[k * 3 + 1] * L, p[k * 3 + 2] * L];
    assert.deepStrictEqual(s[k], want, `${name}: phase 0 moved vertex ${k}`);
  }
}
assert.equal(phaseFraction(L, 0.004, 0), 1, 'f is exactly 1 at rest, not 0.9999999');
console.log('  6b: phase 0 is bit-exact identity on all four fixtures');

// ===========================================================================
// 3. 6b ≡ #4 — the remap and a committed cut are the same operation
// ===========================================================================
// The plan: "this remap is the exact GPU analogue of cutFromTip, and the two
// must agree." They agree on the three things that carry meaning, and differ
// by a bounded amount on the one that does not:
//
//   TIP           exact. Both land on the same point of the target curve.
//   ON-CURVE      exact. Every drawn vertex lies ON the target polyline, which
//                 is #4's geometry invariant restated for the GPU path.
//   ARC POSITION  exact. aT·f lands at fraction f of the arc.
//   INTERIOR      differs. The shader spaces vertices by equal PARAMETER (=
//                 equal arc, under #2); the resampler lays equal CHORDS. On a
//                 curl those place interior points differently — bounded below
//                 at well under half a percent of the strand, and invisible,
//                 but it is a real difference and this is where it is written
//                 down rather than discovered later.

let worstTip = 0, worstInterior = 0, worstOff = 0, worstChord = 0;
for (const [name, p] of CASES) {
  for (const keepFrac of [0.9, 0.7, 0.55, 0.3]) {
    const keepArc = L * keepFrac;
    const rate = L - keepArc;                 // one week of this rate removes exactly that
    const s = physicalRewindSamples(p, L, rate, 1);
    const c = cutStrand(p, L, keepArc);

    worstTip = Math.max(worstTip, d3(s[M - 1], c.pts[M - 1]));
    for (let k = 0; k < M; k++) {
      worstInterior = Math.max(worstInterior, d3(s[k], c.pts[k]));
      worstOff      = Math.max(worstOff, offCurve(p, L, s[k]));
    }
    worstChord = Math.max(worstChord, Math.abs(chordPath(s) - c.length) / c.length);

    // The retained fraction lands where it claims to, in ARC terms.
    assert.ok(Math.abs(arcFractionOf(p, keepFrac * (M - 1)) - keepFrac) < 1e-9,
      `${name}: aT·f does not land at fraction ${keepFrac} of the arc`);
  }
}
assert.ok(worstTip < 1e-12, `tip must land exactly, worst ${worstTip}`);
assert.ok(worstOff < 1e-12, `every drawn vertex must lie ON the target curve, worst ${worstOff}`);
assert.ok(worstChord < 1e-4, `drawn length must match the cut length, worst ${worstChord}`);
// Measured at 0.476% of L, worst case (3-turn curl trimmed to 90%). The bound
// is 1% rather than a hair above the measurement: this number is expected to
// move a little with the fixtures, and a threshold that only just passes
// today is a test that fails tomorrow for no reason anyone can act on.
assert.ok(worstInterior < 0.01 * L,
  `interior spacing differs by more than 1% of the strand: ${worstInterior}`);
console.log(`  6b≡#4: tip ${worstTip.toExponential(1)}, off-curve ${worstOff.toExponential(1)}, ` +
            `drawn-vs-cut length ${(worstChord * 100).toFixed(4)}%, ` +
            `interior spacing ${(worstInterior / L * 100).toFixed(3)}% of L`);

// ===========================================================================
// 4. AND IT ALL RESTS ON #2 — the same check on a drifted strand FAILS
// ===========================================================================
// Without this, §3 could pass for the wrong reason. Parameter truncation is
// arc truncation only while control points are arc-uniform; on a strand whose
// segments have drifted, `aT · f` lands somewhere else, and 6a's cut number is
// wrong by exactly that much with nothing to indicate it.

{
  const p = Array.from(curl(2, 0.12));
  for (let k = 4; k < M; k++) p[k * 3 + 2] += 0.02;   // plausible post-collision drift
  const landed = arcFractionOf(p, 0.4 * (M - 1));
  assert.ok(Math.abs(landed - 0.4) > 1e-3,
    'the drifted fixture must NOT land at 0.4, or §3 proves nothing');
  console.log(`  #2 dependency: drifted, f=0.4 lands at arc ${landed.toFixed(6)} — ` +
              'the remap is only arc truncation while #2 holds');
}

// ===========================================================================
// 5. 6b — resolution is PRESERVED, which is the reason for the remap
// ===========================================================================
// The alternative was hiding the tip: drop the vertices past the cut. That
// throws away resolution exactly where the strand still exists — a nine-point
// curl drawn with two points at a deep rewind — and it quantises the timeline
// to eight steps, so the slider jumps in eighths of a haircut.

for (const [name, p] of [['1 turn r.15', curl(1, 0.15)], ['3 turns r.10', curl(3, 0.10)]]) {
  for (const f of [1, 0.7, 0.4, 0.15]) {
    const s = physicalRewindSamples(p, L, (1 - f) * L, 1);
    assert.equal(s.length, M, 'every phase draws all nine vertices');
    const segs = [];
    for (let k = 1; k < M; k++) segs.push(d3(s[k], s[k - 1]));
    const lo = Math.min(...segs), hi = Math.max(...segs);
    const mean = segs.reduce((a, b) => a + b, 0) / segs.length;
    assert.ok((hi - lo) / mean < 0.01, `${name} @ ${f}: drawn spacing spread ${(hi - lo) / mean}`);
  }
}
// The continuity claim, stated directly: two phases a hair apart give two
// different (not identical) strands, which nearest-texel fetching would not.
{
  const p = curl(2, 0.12);
  const a = physicalRewindSamples(p, L, 0.001, 1);
  const b = physicalRewindSamples(p, L, 0.001 * 1.02, 1);
  assert.ok(d3(a[M - 1], b[M - 1]) > 0, 'a 2% phase nudge must move the tip — no quantisation');
}
console.log('  6b: nine vertices at every phase, spacing spread <1%, tip moves continuously');

// ===========================================================================
// 6. 6d — truncation is from the TIP, and the root never moves
// ===========================================================================
// The physically faithful alternative (remove material at the root, let the
// tip retract) is ruled out on the plan's grounds: hair shape is a field over
// position, not a property carried by material. What that means mechanically
// is that vertex 0 is nailed down and the strand only ever gets shorter.

{
  const p = curl(2, 0.12);
  let prev = Infinity;
  for (const phase of [0, 1, 2, 3, 5, 8]) {
    const s = physicalRewindSamples(p, L, 0.02, phase);
    assert.deepStrictEqual(s[0], [0, 0, 0], 'the root stays at the origin at every phase');
    const drawn = chordPath(s);
    assert.ok(drawn <= prev + 1e-12, 'rewinding further must never lengthen the strand');
    prev = drawn;
  }
  // A rewind past the whole strand collapses it rather than inverting it.
  const gone = physicalRewindSamples(p, L, 1.0, 99);
  assert.ok(chordPath(gone) === 0, 'f clamps at 0: the strand collapses to the scalp');
  console.log('  6d: root pinned, length monotone in phase, clamps to the scalp');
}

// ===========================================================================
// 7. 6e — validity is a named condition, and it is NOT the invariant's drift
// ===========================================================================

{
  // Reachable, and said to be.
  const s = store1(straight(), 0.3, 0.004);
  const p = planRewind({ guides: s, t: 10 });
  assert.equal(p.counts.unreachable, 0);
  assert.equal(p.guides[0].state, 'ok');
  assert.ok(Math.abs(p.guides[0].cut - 0.26) < 1e-12);
  assert.ok(p.ok);
}

{
  // Unreachable: the horizon is longer than the target supports. The plan's
  // point is that this is ALREADY visible (the strand collapses) but reads as
  // a rendering glitch, so it has to be named.
  const s = store1(straight(), 0.05, 0.01);
  const p = planRewind({ guides: s, t: 10 });
  assert.equal(p.guides[0].state, 'unreachable');
  assert.ok(!p.ok);
  assert.match(p.verdict, /unreachable/);
  // And the inverse, which is the more useful half in practice.
  assert.ok(Math.abs(maxHorizon({ guides: s }) - 5) < 1e-9, 'this target supports 5 weeks');
}

{
  // THE COMPARISON THIS MODULE EXISTS TO GET RIGHT. A cut length inside the
  // length invariant's own residual is not a small cut, it is a number the
  // arithmetic cannot distinguish from zero. Drift and margin are both
  // absolute lengths in mesh units and must not be confused.
  const s = store1(straight(), 0.1, 0.0099);
  const clean = planRewind({ guides: s, t: 10 });
  assert.equal(clean.guides[0].state, 'ok', 'with an exact groom, 0.001 is a real cut');
  const noisy = planRewind({ guides: s, t: 10, drift: 0.002 });
  assert.equal(noisy.guides[0].state, 'marginal',
    'the same cut, under 2mm of measured drift, is not distinguishable from unreachable');
  assert.match(noisy.verdict, /drift/);
  // The default drift is MEASURED, not assumed: an exact groom reports zero.
  assert.equal(clean.drift, 0);
  assert.ok(clean.audit.ok);
}

{
  // The third number: you can only ever remove length.
  const s = store1(straight(), 0.3, 0.004);
  const p = planRewind({ guides: s, t: 10, measured: 0.2 });
  assert.equal(p.guides[0].state, 'exceeds-measured');
  assert.ok(p.measuredKnown);
  // Absent means skipped AND SAID to be skipped, rather than silently assumed.
  assert.equal(planRewind({ guides: s, t: 10 }).measuredKnown, false);
}

{
  // #5's minLength is a second floor of the same kind: a guide sitting on it
  // was CLAMPED by a cut, not authored, so its length is not a target anyone
  // chose and 6e must not read it as one.
  const s = store1(straight(), 0.004, 0.0001);
  const p = planRewind({ guides: s, t: 1, minLength: 0.004 });
  assert.equal(p.guides[0].clampedTarget, true);
  assert.match(p.verdict, /minLength/);
  // It is a flag, not a state — it stays true whatever the horizon does.
  assert.equal(planRewind({ guides: s, t: 999, minLength: 0.004 }).guides[0].clampedTarget, true);
}

{
  // A failing invariant poisons every number in the plan, so the verdict says
  // so rather than quietly reporting cuts derived from a bad `aT`.
  const s = store1(straight(), 0.3, 0.004);
  const g = [...s.guides.values()][0];
  g.points = Array.from(g.points);
  g.points[3 * 3 + 2] += 0.05;                 // stretch one segment badly
  const p = planRewind({ guides: s, t: 5 });
  assert.ok(!p.audit.ok);
  assert.match(p.verdict, /aT is not arc length|invariant FAILING/);
}

{
  // Per-guide rate is honoured per guide, not averaged — the whole reason 6c
  // stores it on the guide from day one.
  const s = new GuideStore();
  s.add({ root: [0, 0, 0], normal: [0, 0, 1], points: straight(), length: 0.3, rate: 0.01 });
  s.add({ root: [1, 0, 0], normal: [0, 0, 1], points: straight(), length: 0.3, rate: 0 });
  const p = planRewind({ guides: s, t: 10 });
  assert.ok(Math.abs(p.guides[0].cut - 0.2) < 1e-12);
  assert.equal(p.guides[1].cut, 0.3, 'a rate-0 guide is not rewound at all');
  assert.equal(maxHorizon({ guides: s }), 30, 'and it does not cap the horizon');
}

{
  // A patch mask restricts the plan AND the drift figure it is judged against.
  const s = store1(straight(), 0.3, 0.004, 4);
  const p = planRewind({ guides: s, t: 5, filter: (g) => g.facetId < 2 });
  assert.equal(p.guides.length, 2);
  assert.equal(p.audit.skipped, 2);
}
console.log('  6e: unreachable / marginal / exceeds-measured / clamped all named, ' +
            'drift measured not assumed');

// ===========================================================================
// 8. 6c — the field survives the round trip, which is what "added correctly"
//    means now
// ===========================================================================

{
  const g = new Groom();
  g.faces.set(1, { density: 1, length: 0.2, segments: 4, shape: straightShape() });
  g.guides.add({ facetId: 1, root: [0, 0, 0], normal: [0, 0, 1], points: straight(),
                 length: 0.3, rate: 0.007 });
  const out = g.toJSON();
  assert.equal(out.version, GROOM_SCHEMA_VERSION);
  assert.equal(out.guides[0].rate, 0.007);
  // THE IDENTITY. A new field is correct exactly when this still holds.
  assert.deepStrictEqual(Groom.fromJSON(clone(out)).toJSON(), clone(out));
  // And copyFrom carries it, which is the path history's structural restore uses.
  assert.equal(new Groom().copyFrom(g).guides.get(1).rate, 0.007);
}

{
  // v5 → v6: an old file gets the default STAMPED, not merely defaulted on
  // read. Leaving it absent would round-trip through the object path and not
  // the file path, and writer/loader agreement is the property that catches it.
  const v5 = {
    version: 5, masterSeed: 1, globals: { density: 1, length: 0.1, segments: 4 },
    faces: [], seams: [],
    guides: [{ id: 1, facetId: 1, root: [0, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0],
               points: straightShape(), length: 0.2 }],
  };
  const g = Groom.fromJSON(clone(v5));
  assert.equal(g.guides.get(1).rate, DEFAULT_GROWTH_RATE, 'a pre-growth file gets the default');
  const out = g.toJSON();
  assert.equal(out.version, GROOM_SCHEMA_VERSION);
  assert.deepStrictEqual(Groom.fromJSON(clone(out)).toJSON(), clone(out));
  // A v5 file that ALREADY carries the field is telling the truth about itself.
  const v5b = clone(v5);
  v5b.guides[0].rate = 0.02;
  assert.equal(Groom.fromJSON(v5b).guides.get(1).rate, 0.02);
}

{
  // ABSENT AND ZERO ARE DIFFERENT, which is the whole schemaGuards rule. Zero
  // is a guide that does not grow — a legitimate thing to author.
  const mk = (rate) => ({
    version: GROOM_SCHEMA_VERSION, faces: [], seams: [], globals: {},
    guides: [{ id: 1, facetId: -1, root: [0, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0],
               points: straightShape(), length: 0.2, ...(rate === undefined ? {} : { rate }) }],
  });
  assert.equal(Groom.fromJSON(mk(0)).guides.get(1).rate, 0, 'present zero is preserved');
  assert.equal(Groom.fromJSON(mk(undefined)).guides.get(1).rate, DEFAULT_GROWTH_RATE);
  // A negative rate would make hair LENGTHEN on rewind — the forward-growth
  // problem #6 is designed never to have to solve.
  assert.throws(() => Groom.fromJSON(mk(-0.01)), /must not be negative/);
  assert.throws(() => Groom.fromJSON(mk('fast')), /finite number/);
  assert.throws(() => Groom.fromJSON(mk(NaN)), /finite number/);
}
console.log('  6c: rate round-trips, v5→v6 stamps the default, absent ≠ zero, negative refused');

// ===========================================================================
// 9. THE PREVIEW IS READ-ONLY
// ===========================================================================
// The plan settles "what does combing at phase > 0 mean" by making it
// unaskable: editing always happens at the target. Mechanically that means
// nothing on the rewind path may write to a guide — the phase lives in a
// uniform, and everything here is a pure function of the store.

{
  const s = store1(curl(2, 0.12), 0.3, 0.01, 3);
  const before = JSON.stringify(s.toJSON());
  planRewind({ guides: s, t: 7 });
  maxHorizon({ guides: s });
  for (const phase of [0, 1, 5, 20]) {
    for (const g of s.guides.values()) physicalRewindSamples(g.points, g.length, g.rate, phase);
  }
  assert.equal(JSON.stringify(s.toJSON()), before, 'rewinding must not touch the model');
  console.log('  preview: rewinding at four phases left the store byte-identical');
}

// ===========================================================================
// 10. THE RENDERER PUTS THE RATE WHERE THE SHADER LOOKS FOR IT
// ===========================================================================
// The one part of 6c that no amount of model-level testing can reach: `rate`
// is correct in the GuideStore and correct in the file, and the hair still
// rewinds at the wrong speed if the row writer puts it in the wrong texel.
// Nothing throws in that case — the shader reads whatever is in texel(row,1).w,
// which is 1.0 by default, i.e. a growth rate of one mesh unit per week.

{
  const groom = new Groom();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.catalogue = null;             // guide rows are all we need here

  const a = groom.guides.add({ facetId: 1, root: [0, 0, 0], normal: [0, 0, 1],
                               points: straightShape(), length: 0.3, rate: 0.007 });
  groom.guides.add({ facetId: 2, root: [1, 0, 0], normal: [0, 0, 1],
                     points: straightShape(), length: 0.2, rate: 0 });

  const hair = new GpuHairR3(mesh, groom, groom.guides);
  hair.rebuild();
  const texel = (row, k, c) => hair._shapeData[(row * M + k) * 4 + c];

  assert.ok(Math.abs(texel(0, 0, 3) - 0.3) < 1e-6, 'length still rides in texel 0');
  assert.ok(Math.abs(texel(0, 1, 3) - 0.007) < 1e-9, 'rate rides in texel 1');
  assert.equal(texel(0, 2, 3), 1, 'every other alpha is left alone');
  // Zero must survive the trip: a guide that does not grow is authored, not
  // missing, and defaulting it here would undo the loader's care.
  assert.equal(texel(1, 1, 3), 0, 'a rate of 0 reaches the texture as 0');

  // A rate edit has to reach the texture through the path a comb stroke uses,
  // or the preview keeps rewinding at the old rate with nothing to show for it
  // — the same silent no-op seams had before syncSeams existed.
  groom.guides.get(a).rate = 0.02;
  hair.setGuides([a]);
  assert.ok(Math.abs(texel(0, 1, 3) - 0.02) < 1e-9, 'setGuides carries the rate');

  // Renderer preview supersedes physical weeks rewind; rate storage remains compatible.
  assert.equal(hair.growthFraction, 1);
  hair.setGrowthFraction(0.5); assert.equal(hair.growthFraction, 0.5);
  hair.setGrowthFraction(-2); assert.equal(hair.growthFraction, 0);
  assert.ok(!('uPhase' in hair._material.uniforms));
  assert.ok('uGrowthFraction' in hair._material.uniforms);
  hair.setGrowth(0.5); hair.update(0.016, 1);
  assert.equal(hair.growthFraction, 0, 'legacy ramp must not move preview');
  console.log('  renderer: rate metadata retained, fraction is a runtime-only uniform');
}

console.log('growth: all assertions passed');
