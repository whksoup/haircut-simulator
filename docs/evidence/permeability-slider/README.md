# Permeability integration evidence

Captured 2026-10-05 Asia/Singapore on the combined main working tree. Browser: Chromium 154, 1280×720, UI scale 60%; Vite local preview. Source build: `index-DttnwyHh.js`.

- `browser-checks.json`: real pointer/keyboard slider checks and 19 passing real-head GPU/action checks. Held drag leaves authored state unchanged; release causes exactly one rebind and one history entry. Typed 0.63, hard preset, and undo back to 0.63 verified.
- `control.png`: native range and precise value in the Seams panel, mixed edge selection. Screenshot visually inspected for control placement.
- `node-tests.txt`: 63 passing tests, four unchanged baseline failures; none skipped.

Commands: `node --test tests/ray-brush-tool.test.mjs`, `node --test "tests/*.test.mjs"`, `npm run build`. The combined browser harness is `tests/browser/blending-run.js`; restore the startup groom before invoking `runBlendingChecks(hc)`. Earlier fixed-camera before/after blending images and manual comb/cut evidence are in `../strand-blending/`.
