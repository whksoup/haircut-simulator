# Growth preview — implementation architecture

Track: `growth-preview`. Scope v1. Stage: integrated, human evaluation pending. Coordinator and documentation writer: primary agent. Date: 2026-09-16. The design/rubric below was supplied before implementation; current results follow at the end.

## Product contract

- One runtime fraction `growthFraction` in [0, 1], initialized to exactly 1. It applies to every rendered strand, including strands produced by later rebuilds. It is independent of selection and authored length controls.
- A strand at fraction p is the root-side arc-length prefix of its own final rendered polyline: visible length = p × full length. At 0.5 the tip-side half is removed; retained bends and spatial positions stay unchanged. This is neither coordinate scaling nor undoing styling.
- At 0 there are no visible hair segments; guides remain intact. At 1 the full hairstyle returns without drift.
- Styling is enabled only at exactly 1. During preview, allow camera navigation, facet selection/inspection, saving, and loading. Lock comb/cut/seam edits, add/remove, density/length/seed changes, shape-affecting Look controls, and undo/redo, including keyboard and action callbacks.
- Save always serializes authored full state, with no temporary phase substitution. Load starts a new full-state baseline at 1 after successful validation; failed load leaves the current session intact. Slider movement never adds history entries.
- Entering preview ends the active styling gesture through the existing tool lifecycle before changing phase. Preserve edits already made, close their existing history transaction exactly once, cancel unfinished placement, release pointer ownership, and clear transient comb pushout. Reject/defer a phase change if that lifecycle cannot finish safely. Do not silently discard an in-progress edit.
- Returning to 1 restores edit availability but does not restart an old gesture. Evaluation uses the settled hairstyle with tools/pushout inactive as its full-state reference.

## Findings and scope boundaries

The Growth UI calls `setGrowth`/`update`, which are no-ops in R3. R3's existing `setPhase(weeks)` and shader instead subtract blended growth rate × time, using 0 as full. These semantics conflict with this request.

Changing only that fraction expression is insufficient. Equal-length guide segments do not guarantee equal-length segments after guide blending. The current parameter remap also skips original polyline corners, and jitter is evaluated relative to the new tip, changing retained shape.

Existing guide rate fields, JSON versions, and migrations remain compatible. Historical physical rewind helpers may remain independently tested, but must not drive or describe this preview. Revise old renderer-phase tests explicitly for the new contract; retain unrelated tests. Legacy comparison renderers and unrelated seam/console failures are outside this implementation.

## Geometry and renderer design

The reference is the actual full R3 centerline polyline, not the guide's stored scalar length. Keep guide length normalized as today; measure rendered strand length separately.

For each strand, reconstruct its full vertices Q[0..8] using existing guide weights, clump, length variation, strand frame, and jitter at original parameter k/8. With tool pushout inactive:

1. S[0] = 0; S[k] = S[k-1] + distance(Q[k], Q[k-1]).
2. D = p × S[8]. Locate the segment containing D and interpolate its cut point C.
3. Keep each original Q[k] whose S[k] <= D; map all remaining vertices to C.
4. Existing GL_LINES pairs then retain every complete segment, shorten one terminal segment, and collapse the rest. At zero, explicitly suppress drawing to prevent degenerate-line artifacts.

Handle zero-length segments without division by zero; a wholly degenerate strand stays invisible. Preserve root pinning. Do not resample evenly across the shortened curve: joining those samples can cut across its original corners.

Start with a bounded shader scan of the nine full vertices during preview. Keep a full-state fast path for styling. Both paths must use the same full-vertex reconstruction function, including jitter, so they cannot diverge. Measure the extra GPU cost before introducing a derived cache. A cache would add invalidation requirements for guide edits, bindings, Look settings, and rebuilds and requires a design checkpoint if needed.

Expose an explicitly named renderer API, `setGrowthFraction(p)` / `growthFraction`, and `uGrowthFraction`, default 1. Clamp finite inputs to [0,1]; reject non-finite inputs without changing state. Remove the ambiguous R3 weeks-phase API and update its callers/tests/comments. Preserve compatibility of serialized rate metadata. Phase changes update only runtime/uniform state, not guide textures or strand bindings.

## Application wiring and ownership

One builder owns the end-to-end production change, avoiding competing edits to shared wiring.

| Area | Planned responsibility |
| --- | --- |
| `src/hair/growthPreview.js` (new) | Pure reference prefix math and input contract; separate from physical rewind planning |
| `src/rendering/gpu/hairShaderGuides.js` | Full-vertex reconstruction, cumulative arc clipping, zero/full endpoints |
| `src/rendering/gpu/gpuHairR3.js` | Fraction API, default uniform, unchanged phase across rebuilds, diagnostic access |
| `src/app/main.js` | Authoritative runtime setter, gesture transition, tool arbitration, guarded authoring actions and keyboard history, successful-load reset |
| `src/app/ui.js` | Replace obsolete ramp controls with 0–1 slider and return-to-full action; synchronize lock state and explain “Return to 1.0 to style” |
| `src/tools/` as required | Only lifecycle/guard corrections needed to prevent active-gesture leaks |
| `src/debug/` and `tests/` | Repeatable GPU capture, numerical oracle, interaction and persistence evidence |

Use a shared `canStyle()` predicate in app orchestration. UI disabling is feedback, not the only guard. Controls currently bound directly to groom fields must be staged/guarded before mutation; an onChange guard after a binding writes is too late. Audit direct tool and debug action routes. Do not introduce a generic command framework or modify store identity contracts.

## Evaluation rubric GROWTH-1 (proposed before implementation)

All correctness criteria are mandatory. Verdicts: pass, fail, insufficient evidence. Missing evidence cannot count as a pass. Numerical thresholds below are implementation targets; any change must be versioned and justified before grading.

| ID | Requirement and evidence | Pass threshold |
| --- | --- | --- |
| G1 | Startup, valid load, repeated scrubbing, rebuild; runtime/UI/uniform trace | Default/load = 1; all strands share phase; rebuild preserves current phase; finite/clamped input contract |
| G2 | Independent arc oracle applied to captured full and shortened GPU centerlines | Per strand, abs(Lp − p L1) <= max(1e-6 mesh units, 1e-4 L1) |
| G3 | Compare captured retained segments/cut point against full-polyline prefix | Vertex/tip error <= max(1e-6 mesh units, 1e-4 L1); retain original corners in order, no geometry beyond cut; anchored root |
| G4 | GPU captures/screenshots at 0 and 1, repeated 1→0→1 | Zero visible segments at 0; no NaNs; at 1 same settled full positions within G3 tolerance |
| G5 | Authored-state/serialization and history snapshots across scrub/save | Exact unchanged canonical authored values and history entries; actual downloaded save matches full-state payload; load round-trip retains guides/seams and starts at 1 |
| G6 | Real browser attempts to edit via controls, pointer, shortcuts during preview, including transition mid-gesture | No authored changes below 1; prior gesture closes exactly once; camera/selection/save remain usable; editing works again at 1 |
| G7 | Browser smoke after integration | Head/hair, select/add/remove, comb, cut, seams, undo/redo, save/load checked; no new exceptions; baseline failures identified separately |
| G8 | Human compares fixed-camera phase series and scrubs live | User confirms apparent tip-side truncation and retained shape; no substitute agent approval |

### Fixture and capture manifest

User selected the built-in default groom: `src/app/defaultGroom.js`, `DEFAULT_GROOM`, with `public/models/head.glb`. It contains facets 309, 308, 329 and guides 1, 2, 3. Record fixture/model hashes and migration output. If a standalone JSON is useful, export this fixture through the existing serialization path and record provenance; do not invent a different hairstyle.

- Capture p = 1, .75, .5, .25, 0, then 1; additionally probe .01, .99 and values bracketing an actual segment boundary numerically.
- For all three facets, log guide IDs, roots, normalized points, stored lengths, measured guide arcs. Numerically evaluate every strand in these facets; choose at least five deterministic strands per facet (or all if fewer) for readable detailed reports. Log strand root/seed, guide IDs/weights, full vertex arrays/arcs, phase vertices/arcs, length ratio, prefix error and finite checks. Validate the double-precision oracle on analytic fixtures within 1e-10 times max(1, full length) mesh units.
- Use all three default guide curves. Add clearly separate synthetic fixtures for unequal guide lengths, opposing bends/blended nonuniform segments, repeated vertices, degeneracy, nonzero jitter/length variation, and clump extremes. Never label these as the default groom.
- Capture fixed front/side/top views plus close-ups of each facet at all five main phases. Keep camera matrices, viewport/DPR, seeds and Look settings fixed; provide labeled contact sheets. Include a slow scrub recording or timestamped trace for continuity.
- Numeric rendered claims require GPU output from the same production vertex reconstruction (e.g. diagnostic float render-target readback in the existing WebGL context). Identify shader/source hash and framebuffer precision, check GPU readback support, and validate its coordinate output on a known straight fixture first. A separate JS shader mirror alone is insufficient. If GPU output is unavailable, G2/G3 remain insufficient evidence until another supported GPU capture method is established.
- Every artifact manifest records run ID, local date, source revision plus dirty-source hashes, fixture hash, producing command/scenario, browser/GPU, viewport, camera and settings. Keep baseline and candidate captures distinguishable.

Performance is an explicit investigation, not an unsupported FPS claim: compare full/preview frame-time median and p95 after 5 s warm-up over 15 s, three runs, same browser/device/viewport and strand counts. Test the default fixture and a labeled denser fixture. Report results before human review; a performance acceptance threshold must be agreed/versioned if measurements reveal a usability concern. Do not optimize away required geometry correctness.

## Build → evaluation → human loop

1. Coordinator records the current dirty-source identity and captures settled full-state baseline. Confirm GPU diagnostic support. Give builder scope v1 and GROWTH-1 before changes.
2. Builder establishes RED tests for ratio/prefix behavior (including blended unequal segments and jitter), runtime default, save immutability and edit lock. An import error or existing unrelated test failure is not RED. Implement, obtain focused GREEN, then run `npm test` and `npm run build`.
3. Builder captures browser/GPU evidence and completes smoke scenarios. Handoff includes source identity, artifacts, focused RED/GREEN, full check results and limitations. Current documented baseline is five test-file passes/four failures; remeasure, never hide them.
4. Seaming reviews actual cross-system state/restore/persistence/gesture contracts read-only. Builder owns corrections. Coordinator reruns affected combined checks after changes.
5. Critic grades supplied artifacts against GROWTH-1, citing evidence per criterion. Start with one review and one correction/review round. Stale captures must be regenerated for affected source changes. Unresolved evidence/rubric disputes return to the coordinator/user explicitly.
6. Present contact sheets, numerical summary (especially 0.5/full), known limitations and a live preview for human review. Ask whether the root-side shape and shortening match intent. Record feedback; classify a defect versus a scope change, update scope/rubric when needed, and run the affected build/capture/review cycle again. Human feedback comes after a concrete reviewable build.
7. Coordinator closes only after mandatory evidence and human acceptance. Update README/architecture to accepted implemented behavior then; until that point this document is a plan, not proof the feature works.

## Architecture checkpoint (before implementation)

At the architecture checkpoint, read source and obtained independent seaming/critic design input. Coordinator adopted exact segment clipping and all-strand evaluation on the default facets. Chose an explicit fraction API instead of reusing the old weeks API name, and strand-relative GPU tolerances to avoid a head-scale tolerance masking errors on short strands. No production edits, test runs, browser captures or feature acceptance existed at that earlier checkpoint. Implementation results are recorded below. Checkout HEAD is `218a0fdd847ee6ea544c92696de03180e9b577ac` with extensive pre-existing uncommitted relocation/application work; HEAD alone does not identify this source.

Runtime agent spawning was exercised for the seaming and critic roles in the architecture session.

### Implementation evidence (2026-09-16)

- End-to-end builder implementation integrated in the shared dirty checkout; no commit. Runtime fraction, exact GPU clipping, authoring guards, gesture completion, load reset and staged control synchronization are implemented.
- Baseline with new RED assertions: `docs/evidence/growth-preview/baseline-with-red.txt` (five pass, four known failures, two intended new failures). Only the two default-fraction assertions have demonstrated RED/GREEN; later analytical/lifecycle tests were added as regression coverage.
- Focused: `focused-green.txt`, eight passes. Final full suite: `candidate-test.txt`, twelve pass/four known failures. Final build: `candidate-build.txt`, success, `index-B1O7fh3n.js` 817.72 kB; existing size warning remains.
- Final GPU run: `run-1789495959352-candidate-evaluation.json` and associated raw inputs/GPU arrays/contact sheets in the same evidence directory. All 1,671 default-groom strands, three Look configurations plus adversarial fixtures, 45 scenarios, no failed harness checks. Maximum arc error 8.8068794e-8 mesh units. Page-load and before/after capture source hashes agree.
- Real native comb/cut drag evidence: `ui-1789495675424-native-stroke-comb-1789495699058.json`, `ui-1789495725794-native-stroke-scissors-1789495737404.json`. The opt-in harness requests preview from a real tool edit while history is busy; each stroke closes one history entry and late pointerup preserves that entry and groom.
- Save action Blob payload captured at fraction .5 equals authored JSON. Browser download completion remains unconfirmed; neither an attempted click nor a matching payload proves delivery to disk. Actual filechooser load succeeded and reset preview to 1; invalid and valid app-load checks also pass in the final numerical run.
- Seaming found and builder corrected stale staged globals after undo and a misleading rejected-tool dropdown; reviewer reread fixes. Critic completed one review and one bounded evidence follow-up: G1–G4 and G6–G7 pass; G5 download delivery/G8 human acceptance remain insufficient evidence. No mandatory implementation failure established. No blanket green test or completed human-evaluation claim.
- Critic independently recomputed 45,170 strand-phase comparisons with no failures; maximum prefix error 8.9753614e-8 mesh units, half/full ratios .4999998611–.5000001211, root displacement zero. Follow-up independently corroborated the real UI state transitions and all12 frame-time summaries. G5 delivery and G8 human acceptance remain unconfirmed.
- Final real-control smoke evidence is indexed by `browser-smoke-summary.json`, with uniquely named `ui-1789496304137-interaction-1..10` JSON/PNG captures. Covers seed edit, blocked preview undo/tool selection, restored undo/display/redo, native facet selection/add/remove, seam edit/lock/undo, and camera zoom while previewing. Final browser error query returned no errors from the final run onward.
- `perf-1789496002166-performance.json`: three paired runs per workload on Intel UHD/ANGLE at 955×856, DPR1; 5s warm-up +15s samples per case. 1,671-strand default and 7,850-strand dense fixture: median RAF interval6.9ms at full and half; p95 across runs7.9–8.8ms. This is observed frame pacing on one device, not an isolated GPU timing or broad performance guarantee.

Next action: human review at `http://127.0.0.1:5173/` and comparison page `http://127.0.0.1:5173/tests/browser/growth-review.html?run=run-1789495959352`. Ask whether half growth looks like removing the tip-side half without moving surviving bends, and confirm Save download delivery in the user's browser. Keep the track open until human acceptance and remaining delivery evidence are resolved.

Early `baseline-test.txt`, `baseline-build.txt`, `focused-red.txt` are failed sandbox launches, retained with this qualification. The older `run-1789494420315-*` is an intermediate capture superseded by the final run. Early unprefixed `interaction-*.json` contain exploratory UI snapshots and are not a complete ordered trace; later UI runs use unique IDs.
