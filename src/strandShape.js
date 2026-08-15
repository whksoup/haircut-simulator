/**
 * strandShape.js — the shared shape representation for the R2 hair model.
 *
 * R2 = "shared per-facet polyline". Each hair-bearing facet stores ONE strand
 * shape: a polyline of SHAPE_POINTS control points expressed in the facet's
 * LOCAL frame (x along tangent T, y along bitangent B, z along the growth
 * normal N) and NORMALISED so a straight strand spans local z in [0,1]. The
 * shader scales that by the facet's `length` and the global `uGrowth`, and
 * instances it at every sampled root using that strand's own (N,T) frame — so
 * one authored curl multiplies across the whole facet and still fans with the
 * surface. This is the generalisation of rev3's single `comb` bend vector:
 * a vec3 bend becomes an M-point polyline, which is what lets hair curl.
 *
 * Because the shape is normalised, the `length` slider just rescales it — curl
 * survives a length change. Segment rest length in this normalised space is
 * constant = SHAPE_REST = 1/(SHAPE_POINTS-1); the length solver keeps it fixed,
 * which is the guarantee behind "pushing control points never stretches the
 * strand" (plan point 4).
 *
 * Wire layout: a shape is a flat number[] / Float32Array of SHAPE_POINTS*3
 * floats, [x0,y0,z0, x1,y1,z1, ...]; point 0 = root, always the origin.
 */

import { solveLengths } from './strandConstraints.js';

export const SHAPE_POINTS   = 9;                  // control points per strand shape
export const SHAPE_SEGMENTS = SHAPE_POINTS - 1;   // = TEMPLATE_SEGMENTS in gpuHair.js
export const SHAPE_REST     = 1 / SHAPE_SEGMENTS; // normalised rest length per segment

/** A straight strand: points marching up local +N (z), unit total length. */
export function straightShape() {
  const out = new Array(SHAPE_POINTS * 3).fill(0);
  for (let i = 0; i < SHAPE_POINTS; i++) out[i * 3 + 2] = i * SHAPE_REST; // z = i/(M-1)
  return out;
}

/** Defensive copy for the model (falls back to straight on missing input). */
export function cloneShape(shape) {
  return shape ? Array.from(shape) : straightShape();
}

/**
 * Orthonormal local basis {T,B,N} from a (mesh-space) growth normal.
 * The tangent rule MATCHES strandSampler's per-strand tangent, so a shape
 * authored in this canonical facet frame lines up with how each strand's own
 * frame re-expresses it in the shader (normals are near-constant across a
 * facet, so the small per-strand difference just yields the desirable fan).
 */
export function shapeBasis(nx, ny, nz) {
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;

  let tx, ty, tz;
  if (Math.abs(nx) < 0.9) { tx = 0;   ty = -nz; tz = ny; }
  else                    { tx = -nz; ty = 0;   tz = nx; }
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;

  // B = N x T
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;

  return { tx, ty, tz, bx, by, bz, nx, ny, nz };
}

/**
 * Adapter for rev3's mesh-space comb vector → a normalised shape.
 *
 * Used by the existing "Comb (GPU)" sliders until the drag-comb tool lands.
 * Projects the mesh-space bend into the facet's tangential plane, scales by the
 * facet length (so the bend reads the same regardless of strand length), eases
 * it in from the root, then runs the length solver so every segment keeps its
 * rest length — i.e. the comb bends but never distends the strand.
 *
 * @param {[number,number,number]} meshComb  bend vector in mesh space
 * @param {number} nx @param {number} ny @param {number} nz  facet growth normal
 * @param {number} length  facet strand length (mesh units)
 * @returns {number[]} flat SHAPE_POINTS*3 shape
 */
export function combVectorToShape([cx, cy, cz], nx, ny, nz, length) {
  const { tx, ty, tz, bx, by, bz } = shapeBasis(nx, ny, nz);
  const inv   = 1 / (length || 1);
  const leanT = (cx * tx + cy * ty + cz * tz) * inv; // tangential lean, normalised
  const leanB = (cx * bx + cy * by + cz * bz) * inv;

  const out = new Array(SHAPE_POINTS * 3);
  for (let i = 0; i < SHAPE_POINTS; i++) {
    const t = i * SHAPE_REST; // 0..1 along the strand
    const w = t * t;          // quadratic ease: root stays vertical, tip leans most
    out[i * 3]     = leanT * w;
    out[i * 3 + 1] = leanB * w;
    out[i * 3 + 2] = t;
  }
  solveLengths(out, SHAPE_REST); // fixed segment lengths (plan point 4)
  return out;
}