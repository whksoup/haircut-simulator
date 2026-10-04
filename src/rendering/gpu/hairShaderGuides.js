/** Shared production reconstruction. Texture xyz holds mesh-local guide
 * offsets, already lifted through each guide's own frame and length. Blending
 * never reorients the result through the head's split facet normals. Growth
 * clips the final rendered arc, retaining its original corners. */
import * as THREE from 'three';
import { SHAPE_POINTS } from '../../hair/strandShape.js';

export const hairReconstructionGLSL = /* glsl */ `
attribute float aT;
attribute vec3 iRoot;
attribute vec3 iNormal;
attribute vec3 iTangent;
attribute vec3 iGuideRow;
attribute vec3 iGuideW;
attribute float iSeed;
uniform sampler2D uGuideTex;
uniform vec2 uGuideTexSize;
uniform float uGrowthFraction;
uniform float uClump;
uniform float uJitter;
uniform float uLenVar;
uniform bool uMeshOffsets;
uniform vec3 uCombA;
uniform vec3 uCombB;
uniform float uCombR;
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec4 fetchCP(float row, float k) {
  return texture2D(uGuideTex, vec2((k + 0.5) / uGuideTexSize.x, (row + 0.5) / uGuideTexSize.y));
}
vec3 fullStrandVertex(float t) {
  vec3 w = pow(max(iGuideW, 0.0), vec3(uClump));
  w /= max(w.x + w.y + w.z, 1e-6);
  float len = w.x * fetchCP(iGuideRow.x, 0.0).w
            + w.y * fetchCP(iGuideRow.y, 0.0).w
            + w.z * fetchCP(iGuideRow.z, 0.0).w;
  float variation = 1.0 + (hash11(iSeed * 7.13) - 0.5) * 2.0 * uLenVar;
  float k = t * (uGuideTexSize.x - 1.0);
  vec3 offset = w.x * fetchCP(iGuideRow.x, k).xyz
             + w.y * fetchCP(iGuideRow.y, k).xyz
             + w.z * fetchCP(iGuideRow.z, k).xyz;
  if (!uMeshOffsets) {
    // No authored guides: retain the sampler-normal straight-hair fallback.
    vec3 N = normalize(iNormal);
    vec3 T = normalize(iTangent - N * dot(iTangent, N));
    offset = T * offset.x + cross(N, T) * offset.y + N * offset.z;
  }
  vec3 jd = vec3(hash11(iSeed * 3.7), hash11(iSeed * 5.1), hash11(iSeed * 11.9)) * 2.0 - 1.0;
  offset += jd * (t * t * uJitter * len);
  return iRoot + offset * variation;
}
vec3 growthStrandVertex(float t) {
  if (uGrowthFraction >= 1.0) return fullStrandVertex(t);
  if (uGrowthFraction <= 0.0) return fullStrandVertex(0.0);
  vec3 points[${SHAPE_POINTS}];
  float arcs[${SHAPE_POINTS}];
  points[0] = fullStrandVertex(0.0);
  arcs[0] = 0.0;
  for (int k = 1; k < ${SHAPE_POINTS}; k++) {
    points[k] = fullStrandVertex(float(k) / ${SHAPE_POINTS - 1}.0);
    arcs[k] = arcs[k - 1] + length(points[k] - points[k - 1]);
  }
  float target = uGrowthFraction * arcs[${SHAPE_POINTS - 1}];
  vec3 cut = points[0];
  vec3 result = points[0];
  for (int k = 1; k < ${SHAPE_POINTS}; k++) {
    if (arcs[k - 1] <= target && arcs[k] > target) {
      float segment = arcs[k] - arcs[k - 1];
      cut = mix(points[k - 1], points[k], (target - arcs[k - 1]) / segment);
    }
    if (float(k) <= t * ${SHAPE_POINTS - 1}.0 + 0.01 && arcs[k] <= target) result = points[k];
  }
  // A vertex beyond the cut collapses to the same terminal point. GL_LINES
  // therefore preserves complete segments and shortens just the last one.
  for (int k = 1; k < ${SHAPE_POINTS}; k++) {
    if (abs(float(k) - t * ${SHAPE_POINTS - 1}.0) < 0.01 && arcs[k] > target) result = cut;
  }
  return result;
}
`;
export const hairVertexShaderR3 = hairReconstructionGLSL + /* glsl */ `
varying float vT;
varying float vSeed;
varying vec3 vTechnicalWorldPosition;
void main() {
  vec3 meshPos = growthStrandVertex(aT);
  if (uGrowthFraction == 1.0 && uCombR > 0.0) {
    vec3 ab = uCombB - uCombA;
    float s = clamp(dot(meshPos - uCombA, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    vec3 r = meshPos - (uCombA + ab * s);
    float d = length(r);
    if (d < uCombR) meshPos += (d > 1e-6 ? r / d : normalize(iNormal)) * (uCombR - d);
  }
  vT = aT;
  vSeed = iSeed;
  vTechnicalWorldPosition = (modelMatrix * vec4(meshPos, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(meshPos, 1.0);
}
`;
export const hairFragmentShaderR3 = /* glsl */ `
uniform vec3 uColor;
uniform float uGrowthFraction;
uniform bool uTechnical;
uniform bool uTechnicalClipping;
uniform vec4 uTechnicalPlane;
varying float vT;
varying float vSeed;
varying vec3 vTechnicalWorldPosition;
void main() {
  if (uGrowthFraction <= 0.0) discard;
  if (uTechnicalClipping && dot(uTechnicalPlane.xyz, vTechnicalWorldPosition) + uTechnicalPlane.w < 0.0) discard;
  float shade = mix(0.55, 1.0, vT);
  float tint = 0.9 + 0.2 * fract(vSeed * 17.0);
  gl_FragColor = vec4(uColor * shade * tint, 1.0);
  if (uTechnical) gl_FragColor = vec4(vec3(mix(0.035, 0.12, step(0.65, vT))), 1.0);
}
`;
export function makeHairMaterialR3({ color = 0xd4a96a } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: hairVertexShaderR3, fragmentShader: hairFragmentShaderR3,
    uniforms: {
      uGuideTex: { value: null },
      uGuideTexSize: { value: new THREE.Vector2(SHAPE_POINTS, 1) },
      uGrowthFraction: { value: 1 },
      uTechnical: { value: false },
      uTechnicalClipping: { value: false },
      uTechnicalPlane: { value: new THREE.Vector4(1, 0, 0, 0) },
      uClump: { value: 1 }, uJitter: { value: 0 }, uLenVar: { value: 0 },
      uMeshOffsets: { value: true },
      uCombA: { value: new THREE.Vector3() }, uCombB: { value: new THREE.Vector3() },
      uCombR: { value: 0 }, uColor: { value: new THREE.Color(color) },
    },
  });
}
