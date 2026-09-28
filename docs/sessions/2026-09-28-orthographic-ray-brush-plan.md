# 2026-09-28 — Orthographic grooming and camera-ray brush planning

## Purpose and scope

The user requested a new implementation phase containing orthographic view in ordinary grooming and an extremely long camera-forward comb/brush that follows the mouse with “click for active” behavior. This session plans that phase; it does not implement application changes.

Track: `orthographic-ray-brush`, scope v2, **planned**. Coordinator is the single documentation writer. Plan and acceptance matrix: [workstream](../workstreams/orthographic-ray-brush.md).

## Progress and evidence

- Started from clean `AgentRefactor` at `57ca555` in `C:/Users/He Kai/haircut-simulator`, after the Technical view integration.
- Read README, architecture, workflow, status and the September 28 integration handoff. Inspected the relevant viewer, Technical view, tool, guide-constraint, UI, growth and history integration paths.
- Orthographic camera support already exists inside Technical inspection, where editing is disabled. Ordinary grooming needs its own projection control and shared camera handoff.
- Pointer raycasters read the active viewer camera, but comb/scissors TransformControls retain their construction camera. Both must be updated when grooming switches projection.
- The finite comb already provides guide-segment capsule contact, fixed spatial cadence, final length relaxation and guide-patch history. Reuse those contracts for a distinct brush tool. Dense hair is derived from guides, so independent rendered-strand editing is outside this proposal.
- Existing finite comb deliberately removed unbounded through-head influence. The requested long brush makes depth policy an explicit decision rather than an accidental solver behavior.
- Wrote a staged source-grounded plan with ownership, integration contracts and ORB-1 acceptance evidence. Application source, tests and canonical behavior documentation are unchanged.

Validation is documentation-only: reviewed the plan against the inspected source and checked the documentation diff/links. No fresh tests, build or browser claims. The previous integration's reported 17 passes / four known failures and passing build remain historical baseline evidence.

## Decisions and open questions

The user confirmed **hold the mouse button to brush**, **only hair in front of the head surface**, and **a selected-hair-facets-only option**. Scope v2 replaces the initial click-toggle and through-depth recommendations and adds facet masking as required work. No workers were dispatched, so there are no stale worker assignments to reconcile.

Visibility must be evaluated across the brush footprint, not only along its center ray. Selection is root-facet membership. Existing rendering blends three guides, potentially across facets: a filtered guide list alone does not prove excluded visible hair stays unchanged. Added a required visibility/facet-isolation feasibility gate before the full tool, including constraint propagation, reconstructed-strand evidence and persistence. If the current representation cannot satisfy the exclusions, record the smallest explicit design/scope revision rather than silently weakening “only.”

Other plan recommendations include an ordinary-grooming projection toggle, six orthographic presets, a separate Brush tool, and a camera foundation before brush integration. The default startup projection remains unchanged in the proposal. No agents, automation, or implementation tasks were started.

## Next starting point

Begin baseline characterization and camera integration under [scope v2](../workstreams/orthographic-ray-brush.md). Resolve the visibility/facet-isolation engineering gate before implementing the full brush. Preserve known failing tests and existing verification limits. Keep `main.js`, `ui.js`, status and session documentation under one owner if subsequently delegating.

## Implementation authorization and review checkpoint

The user next requested success criteria and delegation to Astra agents at medium reasoning for a build-review iteration loop. This authorizes implementation; the earlier planning-only statements describe the preceding checkpoint.

Defined [ORB-2](../workstreams/orthographic-ray-brush-acceptance.md): mandatory pass/fail criteria, explicit numeric tolerances and responsiveness budgets, provenance requirements, independent review followed by a bounded correction/review round. The coordinator retains shared app wiring and documentation. Camera implementation and brush isolation feasibility proceed independently; full brush implementation waits for its cross-system design contract. Delegated agents use gpt-6-astra/medium. Starting source remains 57ca555 with only the planning documentation dirty.

## Build/review iteration result

Dispatched `camera_build` (builder), `brush_design_build` (architect) and `independent_review` (seaming/critic responsibility), all gpt-6-astra with medium reasoning. Coordinator implemented camera app/UI wiring and the new opt-in browser harness.

Camera builder implemented shared Viewer camera assignment/notifications, six grooming presets, scale-preserving conversion/resize, Technical restoration, and cached gizmo camera updates. Independent review found a real r169 pan regression: perspective zoom was ignored by OrbitControls pan. Builder reproduced RED and corrected conversion to effective FOV with zoom 1; eleven focused camera/Technical tests pass. One bounded review/correction round completed; final re-review is being collected.

Combined source: 25 tests pass, the same four documented failures remain. Production build passes with the existing warning (`index-DCITRhaU.js`). Sandbox config access initially failed; approved reruns passed. Full logs/hashes and fresh browser results are in the [evidence manifest](../evidence/orthographic-ray-brush/README.md). Browser API checks pass17/17 at1440x900 and1024x768; actual trusted orthographic comb drag at1440x899 changed hair, recorded one entry and passed exact undo/redo. Camera browser coverage is still partial; no full-phase acceptance is claimed.

Brush builder and independent reviewer confirmed guide-sharing counterexamples: useful selected-guide changes necessarily move some excluded rendered hair. Two tests demonstrate the limitation, not brush success. Their proposed sparse authored-strand expansion needs explicit cut/comb, sampling identity, growth and persistence contracts; absolute versus additive shape state has user-visible consequences. No brush production/schema code was changed. Asked the user whether to include strict isolation with the larger authored-strand change, or retain existing guide-based masks with boundary influence. Await that scope answer before brush implementation. Camera work continued independently.

Next checkpoint: collect camera re-review, preserve evidence/remaining browser gaps, then resume the brush design/build loop only against the resolved user scope. No agents are authorized to change the brush's representation speculatively.

Final independent re-review received: [review record](../evidence/orthographic-ray-brush/camera/review.md). Pan defect resolved; C1 passes, C2 remains insufficient for missing actual pick/scissors pointer and active-tool Technical return evidence, camera-specific I1 passes, I4 passes for the current camera assembly. Reviewer verified final source hashes; no remaining confirmed camera violation. Camera and brush agents are idle. User scope question remains pending; overall phase is incomplete. The temporary browser tab and local verification server on127.0.0.1:5176 were closed after capturing evidence; no recurring automation was created.

## Scope v3 — existing guide masking accepted

The user confirmed that existing guide-based masking is fine and asked whether the app runs with `npm run dev`. The manifest maps that command to Vite; the ordinary app includes the camera changes. This answer resolves the brush scope checkpoint and resumes the authorized Astra/medium loop. ORB-3 applies head visibility and selected-facet exclusion to authored guides, allowing existing interpolation influence on neighboring/hidden rendered strands. No individual-strand layer or schema expansion is authorized by this scope. Notify all affected agents and use the same shared-file ownership.

### ORB-3 integration checkpoint — 2026-09-28

User confirmed existing guide-based masking and asked about startup: ordinary `npm run dev` remains the entry point. Brush domain/tool is implemented and wired into Tools, with radius and copied facet scope controls. Save/history, mode/camera, growth and structural operations finish the active brush stroke. Focused builder coverage passes, but phase acceptance is not yet claimed.

Independent review found two actionable gaps: a persistent visual mask overlay and forward-camera clipping of capsule end caps. Camera builder owns the overlay; brush builder owns clipping plus investigation of a no-change default-fixture browser stroke. Browser stroke evidence is retained even where failing. Root owns shared app/UI integration and browser verification. New tests remain synthetic where identified; real pointer and performance evidence are separate obligations.

### ORB-3 corrected-source checkpoint

Independent review found no remaining confirmed defects after forward-camera clipping, persistent mask highlighting and protected-segment correction. Actual default guide roots are slightly embedded; the brush now pins endpoints of pre-hidden segments while editing visible portions, with final visibility and length validation. The default-groom production-GLB regression is useful and passes. Cornered 1/8/64 sampling, a hidden middle interval and a long jump across five guide regions also pass.

Combined verification: 43 passing tests, same four baseline failures, zero skips. Build passes with existing >500 kB warning (`index-DL-rHaQ3.js`). Trusted browser brush drags at1440×900 succeed in orthographic and perspective, each one history entry and exact undo/redo.17/17 camera API checks pass on assembled source. Synthetic app lifecycle checks pass; they do not prove native download/picker delivery. Responsiveness and broader existing-tool smoke are still running.

### Final local delivery

Camera and guide-based brush are implemented and integrated. Astra/medium build-review corrections are complete; no remaining confirmed source defects. Final48 tests:44 pass,4 pre-existing failures; build passes (`index-COJNmB9M.js`, existing size warning). Four actual brush projection/size gestures,36 synthetic changed interruptions,4 existing-tool smoke scenarios and3 matched responsiveness runs pass. Radius/region display now reads current tool state after a final live-inspection correction.

The [final review](../evidence/orthographic-ray-brush/integrated-brush/review.md) retains B1/B2/I2 evidence gaps and does not grant full ORB-3 acceptance. Ordinary startup remains `npm run dev`; choose View→Orthographic and Tools→brush. No commit/push performed. Temporary browser/server testing resources are closed after verification.
