# 2026-09-28 — Snapped brush experiment

Track SNAP-1, implementing. Isolated managed worktree `codex/snapped-brush`, based on HEAD57ca555 plus a copied working snapshot of the orthographic/brush implementation. Original checkout must remain unchanged; this experiment is not merged or folded into it.

User clarification: keep camera tilt, snap only heading to the nearest45° around the head's localY axis (the head-turning axis). Freeze the resulting brush direction/workplane on press. Mouse rays intersect that plane; the cylinder runs normal to it. Camera stays free to orbit between strokes. A3D cylinder appears only while held. Existing guide masks, camera head visibility and history semantics remain.

Success criteria:
- Nearest45° heading with unchanged tilt, correct under transformed head coordinates and both projections; deterministic pole behavior.
- Mouse-to-plane mapping follows the frozen frame; no unstable edits from a parallel or backward intersection.
- Displayed cylinder matches the effective brush capsule and radius, appears on press, hides on every finish path, has no authored state or picking side effects.
- Useful brushing preserves protected guides/segments, pinned roots, length invariants, copied mask and one-step history.
- Focused tests, full suite/build with existing4 failures distinguished, browser demonstration and independent bounded review.
- Original checkout hash manifest unchanged.

Ownership: Astra/medium brush builder owns candidate core tool/frame/visual/tests; coordinator owns candidate app/UI/docs/browser; Astra/medium independent reviewer reads contracts/evidence. No source edits are authorized in the original checkout.

## Completed verification and push preparation

The user briefly requested a checkpoint, then resumed and explicitly requested a push to origin when done. No merge into the original checkout is authorized.

Astra/medium builder completed the variant; independent review found one stale brushing-status message, corrected with a failing-then-passing regression. Final source has no remaining confirmed SNAP-1 contract violation. Full suite: 54 pass / same four baseline failures, zero skipped; build passes with the existing size warning (`index-CpmVAh6M.js`). Trusted perspective and orthographic browser strokes produce useful edits, one entry, exact undo/redo, hidden cylinder on release and passing length audit. Final held-cylinder image and source-hashed metadata are saved separately from the trusted traces.

Original checkout fingerprints match, including its nonignored untracked files. Branch remains `AgentRefactor`; candidate remains `codex/snapped-brush`. This branch includes the copied prior brush implementation needed as its base. Source/evidence/docs will be committed and pushed only on the isolated branch. See [evidence and review](../evidence/snapped-brush/README.md).
