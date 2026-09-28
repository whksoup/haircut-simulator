import * as THREE from 'three';

/** Transient copied-mask highlight; never paints the authored head geometry. */
export class BrushMaskOverlay {
  constructor({ mesh, catalogue = mesh.userData.catalogue }) {
    this.mesh = mesh;
    this.catalogue = catalogue;
    this._mask = null;
    this._visible = false;
    this._hasTriangles = false;
    this.object = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0xf4cf6b, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.object.name = 'Brush copied facet mask';
    this.object.visible = false;
    this.object.renderOrder = 3;
    this.object.raycast = () => {};
  }

  setMask(mask) {
    const next = mask === null ? null : new Set(mask);
    if (next === null && this._mask === null || next && this._mask &&
        next.size === this._mask.size && [...next].every(id => this._mask.has(id))) return;
    this._mask = next;
    const positions = [], source = this.mesh.geometry.getAttribute('position');
    const index = this.mesh.geometry.getIndex();
    for (const id of next ?? []) {
      for (const triangle of this.catalogue?.getFacet(id)?.triIndices ?? []) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
          positions.push(source.getX(vertex), source.getY(vertex), source.getZ(vertex));
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.object.geometry.dispose();
    this.object.geometry = geometry;
    this._hasTriangles = positions.length > 0;
    this.object.visible = this._visible && this._hasTriangles;
  }
  setVisible(visible) {
    this._visible = Boolean(visible);
    this.object.visible = this._visible && this._hasTriangles;
  }
  dispose() {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
