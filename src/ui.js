/**
 * UI — prototype controls (lil-gui).
 *
 * Model:
 *   - ONE active tool at a time (none / pick / comb / scissors / seam). The
 *     dropdown is the only thing that changes it, and it goes through main.js's
 *     setActiveTool — every one of those tools grabs pointerdown and suspends
 *     OrbitControls, so letting two run at once means a click selects a facet
 *     AND drops a comb endpoint.
 *   - "Add hair to selection" / "Remove hair from selection" apply hair to
 *     whatever is currently selected. Selection alone never creates hair.
 *   - Globals sliders: edits write to selected hair-bearing facets and
 *     regenerate their strands; the global default updates too (future adds).
 *   - Comb folder: placement first (two clicks on the head is the primary
 *     gesture), then the bar's dimensions, then gizmo behaviour. Radius and
 *     length are properties rather than gizmo scale — a scaled object would
 *     make the capsule maths lie about its own size.
 *   - Scissors folder: the same shape as Comb, because it is the same gesture
 *     on a tool that removes length instead of moving it. It is deliberately
 *     SHORTER — a blade has no strength, no root stiffness and no solver
 *     iterations, because a cut is a truncation and not a solve.
 *   - Look folder: clump / jitter / length variation. These are pure shader
 *     uniforms — no rebuild, no rebind, no resample. Drag them freely.
 *   - Growth folder: drives the renderer's growth ramp.
 *   - masterSeed change → full rebuild.
 *   - UNDO AND SLIDERS. Every controller that mutates the groom uses BOTH
 *     hooks: onChange mutates and renders live, onFinishChange closes one
 *     history entry. Recording in onChange would give you an undo step per
 *     pointermove; recording only in onFinishChange without marking first
 *     would capture a "before" that is already the after. history.mark() is
 *     idempotent, so calling it on every onChange costs one snapshot per drag
 *     and correctly brackets typed-in values too, which fire both hooks once.
 *
 *     The Look and Growth folders are NOT in history: they are pure shader
 *     uniforms and live nowhere in the serialised groom, so there is nothing
 *     for a patch to restore. Same reasoning as the comb's own settings.
 *
 * BUILD ORDER IS LOAD-BEARING, AND FAILS SILENTLY WHEN IT IS WRONG.
 *
 *   buildUI is one long function that constructs folders top to bottom. An
 *   exception anywhere in it aborts the rest of the build — every folder BELOW
 *   the throw simply never gets added, with no error in the panel and nothing
 *   visibly broken about the folders that did make it. The symptom is
 *   indistinguishable from "that feature was never wired up": the Comb folder
 *   was fully implemented, and CombTool exposed clearBar/beginPlacement, but
 *   the panel showed no comb controls at all because the build died upstream
 *   in Seams.
 *
 *   The specific trap is the three sync closures (syncSeamSlider,
 *   syncSeamEditMode, syncOverlayToggle). They are ASSIGNED inside the Seams
 *   folder and CONSUMED by main.js via setSyncHooks, so they must be declared
 *   in the enclosing scope. They were declared with `let` down beside the Info
 *   folder — lexically after the code that assigns them — which puts the
 *   assignment inside the temporal dead zone and throws
 *   "Cannot access 'syncSeamSlider' before initialization" the moment the
 *   Seams folder calls syncSeamSlider() at the end of its setup. `let` does
 *   not hoist its initialisation the way a `function` declaration does, so
 *   this is not the forgiving pattern it looks like.
 *
 *   They are therefore declared at the TOP of buildUI, before any folder is
 *   built. If you add another cross-folder closure, declare it there too.
 *
 *   Scissors sits directly after Comb and BEFORE Seams for the same reason
 *   Comb was moved up: Seams is the largest block of code in the build, and a
 *   throw in it must not be able to take a primary tool down with it.
 *
 * The R2 "Comb (GPU)" folder is gone: bend-X / bend-Z authored one shape per
 * facet, which the guide model supersedes. The Plane folder is gone too — the
 * work plane no longer exists; the comb bar carries its own gizmo.
 */

import GUI from 'lil-gui';
import { Groom } from './groom.js';

/**
 * @param {object}   opts
 * @param {Groom}    opts.groom
 * @param {Function} opts.onLoad
 * @param {Function} [opts.addHairToSelection]
 * @param {Function} [opts.removeHairFromSelection]
 * @param {Function} [opts.setActiveTool]           'none' | 'pick' | 'comb' | 'scissors' | 'seam'
 * @param {Function} [opts.placeCombAtSelection]    () => boolean
 * @param {Function} [opts.placeScissorsAtSelection] () => boolean
 * @param {Function} [opts.cutAtBlade]              () => number
 * @param {import('./combTool.js').CombTool} [opts.comb]
 * @param {import('./scissorsTool.js').ScissorsTool} [opts.scissors]
 * @param {import('./guideDebugView.js').GuideDebugView} [opts.guideDebug]
 * @param {import('./history.js').History} [opts.history]
 * @param {import('./seamOverlay.js').SeamOverlay} [opts.seamOverlay]
 * @param {import('./seamTool.js').SeamTool} [opts.seamTool]
 * @param {import('./facetWireframe.js').FacetCatalogue} [opts.catalogue]
 * @param {object}   [opts.selectionOps]  grow / shrink / fill / invert / seamFaces
 * @param {Function} [opts.seedSeams]
 * @param {Function} [opts.sealSelectionBorder]
 * @param {Function} [opts.openSelectionSeams]
 * @param {Function} [opts.clearAllSeams]
 * @param {{growRate:number}} [opts.runtime]
 * @param {import('./raycast.js').Raycast} [opts.raycast]
 * @param {object}   [opts.renderer]
 */
export function buildUI({
  groom, onLoad, raycast, renderer, runtime, comb, scissors, guideDebug, history,
  seamOverlay, seamTool, selectionOps, catalogue,
  startCombPlacement, startScissorsPlacement, cutAtBlade,
  seamsFromFacetSelection, seamFromFacetPair, setSyncHooks,
  seedSeams, sealSelectionBorder, openSelectionSeams, clearAllSeams,
  setActiveTool, placeCombAtSelection, placeScissorsAtSelection,
  addHairToSelection, removeHairFromSelection,
}) {
  const gui = new GUI({ title: 'Groom' });

  // --- cross-folder sync closures -------------------------------------------
  // DECLARED FIRST, DELIBERATELY. The Seams folder assigns these; main.js's
  // setActiveTool and the history restore path call them through setSyncHooks.
  // Declaring them further down (they used to sit beside the Info folder) puts
  // the Seams assignment in the temporal dead zone, which throws and silently
  // truncates the rest of the panel — see the header.
  let syncSeamSlider    = () => {};
  let syncSeamEditMode  = () => {};
  let syncOverlayToggle = () => {};

  // --- File -----------------------------------------------------------------
  // FOLDER STATE IS DELIBERATE. lil-gui opens every folder by default, and
  // once Seams grew to three sub-folders the panel ran off the bottom of the
  // screen — Globals, Growth and Look were still there, just below the fold,
  // which reads exactly like they were deleted. Anything used every session
  // (Tools, Globals, Growth) stays open; everything else is collapsed so its
  // TITLE is always visible and it is one click away.
  const file = gui.addFolder('File');
  const actions = {
    save: () => downloadJSON(groom.serialize(), 'groom.json'),
    load: () =>
      pickJSON((text) => {
        try {
          const next = Groom.deserialize(text);
          onLoad?.(next);
          refreshStats();
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
        } catch (e) {
          // The loader names the record and the field it choked on — see
          // schemaGuards.js. Passing e.message through verbatim is the whole
          // point of it doing that.
          console.error('[UI] failed to load groom:', e);
          alert('Could not load groom: ' + e.message);
        }
      }),
  };
  file.add(actions, 'save').name('Save groom (.json)');
  file.add(actions, 'load').name('Load groom (.json)');

  // --- Edit -----------------------------------------------------------------
  // Buttons mirror Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (bound in main.js). The
  // labels carry the pending entry's name so the stack is legible without a
  // separate panel — "Undo comb" reads very differently from "Undo remove
  // hair" when you are three strokes deep and unsure what you just did. It
  // matters more now that "Undo cut" is in the vocabulary and is the one entry
  // you cannot reconstruct by hand.
  if (history) {
    const edit = gui.addFolder('Edit');
    const editActions = {
      undo: () => { const l = history.undo(); if (l) dbg.log(`undo: ${l}`); refreshStats(); },
      redo: () => { const l = history.redo(); if (l) dbg.log(`redo: ${l}`); refreshStats(); },
    };
    edit.close();
    const cUndo = edit.add(editActions, 'undo').name('Undo');
    const cRedo = edit.add(editActions, 'redo').name('Redo');

    history.onChange = (h) => {
      cUndo.name(h.canUndo ? `Undo ${h.undoLabel}` : 'Undo');
      cRedo.name(h.canRedo ? `Redo ${h.redoLabel}` : 'Redo');
      cUndo.enable(h.canUndo);
      cRedo.enable(h.canRedo);
    };
    history.onChange(history);
  }

  file.close();

  // --- Tools ----------------------------------------------------------------
  const tools = gui.addFolder('Tools');
  const toolState = { tool: 'none' };

  // Captured: the seam bridges below call setActiveTool('seam') directly, and
  // the dropdown has to follow or it lies about which tool owns the pointer.
  const toolCtrl = tools
    .add(toolState, 'tool', ['none', 'pick', 'comb', 'scissors', 'seam'])
    .name('Active tool')
    .onChange((v) => setActiveTool?.(v));

  if (raycast) {
    const hairActions = {
      addHair:    () => { addHairToSelection?.();     refreshStats(); },
      removeHair: () => { removeHairFromSelection?.(); refreshStats(); },
      clearSel:   () => { raycast.clearSelection(); },
    };
    tools.add(hairActions, 'addHair').name('Add hair to selection');
    tools.add(hairActions, 'removeHair').name('Remove hair from selection');
    tools.add(hairActions, 'clearSel').name('Clear selection');

    raycast.onSelect          = (facetId) => dbg.log(`click facet ${facetId}`);
    raycast.onSelectionChange = (sel) => {
      stats.selected = sel.size;
      dbg.log(`selection: ${sel.size} facet${sel.size !== 1 ? 's' : ''}`);
    };
  }

  // --- Globals --------------------------------------------------------------
  // Density and length apply to the SELECTION when there is one, and set the
  // default for new facets otherwise.
  const globals = gui.addFolder('Globals');

  function makeParamSlider(folder, key, min, max, step) {
    folder.add(groom.globals, key, min, max, step)
      .onChange((value) => {
        history?.mark(`globals.${key}`);   // idempotent: one snapshot per drag
        groom.globals[key] = value;

        const sel = raycast?.selection;
        if (sel && sel.size > 0) {
          for (const facetId of sel) {
            const rec = groom.faces.get(facetId);
            if (rec) {
              rec[key] = value;
              renderer?.updateFacet(facetId);
            }
          }
        }
      })
      .onFinishChange(() => history?.commitMark(`globals.${key}`, key));
  }

  makeParamSlider(globals, 'density', 0, 4, 0.01);
  makeParamSlider(globals, 'length',  0, 0.5, 0.001);

  globals.add(groom, 'masterSeed', 0, 99999, 1)
    .onChange(() => {
      history?.mark('masterSeed');
      renderer?.rebuild();
    })
    .onFinishChange(() => history?.commitMark('masterSeed', 'master seed'));

  // --- Growth ---------------------------------------------------------------
  const growth = gui.addFolder('Growth');
  if (runtime) growth.add(runtime, 'growRate', 0, 1, 0.01).name('grow rate /s');
  growth.add({ reset: () => renderer?.setGrowth?.(0) }, 'reset').name('Reset to 0 (grow in)');
  growth.add({ grown: () => renderer?.setGrowth?.(1) }, 'grown').name('Set fully grown');

  // --- Look -----------------------------------------------------------------
  const look = gui.addFolder('Look');
  const lookState = { clump: 1.0, jitter: 0.0, lenVar: 0.0 };
  const pushLook = () => renderer?.setLook?.({ ...lookState });
  look.add(lookState, 'clump',  1, 32,  0.1).name('clump').onChange(pushLook);
  look.add(lookState, 'jitter', 0, 0.2, 0.001).name('tip jitter').onChange(pushLook);
  look.add(lookState, 'lenVar', 0, 0.5, 0.01).name('length variation').onChange(pushLook);

  look.close();

  // --- Comb -----------------------------------------------------------------
  // MOVED ABOVE SEAMS. Order in this function is order in the panel, and the
  // comb is a primary tool while Seams is three folders of authoring detail —
  // burying the comb's create/delete buttons under all of it meant scrolling
  // past a collapsed-but-still-tall section to reach the control you press
  // most. It also puts the comb ahead of the largest block of code in the
  // build, so a future throw in Seams cannot take the comb down with it.
  //
  // The bar is placed by two clicks on the head while the comb tool is active;
  // everything here is either a way to re-place it or a property of the shape.
  // Gizmo hotkeys while the comb is active: W translate, E rotate, Q world/
  // local, X/Y/Z isolate an axis, Esc restore all axes (or cancel a placement).
  //
  // Wheel = radius, Shift+wheel = strength, both live during a gesture.
  //
  // A parked bar ejects nothing — it only pushes hair while it MOVES. "Settle"
  // applies one eject at the current pose for when you want the opposite.
  if (comb) {
    const cf = gui.addFolder('Comb');

    // --- Create / delete ----------------------------------------------------
    // Both halves spelled out, and the status line says which state you are
    // in. The comb is a persistent prop in the scene, so "is there a bar right
    // now, and how do I get rid of it" has to be answerable from the panel
    // without looking at the viewport.
    const place = {
      // A GETTER, not a stored string. Placement completes inside CombTool on
      // the second click, with nothing to notify the panel — a cached value
      // would sit on "click 2 points" forever after the bar appeared. lil-gui
      // re-reads the property every frame under .listen(), so a getter is
      // always right without any notification path at all.
      get status() {
        if (comb.isPlacing) return 'click 2 points on the head';
        return comb.hasBar ? 'placed' : 'none';
      },
      // Routed through main.js's startCombPlacement, which activates the tool
      // first. Calling comb.beginPlacement directly silently did nothing
      // whenever the comb tool happened to be inactive.
      //
      // Works whether or not a bar already exists: two fresh points REPLACE
      // the current one, so there is no delete-first step.
      create: () => {
        startCombPlacement?.();
        toolState.tool = 'comb';
        toolCtrl.updateDisplay();
      },
      atFacet:  () => {
        if (placeCombAtSelection?.()) dbg.log('comb: placed at selected facet');
        else dbg.log('comb: no facet selected');
      },
      // Deleting re-arms placement (see CombTool.clearBar), so this doubles as
      // a "start over" that always leaves you able to place a new bar.
      remove: () => {
        if (comb.clearBar()) dbg.log('comb: bar deleted — click 2 points for a new one');
        else dbg.log('comb: no bar to delete');
        toolState.tool = 'comb';
        toolCtrl.updateDisplay();
      },
      settle:   () => comb.settle(),
    };

    cf.add(place, 'status').name('comb bar').disable().listen();
    cf.add(place, 'create').name('New comb — set 2 points  [P]');
    cf.add(place, 'atFacet').name('New comb at selected facet');
    cf.add(place, 'remove').name('Delete comb');
    cf.add(place, 'settle').name('Settle at current pose');

    // --- Patch mask ---------------------------------------------------------
    // Top level, not buried in the sub-folder, and with a permanently visible
    // status line. A mask makes the comb correctly refuse to move hair, which
    // from the viewport is indistinguishable from a broken comb — so the one
    // thing this must never be is quiet. Same reasoning as the bar's own
    // status line above.
    //
    // The mask is taken from the CURRENT selection at the moment you press the
    // button, and copied (see CombTool.setMask). Selecting needs the pick
    // tool, so the flow is: pick → select facets → comb → Mask to selection.
    const mask = {
      get status() {
        const n = comb.maskSize;
        return n ? `${n} facet(s) — pushout off` : 'off — combs everywhere';
      },
      set: () => {
        if (raycast.selection.size === 0) {
          dbg.log('comb: nothing selected — pick facets first, then mask');
          return;
        }
        const n = comb.setMask(raycast.selection);
        dbg.log(`comb: masked to ${n} facet(s) — render pushout off while masked`);
      },
      clear: () => {
        if (comb.maskSize) dbg.log('comb: mask cleared — combs everywhere again');
        comb.clearMask();
      },
    };

    cf.add(mask, 'status').name('patch mask').disable().listen();
    cf.add(mask, 'set').name('Mask to selection');
    cf.add(mask, 'clear').name('Clear mask');

    // --- Bar shape and gizmo ------------------------------------------------
    // Sub-folder, collapsed. Nine controllers of instrument tuning sat between
    // the comb buttons and everything below them; the four buttons above are
    // what you touch per stroke, these are what you touch once a session.
    const cs = cf.addFolder('Bar shape & gizmo');
    const cstate = {
      radius:  comb.radius,
      length:  comb.length,
      visible: true,
      mode:    'translate',
      space:   'local',
      snapPos: 0,
      snapRot: 0,
    };

    cs.add(cstate, 'radius', 0.005, 0.4, 0.001).name('radius').listen()
      .onChange((v) => comb.setRadius(v));
    cs.add(cstate, 'length', 0.01, 1.0, 0.005).name('bar length')
      .onChange((v) => comb.setLength(v));
    cs.add(comb, 'strength', 0.05, 1, 0.01).name('strength').listen();
    cs.add(comb, 'rootRamp', 0,    4, 0.1).name('root stiffness');

    // 'none' collides without preserving length, which is a diagnostic rather
    // than a mode: strands stretch under the correction, phase more easily
    // next stroke, and `aT` stops being arc length — which silently
    // invalidates every cut and every rewind reading. More iterations = tighter
    // length under contact.
    cs.add(comb, 'constrain', ['length', 'none']).name('length constraint');
    cs.add(comb, 'iterations', 1, 16, 1).name('solver iterations');
    cs.add(comb, 'settleIterations', 0, 256, 8).name('stroke-end relax');
    cs.add(comb, 'reauthorTangent').name('re-author flow tangent');

    // Gizmo scale is deliberately absent: radius and length are the truth.
    cs.add(cstate, 'visible').name('show bar').onChange((v) => comb.setVisible(v));
    cs.add(cstate, 'mode', ['translate', 'rotate'])
      .name('gizmo mode').onChange((v) => comb.setMode(v));
    cs.add(cstate, 'space', ['local', 'world'])
      .name('gizmo space').onChange((v) => comb.setSpace(v));
    const pushSnap = () =>
      comb.setSnap({ translate: cstate.snapPos, rotateDeg: cstate.snapRot });
    cs.add(cstate, 'snapPos', 0, 0.1, 0.005).name('snap move').onChange(pushSnap);
    cs.add(cstate, 'snapRot', 0, 45,  5).name('snap rotate (deg)').onChange(pushSnap);
    cs.close();

    // --- Length invariant readout -------------------------------------------
    // The one number in this panel that is not about the instrument. It says
    // whether `aT` is still arc length — which is what the cut and the (later)
    // rewind both read. It is a property of the GROOM, not of the comb, and it
    // lives here only because the comb is what usually breaks it.
    const audit = {
      status: 'not measured',
      check: () => {
        const a = comb.lengthResidual();
        audit.status = a.ok
          ? `holds (worst ${(a.maxRel * 100).toFixed(3)}%)`
          : `VIOLATED on ${a.failing} guide(s), worst ${(a.maxRel * 100).toFixed(2)}%`;
        dbg.log(`length invariant: ${audit.status}`);
      },
    };
    cf.add(audit, 'status').name('aT is arc length').disable().listen();
    cf.add(audit, 'check').name('Check length invariant');
    cf.close();
  }

  // --- Scissors -------------------------------------------------------------
  // Same gesture as the comb, opposite effect: the blade removes length rather
  // than moving it. Placed directly after Comb so the two bar tools read as a
  // pair, and before Seams so a throw down there cannot hide either.
  //
  // TWO THINGS THIS PANEL HAS TO SAY OUT LOUD, because both are destructive
  // and neither is visible from the viewport:
  //
  //   THE BLADE IS BORN ABOVE THE HAIR, not tangent to the scalp like the
  //   comb. A blade placed at the roots would shave the head on the first
  //   drag. You push it down into the hair.
  //
  //   CUTTING IS NOT REVERSIBLE BY CUTTING. Undo works (a cut is one history
  //   entry, same cheap guides scope as a comb stroke), but dragging the blade
  //   back out restores nothing — a cut composes by minimum, which is what
  //   scissors do. The status line says how much is currently at stake.
  if (scissors) {
    const sf = gui.addFolder('Scissors');

    const place = {
      get status() {
        if (scissors.isPlacing) return 'click 2 points on the head';
        return scissors.hasBar ? 'placed — drag it into the hair' : 'none';
      },
      create: () => {
        startScissorsPlacement?.();
        toolState.tool = 'scissors';
        toolCtrl.updateDisplay();
      },
      atFacet: () => {
        if (placeScissorsAtSelection?.()) dbg.log('scissors: blade placed above the selected facet');
        else dbg.log('scissors: no facet selected');
      },
      remove: () => {
        if (scissors.clearBar()) dbg.log('scissors: blade deleted');
        else dbg.log('scissors: no blade to delete');
        toolState.tool = 'scissors';
        toolCtrl.updateDisplay();
      },
      // The precise gesture, and the one that does not require being good at
      // dragging a gizmo: park the blade where the hair should end, press cut.
      cut: () => { cutAtBlade?.(); },
      // Read-only preview of the same thing, for when you want to know what a
      // press would do before you press it. A destructive tool should be able
      // to answer that.
      preview: () => {
        const d = scissors.diagnose();
        dbg.log(`scissors: ${d.verdict}`);
      },
    };

    sf.add(place, 'status').name('blade').disable().listen();
    sf.add(place, 'create').name('New blade — set 2 points  [P]');
    sf.add(place, 'atFacet').name('New blade over selected facet');
    sf.add(place, 'remove').name('Delete blade');
    sf.add(place, 'cut').name('CUT at current pose');
    sf.add(place, 'preview').name('What would this cut?');

    // --- Patch mask ---------------------------------------------------------
    // Same contract as the comb's, and more valuable here: the mistake a mask
    // prevents on a blade is one you cannot undo by re-cutting.
    const mask = {
      get status() {
        const n = scissors.maskSize;
        return n ? `${n} facet(s)` : 'off — cuts everywhere';
      },
      set: () => {
        if (raycast.selection.size === 0) {
          dbg.log('scissors: nothing selected — pick facets first, then mask');
          return;
        }
        dbg.log(`scissors: confined to ${scissors.setMask(raycast.selection)} facet(s)`);
      },
      clear: () => {
        if (scissors.maskSize) dbg.log('scissors: mask cleared — cuts everywhere again');
        scissors.clearMask();
      },
    };
    sf.add(mask, 'status').name('patch mask').disable().listen();
    sf.add(mask, 'set').name('Mask to selection');
    sf.add(mask, 'clear').name('Clear mask');

    // --- Blade shape and gizmo ----------------------------------------------
    // Far fewer knobs than the comb, and that is the point: a cut is a
    // truncation, not a solve. There is no strength (a blade either reaches a
    // strand or it does not), no root stiffness, and no iteration count.
    const ss = sf.addFolder('Blade shape & gizmo');
    const sstate = {
      radius: scissors.radius,
      length: scissors.length,
      visible: true,
      mode: 'translate',
      space: 'local',
    };
    // Thickness is the cut's fuzziness — the blade cuts at its NEAR face, so a
    // fat blade cuts shorter than its centre line suggests.
    ss.add(sstate, 'radius', 0.002, 0.1, 0.001).name('blade thickness').listen()
      .onChange((v) => scissors.setRadius(v));
    ss.add(sstate, 'length', 0.01, 1.0, 0.005).name('blade length')
      .onChange((v) => scissors.setLength(v));
    // Not cosmetic: #3's loader rejects a guide of length <= 0 and history's
    // structural restore runs through it, so a cut to zero would make its own
    // undo throw. Shaving to the scalp is a guide REMOVAL, a different edit.
    ss.add(scissors, 'minLength', 0.001, 0.05, 0.001).name('min length (never cut past)');
    ss.add(sstate, 'visible').name('show blade').onChange((v) => scissors.setVisible(v));
    ss.add(sstate, 'mode', ['translate', 'rotate'])
      .name('gizmo mode').onChange((v) => scissors.setMode(v));
    ss.add(sstate, 'space', ['local', 'world'])
      .name('gizmo space').onChange((v) => scissors.setSpace(v));
    ss.close();
    sf.close();
  }

  // --- Select ---------------------------------------------------------------
  // Topological selection, backed by the catalogue's adjacency graph. Clicking
  // facets one at a time stops scaling somewhere around thirty of them, which
  // is well under the size of a hair region — these are what make a
  // facet-resolution selection usable.
  //
  // None of it is in history: selection is a working set, not model state, and
  // an undo that sometimes reverses a haircut and sometimes just deselects
  // something is worse than no undo.
  if (selectionOps) {
    const sel = gui.addFolder('Select');
    sel.add(selectionOps, 'grow').name('Grow (+1 ring)');
    sel.add(selectionOps, 'shrink').name('Shrink (−1 ring)');
    // Fill respects hard seams, so with the hairline seeded this is
    // "select the scalp" from one click inside it.
    sel.add(selectionOps, 'fill').name('Fill from last click');
    sel.add(selectionOps, 'invert').name('Invert');
    sel.add(selectionOps, 'seamFaces').name('Select seam facets');
    sel.close();
  }

  // --- Seams ----------------------------------------------------------------
  // Permeability across a facet boundary: 1 blends freely, 0 is a hard part,
  // in between is a fade.
  //
  // LAYOUT IS LOAD-BEARING HERE. There are TWO selections in play and they are
  // easy to confuse: the seam tool owns a set of EDGES, while the pick tool
  // owns a set of FACETS. An earlier flat layout put "Seal selection border"
  // (facets) directly above the permeability slider (edges), which read as if
  // the button were how you select a seam. Every control below therefore names
  // its input explicitly, and the direct-manipulation path sits at the top,
  // ahead of every bulk shortcut.
  if (seamOverlay || seedSeams) {
    const sf = gui.addFolder('Seams');

    // --- Direct manipulation: click an edge, pull the slider ----------------
    if (seamTool) {
      const edge = {
        // The affordance the whole feature hangs off. Without a control here,
        // edge clicking is only reachable via Tools > Active tool, which is a
        // different folder and does not mention seams.
        editMode: false,
        addMode: false,
        hint: 'turn on Edit seams, then click an edge',
        selected: 'none',
        permeability: '1.00',
      };

      const cEdit = sf.add(edge, 'editMode').name('Edit seams (click edges)')
        .onChange((v) => {
          setActiveTool?.(v ? 'seam' : 'none');
          toolState.tool = v ? 'seam' : 'none';
          toolCtrl.updateDisplay();
        });

      // A visible toggle instead of a held modifier. Modifier state is
      // invisible and the click means something different depending on it;
      // a checkbox you can see is the whole point.
      sf.add(edge, 'addMode').name('Add to selection')
        .onChange((v) => { seamTool.addMode = v; });

      // Reads as a caption, not a control. lil-gui has no label widget, so a
      // disabled string field is the honest approximation.
      const cHint = sf.add(edge, 'hint').name(' ').disable().listen();
      const cSel  = sf.add(edge, 'selected').name('edge selection').disable().listen();

      // WAS AN HONESTY LINE saying seams were display-only. They are not any
      // more: guideBinding.js spends permeability as extra distance through
      // seamField.js, so this value now moves hair. Kept as a caption because
      // what it affects is still worth stating — a seam changes which guides a
      // strand may BLEND, so its effect is visible only where the two sides
      // are combed differently. Author a part across uniformly-combed hair and
      // nothing appears to happen, correctly.
      sf.add({ note: 'blend across the boundary — needs guides on both sides' }, 'note')
        .name('affects').disable();

      // PERMEABILITY IS A TEXT FIELD, NOT A SLIDER.
      //
      // lil-gui's slider attaches its mousemove/mouseup handlers to `window`
      // on press and removes them only inside its own mouseup handler. When
      // that mouseup goes missing — and in this app it reliably does — the
      // move handler stays attached and the control keeps following the
      // cursor after the button is up. Two rounds of trying to force it to
      // let go (blurring, synthetic mouseup at window, capture-phase
      // listeners) did not fix it, so the control is gone instead.
      //
      // Declaring the property as a STRING is the load-bearing detail: for a
      // string, lil-gui builds a plain <input type="text"> with no pointer
      // handlers whatsoever. A number controller — even without min/max, so
      // without a slider track — still binds drag-to-scrub on the field and
      // would have the same class of problem. There is now no drag machinery
      // to get stuck, which is a stronger guarantee than any amount of
      // defensive cleanup.
      //
      // Commit on Enter or on blur (both are lil-gui's onFinishChange for a
      // string), parse, clamp, write once.
      const cPerm = sf.add(edge, 'permeability')
        .name('permeability (0–1, Enter)')
        .onFinishChange((raw) => {
          if (seamTool.count === 0) { syncSeamSlider(); return; }
          const v = parseFloat(String(raw).trim());
          if (!Number.isFinite(v)) {
            // Reject rather than guess. Writing 0 for unparseable input would
            // silently hard-part every selected edge, which is the most
            // destructive value in the range.
            dbg.log(`seam: "${raw}" is not a number — unchanged`);
            syncSeamSlider();
            return;
          }
          const p = Math.min(Math.max(v, 0), 1);
          const n = seamTool.setPermeability(p);
          dbg.log(`seam: set ${n} edge(s) to ${p}`);
          syncSeamSlider();
          refreshStats();
        });

      // The three values that actually get used, as one-click buttons. Typing
      // is precise but slow, and "hard part" / "half" / "blended" is most of
      // the real vocabulary.
      const presets = {
        hard:  () => applyPreset(0),
        half:  () => applyPreset(0.5),
        open:  () => applyPreset(1),
      };
      function applyPreset(p) {
        if (seamTool.count === 0) { dbg.log('seam: select an edge first'); return; }
        const n = seamTool.setPermeability(p);
        dbg.log(`seam: set ${n} edge(s) to ${p}`);
        syncSeamSlider();
        refreshStats();
      }
      sf.add(presets, 'hard').name('→ 0    hard part');
      sf.add(presets, 'half').name('→ 0.5  soft fade');
      sf.add(presets, 'open').name('→ 1    fully blended');

      // --- Selecting edges --------------------------------------------------
      // Sub-folder so the slider above stays adjacent to the selection readout
      // it summarises, rather than being pushed down by eight buttons.
      const es = sf.addFolder('Select edges');
      const pick = {
        loop:   () => { seamTool.selectLoop(); dbg.log(`seam loop: ${seamTool.count} edges`); },
        grow:   () => { seamTool.growSelection(); dbg.log(`seam grow: ${seamTool.count} edges`); },
        all:    () => { seamTool.selectAllSeams(); dbg.log(`selected ${seamTool.count} seam edge(s)`); },
        none:   () => seamTool.clearSelection(),
        fromFacets: () => { seamsFromFacetSelection?.(); edge.editMode = true; cEdit.updateDisplay(); toolState.tool = 'seam'; toolCtrl.updateDisplay(); },
        fromPair:   () => { seamFromFacetPair?.();       edge.editMode = true; cEdit.updateDisplay(); toolState.tool = 'seam'; toolCtrl.updateDisplay(); },
        reopen: () => {
          // clearPermeability commits its own history entry — see _commit.
          const n = seamTool.clearPermeability();
          dbg.log(`seam: reopened ${n} edge(s)`);
          syncSeamSlider();
          refreshStats();
        },
      };
      es.add(pick, 'loop').name('Extend to whole loop');
      es.add(pick, 'grow').name('Grow along loop');
      es.add(pick, 'all').name('All existing seams');
      es.add(pick, 'none').name('Deselect');
      // These two cross over from the FACET selection — named so it is obvious
      // which selection each one reads.
      es.add(pick, 'fromFacets').name('Border of facet selection');
      es.add(pick, 'fromPair').name('Between 2 selected facets');
      es.add(pick, 'reopen').name('Reopen selected edges (→1)');
      es.close();

      /**
       * Pull the slider to the selection's current mean.
       *
       * Called on every selection change and after an undo. Writing
       * `edge.permeability` directly and calling updateDisplay is deliberate:
       * going through the controller's setValue would fire onChange and write
       * the value straight back over the selection, so merely SELECTING a run
       * would flatten it to its own mean.
       */
      syncSeamSlider = () => {
        const n = seamTool.count;
        edge.permeability = seamTool.meanPermeability().toFixed(2);
        edge.selected = n === 0 ? 'none'
          : `${n} edge${n === 1 ? '' : 's'}${seamTool.isMixed() ? ' (mixed)' : ''}`;
        edge.hint = !seamTool.enabled ? 'turn on Edit seams, then click an edge'
          : n === 0 ? 'click any edge — the nearest one wins'
          : 'type a value + Enter, or use a preset below';
        cPerm.updateDisplay();
        cSel.updateDisplay();
        cHint.updateDisplay();
        cEdit.updateDisplay();
        cPerm.enable(n > 0);
      };
      // setActiveTool may switch tools from elsewhere (the Tools dropdown, or
      // a bridge button), so the checkbox has to be able to follow.
      syncSeamEditMode = () => {
        edge.editMode = seamTool.enabled;
        cEdit.updateDisplay();
        syncSeamSlider();
      };
      syncSeamSlider();
    }

    // --- Generate from creases ----------------------------------------------
    const gen = sf.addFolder('Generate from creases');
    const seed = {
      thresholdDeg: 40,
      softnessDeg:  15,
      // Hair parts along valleys (behind the ear, under the jaw) far more
      // often than along ridges (brow, crown), so concave is the default even
      // though 'both' is the obvious behaviour.
      mode:         'concave',
      keepExisting: false,
      run: () => {
        seedSeams?.({
          thresholdDeg: seed.thresholdDeg,
          softness:     seed.softnessDeg,
          mode:         seed.mode,
          keepExisting: seed.keepExisting,
        });
        refreshStats();
      },
    };
    gen.add(seed, 'thresholdDeg', 5, 120, 1).name('crease angle (deg)');
    gen.add(seed, 'softnessDeg',   0,  60, 1).name('falloff (deg)');
    gen.add(seed, 'mode', ['concave', 'convex', 'both']).name('crease type');
    gen.add(seed, 'keepExisting').name('layer onto existing');
    gen.add(seed, 'run').name('Seed seams');
    gen.close();

    // --- Bulk edits driven by the FACET selection ---------------------------
    // Every control in here reads raycast.selection (facets), NOT the seam
    // tool's edge selection. Collapsed by default and named accordingly, so
    // it stops presenting itself as the way to pick a seam.
    const bulk = sf.addFolder('From facet selection');
    const manual = {
      seal:  () => { sealSelectionBorder?.(0);   refreshStats(); },
      soften:() => { sealSelectionBorder?.(0.5); refreshStats(); },
      open:  () => { openSelectionSeams?.();     refreshStats(); },
      clear: () => { clearAllSeams?.();          refreshStats(); },
    };
    bulk.add(manual, 'seal').name('Seal its border (→0)');
    bulk.add(manual, 'soften').name('Soften its border (→0.5)');
    bulk.add(manual, 'open').name('Reopen its seams (→1)');
    bulk.add(manual, 'clear').name('Clear ALL seams');
    bulk.close();

    // How hard a soft seam bites: a multiplier on the per-edge step cost, so
    // it scales fades and leaves hard parts hard (those are removed from the
    // graph, not made expensive). A BINDER CONSTANT, not model state — it does
    // not serialise and is not in history, same reasoning as the Look folder.
    //
    // onFinishChange ONLY, deliberately: each change is a full rebind
    // (O(strands)), which is nowhere near a drag budget. There is no
    // mark/commitMark pair here for the same reason there is none in Look —
    // nothing in the groom moved, so there is nothing for a patch to restore.
    const tune = { seamScale: 3 };
    sf.add(tune, 'seamScale', 0, 12, 0.5).name('seam falloff strength')
      .onFinishChange((v) => renderer?.setSeamScale?.(v));

    if (seamOverlay) {
      const ov = { show: seamOverlay.visible };
      const cOv = sf.add(ov, 'show').name('Show seam overlay')
        .onChange((v) => seamOverlay.setVisible(v));
      // setActiveTool forces the overlay on when entering the seam tool; this
      // keeps the checkbox honest about it.
      syncOverlayToggle = () => { ov.show = seamOverlay.visible; cOv.updateDisplay(); };
    }

    // Topology readout. A closed head should be chi 2 with zero boundary
    // edges; anything else means the weld missed and the adjacency contains
    // phantom borders that will block blending. Worth being able to see
    // without opening the console.
    if (catalogue?.topology) {
      const t = catalogue.topology;
      const topo = {
        summary: `V${t.vertices} E${t.edges} F${t.facets} chi=${t.euler}` +
                 (t.closed ? ' closed' : ` OPEN(${t.boundaryEdges})`),
      };
      sf.add(topo, 'summary').name('mesh topology').disable();
    }

    sf.close();
  }

  // --- Debug ------------------------------------------------------------------
  // Ground-truth view of what the comb actually edits: a sphere per control
  // point, root (warm) to tip (cool). Toggle off once you trust the blend.
  if (guideDebug) {
    const dbgF = gui.addFolder('Debug');
    const dstate = { visible: true, size: guideDebug.radius };
    dbgF.add(dstate, 'visible').name('show control points')
      .onChange((v) => guideDebug.setVisible(v));
    dbgF.add(dstate, 'size', 0.0005, 0.02, 0.0005).name('point size')
      .onChange((v) => guideDebug.setRadius(v));
    dbgF.close();
  }

  // --- Info -----------------------------------------------------------------
  const info = gui.addFolder('Info');

  const stats = {
    selected: 0, seamEdges: 0, hairFaces: 0, guides: 0, seams: 0,
    strands: 0, undoDepth: 0, shortestGuide: 0, longestGuide: 0,
  };
  info.add(stats, 'selected').disable().listen();
  info.add(stats, 'seamEdges').disable().listen();
  info.add(stats, 'hairFaces').disable().listen();
  info.add(stats, 'guides').disable().listen();
  info.add(stats, 'seams').disable().listen();
  info.add(stats, 'strands').disable().listen();
  info.add(stats, 'undoDepth').disable().listen();
  // The two numbers a cut moves. Without them the only evidence a cut happened
  // is the render, and a cut that clamped to minLength or missed the mask
  // entirely looks identical to one that did nothing.
  info.add(stats, 'shortestGuide').disable().listen();
  info.add(stats, 'longestGuide').disable().listen();
  info.close();

  function refreshStats() {
    const s = groom.stats;
    stats.hairFaces = s.hairFaces;
    stats.guides    = s.guides;
    stats.seams     = s.seams ?? 0;
    stats.seamEdges = seamTool?.count ?? 0;
    stats.selected  = raycast?.selection.size ?? 0;
    stats.strands   = renderer?.stats?.strands ?? 0;
    stats.undoDepth = history?.depth ?? 0;

    let lo = Infinity, hi = 0;
    for (const g of groom.guides.guides.values()) {
      if (g.length < lo) lo = g.length;
      if (g.length > hi) hi = g.length;
    }
    stats.shortestGuide = Number.isFinite(lo) ? +lo.toFixed(4) : 0;
    stats.longestGuide  = +hi.toFixed(4);
  }
  refreshStats();

  // --- Debug console --------------------------------------------------------
  // Hand the sync closures to main.js: setActiveTool needs to push the overlay
  // checkbox, and the history restore path needs to pull the slider back to
  // the restored mean.
  setSyncHooks?.({ syncSeamSlider, syncSeamEditMode, syncOverlayToggle });

  const dbg = buildDebugConsole();

  return { gui, refreshStats, dbg };
}

// ---------------------------------------------------------------------------

function downloadJSON(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickJSON(cb) {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = 'application/json,.json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader  = new FileReader();
    reader.onload = () => cb(String(reader.result));
    reader.readAsText(f);
  };
  input.click();
}

/**
 * The debug log, as a small chat window in the bottom-left corner.
 *
 * It used to be a right-aligned block of text with `pointer-events: none`,
 * which had one decisive problem: you could not scroll it. Forty lines went in
 * and thirty-nine went past — and this log is the only feedback channel for
 * half the app (every tool state change, every seam edit, every count), so
 * "what did that button just say" was unanswerable a second later.
 *
 * So it takes pointer events now, and everything else follows from that:
 *
 *   POINTER EVENTS ARE SCOPED TO THE PANEL, not to the wrapper. The wrapper is
 *   `pointer-events: none` and only the panel turns them back on, so the
 *   corner outside the box still orbits the camera. A full-height transparent
 *   wrapper that swallowed drags would be a much worse trade than the one it
 *   was making before.
 *
 *   AUTOSCROLL IS CONDITIONAL. Sticking to the bottom is right until the
 *   moment someone scrolls up to read, at which point yanking them back down
 *   on the next log line is the single most annoying thing a console can do.
 *   `_pinned` tracks whether the view is within a few pixels of the bottom and
 *   only then follows; scrolling back down re-arms it.
 *
 *   REPEATS COALESCE. Dragging a slider or sweeping a selection emits the same
 *   line many times, which used to push everything else out of a 40-line
 *   buffer in about a second. Identical consecutive messages get a ×N badge
 *   instead of a new row, so the history above survives the spam.
 *
 * The buffer is 200 lines rather than 40 because it is scrollable now, and
 * still capped because this thing runs for hours.
 */
function buildDebugConsole({ max = 200 } = {}) {
  /** @type {{text:string, count:number, time:string, el:HTMLElement}[]} */
  const rows = [];
  let pinned = true;
  let collapsed = false;

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position: fixed',
    'left: 12px',
    'bottom: 12px',
    'z-index: 9999',
    'width: 328px',
    'max-width: calc(100vw - 24px)',
    'display: flex',
    'flex-direction: column',
    'font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    // The corner outside the box keeps orbiting the camera; only the panel
    // itself takes the pointer back.
    'pointer-events: none',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'pointer-events: auto',
    'display: flex',
    'flex-direction: column',
    'overflow: hidden',
    'border-radius: 8px',
    'border: 1px solid rgba(255,255,255,0.07)',
    'background: rgba(16,18,23,0.82)',
    '-webkit-backdrop-filter: blur(8px)',
    'backdrop-filter: blur(8px)',
    'box-shadow: 0 8px 24px rgba(0,0,0,0.35)',
  ].join(';');

  // --- title bar ------------------------------------------------------------
  const bar = document.createElement('div');
  bar.style.cssText = [
    'display: flex',
    'align-items: center',
    'gap: 8px',
    'padding: 5px 8px',
    'background: rgba(255,255,255,0.04)',
    'border-bottom: 1px solid rgba(255,255,255,0.06)',
    'color: #6f7788',
    'letter-spacing: 0.04em',
    'text-transform: uppercase',
    'font-size: 10px',
    'user-select: none',
    'cursor: pointer',
  ].join(';');

  const title = document.createElement('span');
  title.textContent = 'log';
  title.style.flex = '1';

  const mkButton = (label, tip, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = tip;
    b.style.cssText = [
      'all: unset',
      'cursor: pointer',
      'padding: 0 4px',
      'color: #6f7788',
      'font: inherit',
      'border-radius: 3px',
    ].join(';');
    b.onmouseenter = () => { b.style.color = '#c8d0dd'; };
    b.onmouseleave = () => { b.style.color = '#6f7788'; };
    // Buttons live inside the bar, and the bar toggles collapse on click.
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    return b;
  };

  const chevron = document.createElement('span');
  chevron.textContent = '▾';
  const clearBtn = mkButton('clear', 'Clear the log', () => api.clear());

  bar.append(title, clearBtn, chevron);
  bar.onclick = () => setCollapsed(!collapsed);

  // --- message list ---------------------------------------------------------
  const list = document.createElement('div');
  list.style.cssText = [
    'overflow-y: auto',
    'overflow-x: hidden',
    'max-height: 30vh',
    'min-height: 0',
    'padding: 6px 8px',
    'color: #96a0b1',
    'scrollbar-width: thin',
    'overscroll-behavior: contain',   // don't chain the scroll to the page
  ].join(';');

  // Re-arm autoscroll only when the view is back at the bottom.
  list.addEventListener('scroll', () => {
    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
  });

  panel.append(bar, list);
  wrap.append(panel);
  document.body.appendChild(wrap);

  function setCollapsed(v) {
    collapsed = v;
    list.style.display = v ? 'none' : 'block';
    chevron.textContent = v ? '▸' : '▾';
    if (!v) { pinned = true; follow(); }
  }

  function follow() {
    if (pinned) list.scrollTop = list.scrollHeight;
  }

  function stamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:` +
           `${String(d.getMinutes()).padStart(2, '0')}:` +
           `${String(d.getSeconds()).padStart(2, '0')}`;
  }

  /** One row: time, message, and a ×N badge once it repeats. */
  function makeRow(text) {
    const el = document.createElement('div');
    el.style.cssText = [
      'display: flex',
      'gap: 7px',
      'align-items: baseline',
      'padding: 1px 0',
      'white-space: pre-wrap',
      'word-break: break-word',
    ].join(';');

    const t = document.createElement('span');
    t.style.cssText = 'color:#4d5566;flex:none;user-select:none';

    const m = document.createElement('span');
    m.style.flex = '1';

    const n = document.createElement('span');
    n.style.cssText = 'color:#e0b15a;flex:none;display:none';

    el.append(t, m, n);
    return { el, t, m, n, text };
  }

  const api = {
    /** Append a line. Identical consecutive lines coalesce into a ×N badge. */
    log(msg) {
      const text = String(msg);
      const last = rows[rows.length - 1];
      if (last && last.text === text) {
        last.count++;
        last.n.textContent = `×${last.count}`;
        last.n.style.display = '';
        last.t.textContent = stamp();
        follow();
        return;
      }

      const row = makeRow(text);
      row.count = 1;
      row.t.textContent = stamp();
      row.m.textContent = text;
      rows.push(row);
      list.appendChild(row.el);

      while (rows.length > max) rows.shift().el.remove();
      if (collapsed) setCollapsed(false);   // something happened; show it
      follow();
    },

    clear() {
      for (const r of rows) r.el.remove();
      rows.length = 0;
      pinned = true;
    },

    /** For anything that wants the panel out of the way (or back). */
    setCollapsed,

    /** The DOM node, in case something needs to reposition or hide it. */
    element: wrap,
  };

  return api;
}
