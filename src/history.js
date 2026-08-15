/**
 * history.js — undo / redo transaction boundary.
 *
 * Knows nothing about Three.js, Groom, or the renderer. The host injects three
 * closures (snapshot / captureGuides / restore) and History owns only the
 * stack discipline: when a transaction opens, when it closes, what gets
 * coalesced into one entry, and what gets thrown away on a new edit.
 *
 * WHY TWO PATCH KINDS AND NOT ONE
 *
 * A comb stroke is the common edit and it must undo as cheaply as it applied.
 * The comb rewrites `points` on a handful of guides and the renderer answers
 * with `setGuides(ids)` — a few texture rows, no resample, no rebind. If undo
 * went through a whole-Groom snapshot it would answer with rebuild(), which
 * resamples 200k roots and re-runs the binder: three orders of magnitude more
 * work than the edit it is reversing, for a stroke that touched twelve guides.
 *
 * So patches are scoped, and there are exactly two scopes:
 *
 *   { kind: 'guides', data: [{ id, points, tangent, length }] }
 *       Guide SHAPE changed, guide SET did not. Restores with setGuides.
 *       This is comb strokes, and later the cut tool.
 *
 *   { kind: 'snapshot', data: <groom.toJSON()> }
 *       Anything structural — hair added or removed, guides created or
 *       destroyed, globals, masterSeed, file load. Restores with copyFrom +
 *       rebuild. Expensive, but these edits were already expensive.
 *
 * Resist adding a third. The temptation will be a 'faces' scope for slider
 * drags; a slider drag already coalesces to ONE entry (see mark/commitMark),
 * so the cost is one rebuild per drag, not per frame, and that is fine. A
 * third scope buys little and doubles the number of restore paths that can be
 * subtly wrong.
 *
 * RE-ENTRY. `_muted` is set while a patch is being applied so that anything
 * the restore path touches — a renderer callback, a UI refresh that writes
 * back through a controller — cannot record a new entry and corrupt the stack.
 * Every recording method checks it first.
 *
 * THE THREE WAYS TO OPEN A TRANSACTION, and when each is right:
 *
 *   transact(label, fn)          The edit is synchronous and self-contained.
 *                                Snapshots either side of fn. Return false
 *                                from fn to discard (nothing actually changed).
 *
 *   mark(key) / commitMark(key)  The edit is a DRAG: many mutations, one
 *                                logical change. mark() on the first
 *                                mutation is idempotent, so wiring it to
 *                                lil-gui's onChange costs one snapshot per
 *                                drag; commitMark() on onFinishChange closes
 *                                it. Typed-in values fire both and still
 *                                produce exactly one entry.
 *
 *   beginStroke() / commitStroke(label, ids)
 *                                The edit is a comb stroke: a drag whose
 *                                touched set is unknown until it ends.
 *                                beginStroke captures every guide's shape
 *                                (~110 bytes each — 44KB at 400 guides, one
 *                                allocation per drag, invisible); commitStroke
 *                                narrows that to the ids the tool reports and
 *                                discards the rest.
 */

/** Entries kept before the oldest is dropped. Snapshots dominate the memory. */
export const HISTORY_LIMIT = 100;

export class History {
  /**
   * @param {object} o
   * @param {() => object} o.snapshot
   *        Build a 'snapshot' patch of the whole model right now.
   * @param {(ids: number[]|null) => object} o.captureGuides
   *        Build a 'guides' patch for these guide ids, or all of them if null.
   * @param {(patch: object) => void} o.restore
   *        Write a patch back into the model and refresh whatever it implies.
   *        Called with _muted set, so it may freely touch anything.
   * @param {() => void} [o.onChange]  fired whenever the stacks move.
   * @param {number} [o.limit]
   */
  constructor({ snapshot, captureGuides, restore, onChange = null, limit = HISTORY_LIMIT }) {
    this._snapshot      = snapshot;
    this._captureGuides = captureGuides;
    this._restore       = restore;
    this.onChange       = onChange;
    this.limit          = limit;

    /** @type {{label:string, before:object, after:object}[]} */
    this._undo = [];
    /** @type {{label:string, before:object, after:object}[]} */
    this._redo = [];

    /** Open drag transactions, keyed so several can be in flight. */
    this._marks = new Map();

    /** Pre-stroke capture of every guide, held for the duration of a stroke. */
    this._stroke = null;

    /** True while a patch is being applied — blocks all recording. */
    this._muted = false;
  }

  // --- state ----------------------------------------------------------------

  get canUndo()   { return this._undo.length > 0; }
  get canRedo()   { return this._redo.length > 0; }
  get undoLabel() { return this._undo.length ? this._undo[this._undo.length - 1].label : null; }
  get redoLabel() { return this._redo.length ? this._redo[this._redo.length - 1].label : null; }
  get depth()     { return this._undo.length; }
  /** True if any transaction is open. Callers should refuse to undo mid-edit. */
  get busy()      { return this._muted || this._stroke !== null || this._marks.size > 0; }

  // --- recording ------------------------------------------------------------

  /** Record a completed change. Both patches must already be built. */
  push(label, before, after) {
    if (this._muted || !before || !after) return;
    this._undo.push({ label, before, after });
    if (this._undo.length > this.limit) this._undo.shift();
    this._redo.length = 0;    // a new edit invalidates the redo tail
    this._changed();
  }

  /**
   * Snapshot, run, snapshot, record. `fn` returning exactly `false` means
   * "nothing changed" and the entry is dropped — cheaper and more honest than
   * deep-comparing two snapshots to find out.
   */
  transact(label, fn) {
    if (this._muted) return fn();
    const before = this._snapshot();
    const result = fn();
    if (result === false) return result;
    this.push(label, before, this._snapshot());
    return result;
  }

  /**
   * Open a coalescing transaction if one isn't already open for `key`.
   * Idempotent by design: call it on every mutation of a drag and you get one
   * snapshot, taken before the first of them.
   */
  mark(key) {
    if (this._muted || this._marks.has(key)) return;
    this._marks.set(key, this._snapshot());
  }

  /** Close a coalescing transaction. No-op if `key` was never marked. */
  commitMark(key, label) {
    const before = this._marks.get(key);
    if (!before) return;
    this._marks.delete(key);
    this.push(label, before, this._snapshot());
  }

  /** Abandon a coalescing transaction without recording it. */
  dropMark(key) { this._marks.delete(key); }

  /** Begin a comb stroke: capture every guide's shape. */
  beginStroke() {
    if (this._muted) return;
    this._stroke = this._captureGuides(null);
  }

  /**
   * Close a comb stroke, keeping only the guides the tool actually edited.
   * An empty `ids` means the stroke moved nothing — no entry.
   */
  commitStroke(label, ids) {
    const before = this._stroke;
    this._stroke = null;
    if (!before || !ids || ids.length === 0) return;
    const keep = new Set(ids);
    const narrowed = { kind: 'guides', data: before.data.filter((g) => keep.has(g.id)) };
    if (narrowed.data.length === 0) return;
    this.push(label, narrowed, this._captureGuides(ids));
  }

  /** Abandon a stroke without recording it (tool disabled mid-drag, etc). */
  abortStroke() { this._stroke = null; }

  // --- traversal ------------------------------------------------------------

  undo() {
    if (!this.canUndo) return false;
    const entry = this._undo.pop();
    this._apply(entry.before);
    this._redo.push(entry);
    this._changed();
    return entry.label;
  }

  redo() {
    if (!this.canRedo) return false;
    const entry = this._redo.pop();
    this._apply(entry.after);
    this._undo.push(entry);
    this._changed();
    return entry.label;
  }

  /** Drop everything. Call after a file load that establishes a new baseline. */
  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
    this._marks.clear();
    this._stroke = null;
    this._changed();
  }

  // --- internals ------------------------------------------------------------

  _apply(patch) {
    this._muted = true;
    try { this._restore(patch); }
    finally { this._muted = false; }
  }

  _changed() { this.onChange?.(this); }
}
