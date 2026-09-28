import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { loadOutfit } from './armorSet.js';
import { loadAssetModel } from './creature.js';
import { isActorModel, loadActorModel } from './actor.js';
import { POSE_CLIPS } from '../../../game/src/render/characterRig.js';
import { CREATURE_STATES, type ViewerStateInfo } from './types.js';
import type { ViewerModel, ViewerSnapshot, ViewerSource, ViewerMaterial } from './types.js';

export function emptyViewerSnapshot(): ViewerSnapshot {
  return { states: [], state: null, appearance: null, ready: false, clip: null, time: 0, duration: 0, playing: true, speed: 1, clips: [], materials: [], size: null,
    manifestSize: null, body: null, parts: [], attachments: [], missingBones: [], meshCount: 0, boneSample: [], motion: null, currentBounds: null, wireframe: false, bounds: false };
}

/** States for a model that does not list its own: player poses for outfits, clip groups for creatures. */
function defaultStates(source: ViewerSource, model: ViewerModel): ViewerStateInfo[] {
  const names = model.clips.map(clip => clip.name);
  if (source.mode === 'outfit') return Object.entries(POSE_CLIPS).map(([pose, clips]) => {
    const clip = clips.find(candidate => names.includes(candidate)) ?? null;
    return { name: pose, clip, available: clip !== null };
  });
  return CREATURE_STATES.map(state => {
    const clip = names.find(name => model.clipGroups.get(name) === state) ?? null;
    return { name: state, clip, available: clip !== null };
  });
}

/** The documentation viewer's sole renderer. All displayed graphs come from production assets and
 * draw through the game's own WebGPU renderer, so node materials look exactly as they do in play. */
export class ViewerCore {
  readonly renderer: WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, .01, 2000);
  private readonly controls: OrbitControls;
  private readonly stage = new THREE.Group();
  private readonly grid = new THREE.GridHelper(10, 20, 0x677563, 0x39443a);
  private environment?: THREE.RenderTarget;
  private readonly initialized: Promise<void>;
  private ready = false;
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
  /** A loaded model whose pipelines are still compiling asynchronously; frames wait for it. */
  private compiling = false;

  constructor(private container: HTMLElement, private report: (state: ViewerSnapshot) => void) {
    this.renderer = new WebGPURenderer({ antialias: true, alpha: false });
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
    this.scene.environmentIntensity = .65;
    this.initialized = this.renderer.init().then(() => {
      if (this.disposed) return;
      const room = new RoomEnvironment();
      const pmrem = new PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(room, .04);
      this.scene.environment = this.environment.texture;
      room.dispose(); pmrem.dispose();
      this.ready = true;
    });
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
    const model = source.mode === 'outfit' ? await loadOutfit(source) : source.mode === 'actor' ? await loadActorModel(source) : await loadAssetModel(source);
    if (this.disposed || epoch !== this.epoch) { model.dispose(); return; }
    this.model = model;
    this.stage.position.set(0, 0, 0);
    this.stage.add(model.root);
    // Held until the model's pipelines are compiled off the main thread (below): a first draw would
    // compile every one of them synchronously and freeze the page on a slower GPU.
    this.compiling = true;
    // An actor plays itself through the game's EntityViews; a second mixer on its bones would fight it.
    this.mixer = isActorModel(model) ? undefined : new THREE.AnimationMixer(model.animationRoot);
    const materialRows: ViewerMaterial[] = [];
    const clonesBySource = new Map<THREE.Material, THREE.Material>();
    let meshCount = 0;
    model.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshCount++;
      this.originals.set(mesh, mesh.material);
      const clones = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
        let clone = clonesBySource.get(material);
        if (!clone) {
          clone = material.clone();
          // Production material subclasses preserve their own animation uniforms through copy().
          // Only instance hooks need manual copying; binding a subclass hook to the cached source
          // would leave the rendered clone updating a different set of shimmer uniforms.
          if (Object.hasOwn(material, 'onBeforeCompile')) clone.onBeforeCompile = material.onBeforeCompile;
          if (Object.hasOwn(material, 'customProgramCacheKey')) clone.customProgramCacheKey = material.customProgramCacheKey;
          clonesBySource.set(material, clone);
          this.materials.add(clone);
        }
        const textures = Object.entries(material).flatMap(([key, value]) => value instanceof THREE.Texture ? [key] : []);
        const row = { name: material.name || mesh.name || '(unnamed)', type: material.type, textures };
        if (!materialRows.some(item => item.name === row.name && item.type === row.type && item.textures.join() === row.textures.join())) materialRows.push(row);
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0]!;
    });
    this.snapshot = { ...this.snapshot, body: model.body ?? null, parts: model.parts, attachments: model.attachments,
      missingBones: model.missingBones, manifestSize: model.manifestSize ?? null, materials: materialRows, meshCount,
      clips: model.clips.map(clip => ({ name: clip.name, duration: clip.duration, group: model.clipGroups.get(clip.name) ?? 'Other clips' })) };
    this.snapshot.appearance = model.appearance ?? null;
    this.snapshot.states = model.states ?? defaultStates(source, model);
    if (!isActorModel(model)) this.selectClip(model.initialClip ?? model.clips[0]?.name ?? '');
    const initial = model.initialState ?? this.snapshot.states.find(state => state.available && state.clip === this.snapshot.clip)?.name ?? null;
    if (initial) this.setState(initial); else this.snapshot.state = null;
    this.mixer?.update(0);
    // The pooled stage can retain the previous model's matrixWorld after its position is reset.
    // Refresh the parent before measuring this child; updateMatrixWorld on the child alone does not
    // update stale ancestors, so Box3 would otherwise fit to the previous model's translation.
    this.stage.updateMatrixWorld(true);
    model.root.updateMatrixWorld(true);
    const bounds = this.measure(model);
    if (bounds.isEmpty()) {
      this.clearModel(); this.snapshot.ready = false; this.emit();
      throw new Error('The asset contains no measurable geometry');
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    // Production actors already stand or hover at the authored world height. Flooring their idle
    // bounds removes flight clearance and sends their later landing/death poses below the grid.
    this.stage.position.set(-center.x, isActorModel(model) ? 0 : -bounds.min.y, -center.z);
    this.stage.updateMatrixWorld(true);
    this.box.box.copy(this.measure(model));
    this.fitTarget.set(0, center.y + this.stage.position.y, 0);
    // Fit the full bounding-box sphere, with a little room for skeletal poses beyond this sampled pose.
    this.fitRadius = Math.max(size.length() * .55, .05);
    this.snapshot.size = { x: size.x, y: size.y, z: size.z };
    const gridSize = Math.max(1, Math.pow(10, Math.floor(Math.log10(this.fitRadius * 2))));
    this.grid.scale.setScalar(gridSize);
    this.resetCamera();
    this.setWireframe(this.snapshot.wireframe);
    this.setBounds(this.snapshot.bounds);
    await this.initialized;
    if (this.disposed || epoch !== this.epoch) return;
    try { await this.renderer.compileAsync(this.scene, this.camera); }
    catch { /* The first draw compiles what is left. */ }
    finally { if (epoch === this.epoch) this.compiling = false; }
    if (this.disposed || epoch !== this.epoch) return;
    // A ready snapshot must describe pixels already drawn, not an asset still compiling.
    this.renderer.render(this.scene, this.camera);
    this.snapshot.ready = true;
    this.lastFrame = 0;
    this.emit();
  }

  /** World-space bounds of what the model draws right now. */
  private measure(model: ViewerModel): THREE.Box3 {
    if (isActorModel(model)) { this.stage.updateMatrixWorld(true); return model.bounds(); }
    return new THREE.Box3().setFromObject(model.root, true);
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
    // An actor's clips belong to its states; picking one puts the actor in the state that plays it.
    if (this.model && isActorModel(this.model)) {
      const state = this.snapshot.states.find(candidate => candidate.available && candidate.clip === name);
      if (state) this.setState(state.name);
      return;
    }
    const clip = this.model?.clips.find(candidate => candidate.name === name);
    this.mixer?.stopAllAction();
    this.action = clip && this.mixer ? this.mixer.clipAction(clip).reset().setLoop(THREE.LoopRepeat, Infinity).play() : undefined;
    this.snapshot.clip = clip?.name ?? null;
    this.snapshot.duration = clip?.duration ?? 0;
    this.snapshot.time = 0;
    this.mixer?.update(0);
    this.emit();
  }
  /** Put the model in one of `snapshot.states`. Unknown or unavailable states are ignored. */
  setState(name: string): void {
    const state = this.snapshot.states.find(candidate => candidate.name === name);
    if (!state?.available || !this.model) return;
    this.snapshot.state = name;
    if (!this.model.setState?.(name) && state.clip) this.selectClip(state.clip);
    if (this.snapshot.ready && this.ready && !this.compiling) this.renderer.render(this.scene, this.camera);
    this.emit();
  }
  setPlaying(playing: boolean): void { this.snapshot.playing = playing; this.emit(); }
  setSpeed(speed: number): void { this.snapshot.speed = Math.min(4, Math.max(.1, speed)); this.emit(); }
  scrub(time: number): void {
    if (!Number.isFinite(time)) return;
    this.snapshot.playing = false;
    if (this.model?.seek) this.model.seek(Math.max(0, time));
    else if (this.action) { this.action.time = Math.min(this.snapshot.duration, Math.max(0, time)); this.mixer?.update(0); }
    if (this.ready && !this.compiling) this.renderer.render(this.scene, this.camera);
    this.emit();
  }
  setWireframe(enabled: boolean): void {
    this.snapshot.wireframe = enabled;
    for (const material of this.materials) if ('wireframe' in material) { material.wireframe = enabled; material.needsUpdate = true; }
    this.emit();
  }
  setBounds(enabled: boolean): void { this.snapshot.bounds = enabled; this.box.visible = enabled; this.emit(); }
  private emit(): void {
    if (this.model && isActorModel(this.model)) {
      const playback = this.model.playback();
      this.snapshot.clip = playback.clip;
      this.snapshot.time = playback.time;
      this.snapshot.duration = playback.duration;
      this.snapshot.motion = this.model.motion();
      const bounds = this.measure(this.model);
      this.snapshot.currentBounds = bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() };
    } else this.snapshot.time = this.action?.time ?? 0;
    const boneSample: number[] = [];
    this.model?.animationRoot.traverse(object => {
      if ((object as THREE.Bone).isBone && boneSample.length < 512) boneSample.push(...object.quaternion.toArray());
    });
    this.report({ ...this.snapshot, boneSample });
  }
  /**
   * Take the viewer off the page without destroying it. Creating a renderer initializes a device,
   * the environment and every material's pipelines; doing that for each record was seconds of
   * waiting. A parked viewer keeps its device and pipeline cache, drops its model, and stops drawing.
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
    // The new owner must never read the previous page's model as ready.
    this.snapshot = emptyViewerSnapshot();
    this.emit();
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    if (this.parked) { this.lastFrame = 0; this.frame = requestAnimationFrame(this.tick); return; }
    const delta = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .1) : 0;
    this.lastFrame = now;
    if (this.snapshot.ready && !this.compiling && this.snapshot.playing) { this.mixer?.update(delta * this.snapshot.speed); this.model?.update?.(delta * this.snapshot.speed); }
    this.controls.update();
    if (this.box.visible && this.model) this.box.box.copy(this.measure(this.model));
    if (this.ready && !this.compiling) this.renderer.render(this.scene, this.camera);
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
    this.clearModel(); this.environment?.dispose();
    this.grid.geometry.dispose();
    for (const material of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) material.dispose();
    this.box.geometry.dispose();
    for (const material of Array.isArray(this.box.material) ? this.box.material : [this.box.material]) material.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
    this.scene.clear();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
