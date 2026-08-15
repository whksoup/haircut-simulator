/**
 * Exercises History against the real Groom / GuideStore, with a fake renderer
 * that records which restore path each undo took. Run: node history.test.mjs
 */
import assert from 'node:assert';
import { Groom }   from './groom.js';
import { History } from './history.js';

const calls = [];
const groom = new Groom();

// A minimal stand-in for the renderer + debug view.
const renderer = {
  setGuides: (ids) => calls.push(`setGuides:${ids.length}`),
  rebuild:   ()    => calls.push('rebuild'),
  updateFacet: () => {}, removeFacet: () => {}, syncGuides: () => {},
};

const snapshot      = () => ({ kind: 'snapshot', data: groom.toJSON() });
const captureGuides = (ids) => {
  const src = ids ? ids.map((i) => groom.guides.get(i)) : [...groom.guides.guides.values()];
  return { kind: 'guides', data: src.filter(Boolean).map((g) => ({
    id: g.id, points: Float64Array.from(g.points),
    tangent: Float64Array.from(g.tangent), length: g.length,
  })) };
};
const restore = (patch) => {
  if (patch.kind === 'guides') {
    const ids = [];
    for (const rec of patch.data) {
      const live = groom.guides.get(rec.id);
      if (!live) continue;
      for (let i = 0; i < rec.points.length; i++)  live.points[i]  = rec.points[i];
      for (let i = 0; i < rec.tangent.length; i++) live.tangent[i] = rec.tangent[i];
      live.length = rec.length;
      ids.push(rec.id);
    }
    renderer.setGuides(ids);
    return;
  }
  groom.copyFrom(Groom.fromJSON(patch.data));
  renderer.rebuild();
};

const history = new History({ snapshot, captureGuides, restore });

// --- fixture: three guides -------------------------------------------------
const storeRef = groom.guides;      // captured once, as the real tools do
const ids = [0, 1, 2].map((i) => groom.guides.add({
  facetId: i, root: [i, 0, 0], normal: [0, 1, 0], length: 0.1,
}));

// === 1. a comb stroke undoes through the cheap path ========================
history.beginStroke();
const g = groom.guides.get(ids[0]);
g.points[3] = 0.42;                 // pretend the comb moved control point 1
history.commitStroke('comb', [ids[0]]);

assert.equal(history.depth, 1);
assert.equal(history.undoLabel, 'comb');
history.undo();
assert.equal(groom.guides.get(ids[0]).points[3], 0, 'undo restored the point');
assert.equal(calls.at(-1), 'setGuides:1', 'cheap path, one guide');
history.redo();
assert.equal(groom.guides.get(ids[0]).points[3], 0.42, 'redo reapplied');
assert.equal(calls.at(-1), 'setGuides:1');

// === 2. a stroke that moved nothing records nothing ========================
const before = history.depth;
history.beginStroke();
history.commitStroke('comb', []);
assert.equal(history.depth, before, 'empty stroke → no entry');

// === 3. only the touched guides are stored, not all of them ================
history.beginStroke();
groom.guides.get(ids[1]).points[3] = 0.7;
history.commitStroke('comb', [ids[1]]);
assert.equal(history._undo.at(-1).before.data.length, 1, 'narrowed to 1 of 3');

// === 4. structural edits take the snapshot path ============================
history.transact('add hair', () => { groom.addFacet(9); return true; });
assert.ok(groom.hasFacet(9));
history.undo();
assert.ok(!groom.hasFacet(9), 'facet removed by undo');
assert.equal(calls.at(-1), 'rebuild', 'structural → rebuild');

// === 5. GuideStore identity survives a snapshot restore ====================
assert.strictEqual(groom.guides, storeRef, 'store reference is stable');
assert.equal(groom.guides.count, 3, 'guides survived copyFrom');

// === 6. transact returning false records nothing ===========================
const d = history.depth;
history.transact('no-op', () => false);
assert.equal(history.depth, d, 'false → discarded');

// === 7. slider coalescing: many marks, one entry ===========================
const d2 = history.depth;
for (let i = 0; i < 20; i++) { history.mark('globals.density'); groom.globals.density = i; }
history.commitMark('globals.density', 'density');
assert.equal(history.depth, d2 + 1, '20 onChange calls → 1 entry');
history.undo();
assert.equal(groom.globals.density, 0.02, 'restored to pre-drag value');

// === 8. a new edit truncates the redo tail =================================
assert.ok(history.canRedo);
history.transact('add hair', () => { groom.addFacet(5); return true; });
assert.ok(!history.canRedo, 'redo tail dropped');

// === 9. restore cannot record (re-entry is muted) ==========================
const d3 = history.depth;
history.undo();
assert.equal(history.depth, d3 - 1, 'undo popped exactly one, restore recorded none');

// === 10. busy is true mid-stroke ===========================================
assert.ok(!history.busy);
history.beginStroke();
assert.ok(history.busy, 'busy during a stroke');
history.abortStroke();
assert.ok(!history.busy);

console.log(`all assertions passed — ${history.depth} entries on the stack`);
console.log('restore paths taken:', calls.join(' '));
