/**
 * The stuck-slider fix, tested against a FAKE lil-gui slider that reproduces
 * the actual failure: a widget which attaches a window mousemove on press and
 * only detaches it in its own window mouseup handler. If that mouseup never
 * arrives, the widget keeps tracking the cursor forever — which is exactly
 * what "sticky" looked like.
 */
import assert from 'node:assert';
import { buildFacetCatalogue } from './facetWireframe.js';
import { SeamStore } from './seams.js';
import { SeamTool } from './seamTool.js';

// --- minimal DOM ------------------------------------------------------------
class FakeTarget {
  constructor() { this._l = new Map(); }
  addEventListener(t, fn, opts) {
    const cap = opts === true || opts?.capture === true;
    const key = `${t}:${cap}`;
    if (!this._l.has(key)) this._l.set(key, []);
    this._l.get(key).push(fn);
  }
  removeEventListener(t, fn, opts) {
    const cap = opts === true || opts?.capture === true;
    const arr = this._l.get(`${t}:${cap}`);
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  dispatchEvent(e) {
    // Capture listeners first, then bubble — matching the real order that
    // makes a capture-phase listener immune to downstream stopPropagation.
    for (const phase of [true, false]) {
      for (const fn of [...(this._l.get(`${e.type}:${phase}`) ?? [])]) fn(e);
    }
    return true;
  }
  count(t, cap = false) { return (this._l.get(`${t}:${cap}`) ?? []).length; }
}

global.window = new FakeTarget();
global.document = { activeElement: null, body: {} };
global.MouseEvent = class { constructor(type) { this.type = type; } };
global.requestAnimationFrame = (fn) => { fn(); return 0; };

// --- the widget that gets stuck --------------------------------------------
// Faithful to lil-gui's NumberController slider: window listeners added on
// press, removed only by its own mouseup handler.
class StickySlider {
  constructor() {
    this.tracking = false;
    this.finished = 0;
    this._onMove = () => { this.moves++; };
    this._onUp = () => {
      this.tracking = false;
      this.finished++;
      window.removeEventListener('mousemove', this._onMove);
      window.removeEventListener('mouseup', this._onUp);
    };
    this.moves = 0;
  }
  press() {
    this.tracking = true;
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
  }
}

const warn = console.warn; console.warn = () => {};
const info = console.info; console.info = () => {};
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

const ev = { begin: 0, end: 0 };
const tool = new SeamTool({
  viewer: { renderer: { domElement: new FakeTarget() }, camera: null },
  mesh: null, catalogue: cat, seams: new SeamStore(),
  onBeginEdit: () => ev.begin++,
  onEndEdit:   () => ev.end++,
});

// === 1. the tool listens in the CAPTURE phase ==============================
// This is the load-bearing detail: a bubble-phase listener can be suppressed
// by a stopPropagation anywhere downstream, a capture-phase one cannot.
assert.equal(window.count('pointerup', true), 1, 'pointerup listener is capture-phase');
assert.equal(window.count('mouseup', true),   1, 'mouseup listener is capture-phase');
assert.equal(window.count('pointerup', false), 0, 'and nothing in the bubble phase');

// === 2. a stuck widget is released by a pointerup ==========================
const slider = new StickySlider();
slider.press();
tool.select([0]);
tool.setPermeability(0.5);          // opens the history transaction
assert.ok(tool._editing, 'edit is open');
assert.equal(slider.tracking, true, 'the widget is tracking the cursor');

// The real mouseup never arrives — only a pointerup does. This is the case
// that used to leave the slider live forever.
window.dispatchEvent({ type: 'pointerup' });

assert.equal(slider.tracking, false, 'the synthetic mouseup released the widget');
assert.equal(slider.finished, 1, 'and its finish handler ran exactly once');
assert.equal(window.count('mousemove'), 0, 'its move listener is detached');
assert.equal(ev.end, 1, 'and the history transaction closed');
assert.ok(!tool._editing);

// === 3. no infinite recursion from our own synthetic event =================
// The synthetic mouseup re-enters our capture listener; the guard must stop it.
const before = ev.end;
window.dispatchEvent({ type: 'pointerup' });
assert.ok(ev.end >= before, 'a second release does not blow the stack');

// === 4. a real mouseup does NOT get a duplicate synthetic one ==============
const slider2 = new StickySlider();
slider2.press();
window.dispatchEvent({ type: 'mouseup' });
assert.equal(slider2.finished, 1, 'a real mouseup finishes the widget once, not twice');

// === 5. Escape backs out one level at a time ===============================
const slider3 = new StickySlider();
slider3.press();
tool.select([0, 1]);
tool.setPermeability(0.3);
assert.ok(tool._editing);

// First Escape: release the slider. The selection must survive — Escape is
// what you press when something feels stuck, and it must not cost you work.
let msg = tool.cancel();
assert.match(msg, /slider/, 'first Escape releases the slider');
assert.equal(slider3.tracking, false, 'widget released');
assert.equal(tool.count, 2, 'the selection is untouched');

// Second Escape: now clear the selection.
msg = tool.cancel();
assert.match(msg, /selection/, 'second Escape clears the selection');
assert.equal(tool.count, 0);

// Third Escape: nothing left to do, and it says so rather than throwing.
assert.equal(tool.cancel(), null, 'third Escape is a no-op');

// === 6. dispose removes the capture listeners ==============================
tool.dispose();
assert.equal(window.count('pointerup', true), 0, 'listeners removed on dispose');
assert.equal(window.count('mouseup', true), 0);

console.log('release: all assertions passed');
