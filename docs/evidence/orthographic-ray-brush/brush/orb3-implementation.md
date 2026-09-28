# ORB-3 brush implementation handoff

2026-09-28 (Asia/Singapore), `AgentRefactor` at `57ca555`, shared dirty source. Scope v3 accepts existing guide blending; the earlier isolation design is historical feasibility evidence, not the implemented architecture.

## Source and contracts

- `src/tools/rayBrushTool.js`: hold/move gesture, copied facet mask, radius/camera/bounds frozen per pass, cursor, capture interruption lifecycle, callback publication and bounded camera-ray capsule. `setEnabled`, `finishEditing`, `setMask`, `setRadius`, `dispose`; callable `canStyle`; `active`/`enabled` and DOM `cursor`. `onStrokeBegin`, `onEdit(ids)`, `onStrokeEnd(ids)` mirror the finite comb. No-op passes return an empty changed set; the existing History discards them. `finishEditing` is idempotent and drains the final spatial remainder once.
- `src/scene/headVisibility.js`: frozen world-space head-triangle shadow volumes. Tests every complete segment, not merely control-point samples; both endpoints of each pre-hidden segment are protected. Orthographic prisms and perspective pyramids use scale-relative tolerance. Only supplied mesh geometry is an occluder; children/hair/overlays are excluded. Points outside the forward camera region are protected as well.
- `src/hair/rayBrushStroke.js`: carried fixed-distance path sampling without an event step cap; trial contact uses the existing capsule solver and 128 free length-relaxation sweeps. Protected endpoints have zero inverse mass, retain exact authored coordinates and therefore preserve the entire hidden segment. Every other settled segment must remain visible. The settled normalized curve must pass unchanged `LENGTH_TOL=1e-3` before any authored write. Unsafe trials are discarded bitwise. Roots, lengths and tangents are retained. The ray brush has no persistent solid bar after a sample and no shader-only pushout.
- `src/hair/guideFrame.js`: shared frame/lift/writeback extracted from the finite comb. Existing comb delegates the three methods and retains its historical scalp half-space clamp. New brush writes an unclamped trial and validates geometry/length before publication; there is no post-solve clamp that can introduce length error. Actual head visibility governs accepted whole curves.

The camera builder's comb subscriptions remain intact. No schema, authored store, renderer binding, GPU shader or history implementation changes were made by this slice. Application/UI integration and browser evidence belong to the coordinator.

## Verification

Bundled Node 24.19.0, command `node --test "tests/ray-brush-*.test.mjs"`; `orb3-focused-node24.txt` records the current run. Source hashes are in `orb3-source-hashes.json`.

Focused tests cover useful settled movement, exact root/tangent/length preservation, rejection before/after solve without authored writes, 1/8/64 event equivalence, long jumps, segment-interior occlusion, silhouette misses, transformed head geometry and both projections. An independent head-ray comparison tests 300 deterministic points per projection against the actual transformed Three.js mesh. Tool tests dispatch real EventTarget events against a synthetic canvas/control shell: hover, stationary/no-op, empty/copied masks, selected/hidden guide protection, History undo/redo, guide JSON reload, interruption table, fresh-press requirement, growth guard and listener disposal.

The finite-comb extraction characterization passed before and after extraction, including exact existing scalp-clamp output and its known length-audit failure. New brush contact tests were initially run against a no-op implementation and failed the useful-change assertion; the fixture was then corrected to contact mid-strand rather than its pinned root before GREEN. Consequently this is not claimed as a pristine identical-fixture RED/GREEN cycle. Final tests demonstrate useful contact and invariants with the corrected fixture.

These are focused JavaScript tests, not browser gesture/visual or performance acceptance. Full suite/build are deferred to the coordinator's assembled-source verification. Baseline known failures remain console, seam-commit, seam-release and seam-tool. Direct triangle queries and per-sample relaxation require measured I3 evidence on the real default groom; no performance pass is inferred from these small fixtures.

## Integration notes

Finish the tool before projection/preset, Technical, growth, undo/redo, valid load, save and application tool arbitration. Its own handlers finish on canvas exit/cancel/lost capture, window release/blur/hidden, Escape, wheel and non-left navigation. Callback ordering publishes settled rows before committing history; deactivation precedes pointer-capture release to tolerate synchronous re-entry. Mask setters defensively copy and finish any active stroke. The selected mask is transient and an empty set never broadens to All.

The app should prioritize an active Brush on Escape before ordinary selection clearing. Window capture listeners registered earlier by the app retain registration order. The cursor is a reference-depth radius indicator in perspective and an exact projected world radius in orthographic view. Visible geometry still follows the accepted existing cross-facet guide interpolation, documented by the retained feasibility fixtures.

## Correction round

Independent review found that clamping the capsule axis to a forward ray did not clip its spherical near cap. Added a forward-camera/near-plane guard; both orthographic and perspective behind-camera/near-plane overlap regressions pass.

The real default GLB/groom exposed a useful-edit failure: its first root is approximately 0.0010342 mesh units beneath the top-view scalp surface, while points 1–8 are visible. Rejecting every partly hidden guide rejected all three default guides. The new `ray-brush-default.test.mjs` failed against the original implementation, then passed after protecting hidden-segment endpoints and permitting the visible suffix. It verifies a useful normalized movement of at least 0.005, exact embedded root→CP1 preservation and the existing length audit against the actual repository GLB. Visibility tolerance was not broadened.

The synthetic fully hidden fixture now uses length 0.1 to remain entirely behind the box; its earlier length 1 extended beyond the silhouette and was only partly hidden. Excluded guide and fully hidden guide assertions remain exact. Both endpoints of all pre-hidden segments are frozen before solving, and post-solve visibility prevents newly hidden portions from being accepted.

State setters notify the app after changing enabled/mask/radius, enabling the independently owned mask overlay to stay synchronized.

## Final test-only evidence extension

Added three bounded tests after source review: a hidden middle interval with exact protected endpoints and a usefully edited visible suffix; a three-leg cornered path delivered at 1/8/64 subdivisions per leg; and one pointer jump crossing five guide regions, each requiring useful movement. No production source changed for this extension. All pass with root pinning and the existing length audit.

The final B3 addition selects two of three intersected facets, requires useful movement on both selected guides and exact exclusion of the middle guide, and checks one history entry, exact undo/redo, reload and length invariants.

Final focused total: 18 passing brush tests. Full assembled suite on Node 24.19.0: **44 pass, 4 existing failures**, with no skips (`orb3-final-full-suite.txt`). Failures remain console, seam-commit, seam-release and seam-tool. The build was not rerun for test-only additions; the coordinator owns its assembled build/browser result. Source is frozen after the test/evidence update.
