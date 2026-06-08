# Haircut Simulator

Web-based hair grooming tool. **Phase 0 scaffold:** head mesh on screen,
orbitable, with an (empty) serializable groom model and JSON save/load.

See `haircut-simulator-plan.md` for the full roadmap.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` to produce a static bundle in `dist/`, `npm run preview` to serve it.

## What works now (Phase 0)

- Head renders with environment + key/rim lighting; orbit / zoom / pan.
- Camera auto-frames the loaded mesh.
- **Save groom** downloads `groom.json`; **Load groom** reads one back in and
  round-trips cleanly (versioned schema, ready for migrations).
- Global params (`density`, `length`, `segments`, `masterSeed`) edit the model.
  They don't generate anything yet — that's Phase 2.

If `public/models/head.glb` is missing, a procedural placeholder head loads so
you can run everything immediately. The HUD shows when the placeholder is in use.

## Structure

```
index.html          canvas mount + minimal HUD
vite.config.js
src/
  main.js           bootstrap: viewer + head + groom + UI
  viewer.js         renderer, camera, OrbitControls, lighting, render loop
  loadHead.js       GLB loader + procedural fallback; picks the groom target mesh
  groom.js          serializable data model (the spine for every later phase)
  ui.js             lil-gui panel + save/load round-trip
public/models/      drop head.glb here
```

`groom.js` holds **all** haircut state as plain JSON-able data (selected faces,
per-face params, guides, globals, seeds). Three.js never touches it. This is what
makes save/load, undo/redo, and deterministic regeneration possible later.

## Blender export convention

- **Apply all transforms** before export: `Ctrl+A → All Transforms` (location,
  rotation, scale). The loader trusts the exported transform.
- Export as **glTF Binary (`.glb`)**, **+Y up**, with normals included.
- Save to `public/models/head.glb`.
- **Triangulation caveat:** GLB triangulates on export, so any quad grouping is
  lost. Selection granularity is therefore **per-triangle**. If you later want
  quad-level selection, bake the grouping into a custom attribute / vertex
  colors / material slots in Blender first.

## Stack

Three.js · Vite · three-mesh-bvh (Phase 1+) · lil-gui · Line2/LineMaterial (Phase 2+)
