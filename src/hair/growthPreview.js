/** Fraction preview helpers. Authored guides never enter this module. */
export function growthFraction(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : null;
}

/** Keep original polyline corners and collapse the tip-side remainder to the cut. */
export function clipGrowthPrefix(points, fraction) {
  const p = growthFraction(fraction);
  if (p === null) throw new TypeError('Growth fraction must be finite');
  if (!points.length) return [];
  const lengths = points.map((point, i) => i ? Math.hypot(...point.map((v, k) => v - points[i - 1][k])) : 0);
  const target = lengths.reduce((a, b) => a + b, 0) * p;
  let arc = 0;
  let cut = [...points[0]];
  return points.map((point, i) => {
    if (!i) return [...point];
    const previous = arc;
    arc += lengths[i];
    if (arc <= target) return [...point];
    const t = lengths[i] ? Math.max(0, Math.min(1, (target - previous) / lengths[i])) : 0;
    // Locate the terminal point once; later vertices share that exact position.
    if (previous <= target) cut = point.map((v, k) => points[i - 1][k] + t * (v - points[i - 1][k]));
    return [...cut];
  });
}
