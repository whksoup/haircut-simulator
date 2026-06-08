// src/facetWireframe.js
import * as THREE from 'three';

/**
 * buildFacetWireframe — draws quad-boundary edges and builds a FacetCatalogue.
 *
 * Returns { wireframe: LineSegments, catalogue: FacetCatalogue } or null if
 * the geometry has no _facet attribute.
 *
 * FacetCatalogue is the data bridge to the raycaster: given a triangle index
 * from a raycast hit, look up the parent quad facet and all its metadata.
 *
 *   const { wireframe, catalogue } = buildFacetWireframe(mesh.geometry);
 *
 *   // In the raycaster (Phase 1):
 *   const facetId = catalogue.facetIdByTri(hit.faceIndex);
 *   const info    = catalogue.getFacet(facetId);
 *   // info → { id, triIndices, centroid, normal, area }
 */

// ── FacetCatalogue ─────────────────────────────────────────────────────────────

export class FacetCatalogue {
  /**
   * @param {Map<number, FacetEntry>} facetMap  — facetId → FacetEntry
   * @param {Int32Array}              triToFacet — triIndex → facetId
   */
  constructor(facetMap, triToFacet) {
    this._map = facetMap;
    this._triToFacet = triToFacet;
    /** Total number of distinct quad facets catalogued. */
    this.facetCount = facetMap.size;
  }

  /**
   * Triangle index (raycaster `faceIndex`) → facet id.
   * Returns -1 if out of range.
   */
  facetIdByTri(triIndex) {
    if (triIndex < 0 || triIndex >= this._triToFacet.length) return -1;
    return this._triToFacet[triIndex];
  }

  /**
   * Full entry for a facet id.
   * @returns {FacetEntry|undefined}
   */
  getFacet(facetId) {
    return this._map.get(facetId);
  }

  /** Iterate all facet entries. */
  entries() {
    return this._map.values();
  }
}

/**
 * @typedef {Object} FacetEntry
 * @property {number}          id         — Blender polygon / facet index
 * @property {number[]}        triIndices — triangle indices that belong to this facet
 * @property {THREE.Vector3}   centroid   — area-weighted centroid (mesh local space)
 * @property {THREE.Vector3}   normal     — area-weighted average normal
 * @property {number}          area       — summed triangle area
 */

// ── buildFacetWireframe ────────────────────────────────────────────────────────

export function buildFacetWireframe(geometry) {
  const pos   = geometry.attributes.position;
  const facet = geometry.attributes._facet;

  if (!facet) {
    console.warn('[facetWireframe] no _facet attribute — check Blender export settings');
    return null;
  }

  const triCount = Math.floor(pos.count / 3);
  const eps = 1e4;

  // ── 1. Weld vertices by position ──────────────────────────────────────────
  // Non-indexed geometry has duplicated verts at every triangle corner.
  // Welding by rounded position lets us find shared edges across triangles.
  const weldId  = new Int32Array(pos.count);
  const posKeys = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * eps)},${Math.round(pos.getY(i) * eps)},${Math.round(pos.getZ(i) * eps)}`;
    let id = posKeys.get(k);
    if (id === undefined) { id = posKeys.size; posKeys.set(k, id); }
    weldId[i] = id;
  }

  // ── 2. Map each edge (sorted weld-id pair) → which triangles touch it ─────
  const edgeToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = weldId[t * 3 + e];
      const b = weldId[t * 3 + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const entry = edgeToTris.get(key);
      if (!entry) edgeToTris.set(key, { tris: [t], localEdge: [e] });
      else { entry.tris.push(t); entry.localEdge.push(e); }
    }
  }

  // ── 3. Collect boundary / facet-crossing edges for the wireframe ──────────
  const lineVerts = [];
  for (const { tris, localEdge } of edgeToTris.values()) {
    const t0 = tris[0];
    const e0 = localEdge[0];

    let keep = false;
    if (tris.length === 1) {
      keep = true; // mesh boundary
    } else {
      const f0 = facet.getX(t0 * 3);
      const f1 = facet.getX(tris[1] * 3);
      keep = f0 !== f1; // Blender face boundary, not just the quad diagonal
    }

    if (keep) {
      const vA = t0 * 3 + e0;
      const vB = t0 * 3 + ((e0 + 1) % 3);
      lineVerts.push(
        pos.getX(vA), pos.getY(vA), pos.getZ(vA),
        pos.getX(vB), pos.getY(vB), pos.getZ(vB),
      );
    }
  }

  // ── 4. Build the FacetCatalogue ───────────────────────────────────────────
  // Group triangles by their _facet id; accumulate centroid + normal with
  // area weighting so n-gon facets aren't biased by triangle count.

  const triToFacet = new Int32Array(triCount).fill(-1);

  /** @type {Map<number, FacetEntry>} */
  const facetMap = new Map();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    // All 3 verts of a non-indexed triangle share the same _facet id.
    const fid = facet.getX(t * 3);
    triToFacet[t] = fid;

    vA.fromBufferAttribute(pos, t * 3 + 0);
    vB.fromBufferAttribute(pos, t * 3 + 1);
    vC.fromBufferAttribute(pos, t * 3 + 2);

    cross.crossVectors(
      new THREE.Vector3().subVectors(vB, vA),
      new THREE.Vector3().subVectors(vC, vA),
    );
    // cross.length() = 2 × triangle area
    const triArea = cross.length() * 0.5;
    const triNorm = cross.clone().normalize();
    const centX   = (vA.x + vB.x + vC.x) / 3;
    const centY   = (vA.y + vB.y + vC.y) / 3;
    const centZ   = (vA.z + vB.z + vC.z) / 3;

    let entry = facetMap.get(fid);
    if (!entry) {
      entry = {
        id:         fid,
        triIndices: [],
        centroid:   new THREE.Vector3(),
        normal:     new THREE.Vector3(),
        area:       0,
      };
      facetMap.set(fid, entry);
    }

    entry.triIndices.push(t);
    // Area-weighted accumulation; divide by total area after the loop.
    entry.centroid.x += centX * triArea;
    entry.centroid.y += centY * triArea;
    entry.centroid.z += centZ * triArea;
    entry.normal.addScaledVector(triNorm, triArea);
    entry.area += triArea;
  }

  // Normalise accumulated sums → area-weighted averages.
  for (const entry of facetMap.values()) {
    if (entry.area > 0) {
      entry.centroid.divideScalar(entry.area);
      entry.normal.normalize();
    }
  }

  const catalogue = new FacetCatalogue(facetMap, triToFacet);

  // Friendly console summary — useful for verifying the Blender export.
  const ids = [...facetMap.keys()].sort((a, b) => a - b);
  console.info(
    `[facetWireframe] catalogued ${catalogue.facetCount} quad facets ` +
    `from ${triCount} triangles. ` +
    `ID range: ${ids[0]} – ${ids[ids.length - 1]}.`
  );

  // ── 5. Assemble the LineSegments wireframe ────────────────────────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));

  const wireframe = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 }),
  );

  return { wireframe, catalogue };
}