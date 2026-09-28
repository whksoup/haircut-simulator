import * as THREE from 'three';
import { guideFrame, liftGuide } from '../../src/hair/guideFrame.js';
import { syncOrbitCamera } from '../../src/scene/groomingCamera.js';
import { auditGuideLengths } from '../../src/hair/guideLengthAudit.js';
const iframe = document.querySelector('#app'), status = document.querySelector('#status'), result = document.querySelector('#result');
let pass, initial;
const stamp = () => new Date().toISOString().replace(/\D/g,'');
const frame = () => new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
async function save(name,data,png) { const r=await fetch('/__snap_evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data,png})}); if(!r.ok)throw new Error(await r.text()); }
function info(hc) { return {date:new Date().toISOString(),browser:navigator.userAgent,viewport:[iframe.contentWindow.innerWidth,iframe.contentWindow.innerHeight],camera:hc.viewer.camera.toJSON(),counts:hc.stats(),active:hc.brush.active,cylinderVisible:hc.brush.cylinder?.visible,strokeFrame:hc.brush.strokeFrame}; }
async function capture(hc,prefix) { await frame(); hc.viewer.renderer.render(hc.viewer.scene,hc.viewer.camera); await save(prefix+'.png',null,hc.viewer.renderer.domElement.toDataURL('image/png').split(',')[1]); }
async function prepare(projection) {
 const hc=iframe.contentWindow.hc; if(!initial)initial=hc.groom.toJSON(); hc.loadGroom(structuredClone(initial)); hc.setGroomingView('front'); hc.setGroomingProjection(projection);
 const yaw=THREE.MathUtils.degToRad(32), tilt=THREE.MathUtils.degToRad(40), distance=4.5;
 const outward=new THREE.Vector3(Math.sin(yaw)*Math.cos(tilt),Math.sin(tilt),Math.cos(yaw)*Math.cos(tilt));
 hc.viewer.camera.position.copy(hc.viewer.controls.target).addScaledVector(outward,distance); hc.viewer.camera.up.set(0,1,0); hc.viewer.camera.lookAt(hc.viewer.controls.target); syncOrbitCamera(hc.viewer.controls,hc.viewer.camera); hc.viewer.camera.updateMatrixWorld(true);
 hc.setActiveTool('brush'); hc.brush.setRadius(.1); hc.brush.setMask(null);
 const g=hc.groom.guides.guides.values().next().value, points=liftGuide(g,guideFrame(g));
 const p=new THREE.Vector3(...points.slice(12,15)).applyMatrix4(hc.groomTarget.matrixWorld).project(hc.viewer.camera), rect=hc.viewer.renderer.domElement.getBoundingClientRect();
 const x=(p.x+1)*rect.width/2, y=(1-p.y)*rect.height/2;
 pass={projection,before:hc.groom.serialize(),depth:hc.history.depth,start:[x-55,y],end:[x+70,y],events:[],frames:[]};
 for(const old of iframe.contentDocument.querySelectorAll('[data-snap-marker]'))old.remove();
 for(const [point,color] of [[pass.start,'#00ff88'],[pass.end,'#ff44aa']]){const el=iframe.contentDocument.createElement('div');el.dataset.snapMarker='';el.style.cssText=`position:fixed;left:${point[0]-5}px;top:${point[1]-5}px;width:10px;height:10px;border:2px solid ${color};border-radius:50%;pointer-events:none;z-index:999`;iframe.contentDocument.body.append(el);}
 await capture(hc,'before-'+stamp()); status.textContent='Hold left and drag green → pink; then Record released stroke';
}
async function held() {
 const hc=iframe.contentWindow.hc; if(!pass)await prepare('perspective'); const canvas=hc.viewer.renderer.domElement, original=canvas.setPointerCapture;canvas.setPointerCapture=()=>{};
 try { const send=(type,p)=>canvas.dispatchEvent(new iframe.contentWindow.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:981,isPrimary:true,button:0,buttons:1,clientX:p[0],clientY:p[1]})); send('pointerdown',pass.start); for(let i=1;i<=8;i++)send('pointermove',pass.start.map((v,j)=>v+(pass.end[j]-v)*i/16)); await capture(hc,'held-'+stamp()); await save('held-state-'+stamp()+'.json',{...info(hc),input:'synthetic held visualization',hashes:await(await fetch('/__snap_source')).json()}); status.textContent='Held cylinder captured; Record released stroke finishes'; } finally {canvas.setPointerCapture=original;}
}
async function finish() {
 const hc=iframe.contentWindow.hc; hc.brush.finishEditing('harness'); const after=hc.groom.serialize(); const report={...info(hc),changed:after!==pass.before,historyDelta:hc.history.depth-pass.depth,events:pass.events,audit:auditGuideLengths(hc.groom.guides),hashes:await(await fetch('/__snap_source')).json()};
 if(report.changed){hc.history.undo();report.undoExact=hc.groom.serialize()===pass.before;hc.history.redo();report.redoExact=hc.groom.serialize()===after;}
 await capture(hc,'released-'+stamp()); await save('stroke-'+stamp()+'.json',report); result.textContent=JSON.stringify({changed:report.changed,historyDelta:report.historyDelta,undoExact:report.undoExact,redoExact:report.redoExact,cylinderHidden:!report.cylinderVisible,audit:report.audit.ok},null,2);status.textContent='Stroke result recorded';
}
for(const [id,fn] of [['perspective',()=>prepare('perspective')],['orthographic',()=>prepare('orthographic')],['held',held],['finish',finish]])document.getElementById(id).onclick=()=>Promise.resolve().then(fn).catch(e=>{status.textContent=String(e);result.textContent=e.stack;});
const ready=setInterval(()=>{const hc=iframe.contentWindow.hc;if(!hc?.brush)return;clearInterval(ready);status.textContent='Ready';for(const type of ['pointerdown','pointermove','pointerup'])iframe.contentWindow.addEventListener(type,e=>{if(pass&&(type!=='pointermove'||e.buttons))pass.events.push({type,x:e.clientX,y:e.clientY,buttons:e.buttons,trusted:e.isTrusted});},true);},200);
