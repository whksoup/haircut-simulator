/**
 * UI — prototype controls (lil-gui).
 *
 * Model:
 *   - ONE active tool at a time (none / pick / comb). The dropdown is the only
 *     thing that changes it, and it goes through main.js's setActiveTool —
 *     Raycast and CombTool both grab pointerdown and both suspend
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
 * @param {Function} [opts.setActiveTool]           'none' | 'pick' | 'comb' | 'seam'
 * @param {Function} [opts.placeCombAtSelection]    () => boolean
 * @param {import('./combTool.js').CombTool} [opts.comb]
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
  groom, onLoad, raycast, renderer, runtime, comb, guideDebug, history,
  seamOverlay, seamTool, selectionOps, catalogue, startCombPlacement,
  seamsFromFacetSelection, seamFromFacetPair, setSyncHooks,
  seedSeams, sealSelectionBorder, openSelectionSeams, clearAllSeams,
  setActiveTool, placeCombAtSelection,
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
  // hair" when you are three strokes deep and unsure what you just did.
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
    .add(toolState, 'tool', ['none', 'pick', 'comb', 'seam'])
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
    // than a mode: strands stretch under the correction and phase more easily
    // next stroke. More iterations = tighter length under contact.
    cs.add(comb, 'constrain', ['length', 'none']).name('length constraint');
    cs.add(comb, 'iterations', 1, 16, 1).name('solver iterations');
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

      // HONESTY LINE. Seams are authored, saved and drawn, but guideBinding.js
      // still binds strands by Euclidean k-nearest and has no knowledge of
      // permeability — so changing this value currently alters nothing about
      // the hair. That is not a density artefact and not a tuning problem; the
      // consumer does not exist yet. Saying so here is cheaper than letting
      // someone spend an afternoon deciding their mesh is at fault.
      sf.add({ note: 'display + selection only — binder pending' }, 'note')
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
    strands: 0, undoDepth: 0,
  };
  info.add(stats, 'selected').disable().listen();
  info.add(stats, 'seamEdges').disable().listen();
  info.add(stats, 'hairFaces').disable().listen();
  info.add(stats, 'guides').disable().listen();
  info.add(stats, 'seams').disable().listen();
  info.add(stats, 'strands').disable().listen();
  info.add(stats, 'undoDepth').disable().listen();
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

function buildDebugConsole() {
  const MAX_LINES = 40;
  const lines     = [];

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: fixed',
    'bottom: 12px',
    'right: 12px',
    'z-index: 9999',
    'font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    'color: #8b94a3',
    'max-width: 320px',
    'max-height: 140px',
    'overflow-y: auto',
    'white-space: pre',
    'text-align: right',
    'pointer-events: none',
    'user-select: none',
  ].join(';');

  document.body.appendChild(panel);

  function render() {
    panel.textContent = lines.join('\n');
    panel.scrollTop   = panel.scrollHeight;
  }

  return {
    log(msg) {
      lines.push(msg);
      if (lines.length > MAX_LINES) lines.shift();
      render();
    },
    clear() {
      lines.length = 0;
      render();
    },
  };
}
