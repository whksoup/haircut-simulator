/**
 * loadHead — loads the head GLB, with a graceful fallback.
 *
 * Drop your exported mesh at `public/models/head.glb`. Until then (or if the
 * fetch fails) this returns a procedural placeholder head so the rest of the
 * pipeline has a mesh to work against.
 *
 * Returns { root, groomTarget, isPlaceholder }:
 *   - root        : Object3D to add to the scene
 *   - groomTarget : the Mesh strands will root onto
 *   - isPlaceholder : true when falling back to the procedural head
 *
 * Phase 1.5 (step 1): FacetCatalogue is built unconditionally inside prep()
 * and stored on mesh.userData.catalogue so Raycast and the strand generator
 * both read from one source of truth rather than rebuilding it independently.
 *
 * Blender export convention:
 *   - Apply all transforms (Ctrl+A → All Transforms) before export.
 *   - Export as glTF Binary (.glb), +Y up.
 *   - Bake the _facet vertex attribute (Blender polygon index per vertex).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildFacetCatalogue, buildFacetWireframe } from './facetWireframe.js';

const HEAD_URL = 'models/head.glb';

export async function loadHead() {
  try {
    const gltf = await new GLTFLoader().loadAsync(HEAD_URL);
    const root = gltf.scene;
    const groomTarget = pickGroomTarget(root);
    if (!groomTarget) throw new Error('GLB contained no mesh');
    prep(groomTarget);
    console.info('[loadHead] loaded', HEAD_URL);
    return { root, groomTarget, isPlaceholder: false };
  } catch (err) {
    console.warn(
      `[loadHead] could not load "${HEAD_URL}" (${err.message}). ` +
        'Using procedural placeholder — drop your mesh at public/models/head.glb.'
    );
    return makePlaceholder();
  }
}

/** Choose the mesh with the most triangles as the thing we groom. */
function pickGroomTarget(root) {
  let best = null;
  let bestCount = -1;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      const count = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      if (count > bestCount) {
        bestCount = count;
        best = o;
      }
    }
  });
  return best;
}

/**
 * Per-target prep — runs on every real GLB mesh.
 *
 * Order matters:
 *   1. computeVertexNormals only if normals are absent (Blender exports them).
 *   2. toNonIndexed — keeps faceIndex↔triangle mapping 1:1 for raycasting.
 *      Do NOT call computeVertexNormals after this; on non-indexed geometry
 *      it would produce flat face normals, killing smooth interpolation.
 *   3. Build FacetCatalogue from the _facet attribute and store it on
 *      mesh.userData.catalogue.  Raycast and StrandGen both read from here.
 */
function prep(mesh) {
  const g = mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();

  if (g.index) {
    mesh.geometry = g.toNonIndexed();
    g.dispose();
  }

  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();

  // Catalogue FIRST, wireframe from it. The catalogue now owns the weld and
  // the facet adjacency graph (see facetWireframe.js); the wireframe is just a
  // consumer that draws the edges it already computed. Building in this order
  // makes the dependency explicit and means the expensive pass runs exactly
  // once whether or not the debug overlay is ever shown.
  const catalogue = buildFacetCatalogue(mesh.geometry);
  mesh.userData.catalogue    = catalogue;
  mesh.userData.wireframeGeo = catalogue
    ? buildFacetWireframe(mesh.geometry, catalogue).wireframe
    : null;   // viewer.viewQuads() reuses this
}

function makePlaceholder() {
  const root = new THREE.Group();
  root.name = 'PlaceholderHead';

  const geo = new THREE.SphereGeometry(0.11, 64, 48);
  geo.scale(1.0, 1.18, 1.05);
  geo.computeVertexNormals();
  const headGeo = geo.toNonIndexed();
  geo.dispose();
  headGeo.computeBoundingBox();
  headGeo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color    : 0xc9a48a,
    roughness: 0.72,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(headGeo, mat);
  mesh.name = 'PlaceholderHeadMesh';
  // No _facet attribute on the placeholder → catalogue stays null.
  mesh.userData.catalogue = null;
  root.add(mesh);

  return { root, groomTarget: mesh, isPlaceholder: true };
}