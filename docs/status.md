# Project status

Updated: 2026-09-27 (Asia/Singapore). Maintained using [the documentation workflow](workflow.md).

## Frozen handover

User requested freeze and publication. See [README](../README.md) and [freeze session](sessions/2026-09-27-freeze-handover.md). Technical view implementation was recovered in a separate worktree on `codex/haircut-technical-view`, superseding earlier assumptions that task-list absence meant no implementation. Both branches are preserved separately; this baseline remains behaviorally unchanged. Checkpoint monitor paused; do not resume automatically.

Fresh baseline: 12 pass / 4 known failures; candidate: 17 pass / same 4 failures. Both builds pass with existing size warning. Historical browser evidence exists on the candidate; full TV-1 acceptance needs review. Sections below retain historical track context, not current dirty-state claims.

## Existing system and baseline

Guide-based R3 GPU grooming supports selection, combing, cutting, seams, history, and JSON persistence. See [README](../README.md) and [architecture](architecture.md) for behavior and ownership.

Verified 2026-09-16 on the local dirty checkout after growth implementation: production build passes (`index-B1O7fh3n.js`, existing >500 kB warning); full suite has twelve passes and the same four [documented failures](architecture.md#verification). Growth preview is connected and GPU/browser evidence is recorded in the [growth session](sessions/2026-09-16-growth-preview.md) and [workstream](workstreams/growth-preview.md). Human visual acceptance and browser Save download delivery remain unconfirmed. The working tree contains pre-existing uncommitted relocation and application changes; HEAD alone does not represent it.

## Current and recent tracks

| Track | Scope | Stage / owner | Next action / evidence |
| --- | --- | --- | --- |
| Haircut instruction UI | v1: stylist construction study of a finished haircut; UX slice over existing engineering | Planned / coordinator with design brief agent | [Brief complete](../.design/haircut-technical-view/DESIGN_BRIEF.md): dedicated desktop Technical view, illustrated rendering, one viewport with camera presets, cutaway clipping head/hair. Implementation pending. [Session](sessions/2026-09-18-haircut-instruction-ui.md) |
| Growth preview | v1: global retained arc fraction, styling lock, immutable full-state save | Integrated; human evaluation pending / primary agent | Final GPU run passes45 scenarios/1671 strands; real tool/controls smoke and full checks recorded. Critic passes G1–G4/G6–G7; G5 download delivery and G8 human acceptance remain insufficient evidence. [Plan, rubric and remaining acceptance](workstreams/growth-preview.md), [session](sessions/2026-09-16-growth-preview.md). Next: human visual review and Save download delivery check |
| Agent/documentation workflow | v1: three roles and three documentation layers | Closed (files/configuration validated) / primary agent | Use on the next substantive task; runtime role discovery not exercised in this session; [handoff](sessions/2026-09-15-agent-workflow.md) |
| Critic and test-first extension | v2: critic role and builder procedure | Closed (files/configuration validated) / primary agent | Ready for a later implementation trial with a supplied rubric; runtime role behavior untested; [validation](sessions/2026-09-16-critic-test-first.md) |

## Proposed follow-up, not active implementation

- Reconcile known seam/console test failures with intended behavior.
- Repeatable browser smoke scenarios and selective architecture checks.

Other maintenance candidates are listed in [architecture follow-up work](architecture.md#suggested-next-work). No owners or schedules have been assigned to these suggestions.
