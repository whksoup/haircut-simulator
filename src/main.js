/**
 * Haircut Simulator — entry point.
 *
 * Phase 0  : scaffold, empty groom round-trip.
 * Phase 1  : Raycast face selection (pure working set, no hair coupling).
 * Phase 1.5: Groom/HairStore merge, catalogue at load time.
 * Phase 2  : strand generation (CPU StrandGen).
 * GPU rev3 : renderer factory behind one interface, parented under the head.
 * R2       : per-facet SHAPE polyline replaces the comb bend vector.
 * R3       : GUIDE STRANDS. A few hundred authored curves; every render strand
 *            blends its 3 nearest. Facets decide where hair grows, guides
 *            decide what shape it is. The comb brush edits guides directly.
 * R3.1     : the work plane is gone. The comb is a finite capsule bar placed
 *            by two clicks on the head and dragged with a gizmo — bounded in
 *            every direction, so it can no longer reach through the skull.
 *
 * Two things this file owns that nothing else can:
 *
 *   GUIDE SEEDING — a v3 groom has facet shapes but no guides. Converting one
 *   needs facet centroids and normals, which live on the catalogue, which the
 *   data model deliberately can't see. So the v3→v4 conversion finishes here.
 *
 *   TOOL ARBITRATION — Raycast and CombTool both listen on pointerdown and
 *   both suspend OrbitControls. Exactly one may be live at a time, and
 *   setActiveTool is the only thing allowed to enable or disable either.
 *
 *   HISTORY RESTORE — history.js owns the stack; it deliberately cannot see
 *   Groom or the renderer. This file supplies the three closures that give a
 *   patch meaning, because this is the only place that holds both the model
 *   and every object that has to be told the model moved.
 */

import { Viewer }               from './viewer.js';
import { loadHead }             from './loadHead.js';
import { Groom }                from './groom.js';
import { History }              from './history.js';
import { buildUI }              from './ui.js';
import { Raycast }              from './raycast.js';
import { CombTool }             from './combTool.js';
import { GuideDebugView }       from './guideDebugView.js';
import { SeamOverlay }          from './seamOverlay.js';
import { SeamTool }             from './seamTool.js';
import { seedSeamsFromCreases } from './seams.js';
import { createStrandRenderer } from './renderer.js';

async function main() {
  const container = document.getElementById('app');
  const viewer    = new Viewer(container);
  const groom     = new Groom();

  const { root, groomTarget, isPlaceholder } = await loadHead();
  viewer.scene.add(root);
  viewer.frameObject(groomTarget);

  const catalogue = groomTarget.userData.catalogue ?? null;
  // Raycast takes the seam store so its grow/fill ops stop at authored parts.
  // It holds the reference forever, which is safe because SeamStore.copyFrom
  // is in place — same contract as GuideStore.
  const raycast   = new Raycast(viewer, groomTarget, groom.seams);

  // Guide-blend renderer. Flip kind to 'gpu' (R2) or 'cpu' to bisect problems.
  const renderer = createStrandRenderer({
    kind: 'guides', mesh: groomTarget, groom, guides: groom.guides,
  });
  // Parent under the head so its transform carries the strands and the shader's
  // modelViewMatrix gets it for free — strand data stays clean mesh-local space.
  groomTarget.add(renderer.object);

  // Debug view: a tiny sphere at every guide control point, root (warm) to tip
  // (cool). This is the ground truth the comb actually edits — the 200k
  // strands are just a blended reconstruction of it. sync() on guide add/
  // remove, refresh() on every comb edit (cheap: only the touched guides).
  const guideDebug = new GuideDebugView({ mesh: groomTarget, guides: groom.guides });

  // Seam overlay: the authored parting state, drawn on the scalp. Hidden by
  // default — it is an inspection tool, not part of the look. refresh() after
  // any seam edit; it rebuilds a few hundred line segments, which is cheaper
  // than maintaining an index.
  const seamOverlay = catalogue
    ? new SeamOverlay({ mesh: groomTarget, catalogue, seams: groom.seams })
    : null;
  if (seamOverlay) groomTarget.add(seamOverlay.object);

  /**
   * Edge selection + permeability editing. A peer of raycast and comb in
   * setActiveTool — exactly one owns the pointer.
   *
   * The history hooks use mark/commitMark rather than transact because the
   * permeability slider fires continuously: one snapshot per drag, taken
   * before the first tick. Seams go through the SNAPSHOT scope, not the cheap
   * guides scope — they change what the binder is allowed to blend, so undo
   * has to rebind, and a stroke-shaped patch would not express that.
   */
  const seamTool = catalogue
    ? new SeamTool({
        viewer, mesh: groomTarget, catalogue, seams: groom.seams,
        onSelectionChange: (ids) => {
          seamOverlay?.setSelection(ids);
          syncSeamSlider?.();
          refreshStats();
        },
        onEdit: () => { seamOverlay?.refresh(); refreshStats(); },
        onHover: (id) => seamOverlay?.setHover(id),
        onBeginEdit: () => history.mark('seams'),
        onEndEdit:   () => history.commitMark('seams', 'seam permeability'),
      })
    : null;

  // Per-frame growth ramp. growRate lives in `runtime` so the UI can drive it
  // without the renderer ever needing to know about the GUI.
  const runtime = { growRate: 0 };
  viewer.onUpdate((dt) => renderer.update(dt, runtime.growRate));

  // Forward-declared: the history restore path and the hair actions below all
  // need these, and buildUI needs those in turn. `let` rather than a const
  // destructure so nothing sits in the temporal dead zone.
  let gui = null;
  let refreshStats = () => {};
  let dbg = { log: () => {} };
  /** Set by buildUI so setActiveTool can push the overlay checkbox. */
  let syncOverlayToggle = null;
  /** Set by buildUI so a selection change can pull the slider to the new mean. */
  let syncSeamSlider = null;
  /** Set by buildUI so the Seams folder's edit toggle follows setActiveTool. */
  let syncSeamEditMode = null;

  // --- History --------------------------------------------------------------
  // Three closures are the whole contract with history.js. Keeping the restore
  // path here (rather than inside History) is what lets the cheap scope stay
  // cheap: a comb stroke undoes through setGuides, exactly the call the stroke
  // itself made, so reversing a sweep costs what the sweep cost.

  /** Whole-model patch. Structural edits only — see the history.js header. */
  const snapshot = () => ({ kind: 'snapshot', data: groom.toJSON() });

  /**
   * Guide-shape patch. `ids` null means every guide (the pre-stroke capture,
   * which commitStroke then narrows to what actually moved).
   *
   * `tangent` rides along because `reauthorTangent` rotates it, and since
   * g.points are expressed in the frame that tangent spans, restoring points
   * without it would put the shape back in the wrong basis.
   *
   * Float64, not Float32. The guide texture is float32 and the visual
   * difference is nil, but guide points are doubles on the CPU and the solver
   * runs in double — quantising on the way through history would mean
   * undo→redo does not return bitwise to where it started. Given how hard the
   * comb works for that property (see its header on resettling), it is not
   * worth trading away to halve 216 bytes per guide.
   */
  const captureGuides = (ids) => {
    const src = ids ? ids.map((id) => groom.guides.get(id)) : [...groom.guides.guides.values()];
    return {
      kind: 'guides',
      data: src.filter(Boolean).map((g) => ({
        id:      g.id,
        points:  Float64Array.from(g.points),
        tangent: Float64Array.from(g.tangent),
        length:  g.length,
      })),
    };
  };

  const restore = (patch) => {
    if (patch.kind === 'guides') {
      const ids = [];
      for (const rec of patch.data) {
        const live = groom.guides.get(rec.id);
        if (!live) continue;   // guide destroyed since; a later entry owns that
        for (let i = 0; i < rec.points.length; i++)  live.points[i]  = rec.points[i];
        for (let i = 0; i < rec.tangent.length; i++) live.tangent[i] = rec.tangent[i];
        live.length = rec.length;
        ids.push(rec.id);
      }
      renderer.setGuides(ids);
      guideDebug.refresh(ids);
      return;
    }
    // Structural. copyFrom mutates the GuideStore in place, so the comb, the
    // renderer and the debug view keep the reference they captured at
    // construction — see GuideStore.copyFrom.
    groom.copyFrom(Groom.fromJSON(patch.data));
    renderer.rebuild();        // already re-syncs guide rows and rebinds
    guideDebug.sync();
    seamOverlay?.refresh();    // seams ride the snapshot scope; see below
    // Edge ids are derived from the mesh, not the groom, so the selection is
    // still valid after a restore — but the values under it have moved, so the
    // slider has to be pulled back to the new mean or the next drag would
    // write a stale reading over the restored state.
    syncSeamSlider?.();
    refreshStats();
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  };

  const history = new History({ snapshot, captureGuides, restore });

  // --- Guides ---------------------------------------------------------------

  /**
   * Ensure a facet has at least one guide, rooted at its centroid and
   * inheriting the facet's length (and its vestigial v3 shape, if any).
   * Returns true if a guide was created.
   */
  function ensureGuideForFacet(facetId) {
    if (!catalogue) return false;
    if (groom.guides.byFacet(facetId).length > 0) return false;
    const entry = catalogue.getFacet(facetId);
    if (!entry) return false;
    const rec = groom.faces.get(facetId);
    groom.guides.add({
      facetId,
      root:   entry.centroid.toArray(),
      normal: entry.normal.toArray(),
      points: rec?.shape,
      length: rec?.length ?? groom.globals.length,
    });
    return true;
  }

  /** Finish a v3 → v4 conversion: facets with hair but no guides anywhere. */
  function seedGuidesIfEmpty() {
    if (!catalogue) return;
    if (groom.guides.count > 0 || groom.faces.size === 0) return;
    groom.guides.seedFromGroom(groom, catalogue);
  }

  // --- Hair actions on the current selection --------------------------------
  // Selection state lives in raycast; these read it and mutate hair. Selecting
  // or deselecting facets never calls these.

  // Both are wrapped in a history transaction. `transact` discards the entry
  // when the body returns false, so "add hair" over a fully-haired selection
  // leaves no empty step to press undo through.

  function addHairToSelection() {
    return history.transact('add hair', () => _addHairToSelection());
  }

  function removeHairFromSelection() {
    return history.transact('remove hair', () => _removeHairFromSelection());
  }

  function _addHairToSelection() {
    let guidesChanged = false;
    let touched = false;
    for (const facetId of raycast.selection) {
      if (groom.hasFacet(facetId)) continue;
      touched = true;
      groom.addFacet(facetId);
      guidesChanged = ensureGuideForFacet(facetId) || guidesChanged;
      renderer.updateFacet(facetId);
    }
    // updateFacet already rebound against the OLD guide list; if we also added
    // guides, one syncGuides at the end reassigns rows and rebinds once for
    // the whole batch rather than per facet.
    // Optional-chained: syncGuides exists only on the guide path, and flipping
    // `kind` back to 'gpu' or 'cpu' to bisect must stay a one-word change.
    if (guidesChanged) { renderer.syncGuides?.(); guideDebug.sync(); }
    refreshStats();
    return touched;   // false → history drops the entry
  }

  function _removeHairFromSelection() {
    let guidesChanged = false;
    let touched = false;
    for (const facetId of raycast.selection) {
      if (!groom.hasFacet(facetId)) continue;
      touched = true;
      guidesChanged = groom.guides.byFacet(facetId).length > 0 || guidesChanged;
      groom.removeFacet(facetId);   // also drops guides rooted on it
      renderer.removeFacet(facetId);
    }
    if (guidesChanged) { renderer.syncGuides?.(); guideDebug.sync(); }
    refreshStats();
    return touched;
  }

  // --- Selection ops --------------------------------------------------------
  // NOT in history. Selection is a pure working set (see raycast.js) — it is
  // not part of the groom, does not serialise, and putting it on the undo
  // stack would mean Ctrl+Z sometimes reverses a haircut and sometimes just
  // deselects something. Undo should only ever move the model.

  const selectionOps = {
    grow:   () => log(`grow: +${raycast.growSelection()} facet(s)`),
    shrink: () => log(`shrink: -${raycast.shrinkSelection()} facet(s)`),
    fill:   () => {
      const r = raycast.fillFromActive();
      log(r.added ? `fill: ${r.added} facet(s)${r.truncated ? ' (truncated)' : ''}`
                  : 'fill: click a facet first');
    },
    invert:    () => log(`invert: ${raycast.invertSelection()} facet(s)`),
    seamFaces: () => log(`seam facets: ${raycast.selectSeamFacets()}`),
  };

  /**
   * Arm two-click placement, guaranteeing the preconditions first.
   *
   * The comb tool must be ACTIVE before beginPlacement will do anything, and
   * wiring a panel button straight to comb.beginPlacement meant that if the
   * tool happened to be inactive the button silently did nothing. Routing
   * every caller through here makes "make me a new comb from two points" work
   * from any state, which is what the button claims.
   *
   * @returns {boolean}
   */
  function startCombPlacement() {
    if (!comb) return false;
    setActiveTool('comb');           // no-op if already active
    const replacing = comb.hasBar;
    if (!comb.beginPlacement()) { log('comb: could not start placement'); return false; }
    log(replacing
      ? 'comb: click 2 points to REPLACE the bar (Esc cancels)'
      : 'comb: click 2 points on the head (Esc cancels)');
    return true;
  }

  // --- Seams ----------------------------------------------------------------
  // Seams are STRUCTURAL as far as history is concerned: they change how the
  // binder is allowed to blend, so undoing one has to go through the snapshot
  // scope and a rebuild. That is the right cost — you author seams in a
  // handful of deliberate actions, not forty times a second like a comb
  // stroke, so the cheap guide scope buys nothing here and a second restore
  // path would be one more thing to get subtly wrong.

  /**
   * Mark every boundary sharper than `thresholdDeg` as a seam.
   *
   * Replaces the existing seam set by default. Seeding twice with different
   * thresholds should give the second threshold's answer, not the union — the
   * slider has to be explorable, and a monotonically growing set is not.
   */
  function seedSeams(opts = {}) {
    if (!catalogue) return false;
    return history.transact('seed seams', () => {
      const r = seedSeamsFromCreases(catalogue, groom.seams, opts);
      seamOverlay?.refresh();
      refreshStats();
      log(`seams: ${r.marked} marked of ${r.examined} edges (${r.hard} hard)`);
      // Nothing marked AND nothing cleared means nothing happened.
      return r.marked > 0 || (opts.keepExisting !== true && r.examined > 0);
    });
  }

  /**
   * Hand the facet selection to the seam tool as an edge selection: the border
   * of the region. This is the bridge between the two selection models —
   * select a region with the pick tool, switch to seams, and the parting
   * around it is already selected and ready for the slider.
   */
  function seamsFromFacetSelection() {
    if (!seamTool || raycast.selection.size === 0) return 0;
    const n = seamTool.selectBorderOfFacets(raycast.selection);
    setActiveTool('seam');
    log(`seams: selected ${n} border edge(s) from ${raycast.selection.size} facet(s)`);
    return n;
  }

  /**
   * Select the single edge between exactly two selected adjacent facets — the
   * "select two adjoining facets" half of the seam gesture.
   */
  function seamFromFacetPair() {
    if (!seamTool) return false;
    const sel = [...raycast.selection];
    if (sel.length !== 2) { log('seam: select exactly two adjacent facets'); return false; }
    const ok = seamTool.selectBetweenFacets(sel[0], sel[1]);
    if (!ok) { log(`seam: facets ${sel[0]} and ${sel[1]} are not adjacent`); return false; }
    setActiveTool('seam');
    log(`seam: selected the edge between ${sel[0]} and ${sel[1]}`);
    return true;
  }

  /** Wall off the current selection: every edge on its outline becomes hard. */
  function sealSelectionBorder(permeability = 0) {
    if (!catalogue || raycast.selection.size === 0) return false;
    return history.transact('seal selection border', () => {
      const eids = raycast.boundaryEdgesOfSelection();
      for (const eid of eids) {
        const e = catalogue.getEdge(eid);
        groom.seams.set(e.a, e.b, permeability);
      }
      seamOverlay?.refresh();
      refreshStats();
      log(`seams: sealed ${eids.length} border edge(s)`);
      return eids.length > 0;
    });
  }

  /** Reopen every boundary touching the selection. The eraser. */
  function openSelectionSeams() {
    if (!catalogue || raycast.selection.size === 0) return false;
    return history.transact('open seams', () => {
      let n = 0;
      for (const id of raycast.selection) {
        for (const eid of catalogue.edgesOfFacet(id)) {
          const e = catalogue.getEdge(eid);
          if (e.b < 0) continue;
          if (groom.seams.clear(e.a, e.b)) n++;
        }
      }
      seamOverlay?.refresh();
      refreshStats();
      log(`seams: opened ${n} edge(s)`);
      return n > 0;
    });
  }

  function clearAllSeams() {
    return history.transact('clear seams', () => {
      const n = groom.seams.count;
      if (n === 0) return false;
      groom.seams.clearAll();
      seamOverlay?.refresh();
      refreshStats();
      log(`seams: cleared ${n}`);
      return true;
    });
  }

  // --- Comb bar -------------------------------------------------------------
  // Two clicks on the head define a capsule; the gizmo then drags it through
  // the hair. The bar owns its own placement clicks and its own gizmo, so
  // there is no separate "plane" tool any more — selecting 'comb' is the whole
  // interaction. See the combTool.js header for why a bounded capsule replaced
  // the infinite cylinder.

  // onEdit fires many times per second while the gizmo moves. It rewrites
  // texture rows and NOTHING else: no resample, no rebind. That's the whole
  // reason combing stays interactive at 200k strands — see gpuHairR3.js.
  const comb = new CombTool({
    viewer,
    mesh:   groomTarget,
    guides: groom.guides,
    onEdit: (ids) => { renderer.setGuides(ids); guideDebug.refresh(ids); },
    // Mesh-local capsule for the shader-side pushout. Optional-chained: only
    // the guide renderer has it, and flipping `kind` to bisect must stay a
    // one-word change.
    onPose: (pose) => renderer.setComb?.(pose),
    // The undo unit is the whole drag, not the forty onEdit calls inside it.
    // beginStroke captures every guide's shape once (~44KB at 400 guides);
    // commitStroke throws away all but the ids reported here.
    onStrokeBegin: () => history.beginStroke(),
    onStrokeEnd:   (ids) => history.commitStroke('comb', ids),
  });

  // --- Tool arbitration -----------------------------------------------------
  // Raycast and the comb both want pointerdown and both want to suspend
  // OrbitControls. Exactly one may be live; this is the only place allowed to
  // enable or disable either. (The comb's placement clicks and its gizmo are
  // internally exclusive, so it counts as one tool, not two.)

  let activeTool = 'none';
  let log = () => {};   // replaced with the debug console once the UI exists
  function setActiveTool(next) {
    if (next === activeTool) return;
    if (activeTool === 'pick') raycast.disable();
    if (activeTool === 'comb') comb.disable();
    if (activeTool === 'seam') seamTool?.disable();
    activeTool = next;
    if (next === 'pick') raycast.enable();
    if (next === 'comb') comb.enable();
    if (next === 'seam') seamTool?.enable();
    // The seam overlay is the seam tool's viewport. Force it on entering the
    // tool — clicking edges you cannot see is not a workflow — but do not
    // force it off on leaving, since inspecting the parting while combing is
    // a reasonable thing to want.
    if (next === 'seam') { seamOverlay?.setVisible(true); syncOverlayToggle?.(); }
    // The Seams folder has its own edit toggle, and the tool can also be
    // switched from the Tools dropdown or a bridge button. Push the state so
    // the two controls cannot disagree about which tool owns the pointer.
    syncSeamEditMode?.();
    log(`tool: ${next}`);
  }

  /**
   * Drop the bar onto the last-picked facet, lying tangent to the scalp and
   * across the view. Salvaged from the old plane's 'tangent' preset: two
   * clicks is the normal path, but when a facet is already selected, one
   * button is faster and lands somewhere sensible.
   */
  function placeCombAtSelection() {
    if (!catalogue || raycast.activeFacetId < 0) return false;
    const entry = catalogue.getFacet(raycast.activeFacetId);
    if (!entry) return false;
    groomTarget.updateMatrixWorld();
    const point  = entry.centroid.clone().applyMatrix4(groomTarget.matrixWorld);
    const normal = entry.normal.clone()
      .transformDirection(groomTarget.matrixWorld).normalize();
    return comb.placeAtSurfacePoint(point, normal);
  }

  // --- UI -------------------------------------------------------------------

  ({ gui, refreshStats, dbg } = buildUI({
    groom,
    raycast,
    renderer,
    runtime,
    comb,
    guideDebug,
    history,
    seamOverlay,
    seamTool,
    startCombPlacement,
    selectionOps,
    seamsFromFacetSelection,
    seamFromFacetPair,
    setSyncHooks: (hooks) => {
      syncOverlayToggle = hooks.syncOverlayToggle ?? null;
      syncSeamSlider    = hooks.syncSeamSlider ?? null;
      syncSeamEditMode  = hooks.syncSeamEditMode ?? null;
    },
    seedSeams,
    sealSelectionBorder,
    openSelectionSeams,
    clearAllSeams,
    catalogue,
    placeCombAtSelection,
    setActiveTool,
    addHairToSelection,
    removeHairFromSelection,
    onLoad: (next) => {
      groom.copyFrom(next);
      seedGuidesIfEmpty();
      renderer.rebuild();
      guideDebug.sync();
      seamOverlay?.refresh();
      refreshStats();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      // A loaded file is a new baseline, not a step in the current session.
      // Keeping the stack would let undo walk backwards into a groom the user
      // has replaced — the entries would still apply, which is worse than if
      // they threw.
      history.clear();
      log('history cleared (loaded groom)');
    },
  }));

  log = (msg) => dbg.log(msg);

  // --- Escape ---------------------------------------------------------------
  // One key that backs out of whatever is currently in progress, ordered from
  // least to most destructive: leave the input field, then drop the edge
  // selection, then the facet selection, then the tool itself. Escape is what
  // people press when they feel stuck, so it should never cost more work than
  // it has to.
  //
  // Registered in the CAPTURE phase so it runs ahead of CombTool's own Escape
  // (which restores gizmo axes); that handler is on the canvas and only fires
  // when the canvas has focus, whereas typing in the panel means focus is in
  // the GUI — precisely when this is needed.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // 1. Step out of the permeability field, then out of the edge selection.
    const backedOut = seamTool?.cancel?.();
    if (backedOut) { log(`esc: ${backedOut}`); return; }

    // 2. Cancel an in-progress comb placement, or clear its axis isolation.
    //    CombTool handles this itself when the canvas has focus; calling it
    //    here covers the case where focus is in the panel.
    if (activeTool === 'comb' && comb?.hasBar === false) {
      comb.cancelPlacement?.();
        log('esc: cancelled comb placement');
      return;
    }

    // 3. Drop the facet selection.
    if (raycast.selection.size > 0) {
      raycast.clearSelection();
      log('esc: cleared facet selection');
      return;
    }

    // 4. Nothing in progress — step out of the active tool entirely.
    if (activeTool !== 'none') {
      setActiveTool('none');
      gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }, true);

  // --- Comb placement shortcut ----------------------------------------------
  // 'P' re-arms two-click placement from anywhere. The comb's own hotkeys are
  // bare letters handled on the canvas (W/E/Q/X/Y/Z), so this is registered
  // here alongside them and skips modifier chords for the same reason.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)) return;
    if (e.key.toLowerCase() !== 'p') return;
    e.preventDefault();
    startCombPlacement();
    gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  });

  // --- Undo shortcuts -------------------------------------------------------
  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. The comb's bare-letter axis hotkeys
  // ignore modifier chords (see CombTool._onKeyDown), so 'z' does not collide.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)) return;

    const k = e.key.toLowerCase();
    let want = null;
    if (k === 'z') want = e.shiftKey ? 'redo' : 'undo';
    else if (k === 'y') want = 'redo';
    if (!want) return;

    e.preventDefault();
    // Mid-gesture the model is between states and the pre-capture is still
    // open; undoing into that would record the half-finished pose as the
    // baseline. Refuse rather than guess.
    if (history.busy) { log('undo: busy (finish the stroke first)'); return; }

    const label = want === 'undo' ? history.undo() : history.redo();
    log(label ? `${want}: ${label}` : `nothing to ${want}`);
    refreshStats();
  });

  // Initial build (empty groom → nothing drawn, but rows and uniforms are set).
  seedGuidesIfEmpty();
  renderer.rebuild();
  guideDebug.sync();
  seamOverlay?.refresh();
  refreshStats();

  // --- Expose for console debugging ----------------------------------------
  Object.assign(window, {
    viewer, groom, groomTarget, catalogue, raycast, renderer, comb, guideDebug, runtime, history,
    seamOverlay, seamTool, seedSeams, sealSelectionBorder, openSelectionSeams, clearAllSeams,
    topology: () => catalogue?.topology,
    addHairToSelection, removeHairFromSelection, setActiveTool, placeCombAtSelection,
    stats: () => renderer.stats,
  });

  if (isPlaceholder) {
    document.getElementById('hud').innerHTML +=
      ' · <b style="color:#e0b15a">placeholder head — no strands until GLB loaded</b>';
  }
  if (!catalogue) {
    console.warn('[main] no facet catalogue — selection and guides are unavailable');
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById('hud').textContent = 'Error: ' + err.message;
});
