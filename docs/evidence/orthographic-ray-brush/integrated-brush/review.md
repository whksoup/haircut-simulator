# ORB-3 independent acceptance review

2026-09-28, Asia/Singapore. Astra/medium independent read-only review of scope v3 on `AgentRefactor`, base `57ca555`. Coordinator transcribed the final review. Production source matches `browser/smoke-20260928063218735-checks.json`, except the later UI getter correction described below.

**Phase acceptance: insufficient evidence.** No remaining confirmed implementation violation was found. Existing shared-guide interpolation is explicitly accepted by the user; strict exclusion of neighboring rendered strands is not promised.

| Criterion | Grade | Evidence / limits |
| --- | --- | --- |
| C1 | Pass | Ordinary orthographic grooming, camera state preservation and trusted finite-comb edit with exact undo/redo. |
| C2 | Pass | Camera numerical/real-controls tests, 17/17 browser checks, picking/current gizmo cameras, exact masked Technical return. |
| B1 | Insufficient evidence | Trusted brush edits pass both projections at both sizes, including exact undo/redo. Saved application-level before/during/after imagery including DOM cursor and legible controls is incomplete. |
| B2 | Insufficient evidence | Whole-segment visibility, transformed head oracle, hidden prefix/middle preservation and actual GLB usefulness pass. One partial-hidden tool fixture still needs exact protected-point comparisons during movement, after release and reload in one sequence. No preservation failure observed. |
| B3 | Pass | Single/empty/copied/multi-facet masks, useful selected edits, exact excluded guide preservation, undo/redo/reload. |
| B4 | Pass | Root/length/tangent invariants, length audit, cornered1/8/64 cadence, useful long jump across5 guide regions; existing finite-comb clamp residual characterized separately. |
| B5 | Pass |36 changed interruptions (18 exits in each projection), one settlement, exact history branches, no busy state/no still-held resumption. Interruption delivery synthetic; ordinary trusted strokes independently verified. |
| I1 | Pass | Store identities, existing schema, guide-patch history, affected-row updates and non-authoring growth preview preserved. |
| I2 | Insufficient evidence | Four smoke scenarios pass pick/add/remove/seams/measurable cut/history/callback persistence. Finite-comb editing matrix remains incomplete: trusted evidence is1440×899 orthographic, other scenarios verify placement/camera only. No native download/file-picker claim. |
| I3 | Pass |3 matched default-fixture runs; brush framep95 7.1ms, updatep95≈1.4ms,p99 1.4–1.5ms. Source stable. Synthetic dispatch-to-update measurement with22 edited samples/run after saturation, not native input latency. |
| I4 | Pass |18 brush tests; assembled44 pass/same4 known failures/no skips; build passes with existing >500kB warning. |

The source review traced head segment protection through contact solving, relaxation, normalized writeback and final visibility/length validation; copied mask state through independent overlay/Technical return; tool arbitration through one settlement callback; guide history through affected GPU row updates and in-place store restoration. Both reviewer defects (behind-camera capsule cap and missing copied-mask highlight) were corrected and reviewed. The actual-head inset-root usability issue was corrected with fixed hidden-segment endpoints, not relaxed visibility tolerance.

Principal evidence: `brush/orb3-focused-node24.txt`, `brush/orb3-final-full-suite.txt`, `integrated-brush/build.txt`; browser `manual-20260928062459458-result.json`, `manual-20260928062517646-result.json`, `manual-20260928063042147-result.json`, `manual-20260928063053241-result.json`; `camera-20260928062628137-checks.json`, `camera-20260928063053213-checks.json`; `smoke-20260928063218735-checks.json`; `integration-lifecycle-20260928063410133.json`; `integration-performance-20260928062849456.json`.

Coordinator follow-up: live UI inspection found radius/scope could display stale values after programmatic setters. Controls now read the tool's current state using getters/listening displays. This is a narrow UI synchronization correction; final combined checks are repeated. Held-preview captures are explicitly synthetic and do not close the full B1 image-sequence gap.

Final UI follow-up was independently reviewed as sound: getters/listening controls do not cause setter feedback, preserve copied-mask semantics and settle before parameter changes. Live browser AX inspection confirmed Radius0.1 after `setRadius(0.1)` and the active 'Brushing — release to finish' state. Final build is `index-COJNmB9M.js`;44 tests pass,4 baseline failures remain. No change to B1/B2/I2 acceptance limits.
