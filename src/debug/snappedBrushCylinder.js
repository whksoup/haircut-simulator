import * as THREE from 'three';

/** Held-only capsule depiction: central cylinder plus exact spherical endcaps. */
export class SnappedBrushCylinder extends THREE.Group {
  constructor() {
    super(); this.name = 'Snapped brush cylinder'; this.visible = false;
    this._cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1);
    this._sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
    this._material = new THREE.MeshBasicMaterial({color: 0xffaa44, transparent: true, opacity: 0.22,
      depthWrite: false, depthTest: true});
    this.body = new THREE.Mesh(this._cylinderGeometry, this._material);
    this.capA = new THREE.Mesh(this._sphereGeometry, this._material);
    this.capB = new THREE.Mesh(this._sphereGeometry, this._material);
    for (const object of [this.body, this.capA, this.capB]) {
      object.raycast = () => {}; object.renderOrder = 3; this.add(object);
    }
    this.endpoints = null; this.radius = 0;
  }
  setPose(a, b, radius) {
    const axis = b.clone().sub(a), length = axis.length();
    if (!(length > 0) || !Number.isFinite(length)) { this.visible = false; return; }
    this.body.position.copy(a).add(b).multiplyScalar(0.5);
    this.body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.divideScalar(length));
    this.body.scale.set(radius, length, radius);
    this.capA.position.copy(a); this.capB.position.copy(b);
    this.capA.scale.setScalar(radius); this.capB.scale.setScalar(radius);
    this.endpoints = [a.clone(), b.clone()]; this.radius = radius;
    this.updateMatrixWorld(true);
  }
  dispose() {
    this.visible = false; this.removeFromParent();
    this._cylinderGeometry.dispose(); this._sphereGeometry.dispose(); this._material.dispose();
  }
}

