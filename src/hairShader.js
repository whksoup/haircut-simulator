/**
 * hairShader.js — instanced hair strand shaders (R2 shape model).
 *
 * Model: ONE shape per facet, instanced across every root sampled on that
 * facet — your "comb the centre hair, multiply across the facet" idea. The
 * shape is a normalised control-point polyline (strandShape.js) stored as one
 * ROW of a float data texture; the vertex shader looks the strand's facet row
 * up, reads the control point for this vertex, transforms it by the strand's
 * own (N,T) frame, and scales by length × growth. Each strand keeps its own
 * root and smooth growth normal, so a single authored curl fans across the
 * surface instead of cloning into parallel copies.
 *
 * Why a texture and not a per-instance attribute: an instance can carry vectors
 * (root, normal, ...) but not a whole M-point polyline. The shape lives in the
 * texture keyed by facet row; the instance just carries `iShapeRow`. Re-combing
 * one facet rewrites one row — same incrementality the rest of the path has.
 *
 * LOCAL FRAME: shape coords are (x along tangent T, y along bitangent B,
 * z along growth normal N). A straight strand is (0,0,t). The shader rebuilds
 * (T,B,N) per strand from iNormal + iTangent, so the SAME shape row points the
 * same way (modulo the surface fan) across the facet.
 *
 * Per-vertex (template geometry):
 *   aT        float   parameter along the strand, 0 = root → 1 = tip. Vertices
 *                     sit exactly on control points, so aT maps to an integer
 *                     control-point index (no interpolation needed).
 *
 * Per-instance (one strand each — InstancedBufferAttribute):
 *   iRoot     vec3    root position, MESH-LOCAL space
 *   iNormal   vec3    smooth growth normal (unit), mesh-local
 *   iTangent  vec3    frame tangent (unit, ~in the normal plane), mesh-local
 *   iLength   float   ungrown strand length (mesh units)
 *   iShapeRow float   this facet's row in uShapeTex
 *
 * Uniforms:
 *   uShapeTex     sampler2D  SHAPE_POINTS (wide) × rows (tall) float texture;
 *                            texel.xyz = a control point in (T,B,N) coords.
 *   uShapeTexSize vec2       (SHAPE_POINTS, rowCount).
 *   uGrowth       float      0..1 growth ramp; scales the whole shape from the
 *                            root so a strand uncurls cleanly as it grows in.
 *   uColor        vec3       flat strand colour (hook for a colour model later).
 *
 * IMPORTANT: add the rendered object as a CHILD of the head mesh
 * (`groomTarget.add(gpuHair.object)`) so modelViewMatrix carries the head
 * transform and the strand data above stays in clean mesh-local space.
 */

import * as THREE from 'three';
import { SHAPE_POINTS } from './strandShape.js';

export const hairVertexShader = /* glsl */ `
attribute float aT;
attribute vec3  iRoot;
attribute vec3  iNormal;
attribute vec3  iTangent;
attribute float iLength;
attribute float iShapeRow;

uniform sampler2D uShapeTex;
uniform vec2      uShapeTexSize; // (SHAPE_POINTS, rowCount)
uniform float     uGrowth;

varying float vT;

void main() {
  // Vertices sit on control points: aT * (M-1) is an integer index.
  float M = uShapeTexSize.x;
  float k = floor(aT * (M - 1.0) + 0.5);
  vec2  uv = vec2((k + 0.5) / uShapeTexSize.x,
                  (iShapeRow + 0.5) / uShapeTexSize.y);
  vec3  local = texture2D(uShapeTex, uv).xyz; // (T,B,N) coords, normalised length

  // Per-strand orthonormal frame. iTangent is already ~in the normal plane;
  // re-orthogonalise so the basis is clean even after interpolation.
  vec3 N = normalize(iNormal);
  vec3 T = normalize(iTangent - N * dot(iTangent, N));
  vec3 B = cross(N, T);

  vec3 meshOffset = (T * local.x + B * local.y + N * local.z) * (iLength * uGrowth);
  vec3 meshPos    = iRoot + meshOffset;

  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(meshPos, 1.0);
}
`;

export const hairFragmentShader = /* glsl */ `
uniform vec3  uColor;
varying float vT;

void main() {
  // Flat for now. vT is wired through so you can darken the root or fade the
  // tip later without touching the vertex stage, e.g. mix(uColor*0.6, uColor, vT).
  gl_FragColor = vec4(uColor, 1.0);
}
`;

/**
 * Build the ShaderMaterial (thin GL lines — thickness is a later step).
 * uShapeTex / uShapeTexSize are placeholders here; GpuHair owns the texture
 * (it's sized to the facet count) and assigns them after construction.
 */
export function makeHairMaterial({ color = 0xd4a96a } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader:   hairVertexShader,
    fragmentShader: hairFragmentShader,
    uniforms: {
      uShapeTex:     { value: null },
      uShapeTexSize: { value: new THREE.Vector2(SHAPE_POINTS, 1) },
      uGrowth:       { value: 1.0 },
      uColor:        { value: new THREE.Color(color) },
    },
  });
}