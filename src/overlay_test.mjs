/**
 * Verifies the seam overlay's ribbon geometry: selection and hover must have
 * real width (they are triangles, not lines) and must lie IN the surface
 * rather than standing up off it.
 */
import assert from 'node:assert';
import { buildFacetCatalogue } from './facetWireframe.js';
import { SeamStore } from './seams.js';
import { SeamOverlay } from './seamOverlay.js';

function cube() {
  const V=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const F=[[4,5,6,7],[1,0,3,2],[5,1,2,6],[0,4,7,3],[3,7,6,2],[0,1,5,4]];
  const pos=[],fac=[];
  F.forEach((q,fid)=>{const[a,b,c,d]=q;for(const t of[[a,b,c],[a,c,d]])for(const v of t){pos.push(...V[v]);fac.push(fid);}});
  const attr=(a,s)=>({array:a,itemSize:s,count:a.length/s,getX:i=>a[i*s],getY:i=>a[i*s+1],getZ:i=>a[i*s+2]});
  return {attributes:{position:attr(pos,3),_facet:attr(fac,1)}};
}

const warn=console.warn; console.warn=()=>{};
const cat = buildFacetCatalogue(cube());
console.warn=warn;

const seams = new SeamStore();
const ov = new SeamOverlay({ mesh: null, catalogue: cat, seams });

// === selection renders as ribbons, not lines ==============================
ov.setSelection([0]);
const sel = ov._selLayer.geo.attributes.position.array;
assert.equal(sel.length, 18, 'one ribbon = 2 triangles = 6 verts = 18 floats');

// The ribbon must have real width: the two "sides" are distinct points.
const p = (i) => ({ x: sel[i*3], y: sel[i*3+1], z: sel[i*3+2] });
const width = Math.hypot(p(0).x-p(1).x, p(0).y-p(1).y, p(0).z-p(1).z);
assert.ok(width > 1e-4, `ribbon has width, got ${width}`);

// And it must lie IN the surface: the width direction is perpendicular to the
// edge normal, so the quad hugs the scalp rather than standing up as a wall.
const e0 = cat.getEdge(0);
const n = ov._edgeNormal(e0);
const sideDot = ((p(1).x-p(0).x)*n.x + (p(1).y-p(0).y)*n.y + (p(1).z-p(0).z)*n.z) / width;
assert.ok(Math.abs(sideDot) < 1e-6, `ribbon lies flat in the surface, dot=${sideDot}`);

// === hover suppresses itself under the selection ==========================
ov.setHover(0);
assert.equal(ov._hoverLayer.geo.attributes.position.array.length, 0,
  'hovering an already-selected edge draws nothing');
ov.setHover(1);
assert.equal(ov._hoverLayer.geo.attributes.position.array.length, 18,
  'hovering an unselected edge draws one ribbon');
ov.setHover(-1);
assert.equal(ov._hoverLayer.geo.attributes.position.array.length, 0, 'cleared');

// === the seam layer stays as lines ========================================
seams.set(cat.getEdge(3).a, cat.getEdge(3).b, 0.4);
ov.refresh();
assert.equal(ov._seamLayer.geo.attributes.position.array.length, 6,
  'seam layer is 2 verts per edge — still lines, deliberately');
assert.equal(ov.drawnEdges, 1);

// Empty selection empties the buffer rather than leaving stale geometry.
ov.setSelection([]);
assert.equal(ov._selLayer.geo.attributes.position.array.length, 0);

console.log('overlay: all assertions passed');
console.log(`ribbon width = ${width.toFixed(5)} units, flat in surface`);
