# 2026-09-18 — Haircut instruction UI

## Purpose and scope

Track: haircut-instruction-ui, scope v1, investigating. Create a UI vertical slice over existing engineering, scoped through an interactive design brief interview. Coordinator owns documentation; design brief agent owns read-only design exploration and interview recommendations.

## Progress and evidence

Read README, architecture, workflow and status. Design agent inspected existing UI vocabulary. No application changes or runtime verification in this design session. Initial checkout was clean; subsequent status shows user-provided untracked `docs/reference/UIUX_References/`, preserved as reference material. Prior verification in status remains historical.

## Decisions and scope changes

- User frames entry as a completed or nearly completed haircut with which the user is happy. Present it as construction instructions inspired by IKEA or LEGO.
- Required visual direction: toon shader, white background, sharp outlines, optional delineation of planes; Rhino 8 Technical and Pen modes are reference points.
- Existing 3D simulator behavior must be preserved. The scope concerns displayed information.
- Candidate features, not yet committed: cross sections isolating hair planes; orthographic viewpoints with clipping and hair dimensions/angles; box panel controls inspired by MoMA reference; grid of hair growth stages.
- In-app composition versus extraction for composition in other software remains open.
- User permits generating additional reference images if useful. None generated yet.
- Primary audience is a barber or stylist inspecting construction: planes, profile comparisons and shape. Recreating the cut and procedural stepping are explicitly out of scope for now; this supersedes the earlier open interpretation of instruction sequences.
- Tone is humorous, inventive and buildable, with dry communication that treats the head like a furniture product.
- Settled core slice: illustrated rendering, camera presets and cutaway. One inspection viewport only, with free orbit and axis-aligned orthographic view switching; no simultaneous synchronized views.
- Cutaway hides one side of a plane and clips both head and hair. Arranged thin slices along a horizontal axis are an optional stretch subject to feasibility, not core acceptance.
- Dimensions and angles are deferred so the three core capabilities can be established first.
- Confirmed dedicated Technical view on the current haircut, compact boxed panel and Return to grooming.
- Confirmed desktop mouse/keyboard, keyboard-accessible controls and visible focus.
- Confirmed cutaway off on entry; initial enabled plane divides left/right vertically. Controls: on/off, axis selector, position slider and Flip side.
- Completed the [design brief](../../.design/haircut-technical-view/DESIGN_BRIEF.md). Scope is planned, implementation pending. No additional reference images generated.

## Explorations and open questions

Core interview decisions are settled. The brief identifies proposed visual/accessibility defaults. Exact MoMA panel appearance still needs visual inspection before claiming a match; outline/edge implementation and any exploded-slice feasibility need source and browser evaluation. A growth comparison grid and export are outside the selected core.

## Next starting point

Use the completed brief to scope implementation and visual acceptance. Preserve the simulator's behavior and authored state. Documentation was checked against the interview and skill template; no application build/tests were needed or run for this documentation-only checkpoint.

## Implementation checkpoint — Technical view v1

2026-09-18: implementation worktree `C:/Users/He Kai/.codex/worktrees/ddf1/haircut-simulator`, branch `codex/haircut-technical-view`, baseline `effc25c`. New worktree initially started at older `218a0fd`; switched to source checkout committed baseline before implementation. Copied authoritative brief and interview session; source checkout remains untouched. Coordinator is sole documentation writer. Agents own scene/shader presentation, UI/CSS, and read-only contract review; coordinator owns app arbitration/integration and browser evidence.

Acceptance scenarios defined before implementation: current default/authored haircut white/toon/outline; six orthographic presets and orbit label; optional plane edges; cutaway starts off, x split first, every x/y/z side at center and moved positions, disable restores whole object; repeated entry/return; focus/keyboard; grooming select/add/remove/comb/cut/seams, undo/redo and JSON save/load. No solver/schema changes or exploded-slice stretch planned.

Stage: implementing. Dependencies installed from locked local cache. Initial sandbox npm test attempt failed before tests due Node subprocess filesystem EPERM; approved rerun requested. This is an environment result, not a simulator regression. Browser evidence pending integration.

## Integrated result — 2026-09-18

Core Technical view implemented on the current R3 haircut: white toon head, illustrated hair/contours, optional plane delineation, one orthographic viewport with six presets/free orbit, X/Y/Z cutaway with relative position/flip. Main owns gesture completion and editing locks; entry starts clipping off/X. Return restores camera/material/light references, tool/overlay state and focus. Authored state, history, schemas and solvers are unchanged. No exploded-slice stretch was attempted.

Combined verification: `npm test` 17 pass and the same four known failures; `npm run build` passes with the existing bundle-size warning. Five new targeted tests pass. Actual browser harness passes 101 assertions including exact authored/history preservation across three cycles and all camera/cutaway combinations, growth retention, Save Blob, and the actual file-input/FileReader load callback. Source-hashed six-preset and six-cutaway-pair PNGs/metadata saved in [evidence](../evidence/technical-view/README.md).

Browser work caught a real Top/Bottom orbit clamp caused by OrbitControls' cached camera-up basis. Builder added a regression test that failed for that behavior, fixed synchronization, then obtained 5/5 green; coordinator retested actual downward/rightward drags at both poles successfully. Review caught parked tool bars and Escape event propagation; both were corrected. A pressed-hover contrast issue was corrected during visual review.

Coordinator pointer scenarios included facet selection, add/remove, UI Undo/Redo, a comb edit producing Undo comb, inspection/return restoring comb, scissors placement/drag/no-hit cut and seam activation. A moved Y cutaway at +80% visibly intersects fringe/scalp in both directions. Independent read-only critic passes the supplied core rubric; no actionable implementation defect remained. Reviewer conclusions partly rely on coordinator interaction reports, distinguished from source-hashed canvas evidence.

Limits: native download delivery did not yield an event in the in-app browser; Save payload/filename are verified separately. Real load callback is tested with a synthetic File, not OS picker interaction. Successful scissors shortening is not claimed. Viewport override did not apply, so narrower full-UI responsive verification is not claimed (harness iframe is 970×720). These details are retained in the evidence README. Existing four test failures are unmodified and discoverable.

Stage: integrated, core acceptance passes locally. Source remains uncommitted on `codex/haircut-technical-view` in this isolated worktree. Next: user review of the UI/evidence and optional native-browser delivery/picker/cut checks; no new feature scope implied. Canonical README and architecture updated. Coordinator remains sole documentation writer.
