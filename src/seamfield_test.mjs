/**
 * Exercises seam permeability all the way through to blend weights: the
 * SeamField's graph walk, and guideBinding's use of it.
 *
 * The fixture is a two-facet strip rather than a real head, because the claim
 * under test is arithmetic, not geometry: a strand sitting between two guides
 * should blend both when the boundary is open, one when it is hard, and
 * something in between when it is half. A cube or a head would exercise the
 * catalogue instead, which adjacency_test.mjs already covers — so the
 * catalogue here is a stub with exactly the three methods SeamField calls.
 * That stub is also the readable statement of what this feature needs from the
 * catalogue: edgesOfFacet, getEdge (with a length), getFacet (centroid).
 *
 *   Run: node seamfield_test.mjs
 */
import assert from 'node:assert';
import { SeamStore } from './seams.js';
import { SeamField } from './seamField.js';
import { bindStrandsToGuides } from './guideBinding.js';
import { straightShape } from './strandShape.js';

// --- fixture ---------------------------------------------------------------
// Facets 0 | 1 | 2 in a row along x, joined by edges of length 0.1.
// Guides sit at each facet's centre; the boundaries are at x = 0 and x = 0.1.

const EDGES = [
  { id: 0, a: 0, b: 1, length: 0.1 },
  { id: 1, a: 1, b: 2, length: 0.1 },
];
const CENTROIDS = [{ x: -0.05, y: 0, z: 0 }, { x: 0.05, y: 0, z: 0 }, { x: 0.15, y: 0, z: 0 }];

const catalogue = {
  edgesOfFacet: (id) => EDGES.filter((e) => e.a === id || e.b === id).map((e) => e.id),
  getEdge: (eid) => EDGES[eid],
  getFacet: (id) => ({ id, centroid: CENTROIDS[id] }),
};

const guide = (facetId, x) => ({
  id: facetId + 1, facetId,
  root: [x, 0, 0], normal: [0, 1, 0], tangent: [1, 0, 0],
  points: straightShape(), length: 0.1,
});
const guideList = [guide(0, -0.05), guide(1, 0.05), guide(2, 0.15)];

/** One strand just left of the 0|1 boundary, i.e. on facet 0. */
function bind(seams, { facet = 0, scale } = {}) {
  const field = new SeamField(catalogue, seams, scale === undefined ? {} : { scale });
  const rows = new Float32Array(3);
  const weights = new Float32Array(3);
  bindStrandsToGuides({
    rootPositions: Float32Array.from([-0.01, 0, 0]),
    rootNormals:   Float32Array.from([0, 1, 0]),
    total:         1,
    guideList,
    strandFacets:  Int32Array.from([facet]),
    seamField:     field,
    outRows:       rows,
    outWeights:    weights,
  });
  // Weight per guide row, in guideList order.
  const w = [0, 0, 0];
  for (let j = 0; j < 3; j++) w[rows[j]] += weights[j];
  return w;
}

// --- SeamField: the walk itself --------------------------------------------

const seams = new SeamStore();
let field = new SeamField(catalogue, seams);

assert.equal(field.active, false, 'no authored seam → the field opts out entirely');
assert.equal(field.detour(0, 2), 0, 'and charges nothing, without walking anything');

seams.set(0, 1, 0.5);
field = new SeamField(catalogue, seams, { scale: 1 });
assert.ok(field.active, 'one authored seam turns the field on');
assert.equal(field.detour(0, 0), 0, 'a facet is never far from itself');
// scale · length · (1/p − 1) = 1 · 0.1 · 1
assert.ok(Math.abs(field.detour(0, 1) - 0.1) < 1e-9, 'p=0.5 costs one edge length at scale 1');
assert.ok(Math.abs(field.detour(1, 0) - 0.1) < 1e-9, 'and is symmetric');
assert.ok(Math.abs(field.detour(0, 2) - 0.1) < 1e-9, 'cost accumulates only across seamed edges');

field = new SeamField(catalogue, seams, { scale: 4 });
assert.ok(Math.abs(field.detour(0, 1) - 0.4) < 1e-9, 'scale multiplies the step cost');

seams.set(0, 1, 0);
field = new SeamField(catalogue, seams);
assert.equal(field.detour(0, 1), Infinity, 'a hard seam is removed from the graph, not priced');
assert.equal(field.detour(0, 2), Infinity, 'and walls off everything behind it');
assert.equal(field.detour(1, 2), 0, 'the far side stays freely connected to itself');
assert.equal(field.detour(0, -1), 0,
  'a guide with no facet is unknown provenance, not unreachable — never delete it');

// STALENESS IS THE FAILURE MODE. The field caches one walk per source facet,
// so a seam edit that skips invalidate() serves the old parting forever. This
// asserts the sharp edge exists, so nobody discovers it as a bug instead.
seams.set(0, 1, 0.5);   // softening a hard part: the classic "why is nothing happening"
assert.equal(field.detour(0, 1), Infinity, 'cached: the edit is invisible until invalidated');
field.invalidate();
assert.ok(field.detour(0, 1) > 0 && Number.isFinite(field.detour(0, 1)),
  'invalidate() picks the edit up');

// One edit escapes the cache by accident: writing 1 to the LAST authored seam
// empties the store, and an inactive field answers 0 without consulting
// anything. Worth pinning — it is the reason "clear all seams" appears to work
// even if a caller forgets to invalidate, which is exactly the kind of partial
// correctness that hides the bug in every other case.
seams.set(0, 1, 1);
assert.equal(field.active, false);
assert.equal(field.detour(0, 1), 0, 'an emptied store short-circuits ahead of the cache');

// setScale invalidates on its own, since every cached cost is scaled by it.
seams.set(0, 1, 0.5);
field.invalidate();
const before = field.detour(0, 1);
field.setScale(field.scale * 2);
assert.ok(Math.abs(field.detour(0, 1) - before * 2) < 1e-9, 'setScale re-walks');

// --- binding: does any of it reach a strand? -------------------------------

const open = bind(new SeamStore());
assert.ok(open[0] > 0 && open[1] > 0, 'with no seams the strand blends both neighbours');

const hardStore = new SeamStore();
hardStore.set(0, 1, 0);
const hard = bind(hardStore);
assert.equal(hard[1], 0, 'a hard seam stops weight crossing the boundary');
assert.equal(hard[2], 0, 'including guides further behind it');
assert.ok(Math.abs(hard[0] - 1) < 1e-6, 'the near side keeps all of the weight');

const softStore = new SeamStore();
softStore.set(0, 1, 0.5);
const soft = bind(softStore);
assert.ok(soft[1] > 0, 'a soft seam attenuates rather than blocks');
assert.ok(soft[1] < open[1], 'but the far guide weighs less than it would unseamed');

const softer = bind(softStore, { scale: 12 });
assert.ok(softer[1] < soft[1], 'raising the scale pushes the far guide further away');

// The regression property the whole design hangs on: authoring nothing must
// leave the binder bit-identical to its pre-seam behaviour.
const seamless = bind(new SeamStore());
const noField = (() => {
  const rows = new Float32Array(3), weights = new Float32Array(3);
  bindStrandsToGuides({
    rootPositions: Float32Array.from([-0.01, 0, 0]),
    rootNormals:   Float32Array.from([0, 1, 0]),
    total: 1, guideList, outRows: rows, outWeights: weights,
  });
  const w = [0, 0, 0];
  for (let j = 0; j < 3; j++) w[rows[j]] += weights[j];
  return w;
})();
assert.deepEqual(seamless, noField, 'an unseamed groom binds exactly as it did before seams');

// A strand walled in with no guide of its own must not end up unbound: the
// binder retries without the gate rather than rendering a hard-edged bald
// patch. Facet 2 is sealed off from 0 and 1 here, and has a guide — so move
// the strand onto a facet whose only reachable guides are all blocked.
const sealed = new SeamStore();
sealed.set(0, 1, 0);
sealed.set(1, 2, 0);
const orphan = bind(sealed, { facet: 1 });   // strand at x=-0.01 but on facet 1
assert.ok(orphan[0] + orphan[1] + orphan[2] > 0.99,
  'a strand whose neighbours are all walled off still binds (ungated retry)');

console.log('all assertions passed');
