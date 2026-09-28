import * as THREE from 'three';

/** Camera-fixed head triangle shadow volumes. Tests entire guide segments,
 * including a hidden interior whose two endpoints are visible. Hair, gizmos
 * and child meshes are deliberately excluded: only the supplied head geometry
 * contributes. Recreate on each stroke after updating camera/head transforms. */
export class HeadVisibility {
  constructor(mesh, camera) {
    mesh.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    this.matrix = mesh.matrixWorld.clone();
    this.volumes = [];
    const geometry = mesh.geometry;
    if (!geometry?.attributes.position) return;
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position).applyMatrix4(this.matrix);
    this.tolerance = Math.max(box.getSize(new THREE.Vector3()).length() * 1e-6, 1e-9);
    const position = geometry.attributes.position, indices = geometry.index;
    const count = indices ? indices.count : position.count;
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const direction = camera.getWorldDirection(new THREE.Vector3());
    this.origin = origin; this.direction = direction;
    this.near = Math.max(0, camera.near);
    for (let i = 0; i + 2 < count; i += 3) {
      const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices ? indices.getX(i + j) : i + j).applyMatrix4(this.matrix));
      const [a, b, c] = vertices;
      if (vertices.every(p => p.clone().sub(origin).dot(direction) < this.near)) continue;
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const toward = camera.isOrthographicCamera ? direction : center.clone().sub(origin).normalize();
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.lengthSq() < 1e-24) continue;
      n.normalize();
      const facing = n.dot(toward);
      if (Math.abs(facing) < 1e-12) continue;
      if (facing < 0) n.negate();
      const planes = [[n.x, n.y, n.z, -n.dot(a) - this.tolerance]];
      for (let j = 0; j < 3; j++) {
        const p = vertices[j], q = vertices[(j + 1) % 3];
        const edge = q.clone().sub(p);
        const side = edge.cross(camera.isOrthographicCamera ? direction : origin.clone().sub(p)).normalize();
        if (side.dot(center.clone().sub(p)) < 0) side.negate();
        planes.push([side.x, side.y, side.z, -side.dot(p) + this.tolerance]);
      }
      this.volumes.push(planes);
    }
  }

  /** Both ends of every hidden segment must stay fixed. This permits a visible
   * suffix on a scalp-rooted guide whose immutable root is slightly embedded. */
  protectedVertices(points) {
    const pinned = new Array(points.length / 3).fill(false);
    for (let i = 3; i < points.length; i += 3) {
      if (!this.isVisible(points.slice(i - 3, i + 3))) {
        pinned[i / 3 - 1] = true; pinned[i / 3] = true;
      }
    }
    return pinned;
  }

  /** Flat mesh-local polyline. Protected segments are unchanged by the caller;
   * every other complete segment must remain unobscured after deformation. */
  isVisible(points, pinned = null) {
    const world = [];
    for (let i = 0; i < points.length; i += 3) {
      const p = new THREE.Vector3(points[i], points[i + 1], points[i + 2]).applyMatrix4(this.matrix);
      if (!pinned?.[i / 3] && this.origin && p.clone().sub(this.origin).dot(this.direction) < this.near) return false;
      world.push(p);
    }
    for (let i = 1; i < world.length; i++) {
      if (pinned?.[i - 1] && pinned?.[i]) continue;
      const a = world[i - 1], b = world[i];
      for (const planes of this.volumes) {
        let lo = 0, hi = 1;
        for (const p of planes) {
          const da = p[0] * a.x + p[1] * a.y + p[2] * a.z + p[3];
          const db = p[0] * b.x + p[1] * b.y + p[2] * b.z + p[3];
          if (da < 0 && db < 0) { hi = -1; break; }
          if (da < 0) lo = Math.max(lo, da / (da - db));
          else if (db < 0) hi = Math.min(hi, da / (da - db));
          if (hi < lo) break;
        }
        if (hi >= lo) return false;
      }
    }
    return true;
  }
}
