// src/facetWireframe.js
import * as THREE from 'three';

/**
 * buildFacetCatalogue — builds a FacetCatalogue from a geometry's _facet
 * attribute. Call once at load time and store on mesh.userData.catalogue.
 * Everything that needs per-facet data reads from there.
 *
 *   mesh.userData.catalogue = buildFacetCatalogue(mesh.geometry);
 *   const facetId = cat.facetIdByTri(hit.faceIndex);
 *   const info    = cat.getFacet(facetId);
 *
 * WHAT CHANGED: THE CATALOGUE NOW CARRIES AN ADJACENCY GRAPH
 *
 * The weld pass and the edge→triangle map used to live inside
 * buildFacetWireframe, which computed the entire facet-boundary graph, used it
 * to answer one boolean per edge ("draw this line?"), and threw it away. That
 * graph is the thing seams, geodesic guide binding and selection growth all
 * need, so it moves up here and is built once at load. buildFacetWireframe is
 * now a CONSUMER: it iterates catalogue.edges() and draws them. Two benefits
 * beyond not doing the work twice — the expensive pass (welding, one string
 * key per vertex) leaves the debug-only path, and the wireframe can no longer
 * disagree with the adjacency about what an edge is.
 *
 * THE EDGE IS A RECORD, NOT A NEIGHBOUR LIST. `Map<facetId, facetId[]>` is the
 * obvious shape and it is the wrong one: a seam is a property of the BOUNDARY
 * BETWEEN two facets, and a neighbour list gives it nowhere to live. Keying by
 * edge rather than by facet pair also survives the degenerate case where two
 * facets share more than one edge, which a pair-keyed map silently collapses.
 *
 * NO AUTHORED DATA LIVES HERE. Seam permeability is authored and belongs in
 * the Groom (see seams.js), keyed by FACET PAIR, not by edge id. The catalogue
 * is derived purely from the mesh and must be rebuildable at any moment; edge
 * ids are a runtime index and would shift silently on a Blender re-export,
 * whereas facet ids are already the thing groom.faces bets on.
 *
 * buildFacetWireframe — quad-boundary LineSegments for debug display.
 * Returns { wireframe: LineSegments, catalogue } or null.
 */

/** Weld quantisation: positions are rounded to 1/WELD_EPS units. */
const WELD_EPS = 1e4;

// ── FacetCatalogue ─────────────────────────────────────────────────────────────

export class FacetCatalogue {
  /**
   * @param {Map<number, FacetEntry>} facetMap   — facetId → FacetEntry
   * @param {Int32Array}              triToFacet — triIndex → facetId
   * @param {FacetEdge[]}             edges      — facet-boundary edges
   * @param {Map<number, number[]>}   facetEdges — facetId → edge ids
   * @param {Map<string, number>}     pairToEdge — "a_b" → edge id
   * @param {object}                  topology   — validation summary
   */
  constructor(facetMap, triToFacet, edges, facetEdges, pairToEdge, topology) {
    this._map        = facetMap;
    this._triToFacet = triToFacet;
    this._edges      = edges;
    this._facetEdges = facetEdges;
    this._pairToEdge = pairToEdge;

    /** Total number of distinct quad facets catalogued. */
    this.facetCount = facetMap.size;
    /** Total number of facet-boundary edges (quad diagonals excluded). */
    this.edgeCount  = edges.length;
    /**
     * { vertices, edges, facets, euler, boundaryEdges, nonManifoldEdges, closed }
     * See validateTopology — a closed genus-0 head reads euler 2, boundary 0.
     */
    this.topology = topology;
  }

  // --- facets ---------------------------------------------------------------

  /** Triangle index (raycaster `faceIndex`) → facet id. -1 if out of range. */
  facetIdByTri(triIndex) {
    if (triIndex < 0 || triIndex >= this._triToFacet.length) return -1;
    return this._triToFacet[triIndex];
  }

  /** @returns {FacetEntry|undefined} */
  getFacet(facetId) { return this._map.get(facetId); }

  /** Iterate all facet entries. */
  entries() { return this._map.values(); }

  /** All facet ids, ascending. Stable across runs. */
  facetIds() { return [...this._map.keys()].sort((a, b) => a - b); }

  // --- adjacency ------------------------------------------------------------

  /** Iterate every facet-boundary edge. */
  edges() { return this._edges[Symbol.iterator](); }

  /** @returns {FacetEdge|undefined} */
  getEdge(edgeId) { return this._edges[edgeId]; }

  /** Edge ids incident to a facet. Empty (shared, frozen) array if unknown. */
  edgesOfFacet(facetId) { return this._facetEdges.get(facetId) ?? EMPTY; }

  /** Facet ids sharing an edge with this one. Excludes mesh boundary (-1). */
  neighbours(facetId) {
    const out = [];
    for (const eid of this.edgesOfFacet(facetId)) {
      const e = this._edges[eid];
      const other = e.a === facetId ? e.b : e.a;
      if (other >= 0) out.push(other);
    }
    return out;
  }

  /**
   * The edge between two facets, or -1 if they do not touch. When two facets
   * share more than one edge this returns the first in catalogue sort order —
   * use edgesOfFacet and filter if you need all of them.
   */
  edgeBetween(a, b) {
    const id = this._pairToEdge.get(pairKey(a, b));
    return id === undefined ? -1 : id;
  }

  /** Canonical "a_b" key for a facet pair, a < b. Matches SeamStore's keys. */
  static pairKey(a, b) { return pairKey(a, b); }
}

const EMPTY = Object.freeze([]);

/** Unordered facet pair → stable string key. Mirrored in seams.js. */
function pairKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

/**
 * @typedef {Object} FacetEntry
 * @property {number}        id         — Blender polygon / facet index
 * @property {number[]}      triIndices — triangle indices belonging to this facet
 * @property {THREE.Vector3} centroid   — area-weighted centroid (mesh local)
 * @property {THREE.Vector3} normal     — area-weighted average normal
 * @property {number}        area       — summed triangle area
 */

/**
 * @typedef {Object} FacetEdge
 * @property {number}        id       — runtime index. NOT stable across a
 *                                      geometry re-export; never serialise it.
 * @property {number}        a        — lower facet id
 * @property {number}        b        — higher facet id, or -1 at a mesh boundary
 * @property {number}        v0,v1    — weld vertex ids
 * @property {THREE.Vector3} p0,p1    — endpoint positions, mesh-local
 * @property {THREE.Vector3} midpoint — mesh-local
 * @property {number}        length   — real edge length; the geodesic step cost
 * @property {number}        dihedral — unsigned angle between facet normals,
 *                                      radians. 0 on a flat surface. -1 at a
 *                                      mesh boundary, where it is undefined.
 * @property {boolean}       convex   — true if the surface bulges outward
 *                                      across this edge (a ridge), false if it
 *                                      folds inward (a valley). Meaningless
 *                                      when dihedral is ~0 or b is -1.
 */

// ── buildFacetCatalogue ────────────────────────────────────────────────────────

/**
 * @param {THREE.BufferGeometry} geometry
 * @returns {FacetCatalogue|null}
 */
export function buildFacetCatalogue(geometry) {
  const pos   = geometry.attributes.position;
  const facet = geometry.attributes._facet;

  if (!facet) {
    console.warn('[facetWireframe] no _facet attribute — check Blender export settings');
    return null;
  }

  const triCount = Math.floor(pos.count / 3);

  // ── 1. Group triangles by facet; accumulate centroid + normal ─────────────
  // Area-weighted so n-gon facets aren't biased by triangle count.

  const triToFacet = new Int32Array(triCount).fill(-1);
  /** @type {Map<number, FacetEntry>} */
  const facetMap = new Map();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    // All 3 verts of a non-indexed triangle share the same _facet id.
    const fid = facet.getX(t * 3);
    triToFacet[t] = fid;

    vA.fromBufferAttribute(pos, t * 3 + 0);
    vB.fromBufferAttribute(pos, t * 3 + 1);
    vC.fromBufferAttribute(pos, t * 3 + 2);

    cross.crossVectors(ab.subVectors(vB, vA), ac.subVectors(vC, vA));
    // cross.length() = 2 × triangle area
    const triArea = cross.length() * 0.5;
    const triNorm = cross.clone().normalize();

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
    entry.centroid.x += ((vA.x + vB.x + vC.x) / 3) * triArea;
    entry.centroid.y += ((vA.y + vB.y + vC.y) / 3) * triArea;
    entry.centroid.z += ((vA.z + vB.z + vC.z) / 3) * triArea;
    entry.normal.addScaledVector(triNorm, triArea);
    entry.area += triArea;
  }

  for (const entry of facetMap.values()) {
    if (entry.area > 0) {
      entry.centroid.divideScalar(entry.area);
      entry.normal.normalize();
    }
  }

  // ── 2. Weld vertices by quantised position ────────────────────────────────
  // The single most expensive pass in the build, and the one with a real
  // failure mode: two vertices either side of a quantisation boundary do not
  // weld. That used to cost one spurious wireframe line. It now costs a
  // PHANTOM MESH BOUNDARY that blocks geodesic flow — an unauthored seam in a
  // system whose whole job is authoring seams. validateTopology below exists
  // to make that loud instead of mysterious.

  const weldId  = new Int32Array(pos.count);
  const posKeys = new Map();
  /** Representative position per weld id, for edge endpoints. */
  const weldPos = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = `${Math.round(x * WELD_EPS)},${Math.round(y * WELD_EPS)},${Math.round(z * WELD_EPS)}`;
    let id = posKeys.get(k);
    if (id === undefined) {
      id = posKeys.size;
      posKeys.set(k, id);
      weldPos.push(new THREE.Vector3(x, y, z));
    }
    weldId[i] = id;
  }

  // ── 3. Edge → triangles ───────────────────────────────────────────────────

  /** @type {Map<string, {v0:number, v1:number, tris:number[]}>} */
  const edgeToTris = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = weldId[t * 3 + e];
      const b = weldId[t * 3 + ((e + 1) % 3)];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = `${lo}_${hi}`;
      const rec = edgeToTris.get(key);
      if (!rec) edgeToTris.set(key, { v0: lo, v1: hi, tris: [t] });
      else rec.tris.push(t);
    }
  }

  // ── 4. Keep only FACET-BOUNDARY edges → the adjacency graph ───────────────
  // An edge shared by two triangles of the SAME facet is a quad diagonal:
  // internal, invisible, and not a step in the facet graph. Dropping those
  // here is what makes V - E + F the POLYGONAL Euler characteristic below.

  /** @type {FacetEdge[]} */
  const edges = [];
  let nonManifold = 0;

  for (const { v0, v1, tris } of edgeToTris.values()) {
    // Three or more triangles on one edge. The old wireframe read tris[0] and
    // tris[1] and said nothing about it; adjacency has to at least admit the
    // graph it produces there is a guess.
    if (tris.length > 2) nonManifold++;

    const f0 = triToFacet[tris[0]];
    const f1 = tris.length >= 2 ? triToFacet[tris[1]] : -1;
    if (tris.length >= 2 && f0 === f1) continue;   // quad diagonal

    const a = f1 < 0 ? f0 : Math.min(f0, f1);
    const b = f1 < 0 ? -1 : Math.max(f0, f1);

    const p0 = weldPos[v0], p1 = weldPos[v1];
    edges.push({
      id: -1,                              // assigned after the sort
      a, b, v0, v1,
      p0, p1,
      midpoint: new THREE.Vector3().copy(p0).add(p1).multiplyScalar(0.5),
      length:   p0.distanceTo(p1),
      dihedral: -1,                        // filled in below
      convex:   false,
    });
  }

  // Deterministic order, so edge ids are reproducible for a given mesh. They
  // remain a runtime index and still must not be serialised — this is for
  // debugging, not persistence.
  edges.sort((e, f) => (e.a - f.a) || (e.b - f.b) || (e.v0 - f.v0) || (e.v1 - f.v1));

  // ── 5. Dihedral angle + convexity ─────────────────────────────────────────
  // Between FACET normals, not triangle normals — the quad is the unit here.
  // Convexity from which side of facet a's plane facet b's centroid falls on:
  // outward-bulging (a ridge, e.g. the brow) versus inward-folding (a valley,
  // e.g. where the ear meets the skull). Seam seeding wants to tell those
  // apart: hair parts along valleys far more often than along ridges.

  const d = new THREE.Vector3();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    e.id = i;
    if (e.b < 0) continue;                         // boundary: undefined
    const fa = facetMap.get(e.a), fb = facetMap.get(e.b);
    if (!fa || !fb) continue;
    const dot = Math.min(Math.max(fa.normal.dot(fb.normal), -1), 1);
    e.dihedral = Math.acos(dot);
    d.subVectors(fb.centroid, fa.centroid);
    e.convex = fa.normal.dot(d) < 0;
  }

  // ── 6. Indices ────────────────────────────────────────────────────────────

  /** @type {Map<number, number[]>} */
  const facetEdges = new Map();
  /** @type {Map<string, number>} */
  const pairToEdge = new Map();

  for (const e of edges) {
    push(facetEdges, e.a, e.id);
    if (e.b >= 0) {
      push(facetEdges, e.b, e.id);
      const k = pairKey(e.a, e.b);
      if (!pairToEdge.has(k)) pairToEdge.set(k, e.id);
    }
  }

  // ── 7. Validate and report ────────────────────────────────────────────────

  const topology = validateTopology({
    vertices: posKeys.size,
    edges,
    facets: facetMap.size,
    nonManifold,
  });

  const catalogue = new FacetCatalogue(
    facetMap, triToFacet, edges, facetEdges, pairToEdge, topology,
  );

  const ids = catalogue.facetIds();
  console.info(
    `[FacetCatalogue] ${catalogue.facetCount} facets from ${triCount} triangles, ` +
    `ids ${ids[0]}–${ids[ids.length - 1]}; ` +
    `${catalogue.edgeCount} adjacency edges, chi=${topology.euler}.`
  );

  return catalogue;
}

function push(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/**
 * Two cheap invariants that catch the weld failure described in step 2.
 *
 * EULER CHARACTERISTIC. V - E + F = 2 for a closed genus-0 surface, which is
 * what a head is. A failed weld splits one vertex in two and one shared edge
 * into two boundary edges, so chi moves. It is the best signal available here
 * and it costs a subtraction.
 *
 * BOUNDARY EDGES. On a closed mesh this must be zero. Non-zero is either a
 * genuinely open mesh or, far more likely, a weld that missed.
 *
 * Both warn rather than throw: a mesh that fails these still renders and still
 * combs, it just has adjacency you should not trust for seams.
 */
function validateTopology({ vertices, edges, facets, nonManifold }) {
  let boundaryEdges = 0;
  for (const e of edges) if (e.b < 0) boundaryEdges++;

  const euler = vertices - edges.length + facets;
  const t = {
    vertices, edges: edges.length, facets, euler,
    boundaryEdges, nonManifoldEdges: nonManifold,
    closed: boundaryEdges === 0,
  };

  if (boundaryEdges > 0) {
    console.warn(
      `[FacetCatalogue] ${boundaryEdges} boundary edge(s) on a mesh expected to be ` +
      `closed. Most likely the position weld (${1 / WELD_EPS} units) missed a seam — ` +
      `adjacency will contain phantom borders that block seam blending.`
    );
  }
  if (euler !== 2) {
    console.warn(
      `[FacetCatalogue] Euler characteristic is ${euler}, expected 2 for a closed ` +
      `genus-0 surface (V=${vertices} E=${edges.length} F=${facets}). Holes and ` +
      `handles change this legitimately; a value that DRIFTS between exports of ` +
      `the same mesh means the weld is unstable.`
    );
  }
  if (nonManifold > 0) {
    console.warn(
      `[FacetCatalogue] ${nonManifold} non-manifold edge(s) (3+ triangles). ` +
      `Adjacency across them uses the first two triangles found and is a guess.`
    );
  }

  return t;
}

// ── buildFacetWireframe ────────────────────────────────────────────────────────

/**
 * Quad-boundary LineSegments for debug display.
 *
 * Now a pure consumer of the catalogue's adjacency: every edge in the graph is
 * by construction a facet boundary or a mesh boundary, which is exactly the
 * set this used to recompute for itself. No weld pass here any more.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {FacetCatalogue}       [catalogue] — pass mesh.userData.catalogue
 * @returns {{ wireframe: THREE.LineSegments, catalogue: FacetCatalogue }|null}
 */
export function buildFacetWireframe(geometry, catalogue) {
  const cat = catalogue ?? buildFacetCatalogue(geometry);
  if (!cat) return null;

  const verts = [];
  for (const e of cat.edges()) {
    verts.push(e.p0.x, e.p0.y, e.p0.z, e.p1.x, e.p1.y, e.p1.z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

  const wireframe = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6 }),
  );

  return { wireframe, catalogue: cat };
}
