/**
 * Viewer — owns the renderer, scene, camera, controls, and the render loop.
 *
 * Register per-frame work with `onUpdate(fn)`; later phases (strand updates,
 * dynamics) hook in here rather than spinning up their own loops.
 *
 * Phase 1.5: viewQuads() reads the catalogue already built by loadHead.prep()
 * rather than rebuilding it, so there is exactly one FacetCatalogue per mesh.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildFacetWireframe } from './facetWireframe.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    this._updaters = new Set();
    this._clock    = new THREE.Clock();

    // --- renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // --- scene ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161a);

    // --- camera ---
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 0.1, 0.9);

    // --- controls ---
    // Rhino-like scheme: LEFT is never claimed by the camera — raycast, the
    // comb, and the work-plane gizmo all live on left button/drag and must
    // never fight OrbitControls for it. RIGHT-drag orbits; SHIFT+RIGHT-drag
    // pans instead, matching Rhino's rotate/pan split on the same button.
    // Wheel still dollies. See _onNavPointerDown for how the modifier swap
    // works — OrbitControls itself has no per-drag modifier awareness.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 5;
    this.controls.mouseButtons = {
      LEFT:   null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.ROTATE,
    };

    // Capture phase so this runs BEFORE OrbitControls' own (bubble-phase)
    // pointerdown handler reads this.controls.mouseButtons.RIGHT — that's
    // what lets the modifier be decided per-gesture instead of fixed at
    // construction time.
    this.renderer.domElement.addEventListener('pointerdown', this._onNavPointerDown, { capture: true });

    this._setupLighting();
    this._onResize();
    window.addEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(this._tick);
  }

  _setupLighting() {
    const pmrem  = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(1, 1.5, 1);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
    rim.position.set(-1.2, 0.4, -1);
    this.scene.add(rim);
  }

  /** Frame the camera and controls around an object's bounding sphere. */
  frameObject(object, fillRatio = 1.6) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    this.controls.target.copy(sphere.center);
    const fov  = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (sphere.radius * fillRatio) / Math.sin(fov / 2);
    const dir  = new THREE.Vector3(0, 0.15, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 100, 0.001);
    this.camera.far  = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Toggle the facet wireframe overlay for a given mesh.
   * Reads the catalogue already built by loadHead.prep() — does not rebuild it.
   * Falls back to building fresh if the mesh has no pre-built wireframeGeo
   * (e.g. a mesh prepped outside loadHead).
   */
  viewQuads(mesh) {
    if (this._wireframe) {
      this.scene.remove(this._wireframe);
      this._wireframe.geometry.dispose();
      this._wireframe = null;
      return;
    }

    // Prefer the pre-built wireframe stored by loadHead.prep().
    let wireframe = mesh.userData.wireframeGeo ?? null;
    if (!wireframe) {
      const result = buildFacetWireframe(mesh.geometry);
      if (!result) return;
      wireframe = result.wireframe;
      // Backfill catalogue if prep() didn't run (shouldn't happen, but safe).
      if (!mesh.userData.catalogue) mesh.userData.catalogue = result.catalogue;
    }

    this._wireframe = wireframe;
    this.scene.add(wireframe);
  }

  /** Register a per-frame callback: fn(deltaSeconds, elapsedSeconds). */
  onUpdate(fn) {
    this._updaters.add(fn);
    return () => this._updaters.delete(fn);
  }

  _tick = () => {
    const dt = this._clock.getDelta();
    const t  = this._clock.elapsedTime;
    this.controls.update();
    for (const fn of this._updaters) fn(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  _onResize = () => {
    const w = this.container.clientWidth  || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Decide, at the moment RIGHT goes down, whether this gesture rotates or
   * pans — checked once per press (not re-evaluated mid-drag), matching how
   * Rhino reads the modifier at the start of a right-drag. Left/middle pass
   * through untouched.
   */
  _onNavPointerDown = (event) => {
    if (event.button !== 2) return;
    this.controls.mouseButtons.RIGHT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  };

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this._onNavPointerDown, { capture: true });
    this.controls.dispose();
    this.renderer.dispose();
  }
}