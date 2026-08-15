/**
 * The permeability edit model, after the slider was removed.
 *
 * The bug this replaces: the slider held a history transaction open across a
 * drag and closed it on release. When the release event went missing the
 * transaction stayed open, History.busy stayed true, and undo silently stopped
 * working for the whole session. Two rounds of defending against the missed
 * event failed.
 *
 * The fix is structural, so the test is too: it does not check that a stuck
 * transaction gets cleaned up, it checks that NO STATE SPANS TWO EVENTS in the
 * first place. Every write opens and closes inside one call, so there is
 * nothing a dropped event could leave dangling.
 */
import assert from 'node:assert';
import { buildFacetCatalogue } from './facetWireframe.js';
import { SeamStore } from './seams.js';
import { SeamTool } from './seamTool.js';
import { History } from './history.js';
import { Groom } from './groom.js';

const warn = console.warn, info = console.info;
console.warn = () => {}; console.info = () => {};
function cube() {
  const V=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const F=[[4,5,6,7],[1,0,3,2],[5,1,2,6],[0,4,7,3],[3,7,6,2],[0,1,5,4]];
  const pos=[],fac=[];
  F.forEach((q,fid)=>{const[a,b,c,d]=q;for(const t of[[a,b,c],[a,c,d]])for(const v of t){pos.push(...V[v]);fac.push(fid);}});
  const attr=(a,s)=>({array:a,itemSize:s,count:a.length/s,getX:i=>a[i*s],getY:i=>a[i*s+1],getZ:i=>a[i*s+2]});
  return {attributes:{position:attr(pos,3),_facet:attr(fac,1)}};
}
const cat = buildFacetCatalogue(cube());
console.warn = warn; console.info = info;

// Wire a REAL History, so "undo still works" is an actual assertion and not a
// proxy for one.
const groom = new Groom();
const history = new History({
  snapshot: () => ({ kind: 'snapshot', data: groom.toJSON() }),
  captureGuides: () => ({ kind: 'guides', data: [] }),
  restore: (patch) => { if (patch.kind === 'snapshot') groom.copyFrom(Groom.fromJSON(patch.data)); },
});

const tool = new SeamTool({
  viewer: { renderer: { domElement: null }, camera: null },
  mesh: null, catalogue: cat, seams: groom.seams,
  onBeginEdit: () => history.mark('seams'),
  onEndEdit:   () => history.commitMark('seams', 'seam permeability'),
});

// === 1. one commit, one undo entry, nothing left open ======================
tool.select([0]);
assert.ok(!history.busy, 'idle before any edit');

tool.setPermeability(0.25);
assert.equal(history.depth, 1, 'one commit → one undo entry');
assert.ok(!history.busy, 'and NOTHING is left open afterwards');

const e0 = cat.getEdge(0);
assert.equal(groom.seams.get(e0.a, e0.b), 0.25);

// === 2. undo still works — the whole point =================================
history.undo();
assert.equal(groom.seams.get(e0.a, e0.b), 1, 'undo restored the default');
history.redo();
assert.equal(groom.seams.get(e0.a, e0.b), 0.25, 'redo reapplied');

// === 3. many commits do not accumulate open state ==========================
// The old model would have had ONE transaction open across all of these,
// closed only by an event that might never come. Now each is self-contained.
for (let i = 1; i <= 10; i++) {
  tool.setPermeability(i / 10);
  assert.ok(!history.busy, `still not busy after commit ${i}`);
}
assert.equal(history.depth, 11, 'ten more commits, ten more entries');

// === 4. there is no lingering edit flag to get stuck =======================
// The absence of this state is the fix. If someone reintroduces an _editing
// flag spanning calls, this catches it.
assert.equal(tool._editing, undefined, 'no cross-call edit state exists');

// === 5. beginEdit/endEdit survive as no-ops ================================
// Old call sites should not explode; they should also not emit anything.
const depth = history.depth;
tool.beginEdit();
tool.endEdit();
assert.equal(history.depth, depth, 'the legacy no-ops record nothing');
assert.ok(!history.busy);

// === 6. clearPermeability commits on its own ===============================
tool.select([0, 1, 2]);
tool.setPermeability(0);
const d2 = history.depth;
const n = tool.clearPermeability();
assert.equal(n, 3, 'reopened all three');
assert.equal(history.depth, d2 + 1, 'and recorded exactly one entry');
assert.ok(!history.busy);

// === 7. undo works after everything above ==================================
// The regression in one line: after a long session of edits, can you still
// undo? Under the old model the answer became "no" the first time a release
// went missing.
assert.ok(history.canUndo);
history.undo();
assert.equal(groom.seams.get(e0.a, e0.b), 0, 'undo brought the hard part back');

console.log('commit: all assertions passed');
console.log(`${history.depth} entries, busy=${history.busy}`);
