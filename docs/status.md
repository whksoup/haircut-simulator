# Project status

Updated: 2026-10-03 (Asia/Singapore). Maintained using [the documentation workflow](workflow.md).

## Main build integration

Both the horizontal 45° brush and scalable/scrollable Groom panel are accepted into `main` in `F:/haircut-simulator`. This supersedes the isolated-experiment and AgentRefactor working-branch instructions below. The experiment banner is removed. Current integration and verification: [2026-10-03 session](sessions/2026-10-03-main-integration.md). Earlier entries retain their historical verification context.

## Technical view integration

At the user's request, the current Technical view snapshot `e4333dc` is merged into `AgentRefactor` at `C:/Users/He Kai/haircut-simulator`. This is the working branch for subsequent tasks. The September 27 separate-snapshot freeze is superseded by this integration; the checkpoint monitor remains paused. See the [integration session](sessions/2026-09-28-technical-view-integration.md).

Application source and tests are taken unchanged from the Technical view snapshot. Merge conflicts affect documentation only; both planning and recovered implementation history are retained. Fresh combined verification: 17 tests pass and the same four known failures remain; all five Technical view tests pass. Production build passes with the existing size warning and the same candidate JavaScript asset hash. No fresh browser run was performed for this source-identical integration. Historical browser evidence does not establish full TV-1 acceptance.
## Existing system and baseline

Guide-based R3 GPU grooming supports selection, combing, cutting, seams, history, and JSON persistence. See [README](../README.md) and [architecture](architecture.md) for behavior and ownership.

Verified 2026-09-16 on the local dirty checkout after growth implementation: production build passes (`index-B1O7fh3n.js`, existing >500 kB warning); full suite has twelve passes and the same four [documented failures](architecture.md#verification). Growth preview is connected and GPU/browser evidence is recorded in the [growth session](sessions/2026-09-16-growth-preview.md) and [workstream](workstreams/growth-preview.md). Human visual acceptance and browser Save download delivery remain unconfirmed. That historical dirty state was committed during the September 27 freeze.

## Isolated experiment

SNAP-2 implemented and verified locally in `F:/haircut-simulator`: cylinder stays parallel to scene ground; heading snaps by 45° about world Y. This supersedes SNAP-1's retained camera tilt. Ten focused tests pass; full suite has 54 passes and the same four known failures; build passes. Trusted browser strokes in both projections verify horizontal endpoints, useful edits, one history entry, exact undo/redo and length invariants. Exact pole views safely skip edits. [Current session](sessions/2026-09-29-horizontal-brush.md); [prior experiment](sessions/2026-09-28-snapped-brush.md).

## Current and recent tracks

2026-09-29: shared Groom panel scaling implemented in `src/app/uiPanelScale.js` and its stylesheet, mounted from `ui.js`. Bottom-left drag handle scales text and controls, with a viewport-bounded scroll area and fixed footer. Browser verified enlargement/shrinking, wheel scrolling, keyboard/reset, Technical view hiding/restoration and unchanged groom/history. Full suite: 54 pass / same four known failures; direct Vite build passes with existing size warning. Browser validation used actual pointer input; no additional Node tests for this DOM-only change. Intended for the main build, currently uncommitted in this checkout alongside the separately scoped brush changes.

| Track | Scope | Stage / owner | Next action / evidence |
| --- | --- | --- | --- |
| Orthographic grooming and camera-ray brush | v3: orthographic grooming; hold-to-brush with head-visible guides and selected-facet guide masking | Implemented and reviewed; acceptance gaps recorded / Astra-medium builders and reviewer with coordinator | [Phase plan](workstreams/orthographic-ray-brush.md), [ORB-3 criteria](workstreams/orthographic-ray-brush-acceptance.md), [evidence](evidence/orthographic-ray-brush/README.md), [session](sessions/2026-09-28-orthographic-ray-brush-plan.md). Camera and brush integrated without schema expansion. 44 tests pass / same four failures; final build passes. Real brush drags pass both projections/sizes;36 changed interruption cases, four existing-tool smoke scenarios and responsiveness pass. Review found no remaining source defect; B1/B2/I2 evidence gaps prevent full phase acceptance. See final review. |
| Haircut Technical view | v1: illustrated finished-cut inspection, camera presets and head/hair cutaway | Integrated; core rubric passes / coordinator with parallel builders and independent review | [Evidence](evidence/technical-view/README.md), [session](sessions/2026-09-18-haircut-instruction-ui.md). 101 browser assertions pass; 5 targeted tests pass; full suite 17 pass / same 4 known failures; build passes. Native download delivery/picker and successful shortening cut remain verification limits. Snapshot `e4333dc` folded into `AgentRefactor`; fresh integration checks are recorded in the September 28 session. Browser results above are historical. |
| Growth preview | v1: global retained arc fraction, styling lock, immutable full-state save | Integrated; human evaluation pending / primary agent | Final GPU run passes45 scenarios/1671 strands; real tool/controls smoke and full checks recorded. Critic passes G1–G4/G6–G7; G5 download delivery and G8 human acceptance remain insufficient evidence. [Plan, rubric and remaining acceptance](workstreams/growth-preview.md), [session](sessions/2026-09-16-growth-preview.md). Next: human visual review and Save download delivery check |
| Agent/documentation workflow | v1: three roles and three documentation layers | Closed (files/configuration validated) / primary agent | Use on the next substantive task; runtime role discovery not exercised in this session; [handoff](sessions/2026-09-15-agent-workflow.md) |
| Critic and test-first extension | v2: critic role and builder procedure | Closed (files/configuration validated) / primary agent | Ready for a later implementation trial with a supplied rubric; runtime role behavior untested; [validation](sessions/2026-09-16-critic-test-first.md) |

## Proposed follow-up, not active implementation

- Reconcile known seam/console test failures with intended behavior.
- Repeatable browser smoke scenarios and selective architecture checks.

Other maintenance candidates are listed in [architecture follow-up work](architecture.md#suggested-next-work). No owners or schedules have been assigned to these suggestions.
