import './technicalView.css';

/** Presentation controls only. The application owns all inspection state. */
export function createTechnicalViewUI({ onEnter, onExit, onView, onCutaway, onPlaneEdges }) {
  const root = document.createElement('div');
  root.className = 'technical-view-ui';
  root.innerHTML = `
    <button type="button" class="technical-entry" aria-controls="technical-panel" aria-expanded="false">Technical view <span aria-hidden="true">↗</span></button>
    <section id="technical-panel" class="technical-panel" aria-labelledby="technical-title" hidden>
      <header class="technical-heading">
        <p class="technical-eyebrow">OBJECT STUDY / CURRENT HAIRCUT</p>
        <h1 id="technical-title">Technical view</h1>
        <p>One head. Fully assembled.</p>
      </header>
      <button type="button" class="technical-return">← Return to grooming</button>
      <fieldset>
        <legend>01 / Camera</legend>
        <div class="technical-views">
          <button type="button" data-view="front">Front</button>
          <button type="button" data-view="back">Back</button>
          <button type="button" data-view="left">Left</button>
          <button type="button" data-view="right">Right</button>
          <button type="button" data-view="top">Top</button>
          <button type="button" data-view="bottom">Bottom</button>
        </div>
        <button type="button" class="technical-free" data-view="free">Free orbit</button>
        <p class="technical-note">Drag to orbit · Scroll to zoom.<br>Preset views are orthographic.</p>
      </fieldset>
      <fieldset>
        <legend>02 / Cutaway</legend>
        <label class="technical-check"><input type="checkbox" name="cutaway"> Enable cutaway</label>
        <div class="technical-cutaway-settings">
          <label class="technical-axis">Plane axis
            <select name="axis">
              <option value="x">X — left / right</option>
              <option value="y">Y — upper / lower</option>
              <option value="z">Z — front / back</option>
            </select>
          </label>
          <label class="technical-position" for="technical-position">Position <output for="technical-position">0%</output></label>
          <input id="technical-position" name="position" type="range" min="-1" max="1" step="0.01" value="0" aria-describedby="technical-position-help">
          <p id="technical-position-help" class="technical-note">Relative to the head. Centre = 0%.</p>
          <button type="button" class="technical-flip" aria-pressed="false">Flip side</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>03 / Surface</legend>
        <label class="technical-check"><input type="checkbox" name="planeEdges"> Delineate planes</label>
      </fieldset>
      <p class="technical-footer">Inspection only. The haircut stays yours.</p>
    </section>`;
  document.body.append(root);

  const entry = root.querySelector('.technical-entry');
  const panel = root.querySelector('.technical-panel');
  const back = root.querySelector('.technical-return');
  const enabled = root.querySelector('[name="cutaway"]');
  const axis = root.querySelector('[name="axis"]');
  const position = root.querySelector('[name="position"]');
  const output = root.querySelector('output');
  const flip = root.querySelector('.technical-flip');
  const edges = root.querySelector('[name="planeEdges"]');
  const views = [...root.querySelectorAll('[data-view]')];
  let active = false;
  let flipped = false;

  entry.addEventListener('click', () => onEnter());
  back.addEventListener('click', () => onExit());
  views.forEach((button) => button.addEventListener('click', () => onView(button.dataset.view)));
  enabled.addEventListener('change', () => onCutaway({ enabled: enabled.checked }));
  axis.addEventListener('change', () => onCutaway({ axis: axis.value }));
  position.addEventListener('input', () => onCutaway({ position: Number(position.value) }));
  flip.addEventListener('click', () => onCutaway({ flipped: !flipped }));
  edges.addEventListener('change', () => onPlaneEdges(edges.checked));

  function setActive(next) {
    const changed = active !== next;
    active = next;
    document.body.classList.toggle('technical-view-active', active);
    entry.hidden = active;
    panel.hidden = !active;
    entry.setAttribute('aria-expanded', String(active));
    if (changed) (active ? back : entry).focus({ preventScroll: true });
  }

  function update({ active: nextActive, view = 'free', cutaway = {}, planeEdges = false }) {
    if (typeof nextActive === 'boolean') setActive(nextActive);
    views.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    enabled.checked = Boolean(cutaway.enabled);
    axis.value = cutaway.axis ?? 'x';
    const value = Number(cutaway.position ?? 0);
    position.value = String(value);
    const percent = Math.round(value * 100);
    output.value = `${percent > 0 ? '+' : ''}${percent}%`;
    position.setAttribute('aria-valuetext', `${percent} percent relative to head centre`);
    flipped = Boolean(cutaway.flipped);
    flip.setAttribute('aria-pressed', String(flipped));
    flip.textContent = flipped ? 'Flip side · Flipped' : 'Flip side';
    [axis, position, flip].forEach((control) => { control.disabled = !enabled.checked; });
    edges.checked = planeEdges;
  }

  update({ active: false });
  return {
    setActive,
    update,
    dispose() {
      document.body.classList.remove('technical-view-active');
      root.remove();
    },
  };
}
