# 2026-09-29 — Horizontal snapped brush

SNAP-2, verified locally in F:/haircut-simulator. User clarified that the cylinder is a horizontal cross beam whose top-down heading snaps like a clock hand every 45°. This supersedes the retained tilt in SNAP-1.

The frame now snaps world-space yaw about scene Y and fixes elevation at zero. Head tilt cannot tip the cylinder. The upright head-center working plane and frozen-stroke lifecycle remain shared by display and solver. UI feedback and canonical docs describe the new orientation. Existing untracked skills, .claude, SCRATCHPAD and SPACES files were preserved.

Verification: focused orientation tests first failed against old behavior; all 10 frame/tool tests pass after implementation. The pole fixture uses a nonparallel camera up vector so Three.js lookAt does not perturb its exact pole. Node 24.15 explicit-glob full suite: 54 pass, four known failures (console, seam-commit, seam-release, seam-tool), none skipped. npm wrapper emitted no output; direct Vite build passes with existing chunk-size warning, index-Ma1FTMEp.js.

Browser: actual Playwright mouse strokes on the running app at 32° camera yaw / 40° tilt in both perspective and orthographic. Held axis was [-0.7071067811865476, 0, -0.7071067811865475], heading -135°. Cylinder endpoint heights matched exactly in both runs. Both strokes changed guides, added one history entry, passed exact undo/redo and guide-length audit, and hid the cylinder on release. No new independent review; broad comb/cut/seam/native save-load browser acceptance was not repeated for this bounded frame change.

Exact top/bottom camera rays are parallel to the upright workplane and safely skip edits; deterministic pole heading remains zero. No alternative pole interaction was introduced. Changes remain uncommitted. Dev server serves port 5177.
