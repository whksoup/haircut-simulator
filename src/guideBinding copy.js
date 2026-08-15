/**
 * guideBinding.js — bind each render strand to its k nearest guides. SKETCH.
 *
 * Runs after root sampling (CPU side, at build/rebuild time) and produces two
 * instanced attributes for the shader:
 *
 *   iGuideRow  vec3   texture rows of the 3 bound guides (as floats)
 *   iGuideW    vec3   normalised blend weights (sum = 1)
 *
 * Weighting = inverse-square distance, with two corrections that matter more
 * than they look:
 *
 *  NORMAL PENALTY — Euclidean kNN happily binds a strand behind the ear to a
 *  guide on the cheek. Scaling effective distance by (1 + λ(1 - n·n_g)) is a
 *  cheap geodesic-ish proxy: guides facing away are pushed far away. Proper
 *  fix later is geodesic distance over the facet graph; this gets 95% there.
 *
 *  FLOW GATE (part support) — a part is a flow discontinuity. If a candidate
 *  guide's initial direction disagrees strongly with the strand's dominant
 *  (nearest) guide, its weight is zeroed instead of blended, so strands on one
 *  side of a part never average with the other side (which would comb them
 *  flat into the parting line).
 *
 * Rebinding only happens when guides are ADDED or REMOVED — combing edits
 * guide points, which the binding doesn't depend on (it reads roots/normals/
 * first-segment flow). For pure combing, nothing here runs.
 *
 * Perf: uniform grid hash over guide roots → candidate set is O(1) per strand;
 * 200k strands bind in a few ms against a few hundred guides. If binding ever
 * shows up in a profile, it's embarrassingly parallel — move it to a worker.
 */

export const GUIDES_PER_STRAND = 3;

/**
 * @param {object} o
 * @param {Float32Array} o.rootPositions  strand roots, mesh-local, 3/strand
 * @param {Float32Array} o.rootNormals    strand growth normals, 3/strand
 * @param {number}       o.total          strand count
 * @param {Array}        o.guideList      guides in TEXTURE ROW ORDER (index = row)
 * @param {number}       [o.normalPenalty=2.0]  λ above
 * @param {number}       [o.flowGate=-0.2]      min dot(dir, dominantDir); below → w=0
 * @param {Float32Array} o.outRows        out: total*3
 * @param {Float32Array} o.outWeights     out: total*3
 * @param {Float32Array} [o.outTangents]  in/out: total*3. Overwritten with the
 *        weight-blended guide flow tangent, orthogonalised against the strand's
 *        own normal. The incoming value (the sampler's arbitrary in-plane
 *        tangent) is the FALLBACK, used only where the blend degenerates or no
 *        guide binds. This is the step that makes the frame field coherent: the
 *        sampler's tangent rule has a hard branch at |nx| = 0.9 that snaps the
 *        frame 90° mid-scalp, which would otherwise survive into the shader and
 *        tear every authored style along that seam.
 */
export function bindStrandsToGuides({
  rootPositions, rootNormals, total, guideList,
  normalPenalty = 2.0, flowGate = -0.2,
  outRows, outWeights, outTangents = null,
}) {
  const nGuides = guideList.length;
  if (nGuides === 0) return;

  // --- uniform grid hash over guide roots ---------------------------------
  // Cell size ≈ 2× mean nearest-guide spacing; crude heuristic: bbox diag / cbrt(n).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const g of guideList) {
    minX = Math.min(minX, g.root[0]); maxX = Math.max(maxX, g.root[0]);
    minY = Math.min(minY, g.root[1]); maxY = Math.max(maxY, g.root[1]);
    minZ = Math.min(minZ, g.root[2]); maxZ = Math.max(maxZ, g.root[2]);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cell = Math.max(diag / Math.cbrt(nGuides), 1e-4);
  const key = (x, y, z) =>
    `${Math.floor((x - minX) / cell)},${Math.floor((y - minY) / cell)},${Math.floor((z - minZ) / cell)}`;

  /** @type {Map<string, number[]>} cell → guide rows */
  const grid = new Map();
  for (let r = 0; r < nGuides; r++) {
    const g = guideList[r];
    const k = key(g.root[0], g.root[1], g.root[2]);
    (grid.get(k) ?? grid.set(k, []).get(k)).push(r);
  }

  // Precompute each guide's initial flow direction (first shape segment,
  // expressed in mesh space via pointWorldLocal would be exact; the local
  // z-dominant approximation below is fine for gating purposes at sketch level:
  // flow ≈ tangent*p1.x + bitangent*p1.y + normal*p1.z. We reuse guide.tangent
  // and guide.normal directly since the shape's first segment is what encodes
  // the comb direction.)
  const flow = new Float32Array(nGuides * 3);
  for (let r = 0; r < nGuides; r++) {
    const g = guideList[r];
    const p = g.points;
    // local first-segment direction (from root at origin to point 1)
    const lx = p[3], ly = p[4], lz = p[5];
    const [nx, ny, nz] = g.normal;
    const [tx, ty, tz] = g.tangent;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    let fx = tx * lx + bx * ly + nx * lz;
    let fy = ty * lx + by * ly + ny * lz;
    let fz = tz * lx + bz * ly + nz * lz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    flow[r * 3] = fx / fl; flow[r * 3 + 1] = fy / fl; flow[r * 3 + 2] = fz / fl;
  }

  // --- per-strand kNN -------------------------------------------------------
  const candRows = [];   // reused scratch
  const candD2 = [];

  for (let i = 0; i < total; i++) {
    const b3 = i * 3;
    const px = rootPositions[b3], py = rootPositions[b3 + 1], pz = rootPositions[b3 + 2];
    const nx = rootNormals[b3],  ny = rootNormals[b3 + 1],  nz = rootNormals[b3 + 2];

    candRows.length = 0; candD2.length = 0;

    // Expand ring search until we have ≥ k candidates (or exhaust the grid).
    const cx = Math.floor((px - minX) / cell);
    const cy = Math.floor((py - minY) / cell);
    const cz = Math.floor((pz - minZ) / cell);
    for (let ring = 0; ring < 8 && candRows.length < GUIDES_PER_STRAND; ring++) {
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!bucket) continue;
            for (const r of bucket) {
              const g = guideList[r];
              const ddx = g.root[0] - px, ddy = g.root[1] - py, ddz = g.root[2] - pz;
              const align = nx * g.normal[0] + ny * g.normal[1] + nz * g.normal[2];
              const pen = 1 + normalPenalty * (1 - Math.max(align, -1));
              candRows.push(r);
              candD2.push((ddx * ddx + ddy * ddy + ddz * ddz) * pen * pen);
            }
          }
    }
    // Fallback: brute force if the grid walk found nothing (shouldn't happen).
    if (candRows.length === 0) {
      for (let r = 0; r < nGuides; r++) { candRows.push(r); candD2.push(1); }
    }

    // Partial selection of the k smallest (k=3: three linear passes is fine).
    const rows = [-1, -1, -1];
    const d2s  = [Infinity, Infinity, Infinity];
    for (let c = 0; c < candRows.length; c++) {
      const d2 = candD2[c];
      if (d2 < d2s[2]) {
        if (d2 < d2s[0])      { d2s[2]=d2s[1]; rows[2]=rows[1]; d2s[1]=d2s[0]; rows[1]=rows[0]; d2s[0]=d2; rows[0]=candRows[c]; }
        else if (d2 < d2s[1]) { d2s[2]=d2s[1]; rows[2]=rows[1]; d2s[1]=d2; rows[1]=candRows[c]; }
        else                  { d2s[2]=d2; rows[2]=candRows[c]; }
      }
    }

    // Inverse-square weights + flow gate against the dominant guide.
    const dom = rows[0] * 3;
    let w0 = 0, w1 = 0, w2 = 0;
    const ws = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const r = rows[j];
      if (r < 0) continue;
      let w = 1 / (d2s[j] + 1e-10);
      if (j > 0) {
        const f = r * 3;
        const dot = flow[f]*flow[dom] + flow[f+1]*flow[dom+1] + flow[f+2]*flow[dom+2];
        if (dot < flowGate) w = 0; // other side of a part — don't blend across
      }
      ws[j] = w;
    }
    const sum = (ws[0] + ws[1] + ws[2]) || 1;
    w0 = ws[0] / sum; w1 = ws[1] / sum; w2 = ws[2] / sum;

    outRows[b3]     = Math.max(rows[0], 0);
    outRows[b3 + 1] = Math.max(rows[1], 0);
    outRows[b3 + 2] = Math.max(rows[2], 0);
    outWeights[b3]     = w0;
    outWeights[b3 + 1] = w1;
    outWeights[b3 + 2] = w2;

    // --- blended flow tangent ----------------------------------------------
    // Weighted sum of the bound guides' AUTHORED tangents, then Gram-Schmidt
    // against this strand's own normal so the shader's (T,B,N) basis stays
    // orthonormal and the strand still fans with the surface.
    if (outTangents) {
      const ws3 = [w0, w1, w2];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < 3; j++) {
        const r = rows[j];
        if (r < 0 || ws3[j] <= 0) continue;
        const gt = guideList[r].tangent;
        // Guard against antipodal cancellation: guides that disagree by more
        // than 90° with the dominant one get flipped before summing, so a
        // sensible axis survives instead of two tangents annihilating.
        const dom = guideList[Math.max(rows[0], 0)].tangent;
        const s = (gt[0]*dom[0] + gt[1]*dom[1] + gt[2]*dom[2]) < 0 ? -1 : 1;
        ax += gt[0] * ws3[j] * s;
        ay += gt[1] * ws3[j] * s;
        az += gt[2] * ws3[j] * s;
      }
      const d = ax * nx + ay * ny + az * nz;
      let ox = ax - nx * d, oy = ay - ny * d, oz = az - nz * d;
      const ol = Math.hypot(ox, oy, oz);
      if (ol > 1e-6) {
        outTangents[b3]     = ox / ol;
        outTangents[b3 + 1] = oy / ol;
        outTangents[b3 + 2] = oz / ol;
      }
      // else: leave the sampler's tangent in place (degenerate blend).
    }
  }
}
