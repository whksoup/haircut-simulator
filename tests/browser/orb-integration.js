import * as THREE from 'three';
import { guideFrame, liftGuide } from '../../src/hair/guideFrame.js';

// This opt-in harness dispatches explicitly synthetic events. It does not
// establish native pointer capture, download delivery, or native file picking.
const iframe = document.querySelector('#simulator');
const status = document.querySelector('#status'), results = document.querySelector('#results');
const buttons = [...document.querySelectorAll('button')];
const frame = () => new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
const clone = data => JSON.parse(JSON.stringify(data));
const stamp = () => new Date().toISOString().replace(/[^0-9]/g, '');
const percentile = (samples, p) => samples.length ? [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * p) - 1)] : null;
let fixture;

async function save(name, data) {
  const response = await fetch('/__orb_evidence', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, data})});
  if (!response.ok) throw new Error(await response.text());
}
async function metadata(hc) {
  const gl = hc.viewer.renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {date:new Date().toISOString(), rubric:'ORB-3', sourceHashes:await (await fetch('/__orb_source')).json(),
    browser:navigator.userAgent, platform:navigator.platform, hardwareConcurrency:navigator.hardwareConcurrency,
    deviceMemoryGB:navigator.deviceMemory ?? null,
    gpu:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    viewport:[iframe.contentWindow.innerWidth, iframe.contentWindow.innerHeight], devicePixelRatio,
    fixture:'startup head.glb/default groom; restored before every scenario', groomFixture:fixture,
    guideCount:hc.groom.guides.guides.size, rendererStats:hc.stats(),
    input:'synthetic PointerEvent dispatched through actual canvas/window listeners; native capture replaced with no-op for synthetic pointer',
    limitations:['No native-input latency claim','No native download or file-picker delivery claim']};
}
function syntheticPointer(hc) {
  const canvas = hc.viewer.renderer.domElement, win = iframe.contentWindow;
  const saved = ['setPointerCapture','releasePointerCapture','hasPointerCapture'].map(key => [key, Object.getOwnPropertyDescriptor(canvas, key)]);
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  return {send(type, point, buttons = 1) {
    const rect = canvas.getBoundingClientRect();
    const event = new win.PointerEvent(type, {pointerId:931, pointerType:'mouse', isPrimary:true, button:0, buttons,
      clientX:rect.left + point[0], clientY:rect.top + point[1], bubbles:true, cancelable:true});
    (type === 'pointerup' ? win : canvas).dispatchEvent(event);
  }, restore() {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(canvas, key, descriptor); else delete canvas[key];
    }
  }};
}
function prepare(hc) {
  if (hc.technicalView.state.active) hc.exitTechnicalView();
  hc.loadGroom(clone(fixture)); hc.setGrowthFraction(1); hc.setGroomingView('top'); hc.setActiveTool('brush');
  hc.brush.setMask(null); hc.brush.setRadius(0.1);
  const guide = hc.groom.guides.guides.values().next().value;
  if (!guide) throw new Error('Default fixture has no guide');
  const points = liftGuide(guide, guideFrame(guide));
  const offset = Math.min(12, points.length - 3);
  hc.groomTarget.updateWorldMatrix(true, false); hc.viewer.camera.updateMatrixWorld(true);
  const point = new THREE.Vector3(points[offset], points[offset + 1], points[offset + 2])
    .applyMatrix4(hc.groomTarget.matrixWorld).project(hc.viewer.camera);
  const rect = hc.viewer.renderer.domElement.getBoundingClientRect();
  const radius = hc.brush.radius * rect.height / (hc.viewer.camera.top - hc.viewer.camera.bottom) * hc.viewer.camera.zoom;
  const center = [(point.x + 1) * rect.width / 2, (1 - point.y) * rect.height / 2];
  const clamp = (value, max) => Math.min(max - 2, Math.max(2, value));
  return {start:[clamp(center[0] - radius * 2, rect.width), clamp(center[1], rect.height)],
    end:[clamp(center[0] + radius * 3, rect.width), clamp(center[1], rect.height)]};
}
const interpolate = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
async function lifecycle(hc) {
  const path = prepare(hc), report = {...await metadata(hc), scenario:'synthetic pointer lifecycle and app API transitions', checks:[]};
  const check = (name, pass, detail = null) => report.checks.push({name, pass:Boolean(pass), detail});
  const pointer = syntheticPointer(hc), before = hc.groom.serialize();
  try {
    const facetId = hc.groom.guides.guides.values().next().value.facetId;
    hc.setActiveTool('pick'); hc.raycast.selection.add(facetId);
    hc.brush.setMask(hc.raycast.selection); hc.setActiveTool('brush');
    hc.raycast.clearSelection();
    check('copied brush mask survives working-selection clear', hc.brush.mask.size === 1 && hc.brush.mask.has(facetId));
    const maskOverlay = hc.groomTarget.getObjectByName('Brush copied facet mask');
    check('copied mask has a visible persistent surface overlay', maskOverlay?.visible && maskOverlay.geometry.getAttribute('position')?.count > 0);
    hc.brush.setMask(null);
    pointer.send('pointermove', path.start, 0); pointer.send('pointerdown', path.start); pointer.send('pointerup', path.start, 0);
    check('hover and stationary press author nothing', hc.groom.serialize() === before && hc.history.depth === 0);
    pointer.send('pointerdown', path.start);
    for (let i = 1; i <= 32; i++) pointer.send('pointermove', interpolate(path.start, path.end, i / 32));
    pointer.send('pointerup', path.end, 0);
    const after = hc.groom.serialize();
    check('held stroke edits useful fixture', after !== before);
    check('one undo entry after release and no busy stroke', hc.history.depth === 1 && !hc.history._stroke);
    hc.runHistoryAction('undo'); check('undo restores complete state', hc.groom.serialize() === before);
    hc.runHistoryAction('redo'); check('redo restores complete state', hc.groom.serialize() === after);
    const saved = hc.serializeGroom();
    const savedObject = typeof saved === 'string' ? JSON.parse(saved) : saved;
    hc.loadGroom(savedObject); check('serialized callback save/load preserves state', hc.groom.serialize() === after);
    const identity = hc.groom.guides;
    report.interruptions = [];
    const canvas = hc.viewer.renderer.domElement, win = iframe.contentWindow;
    const names = ['projection','preset','Technical','growth','save','undo','redo','valid load',
      'wheel','right navigation','tool switch','pointerleave','pointercancel','lostpointercapture','blur','hidden','Escape','release outside'];
    for (const projection of ['perspective','orthographic']) for (const name of names) {
      const strokePath = prepare(hc);
      hc.setGroomingProjection(projection);
      const startChangedStroke = () => {
        pointer.send('pointerdown', strokePath.start);
        for (let i = 1; i <= 32; i++) pointer.send('pointermove', interpolate(strokePath.start, strokePath.end, i / 32));
      };
      // A new changed stroke must replace an existing redo branch, not replay
      // old work when the app's Redo command first settles that stroke.
      if (name === 'redo') {
        startChangedStroke(); pointer.send('pointerup', strokePath.end, 0); hc.runHistoryAction('undo');
      }
      const beforePass = hc.groom.serialize(), redoBefore = hc.history._redo.length;
      let finishes = 0, settled = null, changedIds = [];
      const originalEnd = hc.brush.onStrokeEnd;
      hc.brush.onStrokeEnd = ids => {
        originalEnd?.(ids); finishes++; changedIds = [...ids]; settled = hc.groom.serialize();
      };
      const entry = {name, projection, before:beforePass, redoBefore, path:strokePath};
      try {
        startChangedStroke();
        entry.changedBeforeExit = hc.groom.serialize() !== beforePass;
        entry.activeBeforeExit = hc.brush.active;
        let saveResult = null;
        switch (name) {
          case 'projection': hc.setGroomingProjection(projection === 'perspective' ? 'orthographic' : 'perspective'); break;
          case 'preset': hc.setGroomingView('front'); break;
          case 'Technical': hc.enterTechnicalView(); hc.exitTechnicalView(); break;
          case 'growth': hc.setGrowthFraction(.5); hc.setGrowthFraction(1); break;
          case 'save': saveResult = hc.serializeGroom(); break;
          case 'undo': hc.runHistoryAction('undo'); break;
          case 'redo': hc.runHistoryAction('redo'); break;
          case 'valid load': hc.loadGroom(clone(fixture)); break;
          case 'wheel': canvas.dispatchEvent(new win.WheelEvent('wheel', {deltaY:12, bubbles:true, cancelable:true})); break;
          case 'right navigation': {
            const rect = canvas.getBoundingClientRect();
            const event = {pointerId:943,pointerType:'mouse',isPrimary:true,button:2,clientX:rect.left+strokePath.end[0],clientY:rect.top+strokePath.end[1],bubbles:true,cancelable:true};
            canvas.dispatchEvent(new win.PointerEvent('pointerdown', {...event,buttons:2}));
            canvas.dispatchEvent(new win.PointerEvent('pointerup', {...event,buttons:0}));
            break;
          }
          case 'tool switch': hc.setActiveTool('comb'); break;
          case 'pointerleave': case 'pointercancel': case 'lostpointercapture':
            pointer.send(name, strokePath.end); break;
          case 'blur': win.dispatchEvent(new win.Event('blur')); break;
          case 'hidden': {
            const document = iframe.contentDocument, descriptor = Object.getOwnPropertyDescriptor(document,'hidden');
            try {
              Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
              document.dispatchEvent(new win.Event('visibilitychange'));
            } finally {if (descriptor) Object.defineProperty(document,'hidden',descriptor); else delete document.hidden;}
            break;
          }
          case 'Escape': win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); break;
          case 'release outside': pointer.send('pointerup', [-10,-10], 0); break;
        }
        Object.assign(entry,{finishes,changedIds,settled,afterExit:hc.groom.serialize(),undoDepth:hc.history.depth,redoDepth:hc.history._redo.length,
          inactive:!hc.brush.active,busy:Boolean(hc.history._stroke)});
        check(`${projection} ${name}: changed pass finishes once`, entry.changedBeforeExit && entry.activeBeforeExit && finishes === 1 && changedIds.length > 0 && entry.inactive && !entry.busy);
        if (name === 'valid load') {
          check(`${projection} load: settled before new baseline and clears history`, settled !== beforePass && hc.history.depth === 0 && hc.history._redo.length === 0 && hc.groom.serialize() === JSON.stringify(fixture,null,2));
        } else if (name === 'undo') {
          check(`${projection} undo: commits then undoes interrupted pass`, hc.groom.serialize() === beforePass && hc.history.depth === 0 && hc.history._redo.length === 1);
          hc.runHistoryAction('redo'); check(`${projection} undo: redo restores settled pass`, hc.groom.serialize() === settled);
          hc.runHistoryAction('undo');
        } else {
          check(`${projection} ${name}: exactly one settled entry`, hc.history.depth === 1 && hc.history._redo.length === 0 && hc.groom.serialize() === settled);
          if (name === 'save') check(`${projection} save: contains settled pass`, saveResult === settled);
          if (name === 'redo') check(`${projection} redo: new pass replaces old redo branch`, redoBefore === 1 && hc.history._redo.length === 0);
          hc.runHistoryAction('undo'); check(`${projection} ${name}: undo restores pre-pass groom`, hc.groom.serialize() === beforePass);
          hc.runHistoryAction('redo'); check(`${projection} ${name}: redo restores settled pass`, hc.groom.serialize() === settled);
        }
        const noResume = hc.groom.serialize();
        pointer.send('pointermove', strokePath.start, 1); pointer.send('pointerup', strokePath.start, 0);
        check(`${projection} ${name}: still-held movement cannot resume`, hc.groom.serialize() === noResume && !hc.brush.active && finishes === 1 && !hc.history._stroke);
      } finally {hc.brush.finishEditing('harness-cleanup'); hc.brush.onStrokeEnd = originalEnd;}
      report.interruptions.push(entry);
    }
    const beforeInvalid = hc.groom.serialize();
    let rejected = false;
    try { hc.loadGroom({schema:999999, faces:'invalid'}); } catch { rejected = true; }
    check('invalid load preserves old groom', rejected && hc.groom.serialize() === beforeInvalid);
    check('load preserves GuideStore identity', hc.groom.guides === identity);
    report.pass = report.checks.every(c => c.pass);
  } finally { hc.brush.finishEditing('harness'); pointer.restore(); }
  return report;
}
async function measure(hc, mode, run) {
  const path = prepare(hc), pointer = syntheticPointer(hc);
  if (mode === 'camera-only') hc.setActiveTool('none');
  const intervals = [], updates = [], dispatchDurations = [];
  let eventStart = null, editedEvents = 0;
  const originalEdit = hc.brush.onEdit;
  hc.brush.onEdit = ids => {
    originalEdit?.(ids);
    if (eventStart !== null) { updates.push(performance.now() - eventStart); editedEvents++; }
  };
  const before = hc.groom.serialize();
  try {
    status.textContent = `${mode} run ${run}/3: warm-up 5 seconds`;
    let time = await frame(), warmupStart = time;
    while (time - warmupStart < 5000) time = await frame();
    const started = time; let previous = time, sent = 0;
    if (mode === 'brush') pointer.send('pointerdown', path.start);
    status.textContent = `${mode} run ${run}/3: sampling 10 seconds`;
    while (time - started < 10000) {
      time = await frame(); intervals.push(time - previous); previous = time;
      const phase = ((time - started) / 2000) % 2;
      const point = interpolate(path.start, path.end, phase <= 1 ? phase : 2 - phase);
      if (mode !== 'camera-only') {
        eventStart = performance.now(); pointer.send('pointermove', point, mode === 'brush' ? 1 : 0);
        dispatchDurations.push(performance.now() - eventStart); eventStart = null; sent++;
      }
    }
    if (mode === 'brush') pointer.send('pointerup', path.end, 0);
    return {mode, run, warmupMs:time - started >= 10000 ? 5000 : null, durationMs:time - started,
      projection:hc.groomingCamera.state, camera:hc.viewer.camera.toJSON(), target:hc.viewer.controls.target.toArray(), path,
      frameIntervalsMs:intervals, pointerToGuideUpdateMs:updates, pointerDispatchDurationsMs:dispatchDurations,
      frameP95Ms:percentile(intervals, .95), updateP95Ms:percentile(updates, .95), updateP99Ms:percentile(updates, .99),
      pointerEvents:sent, editedEvents, authoredChanged:hc.groom.serialize() !== before,
      guideCount:hc.groom.guides.guides.size, rendererStats:hc.stats()};
  } finally { hc.brush.finishEditing('harness'); hc.brush.onEdit = originalEdit; pointer.restore(); }
}
async function performanceRuns(hc) {
  prepare(hc);
  const report = {...await metadata(hc), scenario:'5s stationary warm-up, 10s repeating horizontal sweep; three runs per mode',
    timingDefinition:'RAF intervals; synchronous synthetic pointer dispatch start through completed app onEdit guide-row publication, edited events only', runs:[]};
  for (let run = 1; run <= 3; run++) for (const mode of ['camera-only','hover-baseline','brush']) {
    report.runs.push(await measure(hc, mode, run));
    results.textContent = JSON.stringify(report.runs.map(({mode, run, frameP95Ms, updateP95Ms, updateP99Ms, editedEvents}) => ({mode, run, frameP95Ms, updateP95Ms, updateP99Ms, editedEvents})), null, 2);
    await save(`integration-performance-progress-${report.date.replace(/[^0-9]/g,'')}.json`, report);
  }
  report.comparisons = [1,2,3].map(run => {
    const baseline = report.runs.find(r => r.run === run && r.mode === 'hover-baseline');
    const candidate = report.runs.find(r => r.run === run && r.mode === 'brush');
    const budgetMs = Math.max(33.3, 1.25 * baseline.frameP95Ms);
    return {run, budgetMs, pass:candidate.editedEvents > 0 && candidate.authoredChanged && candidate.frameP95Ms <= budgetMs && candidate.updateP95Ms <= 16.7 && candidate.updateP99Ms <= 50};
  });
  report.pass = report.comparisons.every(result => result.pass);
  report.validViewport = report.viewport[0] === 1440 && report.viewport[1] === 900;
  if (!report.validViewport) report.pass = false;
  report.sourceHashesAfter = await (await fetch('/__orb_source')).json();
  report.sourceStable = JSON.stringify(report.sourceHashesAfter) === JSON.stringify(report.sourceHashes);
  if (!report.sourceStable) report.pass = false;
  return report;
}
async function run(action, name) {
  buttons.forEach(button => { button.disabled = true; });
  try {
    const report = await action(iframe.contentWindow.hc);
    await save(`integration-${name}-${stamp()}.json`, report);
    results.textContent = JSON.stringify(report, null, 2);
    status.textContent = `${name}: ${report.pass ? 'PASS' : 'FAIL — inspect evidence'}`;
  } catch (error) { status.textContent = 'Harness error'; results.textContent = error.stack; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
document.querySelector('#lifecycle').onclick = () => run(lifecycle, 'lifecycle');
document.querySelector('#performance').onclick = () => run(performanceRuns, 'performance');
const ready = setInterval(() => {
  const hc = iframe.contentWindow.hc;
  if (!hc?.brush) return;
  clearInterval(ready); fixture = clone(hc.groom.toJSON()); buttons.forEach(button => { button.disabled = false; });
  status.textContent = 'Ready: synthetic-input harness; preserves evidence and resets its test iframe before each scenario';
}, 200);
