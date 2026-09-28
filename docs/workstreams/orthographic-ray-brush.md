# Orthographic grooming and camera-ray brush

Track: `orthographic-ray-brush` · scope v3 · 2026-09-28 (Asia/Singapore).
Stage: **implementing — camera integrated locally; guide-based brush authorized**. The user accepted existing guide-based masking. [ORB-3](orthographic-ray-brush-acceptance.md) defines active criteria; it supersedes strict rendered-strand isolation in prior planning. [Current evidence](../evidence/orthographic-ray-brush/README.md).
Coordinator owns scope, integration, shared application wiring and documentation. Baseline: `AgentRefactor`, `57ca555`, initially clean checkout at `C:/Users/He Kai/haircut-simulator`.

## Outcome and scope

Build and integrate two features into ordinary grooming:

1. **Orthographic grooming:** inspect and edit hair without perspective distortion, using the existing comb and other grooming tools.
2. **Camera-ray brush:** an extremely long comb aligned with the cursor's camera ray, moved across the viewport while holding the mouse button. It affects only hair in front of the head surface and offers a selected-hair-facets-only mode, without placing a bar or manipulating a gizmo.

Keep the existing finite comb as a separate choice. Orthographic grooming retains ordinary lighting, materials and styling access. Technical view remains its own inspection mode. Camera/brush settings are runtime state. Keep the existing groom schema and guide-patch history; no individual-strand layer is planned. No archived work-plane implementation is adopted.

## Decisions

The user clarified activation and depth, and added selection filtering. These confirmed requirements supersede the initial click-toggle / through-depth proposals.

| Decision | Confirmed behavior | Consequence |
| --- | --- | --- |
| Activation | Hold the mouse button to brush; release ends the stroke. | One pointerdown-to-pointerup gesture is the normal undo unit. |
| Depth | Only hair in front of the head surface. | Evaluate head occlusion across the brush footprint. A capsule shortened at the center ray can still reach behind the surface through its radius or end cap. |
| Selection | Offer a mode affecting only hair on selected hair facets. | Eligibility is the intersection of selection, brush contact and visibility. Selection refers to the facet from which hair grows, not the surface under the cursor. |

Scope v3 applies selection and head visibility to authored guides. Neighboring rendered strands can inherit guide edits across facet boundaries or behind the head through their existing blend weights; the user explicitly accepted this existing guide-based behavior. Hidden/out-of-mask authored guides remain unchanged. The earlier strict-strand design proposal is retained only as historical rationale.

Other proposed choices for this phase:

- Add a **Perspective / Orthographic** control inside grooming; keep the startup projection unchanged. “Default hair sculpting mode” is interpreted as the ordinary grooming workspace.
- Supply Front, Back, Left, Right, Top and Bottom orthographic presets using the existing direction conventions. Free orbit remains possible and changes the preset label to Free.
- Brush deformation means the current comb's contact pushout, not an attraction or grab brush. An inactive cursor or a stationary active cursor does not continuously deform hair.
- Support the active camera's projection: orthographic rays are parallel, giving the exact long-comb translation across the screen plane; perspective rays fan through the cursor. Do not silently flatten perspective rays. Orthographic is the reference workflow for this phase.
- Start with radius, active/inactive indication and **All facets / Selected facets only**. Reuse a world-space radius consistent with the existing comb; keep it fixed during a stroke. A projected outline is exact in orthographic view and a reference-depth indicator in perspective. Additional brush tuning is deferred.

## User interaction contract

### Orthographic grooming

Changing projection preserves the current orbit target, viewing direction and apparent scale at the target plane. Preserve pan, zoom and viewport aspect through resize and repeated changes. Wheel zoom and right-drag orbit / Shift-right-drag pan remain available. Left input continues to belong to the selected grooming tool.

Finish any live grooming stroke before changing projection or preset. Switching projection never authors guides, rebuilds hair, adds an undo entry, or enters Technical view. Entering and leaving Technical view restores the grooming projection, pose, target, zoom and previous tool; restoring the new brush selects it in the inactive state.

### Camera-ray brush

Selecting Brush shows its cursor footprint over the canvas. Hover previews position only. Left pointerdown establishes the starting pose; movement while held edits; pointerup finishes the stroke. A press/release without movement is a no-op. Capture the pointer for reliable release handling, but finish the stroke if the pointer crosses outside the canvas; re-entry requires a new press.

The footprint sweeps eligible guide segments in front of the nearest head surface along their camera rays. If a ray misses the head, visible guides beyond the head silhouette remain brushable. The head is the occluder; hair does not hide other hair for this rule. Contact includes segments crossing the brush between control points. Hair roots remain pinned; constraints preserve segment lengths. Hidden and out-of-mask authored guides remain unchanged after release and save/load. Conservatively excluding an entire partly hidden guide is allowed; do not move hidden portions indirectly through final relaxation. Dense rendered hair retains existing interpolation behavior.

In Selected facets only mode, copy the current facet selection on activation of that mode and expose **Use current selection** to refresh it deliberately. Display the selected-facet count. Freeze the mask for a stroke. Empty selection affects nothing and displays a clear instruction to select hair facets; never silently fall back to All facets. Clearing the ordinary working selection does not broaden a copied mask. The mask stays transient and is not part of haircut history or JSON; it may survive groom load while the head topology is unchanged. A replaced topology invalidates it to an empty mask, not unrestricted brushing.

One active pass produces one guide-history entry containing the union of changed guides. Finishing flushes remaining movement and settles the touched guides before capturing the final state. No movement or no contact produces no entry.

Release, Escape, tool switch, canvas exit, pointercancel, lost capture, window blur, hidden tab, camera navigation, projection/preset changes, Technical view entry and growth-preview entry finish the current pass and deactivate the brush. Finish means retain changes with undo available; it does not discard edits or auto-resume on return. Prioritize Brush's Escape handling before clearing selection. Freeze camera motion during editing and stop pending damping at activation; right/middle navigation or wheel zoom first ends the pass, then navigates. Ignore UI events and never sweep across a gap caused by leaving the canvas. After interruption, a still-held button does not restart editing.

Undo/redo and valid load also finish/deactivate first. A rejected load leaves the groom unchanged. Save finishes the pass before serializing the settled full authored groom. Growth fractions below 1 and Technical view disable editing through `canStyle`; returning to grooming requires a fresh press to brush.

## Implementation sequence and ownership

The coordinator delegates camera implementation, brush feasibility/build and independent review to Astra agents at medium reasoning, keeping shared app wiring and documentation under one writer. Follow [workflow.md](../workflow.md) and the [ORB-3 role/loop contract](orthographic-ray-brush-acceptance.md).

| Gate | Work / owner | Main source | Exit evidence |
| --- | --- | --- | --- |
| 0 — Contracts and baseline | Coordinator: establish camera/comb characterization and reproducible visibility/mask fixtures for confirmed scope v2. | This plan; `tests/`; browser harness | New test scenarios defined; baseline failures recorded; performance budget established. |
| 1 — Orthographic grooming | Camera implementer: shared camera switching, scale matching, presets, resize and tool camera updates. Coordinator: UI and mode wiring. | `src/scene/viewer.js`, proposed `src/scene/groomingCamera.js`, `src/scene/technicalView.js`; `src/tools/combTool.js`, `scissorsTool.js`; `src/app/main.js`, `ui.js` | Existing comb, scissors, picking and seams work under both projections; Technical round trips restore state. |
| 2a — Guide visibility and facet mask | Brush implementer: gate directly edited guides by full-segment head visibility and root-facet membership. | `src/scene/headVisibility.js`; `src/hair/` | Near/far and selected-guide fixtures pass; dense interpolation influence is documented and accepted. |
| 2b — Ray brush | Brush implementer: shared contact editing, bounded camera-ray geometry, facet mask, cursor and hold/release lifecycle. Coordinator: arbitration, history, preview/load/save wiring. | Proposed `src/tools/rayBrushTool.js`, `src/hair/combStroke.js`; existing `src/hair/strandConstraints.js`, `guideLengthAudit.js`; `src/app/main.js`, `ui.js` | Deterministic contact/stroke tests and real pointer checks pass; original comb behavior preserved. |
| 3 — Combined acceptance | Coordinator: exercise the assembled source, capture visual and temporal evidence, resolve regressions and document accepted behavior. | `tests/browser/`, proposed `docs/evidence/orthographic-ray-brush/`; canonical docs | Acceptance matrix below passes on combined source; build/full-suite outcomes reported with known failures separate. |

Sequence: **camera foundation → orthographic grooming → visibility/facet isolation → ray brush → combined acceptance**. Comb characterization can begin alongside camera work. Do not overlap writers in the existing comb or shared app files.

### Camera integration

- `Viewer` should own the active-camera assignment and notification path used by grooming and Technical view. Keep projection conversion/presets in scene ownership and tool arbitration in `main.js`.
- Existing raycasters read `viewer.camera` dynamically. Comb and scissors each construct `TransformControls(viewer.camera, ...)` once, so explicitly update those camera references on every swap; changing the rendered camera alone is insufficient.
- Match orthographic visible height to perspective height at the target distance using the effective field of view; account for orthographic zoom when converting back. Test target-plane landmarks rather than requiring unchanged screen positions at all depths.
- Generalize the resize state currently named `camera.userData.technicalHalfHeight`. Preserve the existing r169 OrbitControls up-basis synchronization for top/bottom presets through one narrow camera adapter and its real-controls tests.
- Technical view should borrow and restore camera state through the shared path while retaining ownership of its illustration and clipping settings.

### Brush geometry and deformation

- Construct the cursor ray from the active camera and canvas-relative coordinates. In orthographic view this is a translated parallel axis; in perspective it is the cursor-directed ray.
- Represent the apparently endless tool with a finite capsule spanning conservative groom depth bounds, expanded by radius and a margin. Include current guide geometry and maximum root-to-tip reach, not just the head mesh, so long hair is covered. Clip to the forward camera region; avoid arbitrary huge coordinates or `Infinity`.
- Freeze conservative depth bounds for the pass so bounds changes do not look like brush motion. Keep cap ends outside the relevant groom interval; enforce head occlusion separately. A miss of the expanded bounds is a no-op. Transform endpoints/radius to mesh-local space using the existing uniform-scale contract.
- Add a head-only visibility query under `src/scene/`: use the actual transformed head surfaces, excluding hair, gizmos and overlays. At a candidate contact's projected position compare its camera depth with the first head hit, using a scale-aware tolerance. Test silhouette misses, grazing rays, perspective and orthographic projection. Do not infer visibility from a guide root alone, and do not use just the brush-center head hit.
- Begin with direct head ray queries on the bounded guide-contact workload and measure cost. Cache under a camera/head-transform revision; any acceleration must preserve the same visibility oracle. Sampling a segment needs enough coverage or conservative rejection to prevent a hidden subsegment being pushed by one visible sample. Keep mesh visibility out of the hair solver: pass explicit eligible contacts and protected-point constraints.
- Protect occluded points and masked guides during both contact solve and final length relaxation. If constraints conflict, conservatively limit the accepted edit instead of moving protected hair or relaxing the length tolerance. Gate 2a must validate feasibility on partially occluded guides.
- Apply root-facet membership before contact/visibility work. Verify excluded authored guides remain exact and record a representative example of accepted interpolation influence on neighboring rendered strands. Do not add hidden seams, binding overrides or an individual-strand layer to force a hard rendered boundary.
- Extract only the current comb's guide contact, frame conversion, fixed-distance stepping and final relaxation into a focused hair-domain module if needed for reuse. Keep the existing constraint solver. Establish characterization before extraction; do not wrap a hidden CombTool or duplicate its math.
- Maintain a fixed spatial cadence with carried remainder. Large pointer jumps must process their entire path, or drain a bounded queue before committing; a per-event step limit must not silently drop travel. Test event-density equivalence and large jumps explicitly.
- Reuse segment-capsule collision, root inverse mass and normalized guide-frame writeback. Keep authored lengths/tangents unchanged unless an explicit shape/frame update requires them. Update only touched GPU guide rows and debug guides; never rebind or resample for a stroke.
- Start without the existing shader-only comb pushout for the new brush. It must not appear to edit hair while previewing, and a disappearing cosmetic effect must not masquerade as a committed stroke. Judge guide-driven visible results early; any cosmetic clamp requires separate active/inactive and post-commit verification.

### Application integration

Give the new tool the same small public lifecycle as existing tools: enable/disable, idempotent `finishEditing`, `canStyle`, mask setters, edit notification and stroke begin/end callbacks. Keep tool selection distinct from brushing-active state. `setActiveTool` remains the only owner of tool activation. Finish Brush before disabling it; do not copy the existing comb's mid-disable abort behavior, which can discard history capture without rolling back the shape.

Include Brush in every shared gesture-completion path, UI synchronization, inspection-overlay handling and dispose path. History remains guide patches, with no structural snapshots for brushing. Preserve GuideStore/SeamStore identity on load/restore and keep selection out of persistence.

## Original acceptance matrix — ORB-1 (historical; superseded by ORB-3)

The active pass/fail thresholds and review loop are in [ORB-3](orthographic-ray-brush-acceptance.md). This original strict-isolation matrix is retained only as historical planning context; its rendered-strand exclusion wording does not apply to scope v3.

| ID | Requirement | Evidence / pass condition |
| --- | --- | --- |
| O1 | Orthographic grooming is editable | Browser capture and interactions show ordinary presentation; finite comb edits and undoes under orthographic projection. |
| O2 | Stable projection and presets | Deterministic target-plane scale/center checks within one CSS pixel; both projections resize correctly; six presets and free orbit work, including top/bottom. Repeated toggles introduce no drift. |
| O3 | All camera consumers agree | Real picking, comb/scissors gizmos and seam interactions align with the pointer in both projections. Technical return restores grooming state, including orthographic zoom, and restores Brush inactive. |
| B1 | Cursor, activation and navigation | Real pointer trace shows hover/no change, held-button editing, release/exit/cancel completion, visible state, no idle edits, and camera navigation without a brush streak. |
| B2 | Front-only reach and contact | Near/far hair on one ray, a radius-edge ray with different scalp depth, partial occlusion, silhouette misses, segment-interior contact, long hair, transformed head and both projections demonstrate visible contact with no change to protected hair, including reconstructed strands. |
| B3 | Selected facets only | All/Selected mode, nonempty/empty/copied mask, selection changes and cross-facet guide blending are tested. Hair rooted outside the mask stays unchanged during/after brushing and after save/load; no silent unrestricted fallback. |
| B4 | Stable deformation | Same sampled path at sparse/dense event delivery agrees within a fixture-defined numeric tolerance; large jumps have no skipped bands. Root points remain exact; settled test fixtures pass `auditGuideLengths` at existing `LENGTH_TOL = 1e-3`. |
| B5 | Correct history and exits | One entry per changed pass; no entry for no-op; exact guide-state undo/redo; every listed interruption ends the pass once and leaves history usable. No stale stroke resumes after load or a mode change. |
| I1 | Authored and derived state preserved | Instrumentation shows touched-row updates without stroke rebinding/rebuild; no camera/brush settings in JSON; save/load round trip retains edits; growth preview leaves authored guides unchanged and locks Brush. |
| I2 | Existing grooming still works | Browser sequence: initial head/hair → select/add/remove → finite comb → brush → shortening cut → seams → undo/redo → save/load, under both projections. Include normal and narrow desktop layouts. |
| I3 | Responsive combined result | Record baseline/candidate frame-time and pointer-to-edit traces on the same machine/browser, viewport, seed, guide/strand counts and scripted sweep. Establish an explicit budget from Gate 0 before claiming a performance pass; screenshots alone do not establish responsiveness. |
| I4 | Repository verification | Focused behavior tests, full test suite and production build on the combined source. Keep the four known failures visible; no new failures. |

The existing comb's post-solve scalp half-space clamp is a documented length-error risk. Capture residuals on scalp-contact fixtures before and after reuse; do not loosen `LENGTH_TOL` to hide a new failure. If the new brush cannot meet the invariant on representative strokes, record the blocker and revise scope explicitly rather than adding a head-collision redesign silently.

For new deterministic behavior, run focused tests RED before production changes, then GREEN. For extraction, passing before/after characterization is sufficient. Browser evidence should include before/during/after views, the opposite side for depth behavior, and a pointer/state trace for lifecycle claims. Save source revision/dirty qualification, fixture/seed, camera, viewport, browser and capture date with results. Do not overwrite historical Technical view or Growth evidence.

Run `npm test` and `npm run build`. If this shell still lacks npm, use the documented Node entry points; Node 24 requires the explicit `tests/*.test.mjs` glob. Baseline integration evidence reports 17 passing tests and four existing failures: console, seam-commit, seam-release and seam-tool. This planning session has not rerun them.

## Completion and next action

Current: the user chose existing guide-based masking; resume the brush build/review loop under v3 / ORB-3. Camera source/app wiring, correction loop, full suite/build and partial browser checks are complete; broader interaction acceptance remains open. The strict-strand counterexamples and larger design options remain historical evidence and do not authorize an authored-model expansion. No recurring monitor is requested.

## Local implementation delivery — scope v3

2026-09-28: both features are integrated. Astra/medium build-review loop corrected camera pan, forward-ray clipping, hidden root-segment usability and copied-mask highlighting. Final44 tests pass with4 known baseline failures; build passes. Browser evidence covers both brush projections/sizes,36 changed interruptions,4 existing-tool smoke scenarios and3 matched performance runs. See the [final review](../evidence/orthographic-ray-brush/integrated-brush/review.md) for the remaining B1/B2/I2 evidence gaps. Implementation is available through ordinary `npm run dev`; full ORB-3 acceptance is not claimed.
