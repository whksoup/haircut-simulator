# Orthographic grooming / brush evidence

2026-09-28 (Asia/Singapore), `AgentRefactor` based on `57ca555`, shared dirty checkout. Rubric: [ORB-3](../../workstreams/orthographic-ray-brush-acceptance.md). Camera and guide-based brush are integrated locally. Full phase acceptance remains subject to the verification limits below.

## Camera build/review loop

- [Camera builder manifest](camera/README.md): initial camera-assignment RED/GREEN, numerical tests, first review's pan defect and correction RED/GREEN. The final camera sources are identified by `camera/review-source-hashes.json`.
- [Final independent review](camera/review.md): pan defect resolved; C1 passes; C2 remains insufficient for actual pick/scissors pointer operation and previous-tool return; I4 passes for current camera assembly. No full-phase pass.
- Independent Astra/medium review found that Three r169 ignores perspective `zoom` during pan. Conversion now expresses the effective field of view directly at zoom 1. The real-controls regression passes at previous orthographic magnifications 4 and 0.25. No dependency files changed.
- [Combined tests](integrated-camera/tests.txt): 25 pass, four known failures (console, seam-commit, seam-release, seam-tool). This includes six new camera tests and two brush infeasibility characterizations; passing the latter does not mean a brush exists.
- [Combined build](integrated-camera/build.txt): passes, `index-DCITRhaU.js`, existing >500 kB warning. Vite initially required an approved rerun because the sandbox blocked parent/config lookup. Final combined source/test hashes: `integrated-camera/source-hashes.json`.
- `baseline/tests.txt` is **startup plus the camera builder's newly added RED test**, captured concurrently: 17 pass / 5 fail. It must not be described as a pristine baseline or final regression. `baseline/early-build-approved.txt` predates the pan correction.

## Browser evidence

Local opt-in harness: run Vite with `--config tests/browser/vite-orb.config.mjs`, then open `http://127.0.0.1:5176/tests/browser/orb.html`. It writes only to this track's `browser/` directory. The ordinary app does not import the harness. Browser: Windows in-app Chromium 154, fixture `head.glb` and startup groom (3 guides, 1671 strands). Images contain the rendered canvas; JSON contains camera, viewport, authored groom and complete source hashes.

| Evidence | Result / limitation |
| --- | --- |
| `browser/camera-20260928032007597-checks.json` and matching images/metadata | Final corrected source, 1440x900 CSS px, 17/17 API assertions: camera/control/gizmo references, projected-head ray hits, six presets, Technical exact identity and pose restoration, camera-only authored JSON/history equality. |
| `browser/camera-20260928032044504-checks.json` and matching images/metadata | Same 17/17 at 1024x768. UI inspected at this width. |
| `browser/manual-20260928031948515-result.json` and adjacent manual PNG/metadata | Actual trusted pointer drag through the finite comb's orthographic gizmo, 1440x899. Hair changed, exactly one history entry, exact undo and redo. Event trace identifies the pointer path. Setup was an explicit harness action; deformation used actual pointer dispatch. |
| `browser/camera-20260928031720414-*` | Earlier pre-pan-correction source; historical only for affected camera behavior. |
| `browser/camera-20260928031822578-*` | Corrected source at 1280x677, before final two-size captures. |

The final two-size runs follow the manual comb edit, so their fixture includes that edit; their metadata carries the actual full groom. Do not treat them as pixel-identical startup comparisons. The manual setup preceded the drag; the first attempt was interrupted by a development reload and is not counted. Source did not change during the final successful captures.

Browser coverage remains incomplete for actual picking/scissors/seam pointer gestures in both projections, real right/Shift-right navigation, native save/file-picker delivery and broad regression checks. Numeric real-OrbitControls tests cover pan and pole behavior but are not real pointer dispatch. These are the historical camera-slice limitations; current brush evidence is recorded below. Full-phase acceptance is not inferred from a subset of passing checks.

## Brush design checkpoint

[Isolation design](brush/isolation-design.md), two production-binding characterization tests and their output establish that guide-only editing cannot guarantee strict exclusion of hidden/unselected reconstructed hair while producing useful single-facet edits. The user subsequently accepted existing guide-based masking. The individual-strand proposal is historical and was not implemented; no schema changes were needed.

Scope v3 / ORB-3 implements the accepted guide-mask semantics. Hidden authored segments remain fixed, while shared guide interpolation may influence neighboring rendered hair.


## ORB-3 integrated brush checkpoint

- [Brush implementation and focused evidence](brush/orb3-implementation.md): actual head geometry, protected hidden segments, cadence, mask, history and interruptions. Review found a behind-camera capsule cap and an actual default-groom root inset; both have regression coverage and corrections.
- [Mask overlay handoff](camera/mask-integration-handoff.md): copied facet highlight and three overlay tests. Pick→Brush preserves the working selection so the mask can be copied after switching.
- [Combined tests](integrated-brush/tests.txt): 40 pass and the same four baseline failures at this checkpoint. [Build](integrated-brush/build.txt) passes, existing >500 kB warning, `index-DL-rHaQ3.js`.
- Real trusted-pointer brushing at 1440×900 works in both projections: changed state, one history entry, exact undo/redo, passing length audit. Failing earlier default-root captures are retained as regression evidence, not counted as passes.
- `browser/integration-lifecycle-20260928062628537.json`: browser lifecycle callback checks pass at 1440×900. Inputs are explicitly synthetic; save/load is callback verification, not a native file-picker/download claim.
- `tests/browser/orb-integration.html` provides a separate matched responsiveness harness. Results and final review will be linked after completion.

## Final verification summary

Final build `index-COJNmB9M.js` passes; [final suite](integrated-brush/tests-final.txt)44 pass /4 known failures, no skips. [Independent review](integrated-brush/review.md) records no remaining confirmed source defect and explicitly withholds full phase acceptance for B1/B2/I2 evidence gaps.

- Trusted brush results: `manual-20260928062459458-result.json` (1440×900 orthographic), `manual-20260928062517646-result.json` (1440×900 perspective), `manual-20260928063042147-result.json` (1024×768 orthographic), `manual-20260928063053241-result.json` (1024×768 perspective). All change hair, create1 history entry, restore exact undo/redo and pass length audits.
- `camera-20260928062628137-checks.json` and `camera-20260928063053213-checks.json`:17/17 each on assembled source.
- `smoke-20260928063218735-checks.json`: all4 projection/size scenarios pass picking, add/remove, seam refresh, cut0.5→0.231389, undo/redo, masked Technical return and callback persistence.
- `integration-lifecycle-20260928063410133.json`:36 changed-stroke interruption cases pass. Input is synthetic; native capture loss is not claimed.
- `integration-performance-20260928062849456.json`:3 matched runs pass. Brush framep95=7.1ms, updatep95≈1.4ms,p99=1.4–1.5ms; only22 edited updates/run after saturation. Synthetic dispatch-to-update timing, not native input latency.
- Final UI control getter correction keeps displayed radius/region synchronized with the tool. It does not change brush geometry; final build/tests repeated. Earlier evidence hashes predate this narrow UI correction and are retained.

Known acceptance gaps: complete saved application-level before/during/after Brush UI/cursor imagery; partial-hidden preservation through a single held/release/reload sequence; complete trusted finite-comb edit matrix. Native file download/picker delivery is not claimed. These are verification limits, not observed implementation failures.
