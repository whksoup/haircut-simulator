# Haircut Simulator

Interactive Three.js hair grooming with GPU-instanced strands blended from authored guides. Supports facet selection, combing, scissors, seam authoring, undo/redo, and JSON save/load. The active renderer is `GpuHairR3` (`kind: 'guides'`).

## Frozen handover — 2026-09-27

Work is frozen for transfer to another agent. Do not start another implementation iteration until asked. The checkpoint automation `technical-view-checkpoint-watch` is PAUSED. No application behavior was changed during this freeze.

### Choose the correct snapshot

Remote: [whksoup/haircut-simulator](https://github.com/whksoup/haircut-simulator).

| Branch | Contents | Use |
| --- | --- | --- |
| `AgentRefactor` | Existing grooming/growth implementation, UI brief, evaluation requirements, visual references and handover | Baseline and planning record |
| `codex/haircut-technical-view` | Recovered Technical view implementation, tests, harness, screenshots and handover | Continue UI review here |

Both branches start from `effc25c` before their freeze commits. These are separate snapshots, not a merged release. `main` is unchanged. In a fresh clone, run `git fetch origin` and `git switch --track origin/codex/haircut-technical-view` (or switch to the existing local branch). Locally the candidate is already checked out at `C:/Users/He Kai/.codex/worktrees/ddf1/haircut-simulator`; use that worktree rather than checking the branch out twice.

**Correction to earlier status:** the app task list never exposed the new implementation task, so this conversation incorrectly inferred implementation had not run. A September 27 Git worktree audit recovered uncommitted implementation and evidence. Its real task ID remains unknown; the queued client ID is not a task ID. Files and evidence provide the handoff independently. Older source-checkout notes claiming implementation is pending reflect incomplete observation.

### Accepted experience

For barbers/stylists inspecting construction, planes, profiles and shape of a finished haircut, with dry IKEA/LEGO/furniture-manual humor. Desktop mouse/keyboard. Dedicated Technical view on the actual haircut, compact boxed controls and Return to grooming.

- White background, toon treatment, sharp outlines and optional plane edges.
- One viewport: free orbit and axis-aligned orthographic presets.
- Cutaway clips both head and hair. Off on entry; first enabled plane divides left/right vertically. Controls: on/off, axis, relative position and Flip side.
- Preserve authored data, guide/seam identities, history, growth state, tool arbitration and grooming on return.
- Deferred: measurements/angles, cutting steps, export, growth grids, simultaneous views and mobile-specific design. Exploded slices are a feasibility stretch only. No solid cut caps promised.

Read the [design brief](.design/haircut-technical-view/DESIGN_BRIEF.md), [evaluation loop](.design/haircut-technical-view/EVALUATION.md) and [references](docs/reference/UIUX_References/), preserved in both snapshots. Images are design inputs, not production assets.

### Implementation and evidence map

On the candidate branch: `src/scene/technicalView.js` owns presentation/camera/cutaway; `src/app/technicalViewUI.js` and `technicalView.css` own the panel; `src/app/main.js` owns mode/tool integration; `src/scene/viewer.js` supplies viewer integration; `src/rendering/gpu/hairShaderGuides.js` contains hair presentation/clipping changes. `tests/technical-view.test.mjs` covers five deterministic contracts. No solver or persistent schema changes are claimed by its handoff.

Candidate evidence is in `docs/evidence/technical-view/README.md`, PNG/JSON captures, `browser-checks.json` and the September 18 implementation session. That report records 101 browser assertions and an independent core critic pass. These are historical artifacts/reports, not a fresh September 27 browser run. The evidence README distinguishes final source-hashed captures from earlier UI screenshots. The later full TV-1 rubric was absent from the recovered worktree: its complete acceptance must be reviewed, not inferred from the earlier critic report.

### Fresh verification and limitations

September 27 checks used Node 24.19.0 and installed dependencies:

| Snapshot | Tests | Build |
| --- | --- | --- |
| Base | 12 pass, 4 known failures | Pass; `index-B1O7fh3n.js` |
| Technical view | 17 pass, 4 known failures; all 5 new tests pass | Pass; `index-DN3trGZb.js` |

Both builds retain the >500 kB warning. Failures are `console.test.mjs` (obsolete extraction / undefined `buildDebugConsole`), `seam-commit.test.mjs` (undo count), `seam-release.test.mjs` (capture-phase listener), and `seam-tool.test.mjs` (missing `edgesOfVertex`). No tests were hidden or weakened.

`npm` was unavailable on this shell's PATH. Used underlying commands `node --test "tests/*.test.mjs"` and `node node_modules/vite/bin/vite.js build`. Node 24 fails directory resolution for the manifest's `node --test tests`; the explicit glob works. Manifest unchanged to preserve the freeze. Use the documented Node 20.16/npm environment or the explicit glob on Node 24. Initial sandbox build access failed; approved reruns passed.

Still unverified: native Save download delivery, native file picker, successful scissors shortening, full UI at narrow desktop width, and fresh acceptance against TV-1. Historical harness verified save contents and load callback with a synthetic File. Camera synchronization relies on Three.js r169 OrbitControls cached up-basis behavior; rerun pole-orbit coverage on upgrades. Growth human acceptance remains open.

### Resume procedure

1. Inspect branch/status, this README, `AGENTS.md`, architecture and the [freeze session](docs/sessions/2026-09-27-freeze-handover.md). Choose the candidate branch for UI review.
2. Run `npm ci` if dependencies are missing, tests/build, then `npm run dev`. Keep the four known failures visible.
3. Candidate harness: `npm run dev -- --config tests/browser/vite-technical.config.mjs`, then `http://127.0.0.1:5175/tests/browser/technical.html?autorun`. It writes evidence; preserve old captures before running a new cycle.
4. After authorized resumption, assign bounded builders and separate capture/critic agents. Keep app integration and shared docs under single owners. Follow TV-1 and retain source, fixture, camera and viewport metadata.
5. Complete remaining verification, grade screenshots and interaction/state evidence, fix actionable defects and recapture. Record checkpoints and leave agents idle when shutdown is requested. Do not restart the monitor automatically or infer correctness from screenshots alone.

## Run

```sh
npm install
npm run dev
npm run build
npm run preview
npm test
```

Validated with Node 20.16. Tests use Node's built-in runner. See [known test failures](docs/architecture.md#verification) before treating this as a green baseline.

## Start here

- [Project status](docs/status.md): current work, known baseline, and session handoffs.
- [Documentation and agent workflow](docs/workflow.md): roles, checkpoints, and scope changes.
- [Architecture and cleanup decisions](docs/architecture.md): ownership, active path, optional files, follow-up work.
- [Current diagram](docs/architecture.mermaid).
- [Agent workflow](AGENTS.md): task routing, invariants, validation.
- [Old-to-new file map](docs/file-map.md).

```text
src/
  app/               startup, UI, history, default groom
  scene/             viewer, head loading, facet topology
  groom/             serializable groom, guides, seams, validation
  hair/              geometry, constraints, cutting, growth, length audits
  rendering/
    gpu/             active guide renderer, shader, binding, seam field
    legacy/          selectable R2 GPU and CPU comparison renderers
  tools/             selection, comb, scissors, seams
  debug/             guide and seam inspection overlays
tests/               regression scripts (*.test.mjs)
docs/                architecture, references, historical notes
archive/             unused experiments and alternate asset
public/models/       production head asset
```

## Model and rendering

`Groom` owns authored faces, guides, seams, globals, and seeds. Guides hold normalized control points plus length, tangent, and growth rate. The GPU reconstructs dense strands by blending three guides; comb edits update guide texture rows. Mesh topology and GPU buffers are derived state.

The Growth slider previews each strand's root-side arc-length fraction, from 1 (the full authored hairstyle) to 0 (no visible hair). It preserves surviving bends rather than scaling the shape. Styling is available at 1; camera movement, inspection, and saving remain available during preview. Saves contain the full authored groom, and loading resets the slider to 1. Historical rate-based rewind helpers remain separate from this visualizer.

## Head assets

The loader reads `public/models/head.glb`, chooses the mesh with the most triangles, and falls back to a procedural head on failure. Apply transforms before Blender export; export glTF Binary with +Y up and normals. Preserve the custom `_facet` attribute to retain polygon grouping through triangulation. Without it, the catalogue is unavailable and guide grooming cannot initialize. The procedural placeholder is a viewer fallback and also lacks a catalogue.

The alternate mesh is retained in `archive/assets/lowPolyHead.glb` and is no longer copied into production builds. Plans in `docs/history/` describe earlier designs, not current requirements.
