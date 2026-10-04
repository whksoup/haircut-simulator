import { SHAPE_POINTS } from './strandShape.js';

/** Shared normalized guide frame; used by tools and GPU texture-row upload. */
export function guideFrame(g, f = {}) {
  const [nx, ny, nz] = g.normal;
  let [tx, ty, tz] = g.tangent;
  const dd = tx * nx + ty * ny + tz * nz;
  tx -= nx * dd; ty -= ny * dd; tz -= nz * dd;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  Object.assign(f, {tx, ty, tz, nx, ny, nz,
    bx: ny * tz - nz * ty, by: nz * tx - nx * tz, bz: nx * ty - ny * tx,
    rx: g.root[0], ry: g.root[1], rz: g.root[2], L: g.length || 1});
  return f;
}

export function liftGuide(g, f, out = new Float64Array(SHAPE_POINTS * 3)) {
  for (let k = 0; k < SHAPE_POINTS; k++) {
    const i = k * 3, x = g.points[i], y = g.points[i + 1], z = g.points[i + 2];
    out[i] = f.rx + (f.tx * x + f.bx * y + f.nx * z) * f.L;
    out[i + 1] = f.ry + (f.ty * x + f.by * y + f.ny * z) * f.L;
    out[i + 2] = f.rz + (f.tz * x + f.bz * y + f.nz * z) * f.L;
  }
  return out;
}

/** Root is never rewritten. Finite comb retains its historical scalp clamp. */
export function writeGuide(g, f, local, {clampScalp = true} = {}) {
  const inv = 1 / f.L;
  for (let k = 1; k < SHAPE_POINTS; k++) {
    const i = k * 3, x = local[i] - f.rx, y = local[i + 1] - f.ry, z = local[i + 2] - f.rz;
    g.points[i] = (x * f.tx + y * f.ty + z * f.tz) * inv;
    g.points[i + 1] = (x * f.bx + y * f.by + z * f.bz) * inv;
    const zn = (x * f.nx + y * f.ny + z * f.nz) * inv;
    g.points[i + 2] = clampScalp && zn < 0 ? 0 : zn;
  }
}
