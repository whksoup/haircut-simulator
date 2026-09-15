/**
 * renderer.js — factory that hands back whichever strand renderer is wired in.
 *
 * All three satisfy the same duck-typed interface, so main.js / ui.js never
 * name a concrete renderer:
 *
 *   rebuild()                  full rebuild from groom.faces (+ guides)
 *   updateFacet(id)            resample one facet (density / first add)
 *   removeFacet(id)            drop one facet
 *   setGrowth(0..1)            growth scale       (R2 only; CPU and R3 no-op)
 *   update(dt, ratePerSec)     per-frame growth ramp (R2 only; CPU and R3 no-op)
 *   object                     THREE.Object3D, parented under the head mesh
 *   dispose()
 *
 * Guide path only (kind: 'guides'):
 *   syncGuides()               re-read the GuideStore: rows + rebind
 *   setGuide(id, pts, len, rate)  rewrite one guide's texture row
 *   setGuides(ids)             batched form — what a comb stroke calls
 *   setLook({clump, jitter, lenVar})
 *   setGrowthFraction(0..1) / growthFraction — runtime arc prefix; 1 is full.
 *
 * `setGrowth` and `update` are legacy R2 controls and no-ops on R3. The active
 * application uses the R3 fraction preview, which clips each final rendered
 * polyline by measured arc length while retaining its root-side shape.
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

import { GpuHairR3 } from './gpu/gpuHairR3.js';
import { GpuHair }   from './legacy/gpuHair.js';
import { StrandGen } from './legacy/strands.js';

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
