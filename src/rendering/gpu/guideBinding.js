/**
 * Bind deterministic roots to a spatial guide field. Shape and authored frame
 * changes belong to texture rows, so binding reads only roots and seams.
 * Neither split mesh normals nor inferred flow parts may tear open boundaries.
 *
 * Three rows fit the existing instance layout. The fourth nearest distance is
 * a compact support radius: the third guide fades to zero at a replacement.
 * Exact four-way equidistance is singular for three-row support; stable row
 * ordering provides a deterministic fallback there.
 *
 * A balanced spatial tree proves the nearest four rather than stopping at
 * the first grid cell with enough guides. Nonnegative seam costs preserve
 * the splitting-plane distance bound used to prune the far branch.
 */
export const GUIDES_PER_STRAND = 3;

export function bindStrandsToGuides({
  rootPositions, total, guideList, strandFacets = null, seamField = null,
  seamSearchCells = 8, outRows, outWeights,
}) {
  if (!guideList.length) return;
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const g of guideList) for (let a=0;a<3;a++) {
    min[a]=Math.min(min[a],g.root[a]); max[a]=Math.max(max[a],g.root[a]);
  }
  const cell=Math.max(Math.hypot(...max.map((v,a)=>v-min[a]))/Math.cbrt(guideList.length),1e-4);
  // Allocations scale with guides and happen once per bind, not per strand.
  function build(indices,depth=0) {
    if(!indices.length) return null;
    const axis=depth%3;
    indices.sort((a,b)=>guideList[a].root[axis]-guideList[b].root[axis] || a-b);
    const m=indices.length>>1;
    return {row:indices[m],axis,left:build(indices.slice(0,m),depth+1),right:build(indices.slice(m+1),depth+1)};
  }
  const tree=build(guideList.map((_,i)=>i));
  const seamsOn=!!(seamField?.active && strandFacets);
  if (seamsOn) seamField.setRadius(cell*seamSearchCells);
  const rows=new Int32Array(4),dist=new Float64Array(4),weights=new Float64Array(3);
  const p=[0,0,0];
  let facet=-1;
  function consider(r,gated) {
    const g=guideList[r];
    const dx=p[0]-g.root[0],dy=p[1]-g.root[1],dz=p[2]-g.root[2];
    let d=dx*dx+dy*dy+dz*dz;
    if (gated) {
      const cost=seamField.detour(facet,g.facetId??-1);
      if(cost>0) d=(Math.sqrt(d)+cost)**2;
    }
    if (!Number.isFinite(d)) return;
    let j=3;
    if (d>dist[j] || (d===dist[j] && r>=rows[j])) return;
    while(j>0 && (d<dist[j-1] || (d===dist[j-1] && r<rows[j-1]))) {
      dist[j]=dist[j-1]; rows[j]=rows[j-1]; j--;
    }
    dist[j]=d; rows[j]=r;
  }
  function visit(node,gated) {
    if(!node) return;
    const delta=p[node.axis]-guideList[node.row].root[node.axis];
    consider(node.row,gated);
    visit(delta<0?node.left:node.right,gated);
    if(delta*delta<=dist[3]) visit(delta<0?node.right:node.left,gated);
  }
  function search(gated) {
    rows.fill(-1); dist.fill(Infinity); visit(tree,gated);
  }
  for(let i=0;i<total;i++) {
    const b=i*3;
    for(let a=0;a<3;a++) p[a]=rootPositions[b+a];
    facet=seamsOn?strandFacets[i]:-1;
    search(seamsOn);
    // Preserve orphan-region fallback. Add a guide inside to enforce the part.
    if(rows[0]<0 && seamsOn) search(false);
    const radius=dist[3];
    let sum=0;
    for(let j=0;j<3;j++) {
      const taper=Number.isFinite(radius)?Math.max(0,1-Math.sqrt(dist[j]/Math.max(radius,1e-24))):1;
      weights[j]=rows[j]<0?0:taper*taper/(dist[j]+1e-10);
      sum+=weights[j];
    }
    if(sum<1e-30) {
      // Coincident/equidistant roots: no NaN and a repeatable tie break.
      for(let j=0;j<3;j++) weights[j]=rows[j]<0?0:1/(dist[j]+1e-10);
      sum=weights[0]+weights[1]+weights[2];
    }
    for(let j=0;j<3;j++) {outRows[b+j]=Math.max(rows[j],0);outWeights[b+j]=weights[j]/(sum||1);}
  }
}
