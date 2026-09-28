# ORB-3 mask overlay and integration harness handoff

2026-09-28, scope v3, `AgentRefactor` base `57ca555`, shared dirty checkout. Assigned correction owns only new `src/debug/brushMaskOverlay.js`, `tests/brush-mask-overlay.test.mjs` and opt-in `tests/browser/orb-integration.js` / `.html`. Source identity: `mask-integration-source-hashes.json`. Root owns app/UI wiring and browser operation; brush builder owns brush setters. No authored state or brush solver changes by this assignment.

`BrushMaskOverlay({mesh,catalogue})` exposes `.object`, `setMask(Set|null)`, `setVisible(boolean)`, `dispose()`. Parent `.object` beneath the head. Gold translucent depth-tested surface, polygon offset, no picking; independent geometry/material so working-selection clearing cannot erase the copied mask. Unchanged masks do not rebuild; invalid facet IDs are ignored; empty/All masks show no triangles. Root synchronizes mask and visibility from brush setters/mode state and hides it during Technical/growth.

Focused procedure: scaffolded the public overlay lifecycle with no mask geometry, then ran behavioral tests. `mask-overlay-red.txt` records two expected geometry failures, not import/fixture errors. Implemented copied mask geometry, filtering and visibility; `mask-overlay-green.txt` records 3/3 passes. Tests cover copied mask independence, original head geometry/material untouched, indexed and nonindexed triangles, unchanged-mask reuse, unknown/empty/All masks, head transform inheritance, no ray hits and disposal. Commands:

```powershell
& 'C:/Users/He Kai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test tests/brush-mask-overlay.test.mjs
& 'C:/Users/He Kai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --check tests/browser/orb-integration.js
git diff --check
```

All pass under Node 24.19.0. Browser appearance remains for coordinator capture. Visual scenario: selected facet mask remains gold while Brush is enabled after working selection is cleared, disappears for All/empty masks and unavailable styling modes, follows transformed head, and does not show the far surface through the head.

Harness URL: `http://127.0.0.1:5176/tests/browser/orb-integration.html` using existing root-owned Vite config. Buttons explicitly run synthetic-pointer lifecycle checks or performance. Fixed iframe 1440x900. Performance runs three repetitions of camera-only, matched hover baseline and active sweep; each has 5 seconds warm-up and 10 seconds sampling (135 seconds total). It saves raw RAF intervals, dispatch-to-completed-guide-publication timings on edited events, dispatch durations, counts, per-run percentiles/budgets, camera/path, browser/GPU, fixture and source hashes. Final source mismatch or no candidate edits prevents a pass. Capture is performed by root, not this builder.

Synthetic capture is temporarily stubbed because dispatched PointerEvents do not establish native capture. The report labels this and does not claim native pointer latency, download or picker delivery. Lifecycle checks use app APIs and callbacks; real controls/native input evidence remains separate. Hardware/browser limitations and missing samples must remain visible in acceptance review. No I3 performance result is claimed before root runs the harness.

Documentation implication: copied mask now has a persistent viewport highlight; root should reconcile the final accepted behavior. Combined suite/build and review remain coordinator-owned to avoid concurrent test-source confusion.
