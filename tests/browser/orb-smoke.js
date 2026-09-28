import * as THREE from 'three';
import {guideFrame, liftGuide} from '../../src/hair/guideFrame.js';

const iframe = document.querySelector('#simulator'), button = document.querySelector('#run');
const status = document.querySelector('#status'), results = document.querySelector('#results');
const frame = () => new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
const clone = data => JSON.parse(JSON.stringify(data));
const stamp = () => new Date().toISOString().replace(/[^0-9]/g, '');
let fixture;
async function save(name, data, png) {
  const response = await fetch('/__orb_evidence', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, data, png})});
  if (!response.ok) throw new Error(await response.text());
}
function pickVisibleFacet(hc) {
  const canvas = hc.viewer.renderer.domElement, rect = canvas.getBoundingClientRect();
  hc.setActiveTool('pick'); hc.viewer.camera.updateMatrixWorld(true); hc.groomTarget.updateWorldMatrix(true, false);
  const candidates = [...hc.groom.guides.guides.values()].map(guide => new THREE.Vector3(...guide.root).applyMatrix4(hc.groomTarget.matrixWorld).project(hc.viewer.camera));
  candidates.push(new THREE.Vector3(0, 0, 0));
  const raycaster = new THREE.Raycaster();
  for (const point of candidates) {
    if (Math.abs(point.x) > .98 || Math.abs(point.y) > .98) continue;
    raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), hc.viewer.camera);
    const hit = raycaster.intersectObject(hc.groomTarget, false)[0];
    if (!hit) continue;
    const expected = hc.catalogue.facetIdByTri(hit.faceIndex);
    const captureDescriptors = ['setPointerCapture','releasePointerCapture','hasPointerCapture'].map(key => [key, Object.getOwnPropertyDescriptor(canvas,key)]);
    canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {}; canvas.hasPointerCapture = () => false;
    try {
      const event = {pointerId:942, isPrimary:true, pointerType:'mouse',
        clientX:rect.left + (point.x + 1) * rect.width / 2, clientY:rect.top + (1 - point.y) * rect.height / 2,
        button:0, bubbles:true, cancelable:true};
      canvas.dispatchEvent(new iframe.contentWindow.PointerEvent('pointerdown', {...event,buttons:1}));
      canvas.dispatchEvent(new iframe.contentWindow.PointerEvent('pointerup', {...event,buttons:0}));
    } finally {
      for (const [key,descriptor] of captureDescriptors) {
        if (descriptor) Object.defineProperty(canvas,key,descriptor); else delete canvas[key];
      }
    }
    return {expected, actual:[...hc.raycast.selection], point:hit.point.toArray(), faceIndex:hit.faceIndex};
  }
  throw new Error('No projected visible head facet found');
}
async function scenario(hc, width, height, projection, prefix) {
  iframe.style.width = `${width}px`; iframe.style.height = `${height}px`;
  await frame(); await frame(); hc.viewer._onResize();
  hc.exitTechnicalView(); hc.loadGroom(clone(fixture)); hc.setGrowthFraction(1);
  hc.setGroomingView('top'); hc.setGroomingProjection(projection); await frame();
  const report = {width, height, projection, checks:[], input:'synthetic pick listener; public action APIs; scripted blade pose (not native gizmo drag)',
    fixture:'restored startup default groom', stats:hc.stats(), camera:hc.viewer.camera.toJSON(), target:hc.viewer.controls.target.toArray()};
  const check = (name, pass, details = null) => {report.checks.push({name, pass:Boolean(pass), details}); results.textContent = JSON.stringify(report, null, 2);};
  const guideStore = hc.groom.guides, seamStore = hc.groom.seams;
  check('head and dense hair present', !!hc.groomTarget.geometry && hc.groom.guides.count > 0 && hc.renderer.mesh?.visible !== false, hc.stats());
  check('canvas CSS viewport matches', iframe.contentWindow.innerWidth === width && iframe.contentWindow.innerHeight === height);
  const picked = pickVisibleFacet(hc);
  check('projected ray picks the actual visible facet', picked.actual.length === 1 && picked.actual[0] === picked.expected, picked);
  // Exercise removal/addition from a known hair-free facet without direct model edits.
  if (hc.groom.hasFacet(picked.expected)) hc.removeHairFromSelection();
  hc.history.clear();
  const bare = hc.groom.serialize();
  hc.addHairToSelection();
  const added = hc.groom.serialize();
  check('add action creates hair and guides', added !== bare && hc.groom.hasFacet(picked.expected) && hc.groom.guides.byFacet(picked.expected).length > 0);
  hc.runHistoryAction('undo'); check('add undo exact', hc.groom.serialize() === bare);
  hc.runHistoryAction('redo'); check('add redo exact', hc.groom.serialize() === added);
  hc.removeHairFromSelection(); check('remove action removes hair and guides', !hc.groom.hasFacet(picked.expected) && hc.groom.guides.byFacet(picked.expected).length === 0);
  hc.runHistoryAction('undo'); check('remove undo exact', hc.groom.serialize() === added);

  const beforeSeam = hc.groom.serialize();
  let refreshCalls = 0, syncCalls = 0;
  const oldRefresh = hc.seamOverlay.refresh, oldSync = hc.renderer.syncSeams;
  hc.seamOverlay.refresh = function(...args) {refreshCalls++; return oldRefresh.apply(this, args);};
  hc.renderer.syncSeams = function(...args) {syncCalls++; return oldSync.apply(this, args);};
  try {
    hc.sealSelectionBorder(.37);
    check('seam edit changes authored state through shared refresh', hc.groom.serialize() !== beforeSeam && refreshCalls > 0 && syncCalls > 0, {refreshCalls, syncCalls});
    hc.runHistoryAction('undo'); check('seam undo exact', hc.groom.serialize() === beforeSeam);
  } finally {hc.seamOverlay.refresh = oldRefresh; hc.renderer.syncSeams = oldSync;}

  // Use an existing guide's actual polyline midpoint as a reproducible blade
  // contact, then call the same Cut action as the panel. Never fabricate a cut.
  const guide = hc.groom.guides.guides.values().next().value;
  const points = liftGuide(guide, guideFrame(guide));
  const k = Math.max(1, Math.floor(points.length / 6));
  const midpoint = new THREE.Vector3(points[k * 3], points[k * 3 + 1], points[k * 3 + 2]).applyMatrix4(hc.groomTarget.matrixWorld);
  const normal = new THREE.Vector3(...guide.normal).transformDirection(hc.groomTarget.matrixWorld);
  const axis = new THREE.Vector3(...guide.tangent).transformDirection(hc.groomTarget.matrixWorld).normalize();
  const a = midpoint.clone().addScaledVector(axis, -.08), b = midpoint.clone().addScaledVector(axis, .08);
  hc.setActiveTool('comb');
  const combPlaced = hc.comb.placeFromPoints(a, normal, b, normal);
  check('finite comb placement and gizmo use current camera', combPlaced && hc.comb.hasBar && hc.comb._tc.camera === hc.viewer.camera);
  report.combLimitation = 'This smoke checks placement/camera only; finite-comb editing requires separate trusted-pointer evidence.';
  hc.setActiveTool('scissors'); hc.scissors.setRadius(.008); hc.scissors.clearMask();
  hc.scissors.placeFromPoints(a, normal, b, normal);
  hc.scissors.object.position.copy(midpoint); hc.scissors.object.updateMatrixWorld(true);
  const beforeCut = hc.groom.serialize(), beforeLength = guide.length;
  const changed = hc.cutAtBlade();
  const afterCut = hc.groom.serialize(), afterLength = hc.groom.guides.guides.get(guide.id)?.length;
  check('cut action measurably shortens an actual guide', changed > 0 && afterLength < beforeLength - 1e-6, {changed, guideId:guide.id, beforeLength, afterLength});
  check('scissors gizmo uses current camera', hc.scissors._tc.camera === hc.viewer.camera);
  if (changed > 0) {
    hc.runHistoryAction('undo'); check('cut undo exact', hc.groom.serialize() === beforeCut);
    hc.runHistoryAction('redo'); check('cut redo exact', hc.groom.serialize() === afterCut);
  }
  hc.setActiveTool('brush'); hc.brush.setMask(new Set([guide.facetId]));
  const camera = hc.viewer.camera, pose = camera.position.clone(), quat = camera.quaternion.clone(), zoom = camera.zoom;
  const target = hc.viewer.controls.target.clone(), mask = [...hc.brush.mask];
  const maskOverlay = hc.groomTarget.getObjectByName('Brush copied facet mask');
  const beforeTechnical = hc.groom.serialize();
  hc.enterTechnicalView();
  check('Technical hides brush mask overlay', maskOverlay?.visible === false);
  hc.technicalView.setView('bottom'); hc.exitTechnicalView(); await frame();
  check('Technical returns exact camera pose and inactive Brush', hc.viewer.camera === camera && camera.position.distanceTo(pose) < 1e-10 && 1-Math.abs(camera.quaternion.dot(quat)) < 1e-10 && camera.zoom === zoom && target.distanceTo(hc.viewer.controls.target) < 1e-10 && hc.brush.enabled && !hc.brush.active);
  check('Technical preserves copied mask and restores highlight', JSON.stringify([...hc.brush.mask]) === JSON.stringify(mask) && maskOverlay?.visible === true);
  check('Technical preserves authored state', hc.groom.serialize() === beforeTechnical);
  const saved = hc.serializeGroom(); hc.loadGroom(JSON.parse(saved));
  check('save/load callbacks preserve serialized groom', hc.groom.serialize() === saved);
  check('store identities survive all operations', hc.groom.guides === guideStore && hc.groom.seams === seamStore);
  await frame(); hc.viewer.renderer.render(hc.viewer.scene, hc.viewer.camera);
  await save(`${prefix}-${width}x${height}-${projection}.png`, null, hc.viewer.renderer.domElement.toDataURL('image/png').split(',')[1]);
  report.pass = report.checks.every(check => check.pass);
  return report;
}
async function run() {
  button.disabled = true;
  const hc = iframe.contentWindow.hc, prefix = `smoke-${stamp()}`;
  const report = {date:new Date().toISOString(), rubric:'ORB-3', browser:navigator.userAgent,
    sourceHashes:await (await fetch('/__orb_source')).json(), scenarios:[],
    limitations:['Synthetic picking and API actions do not verify native gizmo dragging','Save/load invokes app callbacks; no download or file-picker delivery claim']};
  try {
    for (const [width, height] of [[1440,900],[1024,768]]) for (const projection of ['perspective','orthographic']) {
      status.textContent = `${width}×${height} ${projection}`;
      try {report.scenarios.push(await scenario(hc,width,height,projection,prefix));}
      catch (error) {report.scenarios.push({width,height,projection,pass:false,error:error.stack});}
    }
    report.sourceHashesAfter = await (await fetch('/__orb_source')).json();
    report.sourceStable = JSON.stringify(report.sourceHashes) === JSON.stringify(report.sourceHashesAfter);
    report.pass = report.sourceStable && report.scenarios.every(s => s.pass);
    await save(`${prefix}-checks.json`, report);
    status.textContent = report.pass ? 'PASS four smoke scenarios' : 'FAIL — inspect saved checks';
    results.textContent = JSON.stringify(report, null, 2);
  } finally {button.disabled = false;}
}
button.onclick = () => run().catch(error => {status.textContent = 'Harness error'; results.textContent = error.stack;});
const ready = setInterval(() => {
  const hc = iframe.contentWindow.hc;
  if (!hc?.brush) return;
  clearInterval(ready); fixture = clone(hc.groom.toJSON()); button.disabled = false; status.textContent = 'Ready';
}, 200);
