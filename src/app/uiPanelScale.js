/** Scales the whole control panel, including text, without changing groom state.
 * An unscaled footer keeps resizing reachable while oversized controls scroll. */
import './uiPanelScale.css';

export function mountScalablePanel(gui) {
  const panel = document.createElement('section');
  panel.className = 'groom-panel';
  panel.dataset.groomingChrome = '';
  panel.setAttribute('aria-label', 'Groom controls');
  const viewport = document.createElement('div');
  viewport.className = 'groom-panel-scroll';
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', 'Scrollable groom controls');
  const footer = document.createElement('div');
  footer.className = 'groom-panel-footer';
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'groom-panel-resize';
  handle.textContent = '⤢';
  handle.setAttribute('aria-label', 'Resize control panel');
  handle.title = 'Drag left/down to enlarge; right/up to shrink. Arrow keys resize; double-click resets.';
  const label = document.createElement('output');
  label.setAttribute('aria-live', 'polite');
  footer.append(handle, label);
  viewport.append(gui.domElement);
  panel.append(viewport, footer);
  document.body.append(panel);

  let scale = 0.6, drag = null;
  const setScale = value => {
    scale = Math.min(2, Math.max(0.5, value));
    gui.domElement.style.zoom = String(scale);
    panel.style.width = `${245 * scale}px`;
    label.textContent = `UI ${Math.round(scale * 100)}%`;
  };
  setScale(scale);
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    handle.focus();
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, scale};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    setScale(drag.scale + (drag.x - event.clientX + event.clientY - drag.y) / 400);
  });
  const finish = () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish);
  window.addEventListener('blur', finish);
  handle.addEventListener('dblclick', () => setScale(0.6));
  handle.addEventListener('keydown', event => {
    const delta = {ArrowLeft: 0.05, ArrowDown: 0.05, ArrowRight: -0.05, ArrowUp: -0.05}[event.key];
    if (delta === undefined && event.key !== 'Home') return;
    event.preventDefault();
    event.stopPropagation();
    setScale(event.key === 'Home' ? 0.6 : scale + delta);
  });
  const destroy = gui.destroy.bind(gui);
  gui.destroy = () => {
    finish();
    window.removeEventListener('blur', finish);
    panel.remove();
    destroy();
  };
}
