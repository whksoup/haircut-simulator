# SNAP-1 builder handoff

2026-09-28 (Asia/Singapore). Candidate worktree only:
`C:/Users/He Kai/.codex/worktrees/snapped-brush/haircut-simulator`,
branch `codex/snapped-brush`, dirty working source based on `57ca555` plus copied ORB-3 changes.
The original checkout was not modified by this experiment. No builder commits or pushes.

## Source and API

- `src/scene/snappedBrushFrame.js`: actual camera forward vector is expressed in the transformed object's local orientation. Only its heading around local Y rounds to the nearest 45 degrees; elevation remains unchanged. Deterministic heading zero at poles. The frozen plane passes through the transformed head geometry bounds center. Bounded ray/plane mapping rejects parallel, behind-ray and excessive-distance intersections.
- `src/tools/snappedBrushTool.js`: drop-in RayBrushTool subclass. Shared constructor/lifecycle/masks/history/head visibility/constraints remain inherited. Public `strokeFrame` contains `heading`, `originalHeading`, `elevation` (radians), world `axis`, `localAxis`, world `center`, `plane`, `matrix`, `scale`. Null outside a stroke. Public `status` is explanatory text.
- `src/debug/snappedBrushCylinder.js`: public `cylinder` Group is held-only. Its central CylinderGeometry and two spherical caps match the actual collision capsule radius/endpoints. All three meshes have picking disabled. Geometry/material resources dispose once on normal disposal. Public `endpoints` and `radius` describe the last depicted capsule.
- Candidate `src/tools/rayBrushTool.js`: behavior-preserving extraction of the shared capsule solve loop into `_applyCapsule(a,b,tie)`; ordinary brush tests still pass. The original checkout's base file was not changed.

Camera and mesh snapshots, snapped axis, workplane, bounds, radius and mask remain frozen during each held gesture. Actual camera visibility remains the head-occlusion authority; the snapped axis does not replace it. Navigation finishes the gesture through existing arbitration. Nonuniform, singular, mirrored or sheared world transforms reject the gesture with explicit status because the inherited solver supports a single uniform-scale radius.

A press displays the real cylinder but does not author until movement. Every exit hides the cylinder before and after the base sampler's final drain. Inactive movement never resumes the held pass. Unsafe mapped poses hide the cylinder, skip deformation and break continuity.

## Verification

Bundled Node 24.19.0, `node --test "tests/snapped-brush-*.test.mjs" "tests/ray-brush-*.test.mjs"`: **28 pass, 0 fail** (10 new SNAP tests + 18 inherited brush tests). Log: `builder-focused.txt`; tested source hashes: `builder-source-hashes.json`.

New frame tests cover both camera types, parent translation/rotation/uniform scale, nearest heading, exact retained tilt, deterministic poles, an oblique plane distinguishable from a camera-facing plane, bounded/parallel/behind rejection, and nonuniform/singular/mirrored/sheared transform refusal.

New synthetic EventTarget tool tests cover stationary press/no edit, held cylinder visibility, useful oblique drag in both projections, mask/hidden-guide exactness, root/length invariants, one history entry and exact undo/redo/reload, frozen frame under external camera/mesh mutation, cylinder endpoint/radius agreement with the final solve capsule, all interruption exits, fresh-press requirement, unsafe mapping, disposal and explanatory invalid-transform status.

Test-first evidence: the initial frame helper intentionally preserved unsnapped heading; the heading test and non-camera-facing-plane test failed their behavior assertions, then passed after snapping. Independent review found stale inactive "Brushing" text. New release/interruption tests failed the status assertions before the fix, then passed unchanged after idle reset. Invalid-transform error status remains preserved by an explicit regression.

Production source is frozen. The coordinator owns final browser captures, complete assembled suite/build and requested candidate branch push. Browser reports and images from the coordinator are not relabeled as builder-run evidence. Existing four baseline failures remain expected in the full suite; this focused run does not claim a complete suite/build pass.

## Review correction

The stale brushing status is reset before parent finish callbacks. Cylinder hiding runs both before the parent finalization and afterward because parent finish drains the remaining spatial sample. Final state notification occurs after clearing strokeFrame, so inactive UI cannot retain a heading/active message. Invalid transform/unsafe mapping errors are not replaced with a generic idle message.

