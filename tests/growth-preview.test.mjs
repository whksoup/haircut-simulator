import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GpuHairR3 } from '../src/rendering/gpu/gpuHairR3.js';
import { Groom } from '../src/groom/groom.js';
import { makeHairMaterialR3 } from '../src/rendering/gpu/hairShaderGuides.js';

test('growth preview starts at the full fraction', () => {
  const material = makeHairMaterialR3();
  assert.equal(material.uniforms.uGrowthFraction?.value, 1, 'new material must render full growth at fraction 1');
  material.dispose();
});

test('fraction scrub preserves authored state and derived buffers across rebuilds', () => {
  const groom = new Groom();
  const hair = new GpuHairR3(new THREE.Mesh(new THREE.BufferGeometry()), groom, groom.guides);
  const before = groom.serialize();
  const texture = hair._shapeTex;
  const version = texture.version;
  assert.equal(hair.growthFraction, 1, 'renderer default must be full');
  for (const p of [0.75, 0.5, 0.25, 0, 1]) {
    hair.setGrowthFraction(p);
    assert.equal(hair.growthFraction, p);
    assert.equal(groom.serialize(), before);
    assert.equal(hair._shapeTex, texture);
    assert.equal(texture.version, version, 'scrubbing must not upload guide texture');
  }
  hair.setGrowthFraction(-5); assert.equal(hair.growthFraction, 0);
  hair.setGrowthFraction(3); assert.equal(hair.growthFraction, 1);
  for (const value of [NaN, Infinity, -Infinity, '0.5', null]) {
    assert.equal(hair.setGrowthFraction(value), false);
    assert.equal(hair.growthFraction, 1);
  }
  hair.setGrowthFraction(0.5); hair.rebuild();
  assert.equal(hair.growthFraction, 0.5);
  hair.dispose();
});

import { clipGrowthPrefix } from '../src/hair/growthPreview.js';
import { createGrowthPreview } from '../src/app/growthPreview.js';
import { History } from '../src/app/history.js';
import { CombTool } from '../src/tools/combTool.js';
import { ScissorsTool } from '../src/tools/scissorsTool.js';
import { SeamTool } from '../src/tools/seamTool.js';
const arc = (points) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - points[i][k])), 0);

test('arc prefix retains unequal segments, corners, repeated points, and the anchored root', () => {
  const full = [[2,3,4], [3,3,4], [3,3,4], [3,6,4], [3,6,6]];
  assert.deepEqual(clipGrowthPrefix(full, 0.5), [[2,3,4], [3,3,4], [3,3,4], [3,5,4], [3,5,4]]);
  assert.deepEqual(clipGrowthPrefix(full, 1), full);
  for (const p of [0, .01, 1/6-1e-8, 1/6, 1/6+1e-8, .25, .5, .75, .99, 1]) {
    const result = clipGrowthPrefix(full,p);
    assert.ok(Math.abs(arc(result)-p*arc(full)) < 1e-10);
    assert.deepEqual(result[0], full[0]);
    assert.ok(result.flat().every(Number.isFinite));
  }
  const degenerate = [[1,2,3], [1,2,3], [1,2,3]];
  assert.deepEqual(clipGrowthPrefix(degenerate,.5), degenerate);
  assert.deepEqual(clipGrowthPrefix(full,0), full.map(() => full[0]));
});

test('preview settles the current history unit once, locks styling, and never changes serialized state', () => {
  const groom = new Groom();
  let finishCalls = 0, uniform = 1;
  const history = new History({ snapshot: () => groom.serialize(), captureGuides: () => ({ data: [] }), restore: () => {} });
  const preview = createGrowthPreview({
    renderer: { setGrowthFraction: (p) => { uniform = p; return true; } },
    finishEditing: () => { finishCalls++; history.commitMark('density','density'); },
    isBusy: () => history.busy,
  });
  history.canStyle = preview.canStyle;
  history.mark('density'); groom.globals.density = 2;
  const authored = groom.serialize();
  assert.equal(preview.set(.5),true);
  assert.equal(finishCalls,1); assert.equal(history.depth,1);
  assert.equal(preview.canStyle(),false); assert.equal(uniform,.5);
  assert.equal(history.undo(),false);
  assert.equal(history.transact('illegal edit',() => { groom.globals.density=99; }),false);
  for(const p of [0,.25,.75,1]) assert.equal(preview.set(p),true);
  assert.equal(finishCalls,1); assert.equal(preview.canStyle(),true);
  assert.equal(groom.serialize(),authored); assert.equal(history.depth,1);
  for(const p of [NaN,Infinity,undefined,'0']) assert.equal(preview.set(p),false);
  assert.equal(preview.fraction,1);
});

test('unclosed gesture defers preview without changing fraction or uniform', () => {
  let uniform = 1;
  const preview = createGrowthPreview({ renderer: { setGrowthFraction: p => { uniform=p; } }, finishEditing: () => {}, isBusy: () => true });
  assert.equal(preview.set(.5),false);
  assert.equal(preview.fraction,1); assert.equal(uniform,1); assert.equal(preview.canStyle(),true);
});

test('tool and renderer action routes refuse authorship while preview is active', () => {
  const locked = { canStyle: () => false };
  for (const [prototype, methods] of [
    [CombTool.prototype, ['enable','beginPlacement','placeFromPoints','placeAtSurfacePoint','settle','_onObjectChange']],
    [ScissorsTool.prototype, ['enable','beginPlacement','placeFromPoints','placeAtSurfacePoint','cut','_onObjectChange']],
    [SeamTool.prototype, ['enable','beginEdit','setPermeability','clearPermeability']],
    [GpuHairR3.prototype, ['setLook','setSeamScale']],
  ]) for (const method of methods) assert.doesNotThrow(() => prototype[method].call(locked), `${method} must reject before touching live state`);
});

test('preview gesture finish preserves an open cut, closes it once, cancels placement and releases capture', () => {
  let edits=[7], commits=[], cancelled=0, released=[];
  const tool = Object.create(ScissorsTool.prototype);
  tool._cancelPlacement=() => cancelled++;
  tool.session={ get isOpen() { return edits !== null; }, end() { const ids=edits; edits=null; return ids; }, abort() { throw Error('preview must not restore cuts'); } };
  tool.onStrokeEnd=ids => commits.push(ids);
  tool._capturedPointer=23;
  tool.viewer={renderer:{domElement:{hasPointerCapture: () => true, releasePointerCapture: id => released.push(id)}}};
  tool._tc={pointerUp: () => tool._endStroke(), disconnect(){}, connect(){}};
  tool.finishEditing(); tool.finishEditing();
  assert.deepEqual(commits,[[7]]); assert.deepEqual(released,[23]); assert.equal(cancelled,2);
});
