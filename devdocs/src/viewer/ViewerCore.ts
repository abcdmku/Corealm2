import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGLNodesHandler } from 'three/examples/jsm/tsl/WebGLNodesHandler.js';
import { loadOutfit } from './armorSet.js';
import { loadAssetModel } from './creature.js';
import type { ViewerModel, ViewerSnapshot, ViewerSource, ViewerMaterial } from './types.js';

export function emptyViewerSnapshot(): ViewerSnapshot {
  return { ready: false, clip: null, time: 0, duration: 0, playing: true, speed: 1, clips: [], materials: [], size: null,
    manifestSize: null, body: null, parts: [], attachments: [], missingBones: [], meshCount: 0, boneSample: [], wireframe: false, bounds: false };
}

/** The documentation viewer's sole renderer. All displayed graphs come from production assets. */
export class ViewerCore {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, .01, 2000);
  private readonly controls: OrbitControls;
  private readonly stage = new THREE.Group();
  private readonly grid = new THREE.GridHelper(10, 20, 0x677563, 0x39443a);
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly resize: ResizeObserver;
  private readonly box = new THREE.Box3Helper(new THREE.Box3(), 0xb8d57d);
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly materials = new Set<THREE.Material>();
  private model?: ViewerModel;
  private mixer?: THREE.AnimationMixer;
  private action?: THREE.AnimationAction;
  private snapshot = emptyViewerSnapshot();
  private frame = 0;
  private lastFrame = 0;
  private lastReport = 0;
  private epoch = 0;
  private disposed = false;
  private fitRadius = 1;
  private fitTarget = new THREE.Vector3();

  private parked = false;

  constructor(private container: HTMLElement, private report: (state: ViewerSnapshot) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setNodesHandler(new WebGLNodesHandler());
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D model. Drag to orbit, scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    this.container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x202821);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .65;
    room.dispose(); pmrem.dispose();
    // Same light colours, intensities and positions as production itemIconRenderer.
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x302821, 1.25));
    const key = new THREE.DirectionalLight(0xffe3c2, 3); key.position.set(-3, 5, 4);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .1, far: 14 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9d1ff, .8); rim.position.set(4, 2, -4); this.scene.add(rim);
    this.scene.add(this.stage, this.grid, this.box);
    this.box.visible = false;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * .49;
    this.camera.position.set(4, 3, 5);
    this.controls.update();
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(container);
    this.resizeCanvas();
    this.frame = requestAnimationFrame(this.tick);
  }

  private resizeCanvas(): void {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async load(source: ViewerSource): Promise<void> {
    const epoch = ++this.epoch;
    this.clearModel();
    this.snapshot = { ...emptyViewerSnapshot(), playing: this.snapshot.playing, speed: this.snapshot.speed, wireframe: this.snapshot.wireframe, bounds: this.snapshot.bounds };
    this.emit();
    const model = source.mode === 'outfit' ? await loadOutfit(source) : await loadAssetModel(source);
    if (this.disposed || epoch !== this.epoch) { model.dispose(); return; }
    this.model = model;
    this.stage.position.set(0, 0, 0);
    this.stage.add(model.root);
    this.mixer = new THREE.AnimationMixer(model.animationRoot);
    const materialRows: ViewerMaterial[] = [];
    let meshCount = 0;
    model.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshCount++;
      this.originals.set(mesh, mesh.material);
      const clones = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
        const clone = material.clone();
        // Production material subclasses preserve their own animation uniforms through copy().
        // Only instance hooks need manual copying; binding a subclass hook to the cached source
        // would leave the rendered clone updating a different set of shimmer uniforms.
        if (Object.hasOwn(material, 'onBeforeCompile')) clone.onBeforeCompile = material.onBeforeCompile;
        if (Object.hasOwn(material, 'customProgramCacheKey')) clone.customProgramCacheKey = material.customProgramCacheKey;
        this.materials.add(clone);
        const textures = Object.entries(material).flatMap(([key, value]) => value instanceof THREE.Texture ? [key] : []);
        const row = { name: material.name || mesh.name || '(unnamed)', type: material.type, textures };
        if (!materialRows.some(item => item.name === row.name && item.type === row.type && item.textures.join() === row.textures.join())) materialRows.push(row);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0]!;
    });
    this.snapshot = { ...this.snapshot, ready: true, body: model.body ?? null, parts: model.parts, attachments: model.attachments,
      missingBones: model.missingBones, manifestSize: model.manifestSize ?? null, materials: materialRows, meshCount,
      clips: model.clips.map(clip => ({ name: clip.name, duration: clip.duration, group: model.clipGroups.get(clip.name) ?? 'Other clips' })) };
    this.selectClip(model.initialClip ?? model.clips[0]?.name ?? '');
    this.mixer.update(0);
    model.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model.root, true);
    if (bounds.isEmpty()) {
      this.clearModel(); this.snapshot.ready = false; this.emit();
      throw new Error('The asset contains no measurable geometry');
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.stage.position.set(-center.x, -bounds.min.y, -center.z);
    this.stage.updateMatrixWorld(true);
    this.box.box.setFromObject(this.stage, true);
    this.fitTarget.set(0, size.y / 2, 0);
    // The box diagonal overstates a model's silhouette; three quarters of it fills the stage without clipping.
    this.fitRadius = Math.max(size.length() / 2 * .75, .05);
    this.snapshot.size = { x: size.x, y: size.y, z: size.z };
    const gridSize = Math.max(1, Math.pow(10, Math.floor(Math.log10(this.fitRadius * 2))));
    this.grid.scale.setScalar(gridSize);
    this.resetCamera();
    this.setWireframe(this.snapshot.wireframe);
    this.setBounds(this.snapshot.bounds);
    this.emit();
  }

  resetCamera(): void {
    const angle = Math.min(THREE.MathUtils.degToRad(this.camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect));
    const distance = this.fitRadius / Math.sin(angle / 2) * 1.12;
    this.controls.target.copy(this.fitTarget);
    this.controls.minDistance = this.fitRadius * .7;
    this.controls.maxDistance = distance * 3;
    this.camera.near = Math.max(.001, this.fitRadius / 1000);
    this.camera.far = Math.max(100, distance * 10);
    this.camera.position.copy(this.fitTarget).add(new THREE.Vector3(1, .55, 1.65).normalize().multiplyScalar(distance));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  selectClip(name: string): void {
    const clip = this.model?.clips.find(candidate => candidate.name === name);
    this.mixer?.stopAllAction();
    this.action = clip && this.mixer ? this.mixer.clipAction(clip).reset().setLoop(THREE.LoopRepeat, Infinity).play() : undefined;
    this.snapshot.clip = clip?.name ?? null;
    this.snapshot.duration = clip?.duration ?? 0;
    this.snapshot.time = 0;
    this.mixer?.update(0);
    this.emit();
  }
  setPlaying(playing: boolean): void { this.snapshot.playing = playing; this.emit(); }
  setSpeed(speed: number): void { this.snapshot.speed = Math.min(4, Math.max(.1, speed)); this.emit(); }
  scrub(time: number): void {
    if (this.action) { this.action.time = Math.min(this.snapshot.duration, Math.max(0, time)); this.mixer?.update(0); }
    this.emit();
  }
  setWireframe(enabled: boolean): void {
    this.snapshot.wireframe = enabled;
    for (const material of this.materials) if ('wireframe' in material) { material.wireframe = enabled; material.needsUpdate = true; }
    this.emit();
  }
  setBounds(enabled: boolean): void { this.snapshot.bounds = enabled; this.box.visible = enabled; this.emit(); }
  private emit(): void {
    this.snapshot.time = this.action?.time ?? 0;
    const boneSample: number[] = [];
    this.model?.animationRoot.traverse(object => {
      if ((object as THREE.Bone).isBone && boneSample.length < 512) boneSample.push(...object.quaternion.toArray());
    });
    this.report({ ...this.snapshot, boneSample });
  }
  /**
   * Take the viewer off the page without destroying it. Creating a renderer compiles the environment
   * and every material's shaders, and destroying one forces a WebGL context loss; together that was
   * two to four seconds of blocked main thread each time an author stepped to the next record.
   * A parked viewer keeps its context and program cache, drops its model, and stops drawing.
   */
  park(): void {
    this.epoch++;
    this.parked = true;
    this.clearModel();
    this.snapshot = emptyViewerSnapshot();
    this.resize.disconnect();
    this.renderer.domElement.remove();
    this.report = () => {};
  }

  /** Put a parked viewer into a new container and start drawing again. */
  attach(container: HTMLElement, report: (state: ViewerSnapshot) => void): void {
    this.container = container;
    this.report = report;
    this.parked = false;
    container.append(this.renderer.domElement);
    this.resize.observe(container);
    this.resizeCanvas();
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    if (this.parked) { this.lastFrame = 0; this.frame = requestAnimationFrame(this.tick); return; }
    const delta = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .1) : 0;
    this.lastFrame = now;
    if (this.snapshot.playing) this.mixer?.update(delta * this.snapshot.speed);
    this.controls.update();
    if (this.box.visible && this.model) this.box.box.setFromObject(this.stage, true);
    this.renderer.render(this.scene, this.camera);
    if (now - this.lastReport > 120) { this.lastReport = now; this.emit(); }
    this.frame = requestAnimationFrame(this.tick);
  };
  private clearModel(): void {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model.animationRoot);
    this.mixer = undefined; this.action = undefined;
    for (const [mesh, material] of this.originals) mesh.material = material;
    this.originals.clear();
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    this.model?.dispose(); this.model = undefined;
    this.stage.clear();
  }
  dispose(): void {
    this.disposed = true; this.epoch++;
    cancelAnimationFrame(this.frame); this.resize.disconnect(); this.controls.dispose();
    this.clearModel(); this.environment.dispose();
    this.grid.geometry.dispose();
    for (const material of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) material.dispose();
    this.box.geometry.dispose();
    for (const material of Array.isArray(this.box.material) ? this.box.material : [this.box.material]) material.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
    this.scene.clear();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
