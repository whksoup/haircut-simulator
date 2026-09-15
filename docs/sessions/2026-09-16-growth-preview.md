# 2026-09-16 — Growth preview architecture

## Purpose and scope

Plan `growth-preview` scope v1 and its first builder → evaluation → human-review loop. This turn is architecture only, per user request. Primary agent owns documentation.

## Progress and evidence

Read required orientation/workflow and inspected active UI/app/rendering growth paths. Independent seaming and critic agents reviewed contracts and evaluation design read-only. Existing UI invokes no-op growth methods; unused shader rewind subtracts absolute rate × weeks and starts full at zero. Neither meets the requested global retained fraction.

Planned exact clipping of the full rendered polyline, preserving corners and measuring arc after blending/jitter. See [architecture and rubric](../workstreams/growth-preview.md). No application source changed and no tests/build/browser evaluation ran in this session.

Source: local dirty checkout at HEAD `218a0fdd847ee6ea544c92696de03180e9b577ac`, extensive pre-existing relocation and application edits preserved. Prior test/build baseline remains reported in status, not newly verified here.

## Decisions and scope changes

- User confirmed default groom as the fixture; located `DEFAULT_GROOM` in `src/app/defaultGroom.js`, facets 309/308/329.
- Fraction defaults to 1; preview is runtime-only, save keeps full authored state, styling locks below 1.
- Use actual GPU strand output plus independent arc checks; guide logs and CPU mirrors alone cannot prove displayed geometry.
- Plan one end-to-end builder, selective seaming review, critic against a supplied rubric, then human review of a concrete build. Roles were successfully spawned; implementation-loop effectiveness is still untested.

## Explorations and open questions

GPU diagnostic support and preview scan performance require implementation-time measurement. GROWTH-1 numeric tolerances are proposed engineering thresholds, not measured outcomes. Human visual acceptance is pending a build. Historical physical rewind helpers/rate metadata remain compatible but do not define this feature.

## Next starting point

Read [workstream](../workstreams/growth-preview.md); inspect dirty state; capture baseline, validate GPU readback feasibility, and begin focused RED tests. No production implementation is implied by the planned stage.

## Implementation continuation

User authorized implementation in the next turn. Builder owns production code and focused tests; coordinator owns diagnostic capture, browser scenarios, evidence and docs. Work remains scope v1/GROWTH-1.

Browser baseline saved in `docs/evidence/growth-preview/baseline-browser.json` and `baseline-full.png`, including model/fixture/source hashes and full serialized groom. The harness initially used the wrong asset base URL; corrected it and reloaded before baseline capture. Default groom then loaded all three facets/guides correctly. Initial browser-open tool call took over five minutes; subsequent calls responded normally.

Initial baseline test/build logs contain filesystem sandbox EPERM, not a behavioral baseline; builder asked to rerun with required access. Earlier commentary incorrectly inferred the documented baseline had been reproduced and was explicitly corrected. No acceptance is based on those failed launches.

Coordinator added opt-in local evaluation harness under `tests/browser/` and production-GLSL readback module `src/debug/growthCapture.js` (not imported by the application). Local Vite server runs on 127.0.0.1:5173. Evidence POST handler only writes validated JSON/PNG names inside the workstream evidence directory.

Coordinator reran unrestricted checks: `baseline-with-red.txt` has five passes and six failures (the four documented baseline failures plus two new intended growth failures); `baseline-build-unrestricted.txt` passes, producing the same baseline `index-DPwTWVUH.js` asset. The builder's escalation call had waited for approval and was interrupted after it stopped progress; coordinator now owns command execution to avoid duplicate approval waits. Production implementation resumed using the established RED evidence.

Read-only diagnostic seaming review identified weak calibration/provenance and coverage gaps. Coordinator strengthened the harness with unique run IDs, hashes across production and harness sources, page-load source identity, translated/rotated known-coordinate calibration, analytic oracle calibration, repeated vertices, actual segment-boundary probes, full history content comparison, rebuilt GPU geometry, and default/dense performance scenarios. Actual UI actions/save/load remain separate browser evidence obligations.

## Integrated result and human handoff

Builder completed the runtime fraction, GPU arc clipping, authoring locks, safe tool finish, successful-load reset and staged UI synchronization. Seaming caught and builder corrected stale staged values after undo and a stale tool dropdown on rejected preview activation. Additional fixes keep disabled comb pushout cleared and retain attached file inputs/download URLs through browser consumption.

Final checks: `candidate-test.txt` twelve pass/four known baseline failures; `focused-green.txt` eight pass; final `candidate-build.txt` passes with `index-B1O7fh3n.js`,817.72kB, existing size warning. No test skips or weakened baseline assertions. Old physical rewind tests are clearly labeled and remain separate from preview semantics.

Final GPU evidence is `docs/evidence/growth-preview/run-1789495959352-*`. All1671 strands across facets309/308/329,45 scenarios, zero harness failures. Critic independently recomputed45170 strand-phase comparisons: max arc8.8068794e-8, max prefix8.9753614e-8 mesh units, exact roots. All44 manifest file hashes matched the final source. G1–G4 pass in initial critic review; follow-up supplies real UI smoke/performance evidence.

Real native comb/cut drags were armed by the test page to request preview during onEdit with history still open. Each trace shows busy true/depth0 → busy false/depth1; late pointerup leaves both authored state and depth unchanged. Real controls/shortcuts/select/add/remove/seam/zoom/undo smoke is indexed in `browser-smoke-summary.json`, with unique `ui-1789496304137-interaction-*` snapshots. No final-browser errors were returned after the final capture start. Earlier incomplete-source HMR errors and existing topology/color warnings are qualified separately.

Actual filechooser load reset .5→1 and cleared history; the tool took almost9minutes to complete, so no additional native file attempts were made. Save Blob payload at.5 equals authored full state, but browser download completion and disk delivery are unconfirmed. Do not claim G5 fully passed. Early unprefixed exploratory interaction files had naming/timing limitations; final uniquely named snapshots deep-copy state synchronously and supersede them as a trace.

Performance: `perf-1789496002166-performance.json`, three paired full/half runs on1671/7850 strands,5s warm-up+15s recording per case; median6.9ms and p95 range7.9–8.8ms RAF intervals on Intel UHD/ANGLE,955×856 DPR1. No user-visible performance issue observed on these workloads; no broad performance guarantee.

Stage: integrated, awaiting human evaluation and download-delivery confirmation. Live app:127.0.0.1:5173. Review page: `/tests/browser/growth-review.html?run=run-1789495959352`. No commit or deployment. Primary agent owns remaining documentation and human feedback; builder remains available for corrections. Do not close the track solely because automated geometry checks passed.

Critic bounded follow-up completed: G6/G7 pass after raw UI snapshots/image review; all12 performance summaries independently reproduced. G1–G4 remain pass. Overall rubric recommendation remains insufficient evidence solely for G5 browser-delivered file and G8 human visual acceptance. No mandatory implementation failure established, and no further automatic correction cycle recommended absent a new defect.
