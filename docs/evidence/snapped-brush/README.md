# SNAP-1 evidence and review

Isolated `codex/snapped-brush` experiment. Base `57ca555` plus the copied uncommitted orthographic/ray-brush snapshot. The experiment is not merged into the original checkout.

## Results

- [Builder handoff](builder-handoff.md): 10 new snapped-brush tests and 18 inherited brush tests pass. Includes heading/tilt, head transforms, poles, safe intersection rejection, frozen frame, visible/collision capsule matching, masks, history/reload, length audit, interruption cleanup and disposal.
- [Full suite](tests-full.txt): 54 pass, four known baseline failures (`console`, `seam-commit`, `seam-release`, `seam-tool`), no skips.
- [Build](build.txt): passes, `index-CpmVAh6M.js`; existing >500 kB warning remains.
- Browser trusted perspective stroke and trusted orthographic `browser/stroke-20260928155623504.json`: useful edit, one history entry, exact undo/redo, passing length audit, cylinder hidden after release.
- [Held-cylinder image](browser/held-20260928155718355.png) and [metadata](browser/held-state-20260928155718378.json): synthetic held gesture for the visual capture, real rendering. Camera heading 32°/tilt 40° becomes the equivalent forward-axis heading -135°/tilt -40°; tilt is preserved. This is separate from the trusted input traces.
- [Original-checkout fingerprint](original-checkout-after.json): all recorded tracked/nonignored files unchanged; no new files; branch remains `AgentRefactor`.

## Independent Astra/medium review

Read-only source and evidence review found no remaining confirmed SNAP-1 contract violation. Heading snaps around head-local Y while preserving elevation. Frame and intersection are frozen per press; actual-camera head visibility remains. Capsule visualization and collision share endpoints/radius. Existing mask/history/guide invariants remain intact. Unsupported nonuniform, singular, mirrored or sheared transforms reject explicitly.

Review found a stale active-status message after release. Builder reproduced it with a focused failing test, reset idle status before completion notifications while retaining useful error messages, and passed the regression. Coordinator repeated combined checks and orthographic browser interaction after the source freeze.

The acceptance is bounded to this experiment. Earlier ORB-3 evidence limitations are historical and are not silently declared resolved. Native file delivery and broad performance benchmarking were not repeated for SNAP-1.

## Reproduction

In this worktree, `npm run dev` serves the app on port 5177. Choose Tools → brush; hold left mouse to brush, right-drag to orbit between strokes. Browser evidence harness: `npm run dev -- --config tests/browser/vite-snap.config.mjs`, then `/tests/browser/snap.html`. Harness writes only this experiment's browser evidence directory.
