import * as THREE from 'three';
import {captureGrowthVertices} from '/src/debug/growthCapture.js';
import {save,screenshot,savePng} from './growth-evaluation.js';

const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const arc=vertices=>vertices.slice(1).reduce((sum,v,i)=>sum+dist(v,vertices[i]),0);
// Independent double-precision oracle: consume segments from the root.
function prefix(vertices,p) {
  let remaining=arc(vertices)*p, tip=vertices[0], done=p===0;
  return vertices.map((point,i)=>{
    if(i===0) return point;
    if(done) return tip;
    const length=dist(point,vertices[i-1]);
    if(remaining>=length) { remaining-=length; tip=point; return point; }
    tip=vertices[i-1].map((v,k)=>v+(point[k]-v)*(length ? remaining/length : 0)); done=true; return tip;
  });
}
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const historyState=h=>({undo:h._undo,redo:h._redo,stroke:h._stroke,marks:Array.from(h._marks),canUndo:h.canUndo,canRedo:h.canRedo});
function metadata(hc) {
  const gl=hc.viewer.renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info');
  return {runId:window.__growthRunId,date:new Date().toISOString(),revision:'218a0fdd847ee6ea544c92696de03180e9b577ac',dirtyQualification:'Pre-existing dirty relocation plus implementation; source hashes identify executed checkout',browser:navigator.userAgent,viewport:[innerWidth,innerHeight,devicePixelRatio],gpu:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webgl:gl.getParameter(gl.VERSION),captureFormat:'RGBA32F mesh-local positions; same GLSL, independent point projection',stats:hc.renderer.stats,camera:hc.viewer.camera.toJSON(),target:hc.viewer.controls.target.toArray(),look:Object.fromEntries(['uClump','uJitter','uLenVar'].map(k=>[k,hc.renderer._material.uniforms[k].value]))};
}
function compare(full,partial,p) {
  let maxArcError=0,maxPositionError=0,maxRatioError=0; const failures=[];
  const metrics=full.map((record,i)=>{
    const L=arc(record.vertices), got=partial[i].vertices, actual=arc(got), expected=prefix(record.vertices,p);
    const arcError=Math.abs(actual-p*L), positionError=Math.max(...got.map((v,k)=>dist(v,expected[k])));
    const tolerance=Math.max(1e-6,1e-4*L), finite=got.flat().every(Number.isFinite);
    maxArcError=Math.max(maxArcError,arcError); maxPositionError=Math.max(maxPositionError,positionError); maxRatioError=Math.max(maxRatioError,L?Math.abs(actual/L-p):0);
    const metric={index:record.index,fullLength:L,length:actual,ratio:L?actual/L:null,arcError,positionError,tolerance,finite};
    if(!finite||arcError>tolerance||positionError>tolerance) failures.push(metric);
    return metric;
  });
  return {p,count:metrics.length,maxArcError,maxPositionError,maxRatioError,failures,metrics};
}
function syntheticHair(hair) {
  const m=9, rows=3, data=new Float32Array(m*rows*4);
  for(let row=0;row<rows;row++) for(let k=0;k<m;k++) {
    const t=k/(m-1), offset=(row*m+k)*4;
    const point=row===0 ? [0,0,t] : row===1 ? [k<4?0:(k-3)*.13,0,k<4?k*.2:.6] : [Math.sin(t*5)*.2,Math.cos(t*3)*.1-.1,t*.3];
    data.set(point,offset); if(k===0)data[offset+3]=[.2,.8,.4][row];
  }
  const tex=new THREE.DataTexture(data,m,rows,THREE.RGBAFormat,THREE.FloatType);tex.needsUpdate=true;
  const geo=new THREE.BufferGeometry();
  for(const [name,size,values] of [
    ['iRoot',3,[0,0,0,0,0,0,0,0,0,0,0,0]],['iNormal',3,[0,0,1,0,0,1,0,0,1,0,0,1]],['iTangent',3,[1,0,0,1,0,0,1,0,0,1,0,0]],
    ['iGuideRow',3,[0,0,0,1,1,1,0,1,2,2,2,2]],['iGuideW',3,[1,0,0,1,0,0,.2,.5,.3,1,0,0]],['iSeed',1,[.1,.2,.3,.4]],
  ])geo.setAttribute(name,new THREE.BufferAttribute(new Float32Array(values),size));
  const uniforms=Object.fromEntries(Object.entries(hair._material.uniforms).map(([k,v])=>[k,{value:v.value}]));
  uniforms.uGuideTex={value:tex}; uniforms.uGuideTexSize={value:new THREE.Vector2(m,rows)}; uniforms.uCombR={value:0}; uniforms.uJitter={value:0}; uniforms.uLenVar={value:0}; uniforms.uClump={value:1};
  return {_geo:geo,_material:{uniforms},dispose(){tex.dispose();geo.dispose();}};
}
export async function runEvaluation() {
  const hc=window.hc,{viewer,groom,renderer}=hc, webgl=viewer.renderer;
  if(!hc.setGrowthFraction)throw new Error('Candidate app API not ready');
  const manifest={...metadata(hc),source:await(await fetch('/__growth_source')).json(),checks:[],scenarios:[],screenshots:[]};
  const check=(name,pass,details={})=>manifest.checks.push({name,pass,...details});
  check('independent oracle analytic bend',JSON.stringify(prefix([[0,0,0],[1,0,0],[1,3,0]],.5))===JSON.stringify([[0,0,0],[1,0,0],[1,1,0]]));
  check('loaded source matches capture source',JSON.stringify(window.__growthLoadedSource)===JSON.stringify(manifest.source));
  check('initialized full',hc.runtime.growthFraction===1&&renderer.growthFraction===1,{runtime:hc.runtime.growthFraction,renderer:renderer.growthFraction});
  hc.setActiveTool('none'); renderer.setComb(null);
  const before=groom.serialize(), hist=JSON.stringify(historyState(hc.history)), guideStore=groom.guides,seamStore=groom.seams;
  const indices=Array.from({length:renderer._total},(_,i)=>i);
  const sourceRecords=indices.map(index=>({index,facetId:renderer._iFacet[index],root:Array.from(renderer._iRoot.slice(index*3,index*3+3)),seed:renderer._iSeed[index],guideRows:Array.from(renderer._iGuideRow.slice(index*3,index*3+3)),weights:Array.from(renderer._iGuideW.slice(index*3,index*3+3))}));
  const guideMetrics=[...groom.guides.guides.values()].map(g=>({id:g.id,facetId:g.facetId,storedLength:g.length,measuredArc:arc(Array.from({length:g.points.length/3},(_,k)=>Array.from(g.points.slice(k*3,k*3+3),v=>v*g.length)))}));
  await save('candidate-inputs.json',{...metadata(hc),groom:JSON.parse(before),guideMetrics,guideRowMap:Array.from(renderer._guideRow),strands:sourceRecords});
  const initialLook={clump:renderer._material.uniforms.uClump.value,jitter:renderer._material.uniforms.uJitter.value,lenVar:renderer._material.uniforms.uLenVar.value};
  for(const [name,look] of [['default',initialLook],['jitter-blend',{clump:1,jitter:.15,lenVar:.35}],['clump',{clump:8,jitter:.1,lenVar:.25}]]) {
    hc.setGrowthFraction(1); renderer.setLook(look);
    const full=captureGrowthVertices(webgl,renderer,indices,1); const captures=[];
    for(const p of [1,.99,.75,.5,.25,.01,0,.5,1]) {
      hc.setGrowthFraction(p);
      const vertices=captureGrowthVertices(webgl,renderer,indices,renderer.growthFraction);
      captures.push({p,vertices}); manifest.scenarios.push({name,...compare(full,vertices,p)});
      check(`${name} phase ${p} state immutable`,groom.serialize()===before&&JSON.stringify(historyState(hc.history))===hist);
    }
    await save(`gpu-${name}.json`,{full,captures});
  }
  hc.setGrowthFraction(1); renderer.setLook(initialLook);
  const synthetic=syntheticHair(renderer);
  const syntheticRecords=[];
  try {
    const full=captureGrowthVertices(webgl,synthetic,[0,1,2,3],1);
    check('GPU capture straight fixture calibrated',full[0].vertices.every((v,k)=>dist(v,[0,0,.2*k/8])<1e-6),{vertices:full[0].vertices});
    for(const p of [0,.01,.25,.49999,.5,.50001,.75,.99,1]){
      const captured=captureGrowthVertices(webgl,synthetic,[0,1,2,3],p);syntheticRecords.push({name:'synthetic',p,full,captured});manifest.scenarios.push({name:'synthetic',...compare(full,captured,p)});
    }
    const boundary=arc(full[2].vertices.slice(0,5))/arc(full[2].vertices);
    for(const p of [boundary-1e-5,boundary,boundary+1e-5]){
      const captured=captureGrowthVertices(webgl,synthetic,[0,1,2,3],p);syntheticRecords.push({name:'actual-boundary',p,full,captured});manifest.scenarios.push({name:'actual-boundary',...compare(full,captured,p)});
    }
    synthetic._geo.getAttribute('iRoot').array.set([.3,.2,.1],0);
    synthetic._geo.getAttribute('iNormal').array.set([1,0,0],0);
    synthetic._geo.getAttribute('iTangent').array.set([0,1,0],0);
    const rotated=captureGrowthVertices(webgl,synthetic,[0],1);
    syntheticRecords.push({name:'rotated-calibration',p:1,captured:rotated});
    check('GPU capture translated rotated fixture',rotated[0].vertices.every((v,k)=>dist(v,[.3+.2*k/8,.2,.1])<1e-6));
    const syntheticData=synthetic._material.uniforms.uGuideTex.value.image.data;
    syntheticData.copyWithin((9+4)*4,(9+3)*4,(9+3)*4+3);synthetic._material.uniforms.uGuideTex.value.needsUpdate=true;
    const repeated=captureGrowthVertices(webgl,synthetic,[1],1);
    for(const p of [0,.25,.5,.75,1]){
      const captured=captureGrowthVertices(webgl,synthetic,[1],p);syntheticRecords.push({name:'repeated-interior',p,full:repeated,captured});manifest.scenarios.push({name:'repeated-interior',...compare(repeated,captured,p)});
    }
    // Repeated/zero vertices exercise the same production GLSL.
    synthetic._material.uniforms.uGuideTex.value.image.data.fill(0);synthetic._material.uniforms.uGuideTex.value.needsUpdate=true;
    for(const p of [0,.5,1]) {
      const output=captureGrowthVertices(webgl,synthetic,[0,1,2,3],p);
      syntheticRecords.push({name:'degenerate',p,captured:output});
      check(`degenerate finite at ${p}`,output.every(s=>s.vertices.flat().every(Number.isFinite)&&arc(s.vertices)===0));
    }
  } finally {synthetic.dispose();}
  await save('gpu-synthetic.json',syntheticRecords);
  hc.setGrowthFraction(.5);renderer.rebuild();
  check('rebuild preserves fraction',renderer.growthFraction===.5&&hc.runtime.growthFraction===.5);
  manifest.scenarios.push({name:'rebuilt',...compare(captureGrowthVertices(webgl,renderer,indices,1),captureGrowthVertices(webgl,renderer,indices,renderer.growthFraction),.5)});
  check('store identity preserved',groom.guides===guideStore&&groom.seams===seamStore);
  check('rebuild preserves authored state',groom.serialize()===before);
  for(const p of [0,.5,1]){hc.setGrowthFraction(p);await save(`saved-at-${p===.5?'half':p}.json`,JSON.parse(groom.serialize()));check(`serialize full at ${p}`,groom.serialize()===before);}
  // Direct app action attempts supplement real pointer/keyboard UI evidence.
  hc.raycast._selectSingle(309);
  hc.setGrowthFraction(.5);
  for(const name of ['addHairToSelection','removeHairFromSelection','cutAtBlade','seedSeams','sealSelectionBorder','openSelectionSeams','clearAllSeams']){
    const state=groom.serialize();hc[name]();check(`guard ${name}`,groom.serialize()===state);
  }
  for(const name of ['comb','scissors','seam']){hc.setActiveTool(name);check(`tool lock ${name}`,name==='seam'?!hc.seamTool.enabled:!hc[name].enabled);}
  let rejected=false;try{hc.loadGroom({version:999999});}catch{rejected=true;}
  check('invalid load leaves preview and authored state intact',rejected&&hc.runtime.growthFraction===.5&&groom.serialize()===before);
  hc.loadGroom(JSON.parse(before));
  check('valid application load resets full and preserves stores',hc.runtime.growthFraction===1&&renderer.growthFraction===1&&groom.serialize()===before&&groom.guides===guideStore&&groom.seams===seamStore);
  hc.setGrowthFraction(1);
  const cameraPosition=viewer.camera.position.clone(), target=viewer.controls.target.clone(), up=viewer.camera.up.clone(), damping=viewer.controls.enableDamping;
  viewer.controls.enableDamping=false;
  const distance=cameraPosition.distanceTo(target);
  const views=[['front',target.clone(),new THREE.Vector3(0,.15,1).normalize().multiplyScalar(distance)],['side',target.clone(),new THREE.Vector3(1,.15,0).normalize().multiplyScalar(distance)],['top',target.clone(),new THREE.Vector3(0,1,.01).normalize().multiplyScalar(distance)]];
  for(const [facetId,slice] of renderer._slices){
    const center=new THREE.Vector3(...renderer._iRoot.slice(slice.offset*3,slice.offset*3+3));hc.groomTarget.localToWorld(center);
    center.add(new THREE.Vector3(0,.13,0));views.push([`facet-${facetId}`,center,new THREE.Vector3(.35,.5,.8).normalize().multiplyScalar(.95)]);
  }
  for(const [name,center,offset]of views){
    viewer.controls.target.copy(center);viewer.camera.up.set(0,1,0);viewer.camera.position.copy(center).add(offset);viewer.controls.update();
    for(const p of [1,.75,.5,.25,0]){
      hc.setGrowthFraction(p);await frame();const filename=`candidate-${name}-${String(p).replace('.','_')}.png`;
      await screenshot(filename);manifest.screenshots.push({name:window.__growthRunId+'-'+filename,phase:p,camera:viewer.camera.toJSON(),target:center.toArray()});
    }
  }
  viewer.camera.position.copy(cameraPosition);viewer.camera.up.copy(up);viewer.controls.target.copy(target);viewer.controls.update();viewer.controls.enableDamping=damping;hc.setGrowthFraction(1);
  const trace=[];
  for(let i=0;i<=100;i++){
    const p=1-i/100;hc.setGrowthFraction(p);await frame();trace.push({time:performance.now(),p,runtime:hc.runtime.growthFraction,uniform:renderer.growthFraction,canStyle:hc.canStyle()});
  }
  hc.setGrowthFraction(1);check('scrub final state unchanged',groom.serialize()===before);
  await save('scrub-trace.json',trace);
  for(const [sheet,rows]of [['overview',views.slice(0,3)],['facets',views.slice(3)]]){
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=rows.length*470;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#14161a';ctx.fillRect(0,0,canvas.width,canvas.height);
    for(let row=0;row<rows.length;row++)for(const [column,p]of [1,.5,0].entries()){
      const picture=new Image();picture.src=`/docs/evidence/growth-preview/${window.__growthRunId}-candidate-${rows[row][0]}-${String(p).replace('.','_')}.png`;await picture.decode();
      ctx.drawImage(picture,column*480,row*470+35,480,430);ctx.fillStyle='#ffffff';ctx.font='20px system-ui';ctx.fillText(`${rows[row][0]} — ${p.toFixed(1)}`,column*480+15,row*470+25);
    }
    await savePng(`contact-${sheet}.png`,canvas.toDataURL('image/png').split(',')[1]);
  }
  manifest.checks.push({name:'all GPU numeric scenarios',pass:manifest.scenarios.every(s=>!s.failures.length)});
  manifest.sourceAfter=await(await fetch('/__growth_source')).json();
  check('source stable during capture',JSON.stringify(manifest.source)===JSON.stringify(manifest.sourceAfter));
  await save('candidate-evaluation.json',manifest);
  return `${indices.length} strands; ${manifest.scenarios.length} GPU scenarios.\n${manifest.checks.filter(c=>!c.pass).length} failed checks.\nMax arc error ${Math.max(...manifest.scenarios.map(s=>s.maxArcError))}\nEvidence saved. Full state restored.`;
}
export async function runPerformance(){
  const hc=window.hc,results={...metadata(hc),source:await(await fetch('/__growth_source')).json(),samples:[]};
  const densities=new Map([...hc.groom.faces].map(([id,face])=>[id,face.density]));
  try {for(const workload of ['default','dense']){
  hc.setGrowthFraction(1);
  if(workload==='dense'){for(const face of hc.groom.faces.values())face.density=4;hc.renderer.rebuild();}
  for(let run=0;run<3;run++)for(const p of [1,.5]){
    document.querySelector('#result').textContent=`Measuring ${workload}, run ${run+1}/3, fraction ${p}…`;
    hc.setGrowthFraction(p);const start=performance.now();let prior=start;const times=[];
    while(performance.now()-start<20000){await frame();const now=performance.now();if(now-start>5000)times.push(now-prior);prior=now;}
    const sorted=times.slice().sort((a,b)=>a-b);results.samples.push({workload,strands:hc.renderer._total,run,p,count:times.length,median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],times});
  }}}
  finally {hc.setGrowthFraction(1);for(const [id,density]of densities)hc.groom.faces.get(id).density=density;hc.renderer.rebuild();}
  hc.setGrowthFraction(1);await save('performance.json',results);return 'Three full/half frame-time runs saved; full state restored.';
}
