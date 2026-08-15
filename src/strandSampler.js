/**
 * strandSampler.js — the single source of truth for strand root sampling.
 *
 * Extracted from the (previously duplicated, line-for-line identical) samplers
 * in strands.js and gpuHair.js so the CPU and GPU paths can never drift — the
 * same "one source of truth" rule the FacetCatalogue already follows, now
 * applied to sampling and determinism.
 *
 * sampleFacetRoots writes interleaved [x,y,z] roots / smooth growth normals /
 * frame tangents into caller-provided Float32Array views, starting at strand
 * index `offset`, and returns the number of strands written. Each renderer
 * keeps its own per-facet {offset,count} bookkeeping around the call.
 *
 *   const n = sampleFacetRoots({
 *     geometry, entry, params, masterSeed,
 *     positions, normals, tangents,   // Float32Array views, 3 floats / strand
 *     seeds,                           // OPTIONAL, 1 float / strand (R3)
 *     offset,                          // first strand index to write
 *     maxStrands,                      // hard cap (clips mid-facet)
 *   });
 *
 * Determinism: per-strand seed = hash2f((masterSeed ^ facetId) + strandIdx, k).
 * Changing masterSeed reshuffles every strand; changing a slider reshuffles
 * nothing — the sample sequence is a pure function of seed + strand index.
 *
 * R3 addition: `seeds` is an optional output view carrying one deterministic
 * random per strand, drawn from the same hash sequence. The guide-blend shader
 * uses it for per-strand length variation and tip jitter. It's optional so the
 * CPU path (strands.js) calls this unchanged; determinism is unaffected either
 * way because the value is derived from the existing seed/index pair rather
 * than advancing the sequence.
 */

/** Base strand density: strands per unit² at density = 1. Tune to taste. */
export const STRANDS_PER_UNIT = 5000;

/** Maximum strands we'll ever allocate (guards typed-array size). */
export const MAX_STRANDS = 200_000;

/** MurmurHash3 finalizer mix — shared so both render paths agree bit-for-bit. */
export function hash2f(a, b) {
  let h = ((a >>> 0) ^ (b >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

/**
 * Sample strand roots across one facet's triangles into the provided SoA views.
 *
 * @param {object}             o
 * @param {THREE.BufferGeometry} o.geometry   mesh geometry (non-indexed)
 * @param {import('./facetWireframe.js').FacetEntry} o.entry  facet catalogue entry
 * @param {{density:number}}   o.params       per-facet params (only density used here)
 * @param {number}             o.masterSeed
 * @param {Float32Array}       o.positions    out: [x,y,z] per strand (mesh-local)
 * @param {Float32Array}       o.normals      out: smooth interpolated vertex normal
 * @param {Float32Array}       o.tangents     out: arbitrary tangent in the normal plane
 * @param {Float32Array}       [o.seeds]      out: 1 deterministic random per strand
 * @param {number}             o.offset       first strand index to write at
 * @param {number}             [o.maxStrands] hard cap; clips mid-facet when hit
 * @returns {number} strands written (0..)
 */
export function sampleFacetRoots({
  geometry,
  entry,
  params,
  masterSeed,
  positions,
  normals,
  tangents,
  seeds = null,
  offset,
  maxStrands = MAX_STRANDS,
}) {
  const { density } = params;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const seed0 = (masterSeed ^ entry.id) >>> 0;

  let n = 0;
  let strandIdx = 0;

  for (const tri of entry.triIndices) {
    const i0 = tri * 3, i1 = i0 + 1, i2 = i0 + 2;

    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);

    const nax = nrm.getX(i0), nay = nrm.getY(i0), naz = nrm.getZ(i0);
    const nbx = nrm.getX(i1), nby = nrm.getY(i1), nbz = nrm.getZ(i1);
    const ncx = nrm.getX(i2), ncy = nrm.getY(i2), ncz = nrm.getZ(i2);

    // Triangle area = ½‖AB × AC‖.
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const crsX = aby * acz - abz * acy;
    const crsY = abz * acx - abx * acz;
    const crsZ = abx * acy - aby * acx;
    const triArea = Math.sqrt(crsX * crsX + crsY * crsY + crsZ * crsZ) * 0.5;

    const count = Math.max(1, Math.ceil(density * triArea * STRANDS_PER_UNIT));

    for (let s = 0; s < count; s++) {
      if (offset + n >= maxStrands) return n; // clip mid-facet at the cap

      const r1 = hash2f(seed0 + strandIdx, 0x9e3779b9);
      const r2 = hash2f(seed0 + strandIdx, 0x6c62272e);
      // Third draw from the same (seed, index) pair — a separate mix constant,
      // so it does NOT advance strandIdx and the r1/r2 sequence is untouched.
      if (seeds) seeds[offset + n] = hash2f(seed0 + strandIdx, 0x27d4eb2f);
      strandIdx++;

      // Uniform barycentric sampling via square-root mapping.
      const sqr1 = Math.sqrt(r1);
      const u = 1 - sqr1;
      const v = sqr1 * (1 - r2);
      const w = sqr1 * r2;

      const px = u * ax + v * bx + w * cx;
      const py = u * ay + v * by + w * cy;
      const pz = u * az + v * bz + w * cz;

      // Smooth growth normal: barycentric interpolation of the vertex normals.
      let nx = u * nax + v * nbx + w * ncx;
      let ny = u * nay + v * nby + w * ncy;
      let nz = u * naz + v * nbz + w * ncz;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nlen; ny /= nlen; nz /= nlen;

      // Arbitrary tangent in the normal plane — fixes a per-strand frame.
      // In the R3 path guideBinding overwrites this with the blended guide
      // flow tangent; it survives only where no guide binds.
      let tx, ty, tz;
      if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; }
      else { tx = -nz; ty = 0; tz = nx; }
      const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tlen; ty /= tlen; tz /= tlen;

      const b3 = (offset + n) * 3;
      positions[b3] = px; positions[b3 + 1] = py; positions[b3 + 2] = pz;
      normals[b3] = nx;   normals[b3 + 1] = ny;   normals[b3 + 2] = nz;
      tangents[b3] = tx;  tangents[b3 + 1] = ty;  tangents[b3 + 2] = tz;
      n++;
    }
  }

  return n;
}
