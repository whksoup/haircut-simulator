import { SHAPE_POINTS, SHAPE_REST } from './strandShape.js';
import { guideFrame, liftGuide, writeGuide } from './guideFrame.js';
import { buildInvMass, solveStrand, relaxStrand, segmentResidual } from './strandConstraints.js';
import { LENGTH_TOL } from './guideLengthAudit.js';

/** Fixed arc-distance sampler with carried remainder; no per-event step cap.
 * emit receives interpolated arrays. finish emits the final endpoint once. */
export class StrokeSampler {
  constructor(start, spacing, emit) {
    this.previous = [...start]; this.last = [...start];
    this.spacing = spacing; this.remaining = spacing; this.emit = emit;
    this.moved = false;
  }
  move(next) {
    const from = this.previous;
    const distance = Math.hypot(...next.map((v, i) => v - from[i]));
    if (distance <= 1e-12) return;
    this.moved = true;
    let at = this.remaining;
    while (at <= distance + 1e-10 * this.spacing) {
      const t = Math.min(1, at / distance);
      this.last = next.map((v, i) => from[i] + (v - from[i]) * t);
      this.emit(this.last);
      at += this.spacing;
    }
    this.remaining = at - distance;
    this.previous = [...next];
  }
  finish() {
    if (this.moved && Math.hypot(...this.previous.map((v, i) => v - this.last[i])) > 1e-10) {
      this.last = [...this.previous]; this.emit(this.last);
    }
    this.moved = false;
  }
}

/** Trial edit. Rejected contacts never write authored arrays. */
export function brushGuide(guide, capsule, tie, visible = () => true, protect = null) {
  const frame = guideFrame(guide);
  const local = liftGuide(guide, frame);
  const pinned = protect?.(local) ?? null;
  if (pinned?.every(Boolean) || !visible(local, pinned)) return false;
  const masses = buildInvMass(SHAPE_POINTS, 1);
  if (pinned) pinned.forEach((fixed, k) => { if (fixed) masses[k] = 0; });
  const restLen = SHAPE_REST * frame.L;
  if (!solveStrand(local, {restLen, invMass: masses, capsule, tie, iterations: 4})) return false;
  // The brush is a swept authoring tool; it has no persistent solid bar after
  // a sample. Settle freely and reject invalid/hidden trials before publishing.
  relaxStrand(local, {restLen, invMass: masses, iterations: 128});
  if (segmentResidual(local, restLen).maxRel > LENGTH_TOL || !visible(local, pinned)) return false;
  const trial = {...guide, points: [...guide.points]};
  writeGuide(trial, frame, local, {clampScalp: false});
  if (pinned) pinned.forEach((fixed, k) => {
    if (fixed) for (let axis = 0; axis < 3; axis++) trial.points[k * 3 + axis] = guide.points[k * 3 + axis];
  });
  if (segmentResidual(trial.points, SHAPE_REST).maxRel > LENGTH_TOL) return false;
  if (!trial.points.some((v, i) => Math.abs(v - guide.points[i]) > 1e-12)) return false;
  for (let i = 3; i < guide.points.length; i++) guide.points[i] = trial.points[i];
  return true;
}
