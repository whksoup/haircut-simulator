const result = document.querySelector('#result');
window.__growthRunId='ui-'+Date.now();
const ready = setInterval(() => { if (window.hc) { clearInterval(ready); result.textContent = 'Ready'; } }, 100);
// Observe the actual Save action's blob without cancelling its download.
document.addEventListener('click',event=>{
  const anchor=event.target.closest?.('a[download]');
  if(!anchor?.href.startsWith('blob:'))return;
  const h=window.hc,phase=h.runtime.growthFraction,expected=h.groom.serialize();
  fetch(anchor.href).then(r=>r.text()).then(async text=>{
    await save('save-action-'+Date.now()+'.json',{date:new Date().toISOString(),phase,filename:anchor.download,payload:JSON.parse(text),equalsAuthored:text===expected,source:await(await fetch('/__growth_source')).json(),delivery:'Blob payload observed; browser download completion event unavailable'});
    result.textContent='Save payload recorded; download delivery unconfirmed';
  }).catch(e=>{result.textContent=e.message;});
},true);
export async function save(name, data) {
  if(window.__growthRunId) name=window.__growthRunId+'-'+name;
  const response = await fetch('/__growth_evidence', { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data}) });
  if (!response.ok) throw new Error(await response.text());
}
export async function screenshot(name) {
  const {viewer} = window.hc;
  viewer.renderer.render(viewer.scene,viewer.camera);
  const png = viewer.renderer.domElement.toDataURL('image/png').split(',')[1];
  return savePng(name,png);
}
export async function savePng(name,png){
  if(window.__growthRunId) name=window.__growthRunId+'-'+name;
  const response = await fetch('/__growth_evidence', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,png})});
  if (!response.ok) throw new Error(await response.text());
}
document.querySelector('#baseline').onclick = async () => {
  try {
    const {viewer,groom,renderer} = window.hc;
    await screenshot('baseline-full.png');
    await save('baseline-browser.json',{date:new Date().toISOString(),source:await (await fetch('/__growth_source')).json(),groom:JSON.parse(groom.serialize()),stats:renderer.stats,camera:viewer.camera.toJSON(),target:viewer.controls.target.toArray(),viewport:[innerWidth,innerHeight,devicePixelRatio],browser:navigator.userAgent});
    result.textContent='Baseline saved';
  } catch(e) { result.textContent=e.stack; }
};
document.querySelector('#evaluate').onclick = async () => {
  try { window.__growthRunId='run-'+Date.now();result.textContent='Evaluating…'; const {runEvaluation}=await import('./growth-run.js'); result.textContent=await runEvaluation(); }
  catch(e) { result.textContent=e.stack; }
};
document.querySelector('#performance').onclick = async () => {
  try { window.__growthRunId='perf-'+Date.now();result.textContent='Measuring…'; const {runPerformance}=await import('./growth-run.js'); result.textContent=await runPerformance(); }
  catch(e) { result.textContent=e.stack; }
};
let step=0;
document.querySelector('#record').onclick=async()=>{
  try{
    const h=window.hc;
    const state=JSON.parse(JSON.stringify({date:new Date().toISOString(),groom:JSON.parse(h.groom.serialize()),phase:h.runtime.growthFraction,rendererPhase:h.renderer.growthFraction,selection:Array.from(h.raycast.selection),tools:{comb:h.comb.enabled,scissors:h.scissors.enabled,seam:h.seamTool.enabled},history:{undo:h.history._undo,redo:h.history._redo,stroke:h.history._stroke,marks:Array.from(h.history._marks)},canStyle:h.canStyle?.(),ui:document.querySelector('.lil-gui')?.innerText}));
    state.source=await(await fetch('/__growth_source')).json();
    const name='interaction-'+(++step);await save(name+'.json',state);await screenshot(name+'.png');result.textContent=name+' saved';
  }catch(e){result.textContent=e.stack;}
};
document.querySelector('#arm').onclick=()=>{
  const h=window.hc,tool=h.comb.enabled?h.comb:h.scissors.enabled?h.scissors:null;
  if(!tool){result.textContent='Activate comb or scissors first';return;}
  const original=tool.onEdit;
  tool.onEdit=(ids)=>{
    original(ids);
    if(!ids.length||!h.history.busy)return;
    tool.onEdit=original;
    const before={busy:h.history.busy,depth:h.history.depth,groom:JSON.parse(h.groom.serialize())};
    h.setGrowthFraction(.5);
    const after={busy:h.history.busy,depth:h.history.depth,groom:JSON.parse(h.groom.serialize()),phase:h.runtime.growthFraction,enabled:tool.enabled};
    const trace={tool:tool===h.comb?'comb':'scissors',before,after,trigger:'Native tool drag onEdit; harness requests preview while history stroke is open'};
    window.addEventListener('pointerup',async()=>{
      trace.lateRelease={busy:h.history.busy,depth:h.history.depth,groom:JSON.parse(h.groom.serialize()),phase:h.runtime.growthFraction};
      trace.source=await(await fetch('/__growth_source')).json();await save('native-stroke-'+trace.tool+'-'+Date.now()+'.json',trace);
      result.textContent=`${trace.tool}: preview transition and late pointerup saved`;
    },{once:true,capture:true});
    result.textContent='Preview entered during edit; release pointer to finish evidence';
  };
  result.textContent='Armed: drag the active tool through hair';
};
