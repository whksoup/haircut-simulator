# File relocation map

Paths are relative to the repository root. Runtime filenames/exports are retained; test names are normalized for discovery. README was rewritten; the new canonical diagram is `docs/architecture.mermaid`.

| Previous path | Current path |
| --- | --- |
| `src/main.js` | `src/app/main.js` |
| `src/ui.js` | `src/app/ui.js` |
| `src/history.js` | `src/app/history.js` |
| `src/defaultGroom.js` | `src/app/defaultGroom.js` |
| `src/viewer.js` | `src/scene/viewer.js` |
| `src/loadHead.js` | `src/scene/loadHead.js` |
| `src/facetWireframe.js` | `src/scene/facetWireframe.js` |
| `src/groom.js` | `src/groom/groom.js` |
| `src/guides.js` | `src/groom/guides.js` |
| `src/seams.js` | `src/groom/seams.js` |
| `src/schemaGuards.js` | `src/groom/schemaGuards.js` |
| `src/strandShape.js` | `src/hair/strandShape.js` |
| `src/strandConstraints.js` | `src/hair/strandConstraints.js` |
| `src/strandCut.js` | `src/hair/strandCut.js` |
| `src/strandResample.js` | `src/hair/strandResample.js` |
| `src/cutSession.js` | `src/hair/cutSession.js` |
| `src/growthModel.js` | `src/hair/growthModel.js` |
| `src/guideLengthAudit.js` | `src/hair/guideLengthAudit.js` |
| `src/renderer.js` | `src/rendering/renderer.js` |
| `src/strandSampler.js` | `src/rendering/strandSampler.js` |
| `src/gpuHairR3.js` | `src/rendering/gpu/gpuHairR3.js` |
| `src/hairShaderGuides.js` | `src/rendering/gpu/hairShaderGuides.js` |
| `src/guideBinding.js` | `src/rendering/gpu/guideBinding.js` |
| `src/seamField.js` | `src/rendering/gpu/seamField.js` |
| `src/gpuHair.js` | `src/rendering/legacy/gpuHair.js` |
| `src/hairShader.js` | `src/rendering/legacy/hairShader.js` |
| `src/strands.js` | `src/rendering/legacy/strands.js` |
| `src/raycast.js` | `src/tools/raycast.js` |
| `src/combTool.js` | `src/tools/combTool.js` |
| `src/scissorsTool.js` | `src/tools/scissorsTool.js` |
| `src/seamTool.js` | `src/tools/seamTool.js` |
| `src/GuideDebugView.js` | `src/debug/GuideDebugView.js` |
| `src/seamOverlay.js` | `src/debug/seamOverlay.js` |
| `src/Workplane.js` | `archive/experiments/Workplane.js` |
| `src/arcResample.js` | `archive/experiments/arcResample.js` |
| `src/guideBinding copy.js` | `archive/experiments/guideBinding copy.js` |
| `src/adjacency_test.mjs` | `tests/adjacency.test.mjs` |
| `src/commit_test.mjs` | `tests/seam-commit.test.mjs` |
| `src/console_test.mjs` | `tests/console.test.mjs` |
| `src/growth_test.mjs` | `tests/growth.test.mjs` |
| `src/history.test.mjs` | `tests/history.test.mjs` |
| `src/overlay_test.mjs` | `tests/seam-overlay.test.mjs` |
| `src/release_test.mjs` | `tests/seam-release.test.mjs` |
| `src/seamfield_test.mjs` | `tests/seam-field.test.mjs` |
| `src/seamtool_test.mjs` | `tests/seam-tool.test.mjs` |
| `architecture.mermaid` | `docs/history/architecture-early.mermaid` |
| `src/architecture.mermaid` | `docs/history/architecture-intermediate.mermaid` |
| `haircut-simulator-plan.md` | `docs/history/original-plan.md` |
| `bloo.png` | `docs/reference/bloo.png` |
| `public/models/lowPolyHead.glb` | `archive/assets/lowPolyHead.glb` |
