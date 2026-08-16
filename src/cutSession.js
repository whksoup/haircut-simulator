/**
 * cutSession.js — the bookkeeping of one cutting stroke, with no viewport.
 *
 * Split out of ScissorsTool for the same reason guideLengthAudit.js is split
 * out of CombTool: this is the part with behaviour worth asserting, and a check
 * that can only be reached by constructing a Three.js gizmo is a check nobody
 * runs. Everything here is plain data — a GuideStore and capsules in mesh-local
 * space — so `cut_test.mjs` drives a whole stroke headlessly.
 *
 * ═══ THE THREE PROPERTIES THIS CLASS EXISTS TO GUARANTEE ═══
 *
 * 1. COMPOSES BY MINIMUM. `cut = min(cut, thisPose)`. Minimum is associative,
 *    commutative and idempotent, so a stroke's result depends only on the SET
 *    of poses the blade passed through — not their order, their count, or how
 *    finely the drag was sampled. This is why ScissorsTool needs none of the
 *    fixed-cadence, banked-remainder machinery CombTool needs: framerate
 *    independence is not something a cut has to achieve, it is something it
 *    cannot fail at.
 *
 * 2. RESAMPLES FROM A PRISTINE SNAPSHOT, NEVER FROM THE LIVE STRAND.
 *    Resampling is diffusive — each pass lerps between control points — so
 *    feeding it its own output every frame of a drag would visibly melt a curl.
 *    Feeding it the stroke-opening state makes it a pure function of the cut
 *    fraction: the preview during the drag IS the commit, computed the same
 *    way, so the two cannot disagree and a long drag costs nothing in fidelity.
 *
 * 3. AN ABORTED STROKE PUTS THE HAIR BACK. CombTool._abortStroke simply drops
 *    the history pre-capture and leaves the hair where the partial gesture put
 *    it, which is fine for a displacement — the hair is still all there. A
 *    half-finished cut has already destroyed length, and reporting an empty id
 *    set means history discards the only record of it. Restoring from the
 *    snapshots is the difference between "the gesture was cancelled" and "the
 *    gesture was cancelled and you lost three centimetres".
 *
 * ═══ WHY THE BLADE IS TESTED AGAINST THE PRISTINE GEOMETRY ═══
 *
 * Every pose measures the blade against the SNAPSHOT, not the already-shortened
 * live strand. That sounds wrong and is exactly right: a cut only ever removes
 * a suffix, so the live strand is a prefix of the pristine one, and any entry
 * point beyond the current cut is discarded by the minimum anyway. Testing the
 * pristine strand gives the same answer while keeping every fraction measured
 * against the same denominator — which is the only thing that makes the minimum
 * meaningful.
 *
 * The broad-phase reach uses the pristine length too. Rejecting on the live
 * (shorter) length would make the blade stop biting halfway through a drag, in
 * a way that looks exactly like the tool breaking.
 */

import { SHAPE_POINTS } from './strandShape.js';
import { cutFromTip } from './strandResample.js';
import { entryFraction } from './strandCut.js';

/** Never leave a guide shorter than this, in mesh units.
 *
 *  Not cosmetic. #3's loader rejects a guide with `length <= 0` and history's
 *  structural restore path runs through `GuideStore.fromJSON`, so a cut to zero
 *  would make its own undo throw. Shaving to the scalp is a guide REMOVAL —
 *  a different edit, and the only one of the two you cannot reverse by growing
 *  it back. */
export const DEFAULT_MIN_LENGTH = 0.004;

/** Below this change in cut fraction, a "cut" is bisection noise. Acting on it
 *  would rewrite texture rows every frame for something nobody can see. */
const MIN_BITE = 1e-4;

export class CutSession {
  /**
   * @param {object} o
   * @param {{guides: Map<number, object>}} o.guides  a GuideStore
   * @param {number} [o.minLength]
   */
  constructor({ guides, minLength = DEFAULT_MIN_LENGTH }) {
    this.guides = guides;
    this.minLength = minLength;

    /** @type {Map<number, {points: number[], length: number}>} */
    this._pristine = new Map();
    /** @type {Map<number, number>} guide id → cut fraction of PRISTINE length. */
    this._cutFrac = new Map();
    /** Union of everything this stroke has shortened. */
    this._touched = new Set();
    this._open = false;

    this._local = new Float64Array(SHAPE_POINTS * 3);
    this._frm = { tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0, nx: 0, ny: 0, nz: 0,
                  rx: 0, ry: 0, rz: 0 };
  }

  get isOpen()  { return this._open; }
  get touched() { return this._touched; }
  /** Guides carrying an unreleased snapshot — i.e. what an abort would undo. */
  get pending() { return this._pristine.size; }

  /** @returns {boolean} true if THIS call opened the stroke (re-entrant, so a
   *  one-off `cut()` inside an open drag folds into it rather than nesting). */
  begin() {
    if (this._open) return false;
    this._open = true;
    this._pristine.clear();
    this._cutFrac.clear();
    this._touched.clear();
    return true;
  }

  /** Close and hand back everything the stroke shortened. The live guides ARE
   *  the commit and have been since the first pose; this only releases the
   *  snapshots. */
  end() {
    const ids = [...this._touched];
    this._open = false;
    this._pristine.clear();
    this._cutFrac.clear();
    this._touched.clear();
    return ids;
  }

  /** Undo everything this stroke did. @returns {number[]} ids put back. */
  abort() {
    const restored = [];
    for (const [id, snap] of this._pristine) {
      const g = this.guides.guides.get(id);
      if (!g) continue;                       // deleted since; nothing to restore
      g.points = Array.from(snap.points);
      g.length = snap.length;
      restored.push(id);
    }
    this._open = false;
    this._pristine.clear();
    this._cutFrac.clear();
    this._touched.clear();
    return restored;
  }

  /**
   * Apply the blade at one pose.
   *
   * @param {object} cap  {ax,ay,az, bx,by,bz, r} in MESH-LOCAL space
   * @param {(g:object)=>boolean} [filter]  the patch mask, if any
   * @returns {number[]} ids that got shorter at THIS pose (empty is normal)
   */
  applyCapsule(cap, filter = null) {
    const edited = [];
    const abx = cap.bx - cap.ax, aby = cap.by - cap.ay, abz = cap.bz - cap.az;
    const abLenSq = abx * abx + aby * aby + abz * abz;

    for (const g of this.guides.guides.values()) {
      if (filter && !filter(g)) continue;

      let snap = this._pristine.get(g.id);
      const reachLen = snap ? snap.length : g.length;

      // --- broad phase: root-to-axis distance against (r + strand length) ----
      // Sound because the capsule is finite in every direction, and because a
      // strand can never be longer than `length` while #2's invariant holds.
      const ox = g.root[0] - cap.ax, oy = g.root[1] - cap.ay, oz = g.root[2] - cap.az;
      let t = abLenSq > 1e-16 ? (ox * abx + oy * aby + oz * abz) / abLenSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const rx = ox - abx * t, ry = oy - aby * t, rz = oz - abz * t;
      const reach = cap.r + reachLen;
      if (rx * rx + ry * ry + rz * rz > reach * reach) continue;

      // First contact is also the last moment this guide is still pristine —
      // nothing else in this class writes to a guide it has not snapshotted.
      if (!snap) {
        snap = { points: Array.from(g.points), length: g.length };
        this._pristine.set(g.id, snap);
      }

      this._lift(g, snap);
      const frac = entryFraction(this._local, cap);
      if (frac < 0) continue;                       // blade misses this strand

      const prev = this._cutFrac.get(g.id) ?? 1;
      if (frac >= prev - MIN_BITE) continue;        // no new bite — the minimum
      this._cutFrac.set(g.id, frac);

      const res = cutFromTip(snap.points, snap.length, frac * snap.length, this.minLength);
      g.points = res.points;
      g.length = res.length;
      this._touched.add(g.id);
      edited.push(g.id);
    }
    return edited;
  }

  /**
   * Lift a snapshot's normalised points into mesh-local absolute space.
   *
   * The frame comes from the LIVE guide and the points from the SNAPSHOT,
   * which is correct because a cut never touches root, normal or tangent —
   * see #6d's corollary, the cut determines length, not shape. Constructed
   * identically to CombTool._frame and GuideStore.pointWorldLocal, because
   * three readings of one stored polyline would be three slightly different
   * haircuts.
   */
  _lift(g, snap) {
    const f = this._frm;
    const [nx, ny, nz] = g.normal;
    let [tx, ty, tz] = g.tangent;
    const dd = tx * nx + ty * ny + tz * nz;
    tx -= nx * dd; ty -= ny * dd; tz -= nz * dd;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    f.tx = tx; f.ty = ty; f.tz = tz;
    f.bx = bx; f.by = by; f.bz = bz;
    f.nx = nx; f.ny = ny; f.nz = nz;

    const p = snap.points, L = snap.length, loc = this._local;
    const r0 = g.root[0], r1 = g.root[1], r2 = g.root[2];
    for (let k = 0; k < SHAPE_POINTS; k++) {
      const i = k * 3;
      const lx = p[i], ly = p[i + 1], lz = p[i + 2];
      loc[i]     = r0 + (tx * lx + bx * ly + nx * lz) * L;
      loc[i + 1] = r1 + (ty * lx + by * ly + ny * lz) * L;
      loc[i + 2] = r2 + (tz * lx + bz * ly + nz * lz) * L;
    }
    return loc;
  }

  /**
   * What the blade would do at this pose, WITHOUT doing it.
   *
   * A blade that correctly cuts nothing (masked out, parked above the hair,
   * beyond the tips) looks identical from the viewport to a blade that is
   * broken. A destructive tool has to be able to answer "what would this do"
   * before you press it.
   */
  preview(cap, filter = null) {
    const out = { meets: 0, wouldClamp: 0, lengthRemoved: 0, shortestResult: Infinity };
    for (const g of this.guides.guides.values()) {
      if (filter && !filter(g)) continue;
      this._lift(g, { points: g.points, length: g.length });
      const frac = entryFraction(this._local, cap);
      if (frac < 0) continue;
      out.meets++;
      const want = frac * g.length;
      const keep = Math.max(want, this.minLength);
      if (keep > want) out.wouldClamp++;
      out.lengthRemoved += g.length - keep;
      if (keep < out.shortestResult) out.shortestResult = keep;
    }
    if (!out.meets) out.shortestResult = 0;
    return out;
  }
}
