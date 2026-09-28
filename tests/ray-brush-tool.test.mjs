import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RayBrushTool } from '../src/tools/rayBrushTool.js';
import { GuideStore } from '../src/groom/guides.js';
import { History } from '../src/app/history.js';
import { auditGuideLengths } from '../src/hair/guideLengthAudit.js';

class Surface extends EventTarget {
  constructor() { super(); this.style = {}; this.captured = new Set(); }
  getBoundingClientRect() { return {left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000}; }
  setAttribute() {} remove() {}
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
function send(target, name, props = {}) {
  const e = new Event(name, {cancelable: true});
  Object.assign(e, {clientX: 400, clientY: 250, button: 0, buttons: 1, pointerId: 1, isPrimary: true}, props);
  target.dispatchEvent(e);
}
function fixture(perspective = false) {
  globalThis.window = new Surface(); globalThis.document = new Surface();
  document.createElement = () => new Surface(); document.body = {appendChild() {}};
  const canvas = new Surface();
  const camera = perspective ? new THREE.PerspectiveCamera(36.86989764584402, 1, 0.01, 10) : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.z = 3; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.2));
  const guides = new GuideStore();
  for (const [facetId, x, z] of [[1, 0, 0.2], [2, 0.12, 0.2], [1, 0, -0.3]]) guides.add({facetId,
    root: [x, 0, z], normal: [0, 1, 0], tangent: [1, 0, 0], length: z < 0 ? 0.1 : 1});
  const viewer = {camera, renderer: {domElement: canvas}, controls: {target: new THREE.Vector3(), enabled: true,
    _quat: new THREE.Quaternion(), _quatInverse: new THREE.Quaternion(), _sphericalDelta: new THREE.Spherical(), _panOffset: new THREE.Vector3()},
    onCameraChange: () => () => {}};
  const stats = {begins: 0, ends: 0, edits: []};
  const captureGuides = ids => ({kind: 'guides', data: guides.toJSON().filter(g => ids === null || ids.includes(g.id))});
  const history = new History({snapshot: () => ({kind: 'snapshot', data: guides.toJSON()}), captureGuides,
    restore: patch => patch.data.forEach(g => Object.assign(guides.guides.get(g.id), structuredClone(g)))});
  const tool = new RayBrushTool({viewer, mesh, guides, onEdit: ids => stats.edits.push(ids),
    onStrokeBegin: () => {stats.begins++; history.beginStroke();},
    onStrokeEnd: ids => {stats.ends++; history.commitStroke('Brush', ids);}});
  tool.setRadius(0.06); tool.setEnabled(true);
  const dispose = () => {tool.dispose(); mesh.geometry.dispose(); mesh.material.dispose();};
  return {tool, canvas, guides, viewer, stats, history, dispose};
}

test('hold brush authors selected visible guides only; hover/stationary and empty masks are no-ops', () => {
  for (const perspective of [false, true]) {
    const f = fixture(perspective); const {tool, canvas, guides, history, stats} = f;
    const original = JSON.stringify(guides.toJSON());
    send(canvas, 'pointermove'); send(canvas, 'pointerdown'); send(window, 'pointerup');
    assert.equal(JSON.stringify(guides.toJSON()), original); assert.equal(history.depth, 0);
    tool.setMask(new Set()); send(canvas, 'pointerdown'); send(canvas, 'pointermove', {clientX: 600}); send(window, 'pointerup');
    assert.equal(JSON.stringify(guides.toJSON()), original); assert.equal(history.depth, 0);
    const selection = new Set([1]); tool.setMask(selection); selection.clear();
    send(canvas, 'pointerdown'); send(canvas, 'pointermove', {clientX: 600}); send(window, 'pointerup');
    const after = JSON.stringify(guides.toJSON());
    assert.notEqual(after, original); assert.equal(history.depth, 1);
    const beforeRows = JSON.parse(original), afterRows = JSON.parse(after);
    assert.deepEqual(afterRows[1], beforeRows[1]); assert.deepEqual(afterRows[2], beforeRows[2]);
    assert.ok(stats.edits.flat().every(id => id === 1)); assert.ok(auditGuideLengths(guides).ok);
    history.undo(); assert.equal(JSON.stringify(guides.toJSON()), original);
    history.redo(); assert.equal(JSON.stringify(guides.toJSON()), after);
    assert.deepEqual(GuideStore.fromJSON(JSON.parse(after)).toJSON(), JSON.parse(after));
    send(canvas, 'pointermove', {clientX: 450, buttons: 1}); assert.equal(JSON.stringify(guides.toJSON()), after);
    f.dispose();
  }
});

test('1, 8, 64 delivered events yield identical authored curves and long jumps do not skip hair', () => {
  const runs = [];
  for (const n of [1, 8, 64]) {
    const f = fixture(); f.tool.setMask(new Set([1]));
    send(f.canvas, 'pointerdown');
    for (let i = 1; i <= n; i++) send(f.canvas, 'pointermove', {clientX: 400 + 200 * i / n});
    send(window, 'pointerup'); runs.push(f.guides.toJSON());
    assert.equal(f.history.depth, 1); f.dispose();
  }
  for (const rows of runs.slice(1)) rows.forEach((g, i) => g.points.forEach((v, k) => assert.ok(Math.abs(v - runs[0][i].points[k]) <= 1e-5)));
});

test('all owned interruptions finish once, leave no busy history and require a fresh press', () => {
  for (const kind of ['pointerleave', 'pointercancel', 'lostpointercapture', 'blur', 'hidden', 'escape', 'navigation', 'wheel', 'disable', 'app']) {
    const f = fixture(); send(f.canvas, 'pointerdown'); send(f.canvas, 'pointermove', {clientX: 510});
    if (kind === 'blur') send(window, 'blur');
    else if (kind === 'hidden') {document.hidden = true; send(document, 'visibilitychange');}
    else if (kind === 'escape') send(window, 'keydown', {key: 'Escape'});
    else if (kind === 'navigation') send(f.canvas, 'pointerdown', {button: 2});
    else if (kind === 'disable') f.tool.setEnabled(false);
    else if (kind === 'app') f.tool.finishEditing();
    else send(f.canvas, kind);
    const after = JSON.stringify(f.guides.toJSON());
    f.tool.finishEditing(); send(window, 'pointerup'); send(f.canvas, 'pointermove', {clientX: 600});
    assert.equal(f.stats.ends, 1, kind); assert.equal(f.tool.active, false, kind);
    assert.equal(f.history.busy, false, kind); assert.equal(f.viewer.controls.enabled, true, kind);
    assert.equal(JSON.stringify(f.guides.toJSON()), after, kind); f.dispose();
  }
});

test('canStyle prevents authored changes and dispose removes capture listeners', () => {
  const f = fixture(); f.tool.canStyle = () => false;
  send(f.canvas, 'pointerdown'); assert.equal(f.tool.active, false); assert.equal(f.stats.begins, 0);
  f.tool.canStyle = () => true; f.dispose();
  send(f.canvas, 'pointerdown'); assert.equal(f.stats.begins, 0);
});

test('capsule near cap cannot edit guides behind either camera or crossing its near plane', () => {
  for (const perspective of [false, true]) for (const z of [3.02, 2.995]) {
    const f = fixture(perspective);
    f.guides.guides.clear();
    f.guides.add({facetId: 1, root: [0, 0, z], normal: [0, 1, 0], tangent: [1, 0, 0], length: 0.02});
    const before = JSON.stringify(f.guides.toJSON());
    send(f.canvas, 'pointerdown', {clientX: 480, clientY: 500});
    send(f.canvas, 'pointermove', {clientX: 520, clientY: 500});
    send(window, 'pointerup');
    assert.equal(JSON.stringify(f.guides.toJSON()), before);
    assert.equal(f.history.depth, 0); f.dispose();
  }
});

test('cornered piecewise-linear strokes agree at 1, 8 and 64 subdivisions per leg', () => {
  const path = [[350, 250], [600, 250], [600, 175], [450, 175]], runs = [];
  for (const n of [1, 8, 64]) {
    const f = fixture();
    send(f.canvas, 'pointerdown', {clientX: path[0][0], clientY: path[0][1]});
    for (let leg = 1; leg < path.length; leg++) {
      const a = path[leg - 1], b = path[leg];
      for (let i = 1; i <= n; i++) send(f.canvas, 'pointermove', {
        clientX: a[0] + (b[0] - a[0]) * i / n, clientY: a[1] + (b[1] - a[1]) * i / n,
      });
    }
    send(window, 'pointerup');
    assert.equal(f.history.depth, 1); assert.ok(auditGuideLengths(f.guides).ok);
    runs.push(f.guides.toJSON()); f.dispose();
  }
  for (const rows of runs.slice(1)) rows.forEach((g, i) => g.points.forEach((v, k) => assert.ok(Math.abs(v - runs[0][i].points[k]) <= 1e-5)));
});

test('one long pointer jump edits every crossed guide region without skipped bands', () => {
  const f = fixture(); f.guides.guides.clear();
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) f.guides.add({
    facetId: 1, root: [x, 0, 0.2], normal: [0, 1, 0], tangent: [1, 0, 0], length: 1,
  });
  const before = f.guides.toJSON();
  send(f.canvas, 'pointerdown', {clientX: 150});
  send(f.canvas, 'pointermove', {clientX: 850});
  send(window, 'pointerup');
  const changedIds = new Set(f.stats.edits.flat());
  for (const [i, g] of [...f.guides.guides.values()].entries()) {
    assert.ok(changedIds.has(g.id), `region ${i} was contacted`);
    assert.ok(Math.max(...g.points.map((v, k) => Math.abs(v - before[i].points[k]))) >= 0.005, `region ${i} was usefully edited`);
    assert.deepEqual(g.points.slice(0, 3), before[i].points.slice(0, 3));
  }
  assert.equal(f.history.depth, 1); assert.ok(auditGuideLengths(f.guides).ok); f.dispose();
});

test('two-of-three facet mask usefully edits both selected guides and preserves exclusion through history and reload', () => {
  const f = fixture(); f.guides.guides.clear();
  for (const [facetId, x] of [[11, -0.3], [22, 0], [33, 0.3]]) f.guides.add({
    facetId, root: [x, 0, 0.2], normal: [0, 1, 0], tangent: [1, 0, 0], length: 1,
  });
  f.tool.setMask(new Set([11, 33]));
  const beforeRows = f.guides.toJSON(), before = JSON.stringify(beforeRows);
  send(f.canvas, 'pointerdown', {clientX: 300});
  send(f.canvas, 'pointermove', {clientX: 700});
  send(window, 'pointerup');
  const afterRows = f.guides.toJSON(), after = JSON.stringify(afterRows);
  for (const index of [0, 2]) {
    assert.ok(Math.max(...afterRows[index].points.map((v, k) => Math.abs(v - beforeRows[index].points[k]))) >= 0.005,
      `selected facet ${afterRows[index].facetId} receives a useful edit`);
  }
  assert.deepEqual(afterRows[1], beforeRows[1], 'excluded middle facet is bitwise unchanged despite intersecting the same sweep');
  assert.ok(f.stats.edits.flat().every(id => id !== beforeRows[1].id));
  assert.equal(f.history.depth, 1); assert.ok(auditGuideLengths(f.guides).ok);
  f.history.undo(); assert.equal(JSON.stringify(f.guides.toJSON()), before);
  f.history.redo(); assert.equal(JSON.stringify(f.guides.toJSON()), after);
  assert.equal(JSON.stringify(GuideStore.fromJSON(JSON.parse(after)).toJSON()), after);
  f.dispose();
});
