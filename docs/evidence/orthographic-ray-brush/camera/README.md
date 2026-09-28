# Camera slice — ORB-2 / scope v2

2026-09-28, Asia/Singapore. Stage: implemented, focused numeric checks verified locally; browser and combined acceptance remain with coordinator. Worktree `C:/Users/He Kai/haircut-simulator`, branch `AgentRefactor`, base `57ca55583e20c131bfcb419b765ee0bdfa323f8e`, final correction-round dirty source identified by `review-source-hashes.json` (original round retained in `source-hashes.json`). Concurrent application, documentation and brush-feasibility changes are present and are not claimed as camera-builder verification.

## Test evidence

Runtime: bundled Node v24.19.0 on Windows; Three.js r169, real OrbitControls in Node without a browser canvas. Command (from repository root):

```powershell
& 'C:/Users/He Kai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --test tests/grooming-camera.test.mjs tests/technical-view.test.mjs
```

- `red.txt`: focused camera-assignment test before production edits. Expected behavioral failure: rendering/picking retained the old perspective camera instead of receiving the new orthographic camera. No import/fixture error.
- `numeric-first-run.txt`: first extended numeric run; 8 passed, 2 failed because tests demanded exact target equality after OrbitControls arithmetic (differences around 3e-17). Test correction: camera target comparisons now use 1e-12 world-unit tolerance. Authored-state comparisons were not changed; these tests contain no groom.
- `green.txt`: same assignment assertion plus four new camera cases and five existing Technical tests; 10 passed, 0 failed. Extended tests were added after implementation; only the assignment scenario had a pre-implementation RED.
- `review-pan-red.txt`: independent review identified r169 perspective pan ignoring camera zoom. Added real-controls `_pan(20, 0)` behavioral regression before correction; it fails at prior orthographic zoom 4 as expected (10 passed, 1 failed).
- `review-pan-green.txt`: correction represents effective perspective FOV directly with zoom 1. All 11 focused tests pass, including equal 20 CSS-pixel pan at orthographic magnifications 4 and 0.25. No installed dependency changes. This supersedes the original GREEN/source identity for final review.
- `git diff --check`: passed. Repository-wide suite/build and browser validation are coordinated separately to avoid concurrently labeling another builder's RED as a camera regression.

Numeric scenarios: twenty perspective/orthographic round trips at alternating 1440x900 and 1024x768 CSS-pixel dimensions, target-plane center and two offset landmarks within 1 pixel; perspective zoom, orthographic zoom and translated target/camera; all six directions within 1e-5; top/bottom escape via real OrbitControls angular deltas; orthographic Technical return preserves camera object, pose, up, zoom and target through three cycles and a changed aspect; camera assignment clears pending damping; Technical camera changes notify subscribers.

## Interface and decisions

`Viewer.setCamera(camera, {target} = {})` updates camera, controls, r169 orbit basis/residual motion, resize and subscribers. `onCameraChange(fn)` returns unsubscribe. Both existing TransformControls instances subscribe and unsubscribe in their own lifecycle. Dynamic raycasters continue reading `viewer.camera`.

`createGroomingCamera({viewer,onChange})` exposes `state`, `setProjection('perspective'|'orthographic')`, `setView('free'|'front'|'back'|'left'|'right'|'top'|'bottom')`, and `dispose()`. Presets activate orthographic projection. Callback receives a copied state after changes (no initial callback); a preset from perspective emits the projection then preset change. The controller ignores changes while Technical owns the camera. App must settle gestures before setters and disable grooming camera controls during Technical inspection.

Orthographic visible height uses perspective effective FOV and target distance. Conversion back keeps pose/distance and sets the effective FOV directly with perspective zoom 1, avoiding orbit-distance clamps and r169's zoom-insensitive perspective pan calculation. Orthographic resize metadata is now `viewHalfHeight`, shared by grooming and Technical. Technical restores original camera identity through the same camera assignment path. No authored model, solver, schema, history or presentation changes are made by camera setters.

## Browser evidence required for C1/C2 and I1/I4

Coordinator owns actual app wiring and browser capture. Capture both viewport sizes, ordinary materials/lighting, projection/preset controls, right orbit and Shift-right pan, wheel zoom, top/bottom orbit escape, picking and both gizmos with the current camera, an actual finite-comb edit/undo in orthographic mode, and Technical return to each grooming projection with tool restoration. Compare groom JSON/history around camera-only operations. Record browser/version, fixture, camera/viewport, trace/images and combined-source hashes. Node angular deltas establish numerical behavior but do not establish real pointer dispatch. Brush inactive return is an application/Brush lifecycle criterion, not verified by this slice.

No camera performance claim, native save/load delivery claim, or full ORB-2 acceptance is made here. Canonical documentation should describe the accepted projection/preset UI after integration; status/session updates belong to the coordinator.
