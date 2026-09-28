# Technical view verification — 2026-09-18

Source: branch `codex/haircut-technical-view`, base `effc25c`, uncommitted implementation in this worktree. `browser-checks.json` and every `harness-*.json` carry SHA-256 source identities, browser, viewport, camera and fixture metadata. Production source was stable for the final harness run. Tests and build ran on the same production source; later edits affect documentation only.

## Results

- `npm test`: 17 pass, 4 fail. The same pre-existing console, seam-commit, seam-release and seam-tool failures reproduced in `baseline-tests.txt` (12 pass, 4 fail). No tests skipped or weakened.
- Five new deterministic tests pass, covering complementary translated clipping planes, head/hair agreement, repeated restoration, six axis-aligned presets and pole orbit regression. The pole-orbit test genuinely failed before the fix; initial visual implementation used the documented visual-exploration exception.
- `npm run build`: pass; existing >500 kB bundle warning remains.
- Actual in-app Chromium browser: 101/101 harness checks pass. Authored JSON and populated history remain exact through three inspection cycles, seven camera selections and 18 cutaway combinations per cycle. Growth preview and guide/seam object identity remain intact.
- Real Save control produces the complete expected groom JSON Blob and filename. Actual Load button, file input change and asynchronous FileReader callback restore exact JSON and reset load history/growth. Harness uses a synthetic File; native OS picker was not exercised. Browser download-event wait timed out, so downloaded-file delivery is unverified (also a prior growth-track limitation).

## Visual and pointer evidence

`harness-preset-{front,back,left,right,top,bottom}.png` and matching JSON show six actual WebGL views. `harness-cutaway-{x,y,z}-{normal,flipped}.png` show both halves for every axis at center: x/y from Front and z from Right. Head and hair share the section boundary. These canvas captures exclude controls; `ui-final-front.png` shows full UI at 1280×720.

Coordinator directly operated the real UI: entry/return focus, all presets, all axes/sides, clipping off, plane delineation, slider ArrowRight (+1% with visible focus), Front orbit and fixed Top/Bottom orbit (active label becomes Free orbit). Actual pointer select of facet 91, Add/Remove hair and UI Undo/Redo visibly worked. Two clicks placed a comb; its drag produced an Undo comb entry. Inspection hid bars/gizmos and Escape returned the same comb and undo entry (`ui-return-comb.png`). Scissors placement/drag and CUT no-hit response were exercised; this smoke does not claim a successful shortening gesture. Seam tool was activated. No runtime errors were reported; existing catalogue/material/shader warnings remain.

The viewport override API did not change the actual 1280×720 viewport, so a smaller desktop breakpoint is not claimed as browser-verified. The 970×720 harness iframe independently exercises a smaller viewport. Panel scroll is visible and Return remains reachable; no mobile-specific acceptance is claimed.

Earlier `ui-*.png` captures (except `ui-final-front.png` and `ui-top-orbit-fixed.png`) preceded the final pole fix and are scenario evidence only, not exact final-source screenshots. The final source-hashed harness matrix is authoritative. `ui-cutaway-x-flipped.png` was taken around a hot reload and should not be used for acceptance; use the final harness X pair.

## Scope and remaining limits

Presentation only. No solver, persistent schema or geometry authoring changes. No caps, measurements, export, growth grids or exploded-slice stretch. Technical camera synchronization uses Three.js r169 OrbitControls' cached up-basis fields and is covered by the pole regression; revisit this adapter if upgrading Three.js. Native Save download delivery and native picker interaction remain environment verification limits, not a claim of tested behavior.

Final addendum: `ui-final-y80-normal.png` and `ui-final-y80-flipped.png` were captured on final source at Front, Y, +80%, 1280×720. They show the moved cut intersecting both scalp and hanging fringe. Independent critic passed the supplied core rubric, with the limits above. No app source changes followed final tests/build.
