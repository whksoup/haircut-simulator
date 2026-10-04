/** Opt-in checks against the real app and production GLSL. Import in the local
 * preview and call runBlendingChecks(hc); the original groom is restored. */
import { captureGrowthVertices } from '../../src/debug/growthCapture.js';
import { guideFrame, liftGuide } from '../../src/hair/guideFrame.js';
import { bindStrandsToGuides } from '../../src/rendering/gpu/guideBinding.js';

export async function runBlendingChecks(hc) {
  const {groom,renderer:h,viewer}=hc;
  const original=groom.serialize(), guides=groom.guides,seams=groom.seams;
  const report={date:new Date().toISOString(),browser:navigator.userAgent,viewport:[innerWidth,innerHeight,devicePixelRatio],checks:[],boundaries:[]};
  const check=(name,pass,details={})=>{report.checks.push({name,pass,...details});};
  const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const arc=vs=>vs.slice(1).reduce((sum,v,i)=>sum+dist(v,vs[i]),0);
  const roots=Array.from(h._iRoot.slice(0,h._total*3));
  const seeds=Array.from(h._iSeed.slice(0,h._total));
  const geo=h._geo.clone(),proxy={_geo:geo,_material:h._material};
  const initialLook={clump:h._material.uniforms.uClump.value,jitter:h._material.uniforms.uJitter.value,lenVar:h._material.uniforms.uLenVar.value};
  try {
    hc.setGrowthFraction(1); hc.setActiveTool('none'); h.setLook({clump:1,jitter:0,lenVar:0});
    const indices=Array.from({length:h._total},(_,i)=>i);
    const full=captureGrowthVertices(viewer.renderer,h,indices,1);
    const lifted=h._guideList.map(g=>liftGuide(g,guideFrame(g)));
    let maxShapeError=0,rootError=0;
    for(const rec of full) for(let k=0;k<9;k++) {
      const i=rec.index,p=roots.slice(i*3,i*3+3);
      for(let j=0;j<3;j++) {
        const row=h._iGuideRow[i*3+j],g=h._guideList[row];
        for(let a=0;a<3;a++) p[a]+=h._iGuideW[i*3+j]*(lifted[row][k*3+a]-g.root[a]);
      }
      maxShapeError=Math.max(maxShapeError,dist(p,rec.vertices[k]));
      if(k===0) rootError=Math.max(rootError,dist(p,rec.vertices[k]));
    }
    check('all startup vertices match independent authored-frame oracle',maxShapeError<1e-6,{strands:full.length,maxShapeError});
    check('all roots remain pinned',rootError===0,{rootError});
    for(const fraction of [0,.25,.5,.99,1]) {
      const partial=captureGrowthVertices(viewer.renderer,h,indices,fraction);
      let maxArcError=0,maxPrefixError=0;
      for(let i=0;i<full.length;i++) {
        const vertices=full[i].vertices,target=arc(vertices)*fraction;
        let used=0,cut=vertices[0];const expected=[vertices[0]];
        for(let k=1;k<9;k++) {
          const len=dist(vertices[k],vertices[k-1]);
          if(used+len<=target) cut=vertices[k];
          else if(used<target && len>0) cut=vertices[k].map((v,a)=>vertices[k-1][a]+(v-vertices[k-1][a])*(target-used)/len);
          expected.push(cut);used+=len;
        }
        maxArcError=Math.max(maxArcError,Math.abs(arc(partial[i].vertices)-target));
        maxPrefixError=Math.max(maxPrefixError,...expected.map((v,k)=>dist(v,partial[i].vertices[k])));
      }
      check(`growth ${fraction} preserves segment prefix`,maxArcError<1e-5&&maxPrefixError<1e-5,{maxArcError,maxPrefixError});
    }
    const edges=[...hc.catalogue.edges()].filter(e=>groom.faces.has(e.a)&&groom.faces.has(e.b));
    for(const e of edges) {
      const ca=hc.catalogue.getFacet(e.a).centroid,cb=hc.catalogue.getFacet(e.b).centroid;
      const v=[cb.x-ca.x,cb.y-ca.y,cb.z-ca.z],l=Math.hypot(...v),m=[e.midpoint.x,e.midpoint.y,e.midpoint.z];
      const near=Float32Array.from([-1,1].flatMap(sign=>m.map((x,a)=>x+sign*1e-6*v[a]/l)));
      geo.getAttribute('iRoot').array.set(near);
      // Deliberately exaggerated normal jump: the authored shape must ignore it.
      geo.getAttribute('iNormal').array.set([0,1,0,1,0,0]);
      const rows=new Float32Array(6),weights=new Float32Array(6),deltas=[];
      for(const p of [1,.5,0]) {
        groom.seams.set(e.a,e.b,p); h._seams.invalidate();
        bindStrandsToGuides({rootPositions:near,total:2,guideList:h._guideList,strandFacets:Int32Array.from([e.a,e.b]),seamField:h._seams,outRows:rows,outWeights:weights});
        geo.getAttribute('iGuideRow').array.set(rows);geo.getAttribute('iGuideW').array.set(weights);
        const got=captureGrowthVertices(viewer.renderer,proxy,[0,1],1);
        const delta=Math.max(...got[0].vertices.map((v,k)=>dist(v.map((x,a)=>x-near[a]),got[1].vertices[k].map((x,a)=>x-near[a+3]))));
        deltas.push(delta); report.boundaries.push({edge:e.id,permeability:p,delta,rows:Array.from(rows),weights:Array.from(weights)});
      }
      check(`edge ${e.id}: fully open is continuous`,deltas[0]<1e-5,{delta:deltas[0]});
      check(`edge ${e.id}: half and hard produce distinct separation`,deltas[1]>deltas[0]*100&&deltas[2]>deltas[1]+1e-3,{deltas});
      groom.seams.set(e.a,e.b,1);
    }
    h.syncSeams();
    check('seam changes preserve roots and seeds',JSON.stringify(roots)===JSON.stringify(Array.from(h._iRoot.slice(0,h._total*3)))&&JSON.stringify(seeds)===JSON.stringify(Array.from(h._iSeed.slice(0,h._total))));
    const facet=groom.faces.keys().next().value;
    hc.raycast.selection.clear();hc.raycast.selection.add(facet);
    hc.removeHairFromSelection();check('remove hair updates renderer',!h._slices.has(facet));
    hc.history.undo();check('undo restores exact groom',groom.serialize()===original);
    hc.history.redo();check('redo removes hair again',!groom.hasFacet(facet));
    hc.addHairToSelection();check('add restores hair and guide binding',h._slices.has(facet)&&h._total>0);
    hc.loadGroom(JSON.parse(original));
    check('load preserves store identities',groom.guides===guides&&groom.seams===seams);
    check('save/load round trip preserves authored JSON',groom.serialize()===original);
    const after=captureGrowthVertices(viewer.renderer,h,indices,1);
    check('save/load reconstructs identical GPU vertices',JSON.stringify(after)===JSON.stringify(full));
  } finally {
    geo.dispose();hc.loadGroom(JSON.parse(original));h.setLook(initialLook);
  }
  report.pass=report.checks.every(c=>c.pass);return report;
}
