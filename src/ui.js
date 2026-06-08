/**
 * UI — prototype controls (lil-gui). Swap for a real sidebar later.
 *
 * Phase 0 wires the save/load round-trip and exposes global params.
 * Phase 1 (this update) adds a Tools folder with a "Pick face" toggle that
 * enables / disables the Raycast instance.
 */

import GUI from 'lil-gui';
import { Groom } from './groom.js';

/**
 * @param {object} opts
 * @param {Groom}                opts.groom
 * @param {Function}             opts.onLoad      - called with a new Groom on file load
 * @param {import('./raycast.js').Raycast} [opts.raycast] - optional; wired when provided
 */
export function buildUI({ groom, onLoad, raycast }) {
  const gui = new GUI({ title: 'Groom' });

  // --- File -----------------------------------------------------------------
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

  // --- Tools ----------------------------------------------------------------
  const tools = gui.addFolder('Tools');

  // State object so lil-gui can reflect toggle state.
  const toolState = { pickFace: false };

  if (raycast) {
    tools
      .add(toolState, 'pickFace')
      .name('Pick face')
      .onChange((v) => {
        v ? raycast.enable() : raycast.disable();
      });

    // Wire selection changes into the debug console.
    raycast.onSelect     = (facetId) => dbg.log(`select  facet ${facetId}`);
    raycast.onHairChange = (ids)     => dbg.log(`hair    facets: ${ids.size} selected`);
  } else {
    // Graceful no-op if raycast wasn't passed in yet.
    tools.add(toolState, 'pickFace').name('Pick face (unavailable)').disable();
  }

  // --- Globals --------------------------------------------------------------
  const globals = gui.addFolder('Globals');
  globals.add(groom.globals, 'density', 0, 4, 0.01);
  globals.add(groom.globals, 'length', 0, 0.5, 0.001);
  globals.add(groom.globals, 'segments', 1, 16, 1);
  globals.add(groom, 'masterSeed', 0, 99999, 1);

  // --- Info -----------------------------------------------------------------
  const info = gui.addFolder('Info');
  const stats = { selectedFaces: 0, guides: 0 };
  info.add(stats, 'selectedFaces').disable().listen();
  info.add(stats, 'guides').disable().listen();

  function refreshStats() {
    const s = groom.stats;
    stats.selectedFaces = s.selectedFaces;
    stats.guides = s.guides;
  }
  refreshStats();

  // --- Debug console --------------------------------------------------------
  // Fixed to bottom-right of the viewport. Call dbg.log(msg) from anywhere.
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
    const reader   = new FileReader();
    reader.onload  = () => cb(String(reader.result));
    reader.readAsText(f);
  };
  input.click();
}

// ---------------------------------------------------------------------------

/**
 * Debug console fixed to the bottom-right of the viewport.
 * Returns { log(msg), clear() }.
 */
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