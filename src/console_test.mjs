/**
 * The debug console panel, against a minimal DOM.
 *
 * Two behaviours are worth pinning because both are easy to regress and both
 * make the log unusable when wrong: conditional autoscroll (a new line must
 * not yank you away from something you scrolled up to read) and duplicate
 * collapsing (combing emits the same line dozens of times).
 */
import assert from 'node:assert';

// --- minimal DOM ------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = { cssText: '' };
    this._text = '';
    this._listeners = {};
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 100;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get lastChild() { return this.children[this.children.length - 1]; }
  append(...kids) { for (const k of kids) this.appendChild(k); }
  appendChild(k) { this.children.push(k); k.parentNode = this; this.scrollHeight += 16; return k; }
  replaceChildren() { this.children.length = 0; this.scrollHeight = 0; }
  remove() {
    const p = this.parentNode;
    if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); p.scrollHeight -= 16; }
  }
  addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); }
  fire(t, e = {}) { for (const fn of this._listeners[t] ?? []) fn(e); }
}

global.document = {
  createElement: (t) => new El(t),
  body: new El('body'),
};

// Pull buildDebugConsole out of ui.js without importing lil-gui.
import { readFileSync } from 'node:fs';
const src = readFileSync('./ui.js', 'utf8');
const fnSrc = src.slice(src.indexOf('function buildDebugConsole() {'));
const buildDebugConsole = new Function(`${fnSrc}; return buildDebugConsole;`)();

const dbg = buildDebugConsole();
const panel = document.body.children[0];
const body  = panel.children[1];

// === 1. messages land as discrete rows =====================================
dbg.log('tool: comb');
dbg.log('comb: bar deleted');
assert.equal(body.children.length, 2, 'two messages, two rows');

// === 2. consecutive duplicates collapse into a counter =====================
// Forty copies of "selection: 3 facets" would otherwise push everything useful
// off the top of a 400-line buffer.
for (let i = 0; i < 5; i++) dbg.log('selection: 3 facets');
assert.equal(body.children.length, 3, 'five identical lines make one row');
const last = body.children[2];
assert.match(last.lastChild.textContent, /×5$/, 'and carry a count');

// A different message starts a new row again.
dbg.log('seam: set 1 edge(s) to 0');
assert.equal(body.children.length, 4);

// Non-consecutive repeats are NOT merged — the ordering is information.
dbg.log('selection: 3 facets');
assert.equal(body.children.length, 5, 'a repeat after something else is its own row');

// === 3. autoscroll follows only while pinned ===============================
// Enough rows to actually overflow the box — with content shorter than the
// viewport you are always legitimately "at the bottom", so a short log cannot
// exercise this at all.
for (let i = 0; i < 20; i++) dbg.log(`filler ${i}`);
assert.ok(body.scrollHeight > body.clientHeight, 'the log now overflows');

body.scrollTop = 0;                    // pretend the user scrolled up
body.fire('scroll');                   // panel recomputes `pinned` → false
dbg.log('tool: seam');
assert.equal(body.scrollTop, 0, 'a new line must NOT yank you back down');

// Scroll to the bottom again and it resumes following.
body.scrollTop = body.scrollHeight - body.clientHeight;
body.fire('scroll');
dbg.log('tool: pick');
assert.equal(body.scrollTop, body.scrollHeight, 'pinned again → follows');

// === 4. clear empties it and re-pins =======================================
dbg.clear();
assert.equal(body.children.length, 0);
dbg.log('after clear');
assert.equal(body.children.length, 1);
assert.equal(body.scrollTop, body.scrollHeight, 'clear re-pins to the bottom');

// === 5. the buffer is bounded ==============================================
for (let i = 0; i < 500; i++) dbg.log(`line ${i}`);
assert.ok(body.children.length <= 400, `bounded, got ${body.children.length}`);

console.log('console: all assertions passed');
console.log(`rows retained after 500 messages: ${body.children.length}`);
