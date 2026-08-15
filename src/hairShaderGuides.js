/**
 * hairShaderGuides.js — R3 shaders: k=3 guide blend + clump + jitter. SKETCH.
 *
 * Direct evolution of hairShader.js. The shape texture becomes a GUIDE texture
 * (row = guide, not facet); each strand blends 3 rows by weight instead of
 * fetching 1. Everything else about the R2 model is unchanged: control points
 * are normalised (T,B,N)-local, the strand's own frame places them, length ×
 * growth scales them.
 *
 * New per-instance attributes (from guideBinding.js / sampler):
 *   iGuideRow  vec3   texture rows of the 3 bound guides
 *   iGuideW    vec3   base blend weights (sum = 1)
 *   iSeed      float  deterministic per-strand random in [0,1) (hash2f of the
 *                     strand's sampler seed — the same determinism story)
 *
 * New uniforms (all live sliders, no rebuild, no rebind):
 *   uClump   float ≥ 1   weights are raised to this power and renormalised.
 *                        1 = smooth field; 4–8 = visible clumps around each
 *                        guide; large = every strand snaps to its dominant
 *                        guide (wet-hair look). One uniform, huge visual range.
 *   uJitter  float 0..~0.2  per-strand tip wander as a fraction of length.
 *   uLenVar  float 0..~0.5  per-strand length variation (±fraction).
 *
 * Guide LENGTH lives in the texture: texel(row, 0).w = guide length in mesh
 * units (points[0] is always the origin, so its .w is free real estate).
 * Blended lengths mean a long guide next to a short one produces a smooth
 * length gradient across the strands between them — layered cuts for free.
 * iLength from the facet params is retired; per-strand variation comes from
 * uLenVar × iSeed instead.
 *
 * COMB PUSHOUT (uCombA / uCombB / uCombR, mesh-local):
 * Guides being clear of the comb capsule does NOT mean render strands are.
 * Each strand blends its 3 nearest guides, so where those guides straddle the
 * bar the blended curve dips through it — an artefact of RECONSTRUCTION, not
 * of the guide solve, and therefore unfixable on the CPU at any cost. The
 * vertex is clamped out of the same capsule after blending: ~10 ALU, no texture
 * reads, no meaningful branch cost. Purely cosmetic — guides stay authoritative
 * and nothing here writes back — but it guarantees you never SEE the bar
 * intersect a strand. uCombR <= 0 disables it.
 */

import * as THREE from 'three';
import { SHAPE_POINTS } from './strandShape.js';

export const hairVertexShaderR3 = /* glsl */ `
attribute float aT;
attribute vec3  iRoot;
attribute vec3  iNormal;
attribute vec3  iTangent;
attribute vec3  iGuideRow;
attribute vec3  iGuideW;
attribute float iSeed;

uniform sampler2D uGuideTex;
uniform vec2      uGuideTexSize; // (SHAPE_POINTS, rowCount)
uniform float     uGrowth;
uniform float     uClump;
uniform float     uJitter;
uniform float     uLenVar;
uniform vec3      uCombA;
uniform vec3      uCombB;
uniform float     uCombR;

varying float vT;
varying float vSeed;

// Cheap deterministic hash for per-strand variation channels.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec4 fetchCP(float row, float k) {
  vec2 uv = vec2((k + 0.5) / uGuideTexSize.x, (row + 0.5) / uGuideTexSize.y);
  return texture2D(uGuideTex, uv);
}

void main() {
  float M = uGuideTexSize.x;
  float k = floor(aT * (M - 1.0) + 0.5);

  // Clump: sharpen the weight distribution live. pow(w,1)=smooth field,
  // higher pulls every strand toward its dominant guide.
  vec3 w = pow(max(iGuideW, 0.0), vec3(uClump));
  w /= max(w.x + w.y + w.z, 1e-6);

  vec4 c0 = fetchCP(iGuideRow.x, k);
  vec4 c1 = fetchCP(iGuideRow.y, k);
  vec4 c2 = fetchCP(iGuideRow.z, k);
  vec3 local = w.x * c0.xyz + w.y * c1.xyz + w.z * c2.xyz;

  // Blended guide length (stored in texel(row,0).w) + per-strand variation.
  vec4 l0 = fetchCP(iGuideRow.x, 0.0);
  vec4 l1 = fetchCP(iGuideRow.y, 0.0);
  vec4 l2 = fetchCP(iGuideRow.z, 0.0);
  float len = w.x * l0.w + w.y * l1.w + w.z * l2.w;
  len *= 1.0 + (hash11(iSeed * 7.13) - 0.5) * 2.0 * uLenVar;

  // Per-strand frame (unchanged from R2).
  vec3 N = normalize(iNormal);
  vec3 T = normalize(iTangent - N * dot(iTangent, N));
  vec3 B = cross(N, T);

  // Tip jitter: a fixed random lateral direction per strand, eased in
  // quadratically from the root so roots stay planted. Normalised space, so
  // it scales with length like everything else.
  float jt = aT * aT * uJitter;
  vec2 jd = vec2(hash11(iSeed * 3.7) - 0.5, hash11(iSeed * 5.1) - 0.5) * 2.0;
  local.xy += jd * jt;

  vec3 meshOffset = (T * local.x + B * local.y + N * local.z) * (len * uGrowth);
  vec3 meshPos    = iRoot + meshOffset;

  // Comb pushout — see the header. Same capsule the CPU solve used, in the
  // same mesh-local space, so the two agree by construction.
  if (uCombR > 0.0) {
    vec3  ab = uCombB - uCombA;
    float s  = clamp(dot(meshPos - uCombA, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    vec3  r  = meshPos - (uCombA + ab * s);
    float d  = length(r);
    if (d < uCombR) {
      // d ~ 0 is a strand lying exactly on the axis: any radial will do, and
      // N is guaranteed non-degenerate and roughly outward.
      vec3 dir = d > 1e-6 ? r / d : N;
      meshPos += dir * (uCombR - d);
    }
  }

  vT = aT;
  vSeed = iSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(meshPos, 1.0);
}
`;

export const hairFragmentShaderR3 = /* glsl */ `
uniform vec3  uColor;
varying float vT;
varying float vSeed;

void main() {
  // Root darkening + slight per-strand tint variation — reads as depth even
  // on unlit GL lines. Replace with a real colour model later.
  float shade = mix(0.55, 1.0, vT);
  float tint  = 0.9 + 0.2 * fract(vSeed * 17.0);
  gl_FragColor = vec4(uColor * shade * tint, 1.0);
}
`;

export function makeHairMaterialR3({ color = 0xd4a96a } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader:   hairVertexShaderR3,
    fragmentShader: hairFragmentShaderR3,
    uniforms: {
      uGuideTex:     { value: null },
      uGuideTexSize: { value: new THREE.Vector2(SHAPE_POINTS, 1) },
      uGrowth:       { value: 1.0 },
      uClump:        { value: 1.0 },
      uJitter:       { value: 0.0 },
      uLenVar:       { value: 0.0 },
      uCombA:        { value: new THREE.Vector3() },
      uCombB:        { value: new THREE.Vector3() },
      uCombR:        { value: 0.0 },
      uColor:        { value: new THREE.Color(color) },
    },
  });
}