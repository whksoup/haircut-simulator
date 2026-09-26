# Technical view evaluation loop

2026-09-18. Scope v2; rubric TV-1. Required by the user in addition to the design brief. Feature scope is unchanged.

## Ownership and cycle

### Shutdown checkpoint request

The user may power off the PC. At the next completed iteration checkpoint, finish active agent handoffs, write a dated session note, and leave agents idle without starting another iteration until the user resumes. Notify the user of the actual checkpoint and any unmet criteria. If execution stops unexpectedly, report that separately rather than calling it verified. Persist worktree/branch, changed files, completed work, build/test and critic evidence, blockers, pending assignments and exact restart instructions. Do not depend on agents or development servers surviving a shutdown.

The implementation coordinator must assign screenshot capture as an explicit bounded subtask and use an independent critic agent to grade the resulting output. The capture owner operates the browser; the critic reads the supplied evidence and does not edit implementation or produce its own state-changing scenarios. These are subagents within the implementation task, not additional sidebar tasks.

For each completed build cycle (a reviewable integrated candidate, not each file edit):

1. Run the build and appropriate regression checks. Record known baseline failures separately.
2. Capture the scenario matrix below from that candidate using a fixed haircut fixture and consistent framing. Save actual browser screenshots in the worktree under `docs/evidence/technical-view/<cycle>/`.
3. Supply the critic with this rubric, the design brief, relevant references, screenshots, interaction evidence and an evidence manifest.
4. Have the critic grade each criterion and identify concrete defects with screenshot regions or evidence references.
5. Correct actionable failures, rebuild, and recapture affected cases plus the core uncut views and return-to-grooming check. Regrade against the same rubric, incrementing source/cycle identity.

Begin with one review and one correction/review round. If mandatory criteria remain unresolved, report the concrete defect or missing evidence and next action; do not claim acceptance or repeat unchanged reviews indefinitely. Missing screenshots are not a pass. A failed build or blocked capture is recorded as such.

## Capture matrix

- Full head/hair with cutaway off: front, back, left, right, top and one freely orbited three-quarter view. Document coordinate mapping to visible presets; use a clearly described equivalent camera position if a direction is unavailable.
- Cutaway: each of the three axes, a central position with both retained sides. Ensure head and hair are both visibly intersected in the chosen fixture/view.
- Position control: two additional non-central positions for the initial left/right-dividing plane, at the same camera pose to show the slider's effect.
- Plane delineation: matched off/on captures at one useful view.
- Transitions: ordinary grooming before entry, initial Technical view with clipping off, and ordinary grooming after return, with matching before/after framing.
- Layout: normal desktop and a narrower desktop viewport with all controls and return action reachable; one visible keyboard focus state.

Here "slices" means the agreed cutaway states. Exploded separated slices remain optional. If implemented, add a full-arrangement capture and a detail showing slice ordering/spacing; otherwise mark that stretch absent, not failed.

## Evidence manifest

For each cycle record capture date, worktree, commit plus dirty patch identity, producing command/scenario, app URL, browser, viewport dimensions, fixture/groom identity and seed where applicable, camera pose/projection, clipping axis/position/side, and plane-edge setting. Record build/test outputs and known baseline failures. Use consistent inputs for comparisons. Supply a screenshot index with readable filenames; a contact sheet can supplement but must not replace individual full-resolution images.

Screenshots demonstrate appearance, not undo correctness, interaction continuity or performance. Attach meaningful automated state checks and/or recorded browser interaction evidence for preservation, mode transitions and keyboard behavior. Do not infer sustained performance from still images.

## Rubric TV-1

| ID | Mandatory criterion | Evidence / pass threshold |
| --- | --- | --- |
| TV1 | Illustrated appearance | Uncut views clearly show white background, toon treatment and sharp readable head/hair contours; no visibly missing geometry, severe outline noise or rendering artifacts obscuring shape |
| TV2 | Camera views | Labeled presets produce their corresponding axis-aligned orthographic views; free orbit and active-view feedback demonstrated by interaction evidence |
| TV3 | Cutaway consistency | All axes and both sides clip head and hair along the same plane; position changes move the cut; disabling restores the full object |
| TV4 | Optional plane edges | Off/on evidence shows the delineation control works and edges remain legible; no requirement for solid cut caps or exact Rhino algorithm |
| TV5 | Focused usable workspace | One viewport, compact boxed controls, readable labels, accessible return action; desktop and narrow-window evidence show no obstructed essential controls |
| TV6 | Mode isolation | Before/after screenshots restore grooming presentation; state/interaction evidence confirms authored groom and undo history preserved and ordinary grooming remains functional |
| TV7 | Keyboard access | Controls reachable and operable by keyboard with visible focus, exposed state/value labels and appropriate entry/return focus behavior |
| TV8 | Intended art direction | Visual evidence supports dry technical/furniture-manual presentation and lets a stylist inspect shape; cite concrete visual reasons rather than an unsupported taste score |

Report `pass`, `fail` or `insufficient evidence` for every mandatory criterion, with reason and next check. Overall acceptance requires all mandatory criteria to pass; do not average away failures. Numeric grading is unnecessary. Record observations outside this rubric separately, without expanding implementation scope.
