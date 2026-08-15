/**
 * renderer.js — factory that hands back whichever strand renderer is wired in.
 *
 * All three satisfy the same duck-typed interface, so main.js / ui.js never
 * name a concrete renderer:
 *
 *   rebuild()                  full rebuild from groom.faces (+ guides)
 *   updateFacet(id)            resample one facet (density / first add)
 *   removeFacet(id)            drop one facet
 *   setGrowth(0..1)            growth scale       (GPU paths; CPU no-ops)
 *   update(dt, ratePerSec)     per-frame growth ramp (GPU paths; CPU no-ops)
 *   object                     THREE.Object3D, parented under the head mesh
 *   dispose()
 *
 * Guide path only (kind: 'guides'):
 *   syncGuides()               re-read the GuideStore: rows + rebind
 *   syncSeams()                re-read the SeamStore: rebind through the seam
 *                              field. Call after EVERY seam edit — the field
 *                              caches, so skipping it looks exactly like
 *                              permeability having no effect.
 *   setSeamScale(x)            soft-seam strength (binder constant, not model)
 *   setGuide(id, pts, len)     rewrite one guide's texture row
 *   setGuides(ids)             batched form — what a comb stroke calls
 *   setLook({clump, jitter, lenVar})
 *
 * R2 path only (kind: 'gpu'):
 *   setShape(id, shape)        per-facet shape; superseded by guides
 *
 * kind:
 *   'guides' — GpuHairR3. Guide-blend model. The active path.
 *   'gpu'    — GpuHair (R2). One shape per facet. Kept for A/B comparison.
 *   'cpu'    — StrandGen. LineSegments2, straight only. Being retired.
 *
 * Note the asymmetric signature: only the guide path takes `guides`, so
 * flipping to 'gpu' or 'cpu' silently ignores it rather than erroring — which
 * is what you want when bisecting a rendering problem.
 */

import { GpuHairR3 } from './gpuHairR3.js';
import { GpuHair }   from './gpuHair.js';
import { StrandGen } from './strands.js';

export function createStrandRenderer({ kind = 'guides', mesh, groom, guides, color } = {}) {
  switch (kind) {
    case 'guides':
      return new GpuHairR3(mesh, groom, guides ?? groom.guides, { color });
    case 'gpu':
      return new GpuHair(mesh, groom, { color });
    case 'cpu':
      return new StrandGen(mesh, groom, { color });
    default:
      throw new Error(`createStrandRenderer: unknown kind "${kind}"`);
  }
}