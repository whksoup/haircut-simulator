/**
 * guideDebugView.js — draw a tiny sphere at every guide control point.
 *
 * The comb edits guide polylines that otherwise have no visual form of their
 * own — you only ever see their downstream effect on 200k blended strands.
 * This draws the ground truth directly: one InstancedMesh, one sphere per
 * control point across every guide, root-to-tip colour ramped so you can read
 * a curl's direction at a glance and see exactly which points a brush stroke
 * is about to catch.
 *
 * Parented under the head mesh (like the hair renderers), so control points —
 * already mesh-local per guides.js — need no extra transform.
 *
 * Two update paths, matching the cost model in gpuHairR3.js:
 *   sync()       guides added/removed, or SHAPE_POINTS changed. Reassigns the
 *                instance index for every guide and redraws all points.
 *   refresh(ids) points moved (combing). Rewrites only those guides' spheres.
 *                Cheap enough to call from CombTool.onEdit every frame.
 *
 * Public:
 *   sync() / refresh(ids) / setVisible(v) / setRadius(r) / setColors(root, tip)
 *   dispose()
 */

import * as THREE from 'three';
import { SHAPE_POINTS } from './strandShape.js';

const INITIAL_CAPACITY = 256 * SHAPE_POINTS; // guides × points, geometric growth
const MAX_CAPACITY     = 8192 * SHAPE_POINTS;

export class GuideDebugView {
  /**
   * @param {object} o
   * @param {THREE.Mesh} o.mesh                         groomTarget — parent
   * @param {import('./guides.js').GuideStore} o.guides
   * @param {number} [o.radius]  sphere radius, mesh units
   */
  constructor({ mesh, guides, radius = 0.003 } = {}) {
    this.mesh   = mesh;
    this.guides = guides;
    this.radius = radius;

    /** Map<guideId, baseInstanceIndex>. Rebuilt wholesale in sync(). */
    this._base = new Map();
    this._used = 0;

    const geo = new THREE.SphereGeometry(1, 6, 4); // unit sphere; scaled per-instance
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: true });

    this._capacity = INITIAL_CAPACITY;
    this.object = new THREE.InstancedMesh(geo, mat, this._capacity);
    this.object.name = 'GuideDebugView';
    this.object.count = 0;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;

    // instanceColor only exists once something writes to it — force allocation.
    this.object.setColorAt(0, new THREE.Color(0xffffff));

    this._rootColor = new THREE.Color(0xff6b4a); // warm = root, pinned
    this._tipColor  = new THREE.Color(0x66ccff); // cool = tip, free to move
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();

    mesh.add(this.object);
    this.sync();
  }

  setVisible(v) { this.object.visible = v; }

  setRadius(r) {
    this.radius = Math.max(0.002, r);
    this._writeAll();
  }

  setColors(rootHex, tipHex) {
    this._rootColor.set(rootHex);
    this._tipColor.set(tipHex);
    this._writeAll();
  }

  /** Reassign every guide's instance range and redraw all points. Call after
   *  guides are added or removed (i.e. alongside renderer.syncGuides()). */
  sync() {
    const list = [...this.guides.guides.values()];
    const need = list.length * SHAPE_POINTS;
    this._ensureCapacity(need);

    this._base.clear();
    let cursor = 0;
    for (const g of list) {
      this._base.set(g.id, cursor);
      cursor += SHAPE_POINTS;
    }
    this._used = cursor;
    this.object.count = this._used;

    for (const g of list) this._writeGuide(g);
    this._flush();
  }

  /** Rewrite only these guides' spheres (comb hot path). No reallocation,
   *  no reassignment — safe to call every frame during a stroke. */
  refresh(ids) {
    let any = false;
    for (const id of ids) {
      const g = this.guides.get(id);
      if (!g || !this._base.has(id)) continue;
      this._writeGuide(g);
      any = true;
    }
    if (any) this._flush();
  }

  dispose() {
    this.object.parent?.remove(this.object);
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  // --- internals -------------------------------------------------------------

  _ensureCapacity(need) {
    if (need <= this._capacity) return;
    let cap = this._capacity;
    while (cap < need) cap *= 2;
    cap = Math.min(cap, MAX_CAPACITY);
    if (need > cap) {
      console.warn(`[GuideDebugView] ${need} points exceeds MAX_CAPACITY — truncating`);
    }

    const geo = this.object.geometry;
    const mat = this.object.material;
    const next = new THREE.InstancedMesh(geo, mat, cap);
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    next.frustumCulled = false;
    next.renderOrder = this.object.renderOrder;
    next.name = this.object.name;
    next.setColorAt(0, new THREE.Color(0x112233));

    this.mesh.remove(this.object);
    this.object.dispose?.();
    this.object = next;
    this.mesh.add(this.object);
    this._capacity = cap;
  }

  _writeGuide(g) {
    const base = this._base.get(g.id);
    if (base === undefined) return;
    for (let k = 0; k < SHAPE_POINTS; k++) {
      this.guides.pointWorldLocal(g, k, this._p); // already mesh-local
      this._s.setScalar(this.radius);
      this._m.compose(this._p, IDENTITY_Q, this._s);
      this.object.setMatrixAt(base + k, this._m);

      const t = k / (SHAPE_POINTS - 1);
      this._c.copy(this._rootColor).lerp(this._tipColor, t);
      this.object.setColorAt(base + k, this._c);
    }
  }

  _writeAll() {
    for (const g of this.guides.guides.values()) this._writeGuide(g);
    this._flush();
  }

  _flush() {
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }
}

const IDENTITY_Q = new THREE.Quaternion();