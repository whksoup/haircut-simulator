# Architecture and cleanup decisions

## Scope

This cleanup takes the working snapshot as its baseline, including pre-existing uncommitted growth and guide changes. It groups modules and fixes paths without redesigning algorithms, changing renderer selection, or deleting historical implementations. Filenames and exports stay recognizable.

## Ownership and dependencies

Agent responsibilities and the three documentation layers are defined in [workflow.md](workflow.md). [Project status](status.md) tracks current work and links dated handoffs; this document remains the canonical application architecture, not a session log.

| Area | Responsibility |
| --- | --- |
| `src/app` | Composition, UI, default groom, history orchestration and cross-system callbacks |
| `src/scene` | Viewer, head loading, derived facet catalogue and wireframe |
| `src/groom` | Authored groom/guide/seam stores and JSON validation/migrations |
| `src/hair` | Shape math, constraints, resampling, cut sessions, growth, length audits |
| `src/rendering` | Factory and deterministic root sampler |
| `src/rendering/gpu` | Active R3 buffers, texture, GLSL, binding and seam distance cache |
| `src/rendering/legacy` | R2 facet-shape GPU and straight CPU comparison paths |
| `src/tools` | Selection, comb, scissors and seam interactions |
| `src/debug` | Guide spheres and seam inspection overlay |

The intended direction is app → tools/rendering/scene/model, with model and rendering sharing hair math. This is a practical partition, not enforced package isolation. In particular, `guides.js` uses Three.js math: the old diagram's “no three.js” label was inaccurate. `seams.js` also includes topology-driven seeding.

Keep the catalogue and wireframe builder together for now; they share a clear responsibility. Keep the seam distance cache beside guide binding because it serves rendering; authored permeability belongs in `groom/`.

## Active path

1. `app/main.js` creates the viewer and groom, loads the head/catalogue, and wires tools and history.
2. The factory selects `kind: 'guides'`, constructing `GpuHairR3` under the head so strand data stays mesh-local.
3. `strandSampler.js` deterministically allocates roots per facet. `guideBinding.js` selects three guides using the seam-aware distance field.
4. `gpuHairR3.js` writes instance attributes and guide texture rows. `hairShaderGuides.js` reconstructs dense hair.
5. Comb/cut edits update guide rows. Membership edits refresh binding. Seam edits refresh the overlay and invalidate/rebind the seam field.
6. App-owned history callbacks restore guide patches or whole snapshots, preserving store identity and refreshing derived state.

Current groom schema: 6. Guide schema: 5. Growth rates remain serialized per guide for compatibility; they do not drive the visual preview. The Growth UI drives a runtime fraction initialized to 1, outside groom/history state. `app/growthPreview.js` coordinates gesture completion and editing locks; `GpuHairR3.setGrowthFraction()` updates a uniform. The shader measures the final blended/jittered polyline and clips its original segments at the requested arc fraction, preserving root-side corners. At 0, hair fragments are discarded. Preview does not rebind strands or rewrite guides. Valid load restores the full fraction; save always serializes authored full state.

Growth verification uses an opt-in local browser harness in `tests/browser/` and GPU readback in `debug/growthCapture.js`, neither imported by the application. The diagnostic uses the same reconstruction GLSL with a float position target, paired with an independent segment-prefix oracle and fixed-camera screenshots. See the [growth workstream](workstreams/growth-preview.md) for evidence and remaining human acceptance/download-delivery checks.

Technical inspection is transient presentation state. `app/main.js` finishes active gestures, suspends editing through the shared `canStyle`/tool arbitration path, hides diagnostic/tool overlays, and restores the prior tool on return. `app/technicalViewUI.js` owns native boxed controls and focus. `scene/technicalView.js` temporarily swaps head materials, lighting and the camera, supplies six orthographic presets and one world-space clipping plane, then restores original references. The active GPU shader receives presentation-only uniforms for illustrated color and matching clipping after strand reconstruction; no groom rebuild or authored data conversion occurs. `viewer.js` resizes either camera projection. OrbitControls r169 caches its up basis, so the controller synchronizes those cached fields when changing pole views; the real-controls regression test covers this version-specific adapter. Optional surface edges and outline resources are disposed on return. Cutaway surfaces have no generated caps. [Verification evidence](evidence/technical-view/README.md).

## Files outside the main GPU implementation

| Files / dependency | Evidence | Decision |
| --- | --- | --- |
| `rendering/legacy/gpuHair.js`, `hairShader.js`, `strands.js` | Selected only for `'gpu'` / `'cpu'`; default is `'guides'` | Retain comparison paths in an explicit legacy folder |
| `archive/experiments/guideBinding copy.js` | No imports; alternate binder without active seam-field integration | Archive, not a second source of truth |
| `archive/experiments/Workplane.js` | No imports; standalone construction-plane experiment | Archive; current comb owns its bar/gizmo interaction |
| `archive/experiments/arcResample.js` | No imports; cutting uses `hair/strandResample.js` | Archive alternate algorithm; do not merge just because names overlap |
| `archive/assets/lowPolyHead.glb` | Loader requests only `models/head.glb` | Preserve outside public so it is not shipped |
| `docs/reference/bloo.png` | No application references found | Retain as unclassified reference image |
| `docs/history/*` | Plans and diagrams predate current code; root diagram called main missing | Preserve as history; publish one current diagram |
| `three-mesh-bvh` | Declared dependency, no executable imports; comments describe future collision work | Removal candidate; retain manifest/lockfile in this pass |
| `node_modules/`, `dist/` | Installed/generated outputs, already ignored | Exclude from source review; regenerate normally |

The factory still statically imports legacy renderers, so they remain bundled. Folder relocation clarifies ownership; it does not remove their bundle cost. Removing the choices or making the factory asynchronous is a separate API decision.

`debug/` is optional for the final product but currently wired and useful for verifying guides/seams. `hair/guideLengthAudit.js` is **active domain code** used by combing and growth. `defaultGroom.js` is active startup data. Tests support the implementation even though they do not ship.

## Verification

Before relocation, the production build passed and 5 of 9 test files passed. Four failures predate this cleanup:

| Current test | Baseline failure |
| --- | --- |
| `tests/seam-commit.test.mjs` | “one commit → one undo entry”: actual 0, expected 1 |
| `tests/console.test.mjs` | Extracts obsolete zero-argument function signature; buildDebugConsole is not defined |
| `tests/seam-release.test.mjs` | “pointerup listener is capture-phase”: actual 0, expected 1 |
| `tests/seam-tool.test.mjs` | cat.edgesOfVertex is not a function |

All remain in `npm test`; none are hidden. Console source lookup now uses a module-relative URL, but its stale extraction remains visible. The production build has an existing >500 kB chunk warning. Build/test results do not establish browser interaction or shader visual correctness.

After relocation, `npm test` discovers all nine files and reproduces the same five passes and four failures. `npm run build` passes and emits the same JavaScript asset (`index-DPwTWVUH.js`, 814.21 kB) as before relocation. The entry HTML changes only its module path and obsolete loading label. Browser interaction was not revalidated in this organizational pass.

## Suggested next work

1. Reconcile the four failing tests with intended seam and console behavior. Missing APIs may mean incomplete features or stale tests; decide from the behavior contract, not stubs.
2. Complete human evaluation of the implemented Growth preview; see the active workstream for verification limits.
3. Extract the debug console into a directly testable `debug/` module. Split other UI panels when a concrete task benefits. Keep cross-system orchestration in main.
4. Decide whether comparison renderers justify their maintenance/bundle cost. If retired, remove factory options and callers together.
5. Remove the unused BVH dependency with a lockfile update if collision work is not planned. Add focused cut/constraint coverage: some headers reference test files absent from this snapshot.

No framework, package workspace, dependency injection layer, or broad renaming is needed for the present module count.
