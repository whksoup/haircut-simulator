/**
 * Haircut Simulator — entry point.
 *
 * Phase 0: load the head, orbit it, round-trip an empty groom model.
 * Phase 1: wire Raycast — click to select a facet, shift+click to mark as hair.
 */

import { Viewer }    from './viewer.js';
import { loadHead }  from './loadHead.js';
import { Groom }     from './groom.js';
import { buildUI }   from './ui.js';
import { Raycast }   from './raycast.js';
import { HairStore } from './hair.js';

async function main() {
  const container = document.getElementById('app');
  const viewer    = new Viewer(container);
  const groom     = new Groom();
  const hair      = new HairStore(groom.globals);

  const { root, groomTarget, isPlaceholder } = await loadHead();
  viewer.scene.add(root);
  viewer.frameObject(groomTarget);

  const raycast = new Raycast(viewer, groomTarget);

  // Keep HairStore in sync whenever the shift-click selection changes.
  raycast.onHairChange = (facetIdSet) => {
    hair.syncFromSelection(facetIdSet);
  };

  const { gui, refreshStats } = buildUI({
    groom,
    raycast,
    onLoad: (next) => {
      groom.copyFrom(next);
      refreshStats();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  });

  // Expose for console poking.
  Object.assign(window, { viewer, groom, groomTarget, raycast, hair });

  if (isPlaceholder) {
    document.getElementById('hud').innerHTML +=
      ' · <b style="color:#e0b15a">placeholder head</b>';
  }
}

main().catch((err) => {
  console.error(err);
  document.getElementById('hud').textContent = 'Error: ' + err.message;
});