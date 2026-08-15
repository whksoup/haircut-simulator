/**
 * Exercises the facet adjacency graph, topology validation, dihedral seam
 * seeding, and seam-aware flood fill against a synthetic closed cube.
 *
 * A cube is the right fixture: it is closed, genus 0 (chi = 2), has exactly
 * 6 quad facets and 12 edges, and every edge is a 90-degree CONVEX crease.
 * That last property makes the concave/convex split testable — a cube's
 * exterior should seed zero seams in 'concave' mode and all twelve in
 * 'convex'.  Run: node adjacency_test.mjs
 */
import assert from 'node:assert';
import { buildFacetCatalogue, FacetCatalogue } from './facetWireframe.js';
import { SeamStore, seedSeamsFromCreases } from './seams.js';
import { Groom } from './groom.js';

// --- fixture: a unit cube, non-indexed, two triangles per quad facet -------

function cubeGeometry() {
  // 8 corners
  const V = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],   // z = -1
    [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],   // z = +1
  ];
  // Each face: 4 corner indices, counter-clockwise seen from OUTSIDE, so the
  // computed normals point outward and `convex` comes out true.
  const F = [
    [4, 5, 6, 7],   // +z
    [1, 0, 3, 2],   // -z
    [5, 1, 2, 6],   // +x
    [0, 4, 7, 3],   // -x
    [3, 7, 6, 2],   // +y
    [0, 1, 5, 4],   // -y
  ];

  const pos = [], fac = [];
  F.forEach((quad, fid) => {
    const [a, b, c, d] = quad;
    for (const tri of [[a, b, c], [a, c, d]]) {
      for (const vi of tri) { pos.push(...V[vi]); fac.push(fid); }
    }
  });

  const attr = (arr, size) => ({
    array: arr, itemSize: size, count: arr.length / size,
    getX: (i) => arr[i * size],
    getY: (i) => arr[i * size + 1],
    getZ: (i) => arr[i * size + 2],
  });

  return { attributes: { position: attr(pos, 3), _facet: attr(fac, 1) } };
}

// Quiet the expected-clean build; re-enable if a warning is the point.
const warn = console.warn;
let warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));

const cat = buildFacetCatalogue(cubeGeometry());
console.warn = warn;

// === 1. facets and edges ===================================================
assert.equal(cat.facetCount, 6, '6 quad facets');
assert.equal(cat.edgeCount, 12, '12 facet-boundary edges — diagonals excluded');

// === 2. topology validates clean ===========================================
const t = cat.topology;
assert.equal(t.vertices, 8, '8 welded corners');
assert.equal(t.euler, 2, 'chi = 2 for a closed genus-0 surface');
assert.equal(t.boundaryEdges, 0, 'closed: no boundary edges');
assert.equal(t.nonManifoldEdges, 0);
assert.ok(t.closed);
assert.equal(warnings.length, 0, `a clean cube warns about nothing: ${warnings}`);

// === 3. adjacency is correct and symmetric =================================
for (const id of cat.facetIds()) {
  const ns = cat.neighbours(id);
  assert.equal(ns.length, 4, `facet ${id} has 4 neighbours`);
  assert.equal(new Set(ns).size, 4, 'no duplicates');
  assert.ok(!ns.includes(id), 'not its own neighbour');
  for (const n of ns) {
    assert.ok(cat.neighbours(n).includes(id), `adjacency symmetric ${id}<->${n}`);
  }
  assert.equal(cat.edgesOfFacet(id).length, 4);
}
// Opposite faces (+z / -z) must NOT touch.
assert.equal(cat.edgeBetween(0, 1), -1, 'opposite faces are not adjacent');
assert.ok(cat.edgeBetween(0, 2) >= 0, 'adjacent faces share an edge');
assert.equal(FacetCatalogue.pairKey(5, 2), '2_5', 'pair key is order-independent');

// === 4. edge geometry ======================================================
for (const e of cat.edges()) {
  assert.ok(e.b >= 0, 'no boundary edges on a cube');
  assert.ok(Math.abs(e.length - 2) < 1e-9, 'unit cube edges are length 2');
  // 90 degrees between adjacent face normals.
  assert.ok(Math.abs(e.dihedral - Math.PI / 2) < 1e-9, `dihedral 90deg, got ${e.dihedral}`);
  assert.equal(e.convex, true, 'a cube exterior is convex everywhere');
  assert.ok(e.a < e.b, 'a < b');
}
// Deterministic ids, densely assigned.
assert.deepEqual([...cat.edges()].map((e) => e.id), [...Array(12).keys()]);

// === 5. dihedral seeding respects the convex/concave split =================
const seams = new SeamStore();

let r = seedSeamsFromCreases(cat, seams, { thresholdDeg: 40, mode: 'concave', softness: 0 });
assert.equal(r.marked, 0, 'a convex cube seeds NO concave seams');
assert.equal(seams.count, 0);

r = seedSeamsFromCreases(cat, seams, { thresholdDeg: 40, mode: 'convex', softness: 0 });
assert.equal(r.marked, 12, 'all 12 edges are convex creases past 40deg');
assert.equal(r.hard, 12, 'softness 0 → fully hard');
assert.equal(seams.count, 12);

// Threshold above the actual dihedral marks nothing, and REPLACES.
r = seedSeamsFromCreases(cat, seams, { thresholdDeg: 100, mode: 'both', softness: 0 });
assert.equal(r.marked, 0);
assert.equal(seams.count, 0, 'reseeding replaces rather than unions');

// Softness produces a partial value, not a binary.
seedSeamsFromCreases(cat, seams, { thresholdDeg: 80, mode: 'convex', softness: 20 });
const p = seams.get(0, 2);
assert.ok(p > 0 && p < 1, `90deg is 10 of 20 degrees past 80 → mid value, got ${p}`);
assert.ok(Math.abs(p - 0.5) < 1e-9, 'exactly halfway');

// === 6. SeamStore semantics ================================================
const ss = new SeamStore();
assert.equal(ss.get(3, 7), 1, 'absent means fully permeable');
ss.set(7, 3, 0.25);
assert.equal(ss.get(3, 7), 0.25, 'order-independent');
assert.ok(!ss.isHard(3, 7));
ss.set(3, 7, 0);
assert.ok(ss.isHard(3, 7));
ss.set(3, 7, 1);
assert.equal(ss.count, 0, 'writing 1 deletes the override rather than storing it');
ss.set(3, 7, 5);
assert.equal(ss.count, 0, 'out-of-range high clamps to 1 → deleted');
ss.set(3, 7, -2);
assert.equal(ss.get(3, 7), 0, 'out-of-range low clamps to 0');

// === 7. seams round-trip through the Groom (schema v5) =====================
const groom = new Groom();
groom.addFacet(0);
groom.seams.set(0, 2, 0.3);
groom.seams.set(2, 4, 0);
const json = JSON.parse(groom.serialize());
assert.equal(json.version, 5);
assert.equal(json.seams.length, 2);

const back = Groom.deserialize(groom.serialize());
assert.equal(back.seams.get(2, 0), 0.3, 'permeability survives the round trip');
assert.ok(back.seams.isHard(4, 2));

// v4 files migrate to an empty, behaviourally identical seam set.
const v4 = { version: 4, masterSeed: 7, globals: {}, faces: [], guides: [] };
const migrated = Groom.fromJSON(v4);
assert.equal(migrated.seams.count, 0);
assert.equal(migrated.seams.get(1, 2), 1, 'v4 behaviour: everything blends');

// copyFrom keeps the store identity (the orphaning bug, for seams this time).
const seamRef = back.seams;
back.copyFrom(groom);
assert.strictEqual(back.seams, seamRef, 'SeamStore reference is stable');
assert.equal(back.seams.get(0, 2), 0.3);

// removeFacet must NOT wipe seams — they describe the scalp, not the hair.
groom.removeFacet(0);
assert.equal(groom.seams.get(0, 2), 0.3, 'seams survive shaving a facet');

// === 8. seam-aware flood fill ==============================================
// Wall off facet 0 (+z) from all four of its neighbours; a fill from 0 should
// then reach exactly one facet, and an unrestricted fill should reach all six.
const walled = new SeamStore();
for (const n of cat.neighbours(0)) walled.set(0, n, 0);

function fill(start, respectSeams) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const id = q.pop();
    for (const n of cat.neighbours(id)) {
      if (seen.has(n)) continue;
      if (respectSeams && walled.isHard(id, n)) continue;
      seen.add(n); q.push(n);
    }
  }
  return seen;
}
assert.equal(fill(0, true).size, 1, 'walled facet is isolated');
assert.equal(fill(0, false).size, 6, 'ignoring seams reaches the whole cube');
assert.equal(fill(1, true).size, 5, 'the other five are still connected');

// === 9. topology validation FIRES on a broken weld =========================
// Nudge one corner past the weld epsilon so it splits: chi and the boundary
// count must both move, and both must warn.
const broken = cubeGeometry();
broken.attributes.position.array[0] += 0.01;
warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));
const bad = buildFacetCatalogue(broken);
console.warn = warn;
assert.ok(bad.topology.boundaryEdges > 0, 'a split weld creates boundary edges');
assert.notEqual(bad.topology.euler, 2, 'and moves the Euler characteristic');
assert.ok(warnings.some((w) => w.includes('boundary edge')), 'warned about the weld');
assert.ok(warnings.some((w) => w.includes('Euler')), 'warned about chi');

console.log('all assertions passed');
console.log(`cube: F=${cat.facetCount} E=${cat.edgeCount} V=${t.vertices} chi=${t.euler}`);
console.log(`broken weld: chi=${bad.topology.euler}, ${bad.topology.boundaryEdges} boundary edges`);
