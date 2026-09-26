const iframe = document.querySelector('#simulator');
const results = document.querySelector('#results');
const runButton = document.querySelector('#run');
const frame = () => new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
const historyState = h => JSON.stringify({ undo: h._undo, redo: h._redo, stroke: h._stroke, marks: [...h._marks] });
async function save(name, data, png) {
  const response = await fetch('/__technical_evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data, png }) });
  if (!response.ok) throw new Error(await response.text());
}
function metadata(hc) {
  return { date: new Date().toISOString(), revision: 'effc25c', source: 'Dirty current worktree; source hashes attached', browser: navigator.userAgent,
    viewport: [iframe.contentWindow.innerWidth, iframe.contentWindow.innerHeight, devicePixelRatio], fixture: 'Real app startup head.glb and default groom', stats: hc.stats() };
}
async function capture(hc, name) {
  await frame();
  hc.viewer.renderer.render(hc.viewer.scene, hc.viewer.camera);
  await save(`${name}.png`, null, hc.viewer.renderer.domElement.toDataURL('image/png').split(',')[1]);
  await save(`${name}.json`, { ...metadata(hc), sourceHashes: await (await fetch('/__technical_source')).json(), authoredGroom: hc.groom.toJSON(), state: hc.technicalView.state, camera: hc.viewer.camera.toJSON(), target: hc.viewer.controls.target.toArray() });
}
export async function run() {
  const hc = iframe.contentWindow.hc;
  if (!hc?.technicalView) throw new Error('Real app not ready');
  runButton.disabled = true;
  const report = { ...metadata(hc), sourceHashes: await (await fetch('/__technical_source')).json(), checks: [] };
  const check = (name, pass, details) => { report.checks.push({ name, pass: Boolean(pass), ...(details ? { details } : {}) }); results.textContent = JSON.stringify(report, null, 2); };
  const original = hc.groom.serialize();
  const guideStore = hc.groom.guides, seamStore = hc.groom.seams;
  const selection = [...hc.raycast.selection];
  try {
    hc.exitTechnicalView(); hc.setGrowthFraction(1); hc.setActiveTool('none');
    const facet = hc.groom.faces.keys().next().value;
    check('startup has authored hair facet', facet !== undefined);
    if (facet === undefined) throw new Error('Fixture has no authored hair');
    hc.raycast.selection.clear(); hc.raycast.selection.add(facet);
    hc.removeHairFromSelection();
    const removed = hc.groom.serialize();
    check('remove selected hair updates authored state', !hc.groom.hasFacet(facet) && removed !== original);
    hc.history.undo(); check('undo removal restores exact authored JSON', hc.groom.serialize() === original);
    hc.history.redo(); check('redo removal restores exact removed JSON', hc.groom.serialize() === removed);
    hc.addHairToSelection(); check('add selected hair creates guides', hc.groom.hasFacet(facet) && hc.groom.guides.byFacet(facet).length > 0);
    const authored = hc.groom.serialize(), history = historyState(hc.history);
    for (let cycle = 0; cycle < 3; cycle++) {
      hc.setGrowthFraction(cycle === 1 ? .5 : 1);
      const growth = hc.runtime.growthFraction;
      hc.enterTechnicalView();
      check(`cycle ${cycle}: entry complete and clipping off X`, hc.technicalView.state.active && !hc.technicalView.state.cutaway.enabled && hc.technicalView.state.cutaway.axis === 'x');
      check(`cycle ${cycle}: return button receives focus`, iframe.contentDocument.activeElement.classList.contains('technical-return'));
      check(`cycle ${cycle}: editing locked`, !hc.canStyle() && hc.addHairToSelection() === false && hc.removeHairFromSelection() === false && hc.setActiveTool('comb') === false);
      for (const view of ['front','back','left','right','top','bottom','free']) {
        hc.technicalView.setView(view); await frame();
        check(`cycle ${cycle}: ${view} camera`, hc.technicalView.state.view === view && hc.viewer.camera.isOrthographicCamera);
        if (cycle === 0 && view !== 'free') await capture(hc, `harness-preset-${view}`);
      }
      for (const axis of ['x','y','z']) for (const flipped of [false,true]) for (const position of [-.5,0,.5]) {
        hc.technicalView.setCutaway({ enabled: true, axis, flipped, position }); await frame();
        check(`cycle ${cycle}: ${axis}/${flipped}/${position} authored state`, hc.groom.serialize() === authored && historyState(hc.history) === history);
        if (cycle === 0 && position === 0) {
          hc.technicalView.setView(axis === 'z' ? 'right' : 'front');
          await capture(hc, `harness-cutaway-${axis}-${flipped ? 'flipped' : 'normal'}`);
        }
      }
      hc.technicalView.setPlaneEdges(true); hc.technicalView.setPlaneEdges(false);
      hc.technicalView.setCutaway({ enabled: false });
      if (cycle === 0) { hc.technicalView.setView('front'); await capture(hc, 'harness-technical-front'); }
      hc.exitTechnicalView();
      check(`cycle ${cycle}: return restores state and growth`, hc.groom.serialize() === authored && historyState(hc.history) === history && hc.runtime.growthFraction === growth);
      check(`cycle ${cycle}: entry receives focus`, iframe.contentDocument.activeElement.classList.contains('technical-entry'));
    }
    hc.setGrowthFraction(1);
    // Intercept only this frame's download plumbing and restore it immediately.
    const win = iframe.contentWindow, create = win.URL.createObjectURL, click = win.HTMLAnchorElement.prototype.click;
    let savedBlob, filename;
    try {
      win.URL.createObjectURL = blob => { savedBlob = blob; return create.call(win.URL, blob); };
      win.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
      const saveButton = [...iframe.contentDocument.querySelectorAll('button')].find(button => button.textContent.includes('Save groom (.json)'));
      saveButton?.click();
    } finally { win.URL.createObjectURL = create; win.HTMLAnchorElement.prototype.click = click; }
    check('Save groom produces full authored JSON Blob', savedBlob && await savedBlob.text() === authored && filename === 'groom.json');
    report.saveDelivery = 'Blob contents and download filename verified; browser download delivery intentionally intercepted and unverified.';
    hc.setGrowthFraction(.5); hc.loadGroom(JSON.parse(authored));
    check('load roundtrip exact authored JSON and resets growth/history', hc.groom.serialize() === authored && hc.runtime.growthFraction === 1 && !hc.history.canUndo && !hc.history.canRedo);
    // Exercise the real UI-created input, FileReader, parsing and load callback.
    // Only the native picker opening is replaced with a File/DataTransfer fixture.
    hc.removeHairFromSelection(); hc.setGrowthFraction(.5);
    check('file-input load starts from a different groom', hc.groom.serialize() !== authored);
    const inputClick = win.HTMLInputElement.prototype.click;
    let fileInput;
    try {
      win.HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') fileInput = this;
        else inputClick.call(this);
      };
      const loadButton = [...iframe.contentDocument.querySelectorAll('button')].find(button => button.textContent.includes('Load groom (.json)'));
      loadButton?.click();
    } finally { win.HTMLInputElement.prototype.click = inputClick; }
    check('Load groom action creates a file input', fileInput?.type === 'file');
    if (!fileInput) throw new Error('Load button did not create the real file input');
    const transfer = new win.DataTransfer();
    transfer.items.add(new win.File([authored], 'technical-roundtrip.json', { type: 'application/json' }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline && (hc.groom.serialize() !== authored || hc.runtime.growthFraction !== 1)) await frame();
    check('file-input FileReader load roundtrip restores JSON and resets growth/history', hc.groom.serialize() === authored && hc.runtime.growthFraction === 1 && !hc.history.canUndo && !hc.history.canRedo && !fileInput.isConnected);
    report.loadDelivery = 'Actual UI file input change and asynchronous FileReader callback verified using a synthetic File; native OS picker selection is not exercised.';
    check('authored store identities retained', hc.groom.guides === guideStore && hc.groom.seams === seamStore);
  } catch (error) { report.error = error.stack; }
  finally {
    hc.exitTechnicalView(); hc.loadGroom(JSON.parse(original)); hc.raycast.selection.clear(); selection.forEach(id => hc.raycast.selection.add(id));
    report.passed = !report.error && report.checks.every(check => check.pass);
    results.textContent = JSON.stringify(report, null, 2);
    window.technicalReport = report;
    try { await save('browser-checks.json', report); } catch (error) { results.textContent += `\nEvidence save failed: ${error}`; }
    runButton.disabled = false;
  }
  return report;
}
runButton.addEventListener('click', () => run().catch(error => { results.textContent = error.stack; }));
document.querySelector('#capture').addEventListener('click', () => capture(iframe.contentWindow.hc, 'harness-manual').catch(error => { results.textContent = error.stack; }));
const readiness = setInterval(() => {
  if (!iframe.contentWindow.hc?.technicalView) return;
  clearInterval(readiness); results.textContent = 'App ready. Run checks to begin. The run restores the startup groom and clears its test history.';
  if (new URLSearchParams(location.search).has('autorun')) run().catch(error => { results.textContent = error.stack; });
}, 250);
