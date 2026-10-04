# Strand blending repair — 2026-10-03

Source: `F:/haircut-simulator`, base HEAD `c153e5f`, uncommitted repair. Final source SHA-256 values are in `source-hashes.json`. Session: [diagnosis and implementation](../../sessions/2026-10-03-strand-blending-investigation.md).

## Results

- `node --test "tests/*.test.mjs"`: **62 pass, four known failures**, none skipped. Includes eight new blending tests. Full output: `node-tests.txt`.
- `npm test`: the existing `node --test tests` entrypoint fails directory resolution under installed Node 24.15.0; see `npm-test.txt`. The explicit glob above discovers all test files. No manifest/test exclusions changed.
- `npm run build`: passes; `index-CKJQ1tyg.js`, 856.54 kB. Existing >500 kB warning remains.
- Final-source browser harness: **19 checks pass**, `browser-checks.json`. Run by importing `/tests/browser/blending-run.js` in the real app preview and calling `runBlendingChecks(hc)`. It restores the startup groom; it clears history while testing load and should only run in a disposable verification page.
- All 1671 startup strands match independently lifted guide geometry to 1.2e-7 mesh units. Root error is zero. Growth prefix tests at 0, .25, .5, .99 and 1 pass. Fully open boundary differences at 2e-6 root spacing are below 5.3e-6; half/hard are distinctly separated.
- Trusted pointer selection of real edge 653 and UI preset clicks verified permeability 0/.5/1, exact restoration of weights when reopened, unchanged roots and keyboard undo/redo. Trusted finite-comb X-gizmo drag from scripted capsule contact changes guides/rows without rebinding; length audit and exact undo/redo pass. Scripted scissors placement plus the real Cut action shortens a guide from .5 to .2106958 with exact undo/redo.
- Pointer/tool checks preceded the spatial-tree optimization; final-source GPU, seam, add/remove, history and persistence harness checks reran after it. Tool and texture-upload implementations did not change during that optimization. Native save-download and file-picker delivery were not retested.

## Images and provenance

1280×720, device scale 1, Headless Chrome 154 on Windows. Startup `head.glb`, default three guides, seed 1337; clump 1, jitter 0, length variation 0.

| Scenario | Baseline | Candidate |
| --- | --- | --- |
| Front orthographic, zoom 1 | `baseline-front.png` | `candidate-front.png` |
| Left orthographic, zoom 1.8 | `baseline-left.png` | `candidate-left.png` |

Baseline images reconstructed HEAD's original shader and binder from `baseline-source.json` and restored raw authored texture coordinates in the current app. Camera, authored groom, root samples and look were held fixed. This compares the reconstruction path, not every historical application module. The candidate shader/buffers were restored afterward. These image pairs predate the final search optimization, which does not change this three-guide fixture's weights. `final-open.png` is a fresh final-source left view at zoom 1.3.

`seam-open.png`, `seam-half.png` and `seam-hard.png` are same-camera left views, zoom 1.3, from actual preset clicks on selected edge 653. `comb-placed.png` records initial placement only and is not evidence of a successful edit; the later contact/drag test is recorded numerically.

## Binding cost

`binding-benchmark.json`: Node 24.15.0 Windows, 200k roots, 128 guides, one warmup/three measured runs, no seams. Candidate 140–150 ms; baseline 146–159 ms. Synthetic unit-sphere locations derive from the shared hash: z = 2*hash2f(i,11)-1, angle = 2*pi*hash2f(i,37), guide indices offset by 500000. This is CPU binding cost, not frame time. The rejected exact-grid prototype took 918–966 ms. A final balanced spatial tree restores comparable cost while proving the correct nearest neighbors.

## Limits

Exact four-way equidistance remains singular with only three guide rows per strand. Stable tie handling guarantees finite deterministic weights, not continuity at that exceptional configuration. Hard edges block direct crossing but can receive attenuated influence around endpoints. The pre-existing fallback borrows a guide if a sealed region has no reachable guide; author one inside the region for isolation. This repair does not smooth or change the head mesh itself, add a scalp collision solver, or change JSON schemas. Authored guides remain the source of truth.
