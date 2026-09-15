# Haircut Simulator — Implementation Plan (rev 2)

A web-based hair grooming tool for a single head mesh: mark faces as hair-bearing, grow strands (length + density), brush via guide curves, optional collision and dynamics.

> **Rev 2 notes.** Phases 0–1 are complete. This revision reflects what the code actually does (quad-facet granularity via a baked `_facet` attribute, `FacetCatalogue`, `HairStore`, `Raycast`), fixes three architectural seams found during review, and updates the phase ordering and performance strategy accordingly. Where this document conflicts with the original, defer to this revision.

---

## Stack (decided)

- **Three.js** — renderer, scene graph, raycasting.
- **Vite** — dev server + bundler.
- **three-mesh-bvh** — accelerated raycasting (face picking) and `closestPointToPoint` (collision).
- **GLB** — mesh format, exported from Blender.
- **lil-gui** — prototype controls panel. Swap for a React/Svelte sidebar later if the UI grows.
- **Line2 / LineSegments2 + LineMaterial** (from `three/examples`) — strand rendering with real thickness. Do **not** use plain `LineSegments`; `linewidth` is ignored on most platforms.

---

## Key decisions (locked)

**Selection granularity = quad facets, not triangles.** The `_facet` vertex attribute is baked in Blender and exported into the GLB. `FacetCatalogue` (built from this attribute) maps triangle raycaster hits → quad facet IDs, and stores per-facet centroid, area-weighted normal, area, and vertex-index lists. This is a deliberate and correct deviation from the original plan's "start at triangles" hedge.

**Groom is the single serializable model; HairStore is removed.** The live runtime state and the save/load artefact are merged into one `Groom` class. Per-facet params (`density`, `length`, `segments`, derived seed) live in `Groom.faces` keyed by `facetId`. There is no separate `HairStore`. See the Groom schema section below.

**Seeds are derived, not stored per-facet.** Per-facet seed = `murmur(masterSeed, facetId)` or equivalent. Only `masterSeed` is serialized. This keeps `Groom.faces` records short and guarantees determinism without per-record seed fields.

**A facet "has hair" iff it has a record in `Groom.faces`.** No separate boolean flag. Removing a facet from the hair region = deleting its record.

**Working selection is transient; hair membership is persistent.** The raycaster maintains a `Set<facetId>` as a *working selection* (highlighted, editable). Slider edits write to every facet in that set. Clicking empty space clears the selection but leaves `Groom.faces` records intact. There are no persistent named groups yet — a future group is a saved `Set<facetId>` + optional param overrides layered on top of per-facet records, requiring no data model change.

**Smooth growth normals come from interpolated vertex normals, not from subdivision.** Barycentric interpolation of the triangle's three vertex normals at the strand root gives a continuous, smooth growth direction over the whole surface. No geometry subdivision needed. The lever is ensuring Blender exports smooth (non-split) vertex normals. Do not recompute normals after `toNonIndexed()` — on non-indexed geometry `computeVertexNormals` produces face normals, killing the smoothing. See the Normals section under Phase 2.

**Strand data layout is SoA typed arrays from day one.** Root positions, root frames, seeds, and per-facet param refs live in flat `Float32Array`s with per-facet offset+count slices. This is GPU-upload-ready and makes incremental regeneration (one facet's slice at a time) cheap. Per-strand data is never stored as `Array<{...}>` objects.

**GPU instancing deferred until after Phase 3.** The per-instance attribute set is determined by the guide/brushing model — building `InstancedBufferGeometry` before the styling math exists means rebuilding it once guides land. The SoA CPU path is a backend swap away from instancing, not a rewrite.

**Per-strand GPU data = instanced attributes or a data texture, never uniforms.** Uniform counts are capped; strand counts are not.

---

## Groom schema (v2)

```jsonc
{
  "version": 2,
  "masterSeed": 1337,
  "globals": {
    "density": 1.0,    // strands per unit area multiplier
    "length": 0.1,     // strand length in mesh units
    "segments": 4      // polyline segments per strand
  },
  "faces": [
    // One entry per hair-bearing facet. Absence = no hair.
    { "facetId": 42, "density": 2.0, "length": 0.08, "segments": 4 }
    // density/length/segments stored even when matching globals,
    // so per-facet state is self-contained and globals can change freely.
  ],
  "guides": []         // Phase 3
}
```

Migration from v1 (`faceIndex`-keyed `faces` with `seed` fields): on load, discard `seed` fields; rename `faceIndex` → `facetId`. Because the v1 schema was never successfully serializing live state anyway, no backward-compat shim is required beyond dropping unrecognised keys.

---

## Phases already done

### Phase 0 — Scaffold & asset pipeline ✓

Head loads and orbits. Viewer, Groom stub, empty save/load button. Blender export convention established (GLB, apply transforms, `_facet` attribute, +Y up).

### Phase 1 — Face selection ✓

`_facet` attribute baked in Blender. `FacetCatalogue` maps triangle hits → quad facets. `Raycast` paints vertex colors on shift-click. `HairStore` (now merged into Groom — see Phase 1.5) tracks the hair region. Click/shift-click interaction is working.

---

## Phase 1.5 — Close the architectural seams (do before Phase 2)

**Goal:** eliminate the three latent bugs found during review before the strand generator depends on any of them.

**1. Build FacetCatalogue at load time, unconditionally.**

`viewer.viewQuads()` currently builds the catalogue as a side-effect of toggling the debug wireframe. The strand generator needs the catalogue (centroid, normal, area, vertex indices per facet). Move catalogue construction so it runs in `loadHead.prep()` or immediately after, storing the result on the mesh (e.g. `mesh.userData.catalogue`). `viewQuads` then draws from the already-built catalogue rather than building it. `raycast.js` replaces its own `_buildFacetIndex()` with a read from the same catalogue — one source of truth, no duplication.

**2. Merge Groom and HairStore; fix save/load.**

Remove `hair.js`. Extend `Groom` to v2 schema above. The raycaster's `onHairChange` callback — which previously called `hair.syncFromSelection()` — now writes directly into `Groom.faces`: add records for newly selected facets (inheriting globals), remove records for deselected ones. `main.js` drops the `HairStore` import. Save/load now round-trips real state.

**3. Rework selection to working-set semantics.**

The current raycaster conflates "in working selection" (orange) with "is a hair facet" (green). Replace with:

- `raycast.workingSelection` — `Set<facetId>`, transient.
- **Shift-click** — add/remove from `workingSelection`. Facets added to the selection automatically get a `Groom.faces` record if they don't have one.
- **Plain click** — replace `workingSelection` with just this facet (same record-creation rule applies).
- **Click on empty space** (`hits.length === 0`) — clear `workingSelection`. `Groom.faces` records are untouched. Facets with records lose the selection highlight but remain hair-bearing.
- **Highlight** — single "in working selection" tint. Hair-bearing facets outside the selection get no extra tint (the strands will show them).
- Remove the dead `_raycaster.params.Mesh = { backfaceCulling: true }` line — it's a no-op. Raycasting already follows `material.side`, which defaults to `FrontSide`.

**4. Wire sliders to the working selection.**

When a globals slider (density, length, segments) changes and `workingSelection` is non-empty, write the new value to every `Groom.faces` record in the selection rather than changing the global default. If the selection is empty, change the global default only (affects future additions). This is the "select then edit" loop the UX requires.

**Done when:** save/load round-trips a real facet selection with params; clicking empty space drops the highlight but the next strand generation still reads the correct per-facet values.

---

## Phase 2 — Hair generation (length + density)

**Goal:** strands grow from selected facets, controllable by sliders, without reshuffling on param change.

### Normals

Strand growth direction = barycentric interpolation of the three vertex normals at the strand root. Not the face normal. This gives a continuous direction field across the surface for free.

Prerequisite: Blender must export smooth (non-split) vertex normals. Check in Blender: no sharp edge marks on the scalp region, auto-smooth angle set generously, or normals baked explicitly. The current `prep()` pipeline correctly preserves whatever normals the GLB carries through `toNonIndexed()` — do not add a `computeVertexNormals()` call after `toNonIndexed()`.

Catmull–Clark subdivision is explicitly out of scope for this goal. Reserve it for if the surface silhouette itself reads as too blocky (a separate, later decision). If you do subdivide, do it as a Blender bake with `_facet` IDs propagated to children — never at runtime.

### Root sampling

Stratified barycentric sampling within each selected triangle. Per-strand seed derived from `murmur(masterSeed, facetId) + strandIndex`. Strand count per triangle = `density × triangleArea`. Regenerate only the affected facet's slice when a param changes — never the whole groom.

### Strand data layout

```
// Per strand root (built once on facet add, updated on param change):
rootPositions  : Float32Array  // [x,y,z] per root
rootNormals    : Float32Array  // [x,y,z] interpolated vertex normal at root
rootTangents   : Float32Array  // [x,y,z] for full frame (needed by Phase 3 blending)

// Flat strand segment positions (rebuilt on generation):
segmentPositions : Float32Array  // [x,y,z] × segments per strand
```

Per-facet offset+count into the above arrays lets any single facet's slice be rebuilt without touching the rest.

### Rendering

`Line2` / `LineSegments2` + `LineMaterial`. Rebuild the `LineSegments2` geometry from the segment positions buffer on change. This is the CPU render path — it stays until Phase 4.

### Done when

Sliders smoothly change hair on selected facets without strands jumping around. Unselected facets with records keep their strands unchanged. The select → grow → adjust loop feels good.

---

## Phase 3 — Brushing via guide curves (the difficulty spike — budget for it)

**Goal:** style hair direction, not just grow it straight out.

- **Guide model:** a guide is a polyline of control points with per-segment tangent offsets, stored in `Groom.guides`. This defines what per-strand instance data the GPU shader will eventually need — design Phase 4's shader only after this model is settled.
- **Influence:** for each strand root, find nearest guide(s) by Euclidean distance (fine on a roughly convex head). Inverse-distance falloff weights.
- **Blend:** apply weighted guide segment offsets to the strand's segments in the strand's local frame (the `rootNormals` + `rootTangents` basis built in Phase 2). Bending, not rigid translation.
- **Tool:** a comb/brush that on drag creates or edits a guide. Control points are placed on selected hair facets.
- **Prototype the math on a flat patch first** — debugging blend weights on a curved head is painful.
- `rootTangents` (built in Phase 2) is the prerequisite; this is why Phase 2 stores the full frame even though straight-growth doesn't use tangents yet.

**Done when:** dragging the comb produces smooth, predictable styling and the result persists in `Groom.guides`.

---

## Phase 4 — GPU instancing

**Goal:** scale to tens of thousands of strands at framerate.

Now that the guide model exists, the per-instance attribute set is known. Migrate to `InstancedBufferGeometry`:

- **Per-instance attributes:** root position, root frame (normal + tangent), derived seed, guide-influence params. Use a **data texture** if attribute count exceeds limits.
- The SoA typed arrays from Phase 2 are already GPU-upload-ready — this is a backend swap, not a rewrite.
- The "hairs on the same plane share a transform + per-strand offset" insight maps directly: bake the per-facet frame as the common instance transform; the shader adds the per-strand offset.
- A strand *displacement* shader (move vertices by guide weights) is the main deliverable. A strand *shading* model (Kajiya-Kay anisotropic highlights) is separate polish — don't block on it.

**Done when:** strand count scales an order of magnitude with no framerate cliff.

---

## Phase 5 — Collision (polish)

**Goal:** strands don't clip through the skull.

- For each strand segment point, query `closestPointToPoint` on the head BVH (`three-mesh-bvh`).
- If inside (dot against closest-point normal is negative) or within a hair-radius offset, project outward.
- **Reality check:** roots on a convex skull grow outward, so penetration is rare until Phase 3 brushing pushes strands inward. Implement only once inward styling exists.

**Done when:** aggressive inward brushing no longer clips through the head.

---

## Phase 6 — Dynamics (optional)

**Goal:** gravity, jiggle, wind.

- Per-strand Verlet integration or XPBD: segment distance constraints + gravity + collision. Natural fit for strands; simpler than a rigid-body engine.
- Do **not** reach for Rapier for strands — it's a rigid/soft-body engine. You could use it for a static head collider, but the strand sim must be custom.

**Done when:** hair settles under gravity and reacts plausibly to motion.

---

## Cross-cutting (ongoing)

- **Serialization:** `Groom` ↔ JSON v2 schema with migration. Version field required.
- **Undo/redo:** command pattern or snapshots. The app is an editor; treat it as one.
- **Determinism:** derived seeds everywhere strands are sampled. Changing `masterSeed` reshuffles all strands; changing a slider reshuffles nothing.
- **Incrementality:** regenerate only the affected facet's slice on param change — never the whole groom.
- **Performance budget:** pick a target (e.g. 60 fps at 50k strands) and check it at the end of each phase.

---

## Build order

```
Phase 0    ✓  scaffold + asset pipeline
Phase 1    ✓  quad-facet selection
Phase 1.5     close seams (catalogue timing, Groom/HairStore merge, selection UX)
Phase 2       strand generation, SoA data layout, smooth normals, CPU render
Phase 3       guide curves + brushing  ← main time sink, budget a week+
Phase 4       GPU instancing           ← data layout ready; shader designed post-Phase 3
Phase 5       collision
Phase 6       dynamics (optional)
```
