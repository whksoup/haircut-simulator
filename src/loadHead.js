/**
 * loadHead — loads the head GLB, with a graceful fallback.
 *
 * Drop your exported mesh at `public/models/head.glb`. Until then (or if the
 * fetch fails) this returns a procedural placeholder head so the rest of the
 * pipeline has a mesh to work against.
 *
 * Returns { root, groomTarget }:
 *   - root        : Object3D to add to the scene (whole GLTF scene or placeholder)
 *   - groomTarget : the Mesh strands will root onto (largest mesh by triangles)
 *
 * Blender export convention (see README):
 *   - Apply all transforms (Ctrl+A → All Transforms) before export.
 *   - Export as glTF Binary (.glb), +Y up.
 *   - GLB triangulates on export — selection granularity is per-triangle.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

/** Per-target prep we'll rely on in later phases. */
function prep(mesh) {
  const g = mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  // A non-indexed copy keeps faceIndex ↔ triangle mapping simple for
  // raycasting + per-vertex coloring in Phase 1. Cheap at these sizes.
  if (g.index) {
    mesh.geometry = g.toNonIndexed();
    g.dispose();
  }
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function makePlaceholder() {
  const root = new THREE.Group();
  root.name = 'PlaceholderHead';

  // Roughly head-proportioned ellipsoid (~0.2m across), enough faces to paint.
  const geo = new THREE.SphereGeometry(0.11, 64, 48);
  geo.scale(1.0, 1.18, 1.05); // taller, slightly deeper than wide
  geo.computeVertexNormals();
  const headGeo = geo.toNonIndexed();
  geo.dispose();
  headGeo.computeBoundingBox();
  headGeo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xc9a48a,
    roughness: 0.72,
    metalness: 0.0,
    // vertexColors switched on in Phase 1 once we add a color attribute.
  });
  const mesh = new THREE.Mesh(headGeo, mat);
  mesh.name = 'PlaceholderHeadMesh';
  root.add(mesh);

  return { root, groomTarget: mesh, isPlaceholder: true };
}
