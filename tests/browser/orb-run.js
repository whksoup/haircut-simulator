import * as THREE from 'three';
import { auditGuideLengths } from '../../src/hair/guideLengthAudit.js';
const iframe = document.querySelector('#simulator');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const frame = () => new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
const stamp = () => new Date().toISOString().replace(/[^0-9]/g, '');
const historyState = h => JSON.stringify({ undo: h._undo, redo: h._redo, stroke: h._stroke, marks: [...h._marks] });
let manual = null;
async function save(name, data, png) {
  const response = await fetch('/__orb_evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data, png }) });
  if (!response.ok) throw new Error(await response.text());
}
function metadata(hc) {
  return { date: new Date().toISOString(), revision: '57ca555', source: 'Concurrent dirty source; hashes attached', browser: navigator.userAgent,
    viewport: [iframe.contentWindow.innerWidth, iframe.contentWindow.innerHeight, devicePixelRatio], fixture: 'head.glb and default groom',
    camera: hc.viewer.camera.toJSON(), target: hc.viewer.controls.target.toArray(), stats: hc.stats() };
}
async function capture(hc, name) {
  await frame();
  hc.viewer.renderer.render(hc.viewer.scene, hc.viewer.camera);
  await save(`${name}.png`, null, hc.viewer.renderer.domElement.toDataURL('image/png').split(',')[1]);
  await save(`${name}.json`, { ...metadata(hc), sourceHashes: await (await fetch('/__orb_source')).json(), authoredGroom: hc.groom.toJSON(), cameraState: hc.groomingCamera.state });
}
async function runCamera() {
  status.textContent = 'Running camera checks…';
  const hc = iframe.contentWindow.hc;
  const prefix = `camera-${stamp()}`;
  const report = { ...metadata(hc), sourceHashes: await (await fetch('/__orb_source')).json(), checks: [] };
  const check = (name, pass, details) => {
    report.checks.push({ name, pass: Boolean(pass), details });
    results.textContent = JSON.stringify(report.checks, null, 2);
  };
  const before = hc.groom.serialize(), history = historyState(hc.history);
  hc.setActiveTool('none');
  try {
    for (const projection of ['perspective', 'orthographic']) {
      hc.setGroomingProjection(projection); await frame();
      check(`${projection}: render and OrbitControls camera agree`, hc.viewer.controls.object === hc.viewer.camera);
      check(`${projection}: both gizmos follow camera`, hc.comb._tc.camera === hc.viewer.camera && hc.scissors._tc.camera === hc.viewer.camera);
      await capture(hc, `${prefix}-${projection}`);
      const guide = hc.groom.guides.guides.values().next().value;
      const point = new THREE.Vector3(...guide.root).applyMatrix4(hc.groomTarget.matrixWorld);
      const ndc = point.clone().project(hc.viewer.camera);
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), hc.viewer.camera);
      const hits = ray.intersectObject(hc.groomTarget, false);
      check(`${projection}: head raycast hits from projected point`, hits.length > 0);
      const camera = hc.viewer.camera, position = camera.position.clone(), quaternion = camera.quaternion.clone(), zoom = camera.zoom, target = hc.viewer.controls.target.clone();
      hc.enterTechnicalView(); hc.technicalView.setView('top'); hc.exitTechnicalView(); await frame();
      check(`${projection}: Technical restores exact camera`, hc.viewer.camera === camera);
      check(`${projection}: Technical restores pose/target/zoom`, camera.position.distanceTo(position) < 1e-10 && 1 - Math.abs(camera.quaternion.dot(quaternion)) < 1e-10 && camera.zoom === zoom && target.distanceTo(hc.viewer.controls.target) < 1e-10);
    }
    for (const [view, direction] of Object.entries({ front:[0,0,1], back:[0,0,-1], left:[-1,0,0], right:[1,0,0], top:[0,1,0], bottom:[0,-1,0] })) {
      hc.setGroomingView(view); await frame();
      const actual = hc.viewer.camera.position.clone().sub(hc.viewer.controls.target).normalize();
      check(`${view}: orthographic axis`, hc.viewer.camera.isOrthographicCamera && actual.distanceTo(new THREE.Vector3(...direction)) <= 1e-5);
    }
    check('camera-only actions preserve groom/history', hc.groom.serialize() === before && historyState(hc.history) === history);
    hc.setGroomingView('front');
    await capture(hc, `${prefix}-front`);
    report.passed = report.checks.every(c => c.pass);
  } catch (error) { report.error = error.stack; report.passed = false; }
  await save(`${prefix}-checks.json`, report);
  status.textContent = `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.filter(c => c.pass).length}/${report.checks.length} camera checks`;
}
function prepareComb() {
  const hc = iframe.contentWindow.hc;
  hc.setGroomingView('front'); hc.setActiveTool('comb');
  const guides = [...hc.groom.guides.guides.values()];
  const ordered = guides.map(guide => ({ guide, point: new THREE.Vector3(...guide.root).applyMatrix4(hc.groomTarget.matrixWorld) }))
    .sort((a,b) => b.point.z - a.point.z);
  const chosen = ordered[Math.min(3, ordered.length - 1)];
  if (!chosen) throw new Error('No guide for comb fixture');
  const normal = new THREE.Vector3(...chosen.guide.normal).transformDirection(hc.groomTarget.matrixWorld);
  hc.comb.placeAtSurfacePoint(chosen.point, normal);
  manual = { kind: 'comb', date: new Date().toISOString(), before: hc.groom.serialize(), depth: hc.history.depth, events: [] };
  status.textContent = 'Comb ready: drag its visible gizmo, then Record manual result';
}
function prepareBrush(projection = 'orthographic') {
  const hc = iframe.contentWindow.hc;
  if (!hc.brush) throw new Error('Brush implementation is not loaded');
  hc.setGrowthFraction(1); hc.setGroomingView('top'); hc.setActiveTool('brush');
  hc.setGroomingProjection(projection);
  hc.brush.setMask(null); hc.brush.setRadius(0.1);
  const guide = hc.groom.guides.guides.values().next().value;
  if (!guide) throw new Error('No guide for brush fixture');
  const n = new THREE.Vector3(...guide.normal);
  const t = new THREE.Vector3(...guide.tangent).addScaledVector(n, -n.dot(new THREE.Vector3(...guide.tangent))).normalize();
  const b = new THREE.Vector3().crossVectors(n, t);
  const p = new THREE.Vector3(...guide.root).addScaledVector(t, guide.points[12] * guide.length)
    .addScaledVector(b, guide.points[13] * guide.length).addScaledVector(n, guide.points[14] * guide.length)
    .applyMatrix4(hc.groomTarget.matrixWorld).project(hc.viewer.camera);
  const canvas = hc.viewer.renderer.domElement.getBoundingClientRect();
  const x = (p.x + 1) * canvas.width / 2, y = (1 - p.y) * canvas.height / 2;
  const halfHeight = hc.viewer.camera.isOrthographicCamera ? (hc.viewer.camera.top - hc.viewer.camera.bottom) / (2 * hc.viewer.camera.zoom) : hc.viewer.camera.position.distanceTo(hc.viewer.controls.target) * Math.tan(THREE.MathUtils.degToRad(hc.viewer.camera.getEffectiveFOV()) / 2);
  const pixelRadius = hc.brush.radius * canvas.height / (2 * halfHeight);
  const start = [x - pixelRadius * 2, y], end = [x + pixelRadius * 3, y];
  for (const old of iframe.contentDocument.querySelectorAll('[data-orb-marker]')) old.remove();
  for (const [point, color] of [[start, '#00ff66'], [end, '#ff55aa']]) {
    const marker = iframe.contentDocument.createElement('div'); marker.dataset.orbMarker = '';
    marker.style.cssText = `position:fixed;left:${point[0]-5}px;top:${point[1]-5}px;width:10px;height:10px;border:2px solid ${color};border-radius:50%;pointer-events:none;z-index:9999`;
    iframe.contentDocument.body.append(marker);
  }
  manual = { kind:'brush', date:new Date().toISOString(), before:hc.groom.serialize(), depth:hc.history.depth, events:[], baselineAudit:auditGuideLengths(hc.groom.guides), start, end };
  status.textContent = 'Brush ready: hold left and drag from green to pink, then Record manual result';
}
async function heldPreview() {
  prepareBrush();
  const hc = iframe.contentWindow.hc, canvas = hc.viewer.renderer.domElement;
  const folderButton = [...iframe.contentDocument.querySelectorAll('button.title')].find(button => button.textContent.trim() === 'Brush');
  if (folderButton?.getAttribute('aria-expanded') !== 'true') folderButton?.click();
  const capturePointer = canvas.setPointerCapture;
  canvas.setPointerCapture = () => {};
  try {
    const send = (type, p) => canvas.dispatchEvent(new iframe.contentWindow.PointerEvent(type, {bubbles:true, pointerId:991, isPrimary:true, button:0, buttons:1, clientX:p[0], clientY:p[1]}));
    send('pointerdown', manual.start);
    for (let i=1;i<=8;i++) send('pointermove', manual.start.map((v,j)=>v+(manual.end[j]-v)*i/8));
    await capture(hc, `held-synthetic-${stamp()}`);
    status.textContent = 'Synthetic held preview: cursor and live status; press Record to finish';
    await save(`held-state-${stamp()}.json`, {...metadata(hc), active:hc.brush.active, radius:hc.brush.radius, mask:hc.brush.mask===null?'all':[...hc.brush.mask], cursor:hc.brush.cursor.style.cssText, input:'Synthetic held movement for static UI inspection; separate manual traces prove trusted gestures'});
  } finally { canvas.setPointerCapture = capturePointer; }
}
async function finishManual() {
  const hc = iframe.contentWindow.hc;
  if (manual?.kind === 'brush') hc.brush.finishEditing('harness');
  else hc.comb.finishEditing();
  const after = hc.groom.serialize();
  const changed = manual && manual.before !== after;
  const report = { ...metadata(hc), kind:manual?.kind, sourceHashes: await (await fetch('/__orb_source')).json(), changed, historyDelta: manual ? hc.history.depth - manual.depth : null, events: manual?.events,
    baselineAudit:manual?.baselineAudit, finalAudit:auditGuideLengths(hc.groom.guides) };
  if (changed) {
    hc.history.undo(); report.undoExact = hc.groom.serialize() === manual.before;
    hc.history.redo(); report.redoExact = hc.groom.serialize() === after;
  }
  await capture(hc, `manual-${stamp()}`);
  await save(`manual-${stamp()}-result.json`, report);
  results.textContent = JSON.stringify({kind:report.kind,changed,historyDelta:report.historyDelta,undoExact:report.undoExact,redoExact:report.redoExact,finalAudit:report.finalAudit,events:report.events}, null, 2);
  status.textContent = `Manual ${report.kind} changed: ${changed}; undo: ${report.undoExact}; redo: ${report.redoExact}`;
}
for (const [id, action] of [['camera',runCamera],['capture',()=>capture(iframe.contentWindow.hc,`capture-${stamp()}`)],['comb',prepareComb],['brush',()=>prepareBrush()],['brushPerspective',()=>prepareBrush('perspective')],['held',heldPreview],['finish',finishManual]]) {
  document.querySelector(`#${id}`).addEventListener('click', () => Promise.resolve().then(action).catch(error => { status.textContent = String(error); results.textContent = error.stack; }));
}
const ready = setInterval(() => {
  const hc = iframe.contentWindow.hc;
  if (!hc?.groomingCamera) return;
  clearInterval(ready); status.textContent = 'Ready';
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) iframe.contentWindow.addEventListener(type, event => {
    if (manual && (type !== 'pointermove' || event.buttons)) manual.events.push({ type, x:event.clientX, y:event.clientY, button:event.button, buttons:event.buttons, trusted:event.isTrusted, time:performance.now() });
  }, true);
}, 200);



