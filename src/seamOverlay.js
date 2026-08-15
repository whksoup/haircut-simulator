/**
 * seamOverlay.js — draw authored seams, the current edge selection, and the
 * edge under the cursor.
 *
 * THREE LAYERS, AND WHY IT CANNOT BE ONE
 *
 * The obvious design draws every seam and tints the selected ones. It does not
 * work, because the most common thing you do with the seam tool is select an
 * edge that has NO seam on it yet in order to give it one — and that edge is,
 * by definition, not in the authored set. A single layer would leave the user
 * clicking invisible geometry and guessing. So:
 *
 *   seams      every edge with permeability < 1. Colour encodes the value:
 *              hot for a hard part, warm as it fades toward 1. This is the
 *              authored state — the thing the binder will act on.
 *   selection  every selected edge, whatever its permeability. Drawn bright,
 *              depth-tested off, so it reads on top of the seam layer and
 *              through the head. Depth-off matters: a run of seam usually
 *              wraps around a curve and half of it is facing away.
 *   hover      one edge, dim. Confirms which edge a click will take BEFORE it
 *              is taken, which is what makes a one-pixel target clickable.
 *
 * Three LineSegments, three materials, no per-frame work. Each layer rebuilds
 * only when its own input changes, so hovering does not touch the seam buffer
 * and dragging the permeability slider does not touch the selection buffer.
 *
 * Parent under the head mesh so its transform applies:
 *     groomTarget.add(overlay.object);
 */

import * as THREE from 'three';

/** Outward lift along the facet normals so lines clear the skin. */
const LIFT       = 0.0015;
/** Selection and hover sit slightly further out again, above the seam layer. */
const LIFT_PICK  = 0.0026;

/**
 * Half-width of the selection / hover ribbons, in mesh units.
 *
 * WebGL ignores LineBasicMaterial.linewidth on essentially every platform, so
 * a "selected" line is one pixel no matter what is asked for — which on a
 * pale head at a normal zoom is genuinely hard to see, and harder still to
 * confirm you picked the edge you meant. Selection and hover are therefore
 * drawn as RIBBONS: two triangles per edge, laid flat in the surface, with a
 * real width. The seam layer stays as lines because it can run to hundreds of
 * edges and its job is to show a field, not a target.
 *
 * World units rather than screen: it scales with zoom, which is the wrong
 * behaviour in the limit but is one uniform's worth of complexity here, and
 * the tool is used at a fairly consistent working distance.
 */
const RIBBON_HALF_WIDTH = 0.0035;

const HARD   = new THREE.Color(0xff3355);   // permeability 0 — a part
const SOFT   = new THREE.Color(0xffcc44);   // permeability → 1 — a fade
/**
 * Selection and hover are GREEN, not white or cyan.
 *
 * The head renders as pale skin and the default material reads near-white
 * under the key light, so a white highlight disappears into exactly the
 * surface it is drawn on. Green is the one hue that is far from the skin,
 * far from the red/amber the seam layer uses for permeability, and still
 * unambiguous against the blue facet wireframe if that is also on.
 *
 * Hover is the same hue at lower value: same family, clearly subordinate, so
 * "what I would pick" and "what I have picked" never get confused.
 */
const SELECT = new THREE.Color(0x00ff5a);
const HOVER  = new THREE.Color(0x7dffae);

export class SeamOverlay {
  /**
   * @param {object} o
   * @param {THREE.Mesh} o.mesh                              the groomTarget
   * @param {import('./facetWireframe.js').FacetCatalogue} o.catalogue
   * @param {import('./seams.js').SeamStore} o.seams
   */
  constructor({ mesh, catalogue, seams }) {
    this.mesh      = mesh;
    this.catalogue = catalogue;
    this.seams     = seams;

    /** @type {Set<number>} */
    this._selection = new Set();
    this._hovered   = -1;

    this.object = new THREE.Group();
    this.object.name = 'SeamOverlay';

    // Authored seams. Depth-tested, so they sit on the surface and are hidden
    // by the head when facing away — they are scene content, not a HUD.
    this._seamLayer = this._makeLayer({
      vertexColors: true, opacity: 0.95, depthTest: true, renderOrder: 3,
    });

    // Selection. Depth test OFF: a parting wraps around the skull and you need
    // to see the whole run while editing it, not just the near half.
    this._selLayer = this._makeRibbonLayer({
      color: SELECT, opacity: 1.0, renderOrder: 5,
    });

    this._hoverLayer = this._makeRibbonLayer({
      color: HOVER, opacity: 0.7, renderOrder: 4,
    });

    /** Edge counts from the last build — cheap readouts for the UI. */
    this.drawnEdges     = 0;
    this.selectedEdges  = 0;

    this.refresh();
  }

  _makeLayer({ color, vertexColors = false, opacity, depthTest, renderOrder }) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    if (vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute([], 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors,
      color: vertexColors ? undefined : color,
      transparent: true,
      opacity,
      depthTest,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = renderOrder;
    // Depth-tested-off layers must not be frustum-culled by a stale bounding
    // sphere when the buffer is rewritten from empty.
    lines.frustumCulled = false;
    this.object.add(lines);
    return { geo, mat, lines };
  }

  /** A ribbon layer: triangles rather than lines, so it has real width. */
  _makeRibbonLayer({ color, opacity, renderOrder }) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest:  false,
      depthWrite: false,
      side: THREE.DoubleSide,   // ribbons on the far side of the head still read
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    return { geo, mat, lines: mesh };
  }

  // --- visibility -----------------------------------------------------------

  setVisible(v) { this.object.visible = !!v; }
  get visible()  { return this.object.visible; }

  // --- inputs ---------------------------------------------------------------

  /** Rebuild the authored-seam layer. Call after any permeability change. */
  refresh() {
    if (!this.catalogue) return;

    const pos = [], col = [];
    const c = new THREE.Color();
    let count = 0;

    for (const e of this.catalogue.edges()) {
      if (e.b < 0) continue;
      const p = this.seams.get(e.a, e.b);
      if (p >= 1) continue;                        // default: nothing to draw

      this._pushEdge(pos, e, LIFT);
      // p is permeability: 0 = hard. Lerp SOFT→HARD as p falls, so a wide
      // crease-seeding softness reads as a gradient along the hairline rather
      // than a uniform stripe — which is the information you need to judge
      // whether the threshold was right.
      c.copy(SOFT).lerp(HARD, 1 - p);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      count++;
    }

    this._seamLayer.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this._seamLayer.geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
    this.drawnEdges = count;
  }

  /** @param {Iterable<number>} edgeIds */
  setSelection(edgeIds) {
    this._selection = edgeIds instanceof Set ? edgeIds : new Set(edgeIds);
    const pos = [];
    for (const id of this._selection) {
      const e = this.catalogue?.getEdge(id);
      if (e) this._pushRibbon(pos, e, LIFT_PICK);
    }
    this._selLayer.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.selectedEdges = this._selection.size;
  }

  /** @param {number} edgeId -1 clears. */
  setHover(edgeId) {
    if (this._hovered === edgeId) return;
    this._hovered = edgeId;
    const pos = [];
    const e = edgeId >= 0 ? this.catalogue?.getEdge(edgeId) : null;
    // Hovering something already selected adds nothing and only flickers.
    if (e && !this._selection.has(edgeId)) this._pushRibbon(pos, e, LIFT_PICK);
    this._hoverLayer.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }

  // --- internals ------------------------------------------------------------

  /**
   * Append an edge's two endpoints, lifted along the mean of its facet
   * normals. A seam sits by definition on a fold, and an unlifted line there
   * z-fights along its entire length.
   */
  _pushEdge(pos, e, lift) {
    const n = this._edgeNormal(e);
    const ox = n.x * lift, oy = n.y * lift, oz = n.z * lift;
    pos.push(
      e.p0.x + ox, e.p0.y + oy, e.p0.z + oz,
      e.p1.x + ox, e.p1.y + oy, e.p1.z + oz,
    );
  }

  /**
   * Append an edge as a flat quad (two triangles) lying in the surface.
   *
   * The ribbon's width runs along `side` = edge direction x surface normal, so
   * it hugs the scalp instead of standing up off it — a ribbon that stood
   * proud would read as a wall and would occlude the hair it is meant to
   * annotate.
   */
  _pushRibbon(pos, e, lift) {
    const n = this._edgeNormal(e);

    let dx = e.p1.x - e.p0.x, dy = e.p1.y - e.p0.y, dz = e.p1.z - e.p0.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    // side = d x n
    let sx = dy * n.z - dz * n.y;
    let sy = dz * n.x - dx * n.z;
    let sz = dx * n.y - dy * n.x;
    const sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-9) return;                  // degenerate; nothing sensible to draw
    const w = RIBBON_HALF_WIDTH / sl;
    sx *= w; sy *= w; sz *= w;

    const ox = n.x * lift, oy = n.y * lift, oz = n.z * lift;
    const a = [e.p0.x + ox - sx, e.p0.y + oy - sy, e.p0.z + oz - sz];
    const b = [e.p0.x + ox + sx, e.p0.y + oy + sy, e.p0.z + oz + sz];
    const c = [e.p1.x + ox + sx, e.p1.y + oy + sy, e.p1.z + oz + sz];
    const d = [e.p1.x + ox - sx, e.p1.y + oy - sy, e.p1.z + oz - sz];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }

  /** Unit mean of the two facet normals either side of an edge. */
  _edgeNormal(e) {
    let nx = 0, ny = 0, nz = 0;
    const fa = this.catalogue.getFacet(e.a);
    const fb = e.b >= 0 ? this.catalogue.getFacet(e.b) : null;
    if (fa) { nx += fa.normal.x; ny += fa.normal.y; nz += fa.normal.z; }
    if (fb) { nx += fb.normal.x; ny += fb.normal.y; nz += fb.normal.z; }
    const l = Math.hypot(nx, ny, nz);
    return l > 1e-9 ? { x: nx / l, y: ny / l, z: nz / l } : { x: 0, y: 1, z: 0 };
  }

  dispose() {
    this.object.parent?.remove(this.object);
    for (const layer of [this._seamLayer, this._selLayer, this._hoverLayer]) {
      layer.geo.dispose();
      layer.mat.dispose();
    }
  }
}
