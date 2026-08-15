/**
 * Exercises edge traversal (loops, paths, nearest-edge picking) and the
 * SeamTool selection/edit model.
 *
 * FIXTURE: an N x N x N subdivided cube surface. A plain 6-quad cube is useless
 * here because every vertex is a corner and no edge loop can continue through
 * one. A subdivided cube has genuine valence-4 interior vertices, so loops
 * actually run — and because the loops wrap right around the solid, their
 * length is known in advance (4N edges for a band around the cube), which is
 * what makes the loop walk falsifiable rather than merely non-crashing.
 *
 * Run: node seamtool_test.mjs
 */
import assert from 'node:assert';
import { buildFacetCatalogue } from './facetWireframe.js';
import { SeamStore } from './seams.js';
import { SeamTool } from './seamTool.js';

const N = 4;   // quads per cube edge

// --- fixture ---------------------------------------------------------------

function subdividedCube(n) {
  const pos = [], fac = [];
  let fid = 0;

  // Six faces, each an n x n grid. `map(u,v)` returns the 3D corner for grid
  // coords in [0..n]; winding is chosen so normals point outward.
  const faces = [
    (u, v) => [u, v, n],   // +z
    (u, v) => [v, u, 0],   // -z
    (u, v) => [n, u, v],   // +x
    (u, v) => [0, v, u],   // -x
    (u, v) => [u, n, v],   // +y
    (u, v) => [v, 0, u],   // -y
  ];

  const S = 2 / n;   // scale grid coords into [-1, 1]
  const pt = (c) => [c[0] * S - 1, c[1] * S - 1, c[2] * S - 1];

  for (const map of faces) {
    for (let v = 0; v < n; v++) {
      for (let u = 0; u < n; u++) {
        const a = pt(map(u, v)), b = pt(map(u + 1, v));
        const c = pt(map(u + 1, v + 1)), d = pt(map(u, v + 1));
        for (const tri of [[a, b, c], [a, c, d]]) {
          for (const p of tri) { pos.push(...p); fac.push(fid); }
        }
        fid++;
      }
    }
  }

  const attr = (arr, size) => ({
    array: arr, itemSize: size, count: arr.length / size,
    getX: (i) => arr[i * size],
    getY: (i) => arr[i * size + 1],
    getZ: (i) => arr[i * size + 2],
  });
  return { attributes: { position: attr(pos, 3), _facet: attr(fac, 1) } };
}

const warn = console.warn;
console.warn = () => {};
const cat = buildFacetCatalogue(subdividedCube(N));
console.warn = warn;

// === 1. the fixture is sane ================================================
assert.equal(cat.facetCount, 6 * N * N, `6 * ${N}^2 facets`);
assert.equal(cat.topology.euler, 2, 'still a closed genus-0 surface');
assert.equal(cat.topology.boundaryEdges, 0, 'closed');

// Interior vertices are valence 4; cube corners are valence 3.
let v4 = 0, v3 = 0;
for (const e of cat.edges()) { /* touch to force the index */ break; }
const seenVerts = new Set();
for (const e of cat.edges()) { seenVerts.add(e.v0); seenVerts.add(e.v1); }
for (const v of seenVerts) {
  const d = cat.edgesOfVertex(v).length;
  if (d === 4) v4++; else if (d === 3) v3++;
}
assert.equal(v3, 8, 'exactly 8 corners of valence 3');
assert.ok(v4 > 0, 'and interior vertices of valence 4');

// === 2. edge loops close and are the right length ==========================
// A loop that starts on a face interior edge and runs perpendicular to the
// cube's axis wraps all the way around: 4 faces x N edges.
let closedLoops = 0, checked = 0;
for (const e of cat.edges()) {
  const { edges, closed } = cat.edgeLoop(e.id);
  assert.ok(edges.includes(e.id), 'the loop contains its seed');
  assert.equal(new Set(edges).size, edges.length, 'no repeats in a loop');
  if (closed) {
    closedLoops++;
    assert.equal(edges.length, 4 * N, `a closed band is ${4 * N} edges, got ${edges.length}`);
  }
  if (++checked > 60) break;   // representative sample; the walk is O(loop)
}
assert.ok(closedLoops > 0, 'some loops close all the way round');

// Every edge of a closed loop reports the same loop, whichever you seed from.
const seed = [...cat.edges()].find((e) => cat.edgeLoop(e.id).closed);
const loopA = new Set(cat.edgeLoop(seed.id).edges);
for (const id of loopA) {
  const loopB = cat.edgeLoop(id);
  assert.ok(loopB.closed, 'every member of a closed loop sees a closed loop');
  assert.deepEqual(new Set(loopB.edges), loopA, 'and the same membership');
}

// A loop never turns a corner: consecutive edges share no facet.
const walk = cat.edgeLoop(seed.id).edges;
for (let i = 0; i + 1 < walk.length; i++) {
  const p = cat.getEdge(walk[i]), q = cat.getEdge(walk[i + 1]);
  const shares = p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b;
  assert.ok(!shares, `loop step ${i} turned a corner`);
}

// === 3. paths ==============================================================
const e0 = 0, e1 = cat.edgeCount - 1;
const path = cat.edgePath(e0, e1);
assert.ok(path.length >= 2, 'a path exists on a connected shell');
assert.equal(path[0], e0);
assert.equal(path[path.length - 1], e1);
// Consecutive path edges must actually touch.
for (let i = 0; i + 1 < path.length; i++) {
  const p = cat.getEdge(path[i]), q = cat.getEdge(path[i + 1]);
  const touch = p.v0 === q.v0 || p.v0 === q.v1 || p.v1 === q.v0 || p.v1 === q.v1;
  assert.ok(touch, `path step ${i} is disconnected`);
}
assert.deepEqual(cat.edgePath(7, 7), [7], 'a path to itself is one edge');

// Length-weighted, so the path is no longer than a straight-line lower bound
// would suggest by more than the mesh's own granularity.
const total = path.reduce((s, id) => s + cat.getEdge(id).length, 0);
assert.ok(total > 0);

// === 4. nearest-edge picking always resolves ===============================
for (const f of [0, 5, 37, cat.facetCount - 1]) {
  const entry = cat.getFacet(f);
  const { edgeId, distance } = cat.nearestEdgeOfFacet(f, entry.centroid);
  assert.ok(edgeId >= 0, 'a click on a facet always resolves to an edge');
  assert.ok(cat.edgesOfFacet(f).includes(edgeId), 'and it is one of that facet\'s own');
  assert.ok(distance >= 0);
  // A point right on an edge's midpoint picks that edge.
  const target = cat.getEdge(cat.edgesOfFacet(f)[0]);
  const hit = cat.nearestEdgeOfFacet(f, target.midpoint);
  assert.equal(hit.edgeId, target.id, 'picking at a midpoint picks that edge');
  assert.ok(hit.distance < 1e-9);
}

// === 5. SeamTool selection model ===========================================
const seams = new SeamStore();
const events = { selection: 0, edit: 0, begin: 0, end: 0 };
const tool = new SeamTool({
  viewer: { renderer: { domElement: null }, camera: null },
  mesh: null,
  catalogue: cat,
  seams,
  onSelectionChange: () => events.selection++,
  onEdit:            () => events.edit++,
  onBeginEdit:       () => events.begin++,
  onEndEdit:         () => events.end++,
});

assert.equal(tool.count, 0);
assert.equal(tool.meanPermeability(), 1, 'empty selection reads as the default');

tool.select([seed.id]);
assert.equal(tool.count, 1);
assert.equal(tool.anchor, seed.id);
assert.equal(events.selection, 1);

// The single edge is not a special case — it is a set of one.
tool.setPermeability(0.25);
tool.endEdit();
const se = cat.getEdge(seed.id);
assert.equal(seams.get(se.a, se.b), 0.25, 'slider wrote through to the store');
assert.equal(tool.meanPermeability(), 0.25, 'and the slider reads it back');
assert.equal(events.begin, 1, 'one history transaction opened');
assert.equal(events.end, 1, 'and closed');

// A drag is many writes and ONE transaction.
const beginBefore = events.begin;
for (let i = 0; i <= 10; i++) tool.setPermeability(i / 10);
tool.endEdit();
assert.equal(events.begin, beginBefore + 1, '11 slider ticks → 1 undo entry');

// === 6. uniform apply across a run =========================================
tool.selectLoop(seed.id);
assert.equal(tool.count, 4 * N, 'loop select picked up the whole band');
tool.setPermeability(0);
tool.endEdit();
for (const id of tool.selected) {
  const e = cat.getEdge(id);
  assert.ok(seams.isHard(e.a, e.b), 'every edge of the run was written');
}
assert.equal(tool.meanPermeability(), 0);
assert.ok(!tool.isMixed(), 'a uniformly written run is not mixed');

// === 7. mixed detection ====================================================
const first = tool.selected[0];
const fe = cat.getEdge(first);
seams.set(fe.a, fe.b, 0.8);
assert.ok(tool.isMixed(), 'one differing edge makes the run mixed');
assert.ok(tool.meanPermeability() > 0, 'and the mean moves off zero');

// === 8. reopening drops the overrides ======================================
const reopened = tool.clearPermeability();
tool.endEdit();
assert.equal(reopened, 4 * N);
for (const id of tool.selected) {
  const e = cat.getEdge(id);
  assert.equal(seams.get(e.a, e.b), 1, 'back to the default');
}
assert.equal(seams.count, 0, 'and nothing left in the sparse store');

// === 9. the two-facet gesture ==============================================
const someEdge = cat.getEdge(20);
assert.ok(tool.selectBetweenFacets(someEdge.a, someEdge.b), 'adjacent pair resolves');
assert.deepEqual(tool.selected, [someEdge.id]);
// Two facets on opposite sides of the cube share no edge.
assert.equal(tool.selectBetweenFacets(0, 6 * N * N - 1), false, 'non-adjacent pair fails');

// === 10. border of a facet region =========================================
// One facet's border is its own edge ring.
tool.selectBorderOfFacets([5]);
assert.equal(tool.count, cat.edgesOfFacet(5).length, 'a lone facet\'s border is its ring');
// Two adjacent facets: the border excludes the edge between them.
const pair = [someEdge.a, someEdge.b];
tool.selectBorderOfFacets(pair);
assert.ok(!tool.selection.has(someEdge.id), 'the shared edge is interior, not border');
for (const id of tool.selected) {
  const e = cat.getEdge(id);
  assert.notEqual(pair.includes(e.a), pair.includes(e.b), 'border edges straddle the set');
}

// === 11. path extension is chainable ======================================
tool.select([e0]);
const n1 = tool.extendPathTo(e1);
assert.ok(n1 > 0);
assert.equal(tool.anchor, e1, 'the anchor moved to the far end');
const sizeAfterFirst = tool.count;
const e2 = Math.floor(cat.edgeCount / 3);
tool.extendPathTo(e2);
assert.ok(tool.count > sizeAfterFirst, 'a second ctrl+click continues the run');
assert.equal(tool.anchor, e2);

// === 12. grow walks along the loop ========================================
tool.select([seed.id]);
tool.growSelection();
assert.equal(tool.count, 3, 'grow adds one edge in each direction');
for (const id of tool.selected) {
  assert.ok(loopA.has(id), 'and stays on the loop');
}

console.log('all assertions passed');
console.log(`cube ${N}x${N}: F=${cat.facetCount} E=${cat.edgeCount} chi=${cat.topology.euler}`);
console.log(`closed loop length = ${walk.length} edges (expected ${4 * N})`);

// === 13. screen-space picking beats the 3D test at grazing angles ==========
// A fake orthographic-ish camera looking down -Z: project by dropping z and
// squashing y, which is what a real projection does to a surface seen nearly
// edge-on. The point of the test is that the two metrics DISAGREE and the
// screen one matches the cursor.
const squash = 0.06;
const fakeCam = { project: (v) => { v.y *= squash; v.z = 0; return v; } };
const fakeCanvas = { clientWidth: 800, clientHeight: 800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) };

// Identity mesh transform, and a raycast we control directly.
let forcedFacet = 0;
const fakeMesh = {
  worldToLocal: (v) => v,
  localToWorld: (v) => v,
};
const screenTool = new SeamTool({
  viewer: { renderer: { domElement: fakeCanvas }, camera: fakeCam },
  mesh: fakeMesh, catalogue: cat, seams: new SeamStore(),
});
// Stub the ray hit so the test isolates the edge-choice step.
screenTool._raycaster = {
  setFromCamera: () => {},
  intersectObject: () => [{ faceIndex: cat.getFacet(forcedFacet).triIndices[0],
                            point: cat.getFacet(forcedFacet).centroid.clone() }],
};

// Find a facet where the two metrics disagree under the squash.
let disagreements = 0;
for (const f of cat.facetIds()) {
  forcedFacet = f;
  const entry = cat.getFacet(f);
  const ev = { clientX: 400, clientY: 400 };
  // Aim the pointer at the projected centroid, then nudge in +y.
  const c = entry.centroid;
  screenTool._pointer.set(c.x, c.y * squash + 0.02);
  const screenPick = screenTool._nearestEdgeOnScreen(f);
  const spacePick  = cat.nearestEdgeOfFacet(f, c).edgeId;
  assert.ok(screenPick >= 0, 'screen pick always resolves when geometry projects');
  assert.ok(cat.edgesOfFacet(f).includes(screenPick), 'and stays on the facet');
  if (screenPick !== spacePick) disagreements++;
}
assert.ok(
  disagreements > 0,
  'a grazing view must make screen-space and mesh-space picks differ — ' +
  'otherwise this test is not exercising anything'
);
console.log(`screen vs mesh-space pick differed on ${disagreements}/${cat.facetCount} facets`);
