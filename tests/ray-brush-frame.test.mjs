import test from 'node:test';
import assert from 'node:assert/strict';
import { CombTool } from '../src/tools/combTool.js';
import { GuideStore } from '../src/groom/guides.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';

test('finite comb frame conversion retains exact root and historical scalp clamp', () => {
  const store = new GuideStore();
  const id = store.add({root: [2, 3, 4], normal: [0, 0, 1], tangent: [2, 0, 1], length: 2});
  const g = store.guides.get(id);
  const comb = Object.create(CombTool.prototype);
  comb._frm = {}; comb._local = new Float64Array(27);
  const f = comb._frame(g);
  comb._lift(g, f);
  assert.deepEqual([...comb._local.slice(0, 6)], [2, 3, 4, 2, 3, 4.25]);
  comb._local[0] = 99;
  comb._local[3] = 2.2; comb._local[4] = 3.4; comb._local[5] = 3.8;
  comb._writeBack(g, f);
  assert.deepEqual(g.points.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(g.points.slice(3, 6), [0.10000000000000009, 0.19999999999999996, 0]);
  assert.equal(auditGuideLengths(store).ok, false, 'historical post-solve scalp clamp can leave a length residual');
});
