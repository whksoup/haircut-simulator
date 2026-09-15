# Haircut Simulator

Interactive Three.js hair grooming with GPU-instanced strands blended from authored guides. Supports facet selection, combing, scissors, seam authoring, undo/redo, and JSON save/load. The active renderer is `GpuHairR3` (`kind: 'guides'`).

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
