/**
 * Small backend probe on the existing lab canvas. Production assets/decoding, animation and
 * geometry are real; the ground's node shader is a migration probe, not authored-world parity.
 * Inspect __webgpuPoc.getState(), then await __webgpuPoc.addContent() to exercise streaming.
 */
import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, sin } from 'three/tsl';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetRegistry } from './assets.js';
import { CAMERA } from '../app/config.js';

interface PocState {
  ready: boolean;
  backend: 'initializing' | 'webgpu' | 'webgl2-fallback';
  error: string | null;
  startupMs: number;
  compileMs: number;
  streamedMs: number;
  frames: number;
  maxFrameGapMs: number;
  maxRenderCpuMs: number;
  drawCalls: number;
  triangles: number;
  drawnMeshes: number;
  skinnedMeshes: number;
  foliageInstances: number;
  creatures: number;
  animationSeconds: number;
  pendingContent: boolean;
  assetIds: string[];
}

export async function startWebGpuPoc(canvas: HTMLCanvasElement): Promise<void> {
  const began = performance.now();
  const state: PocState = {
    ready: false, backend: 'initializing', error: null, startupMs: 0, compileMs: 0,
    streamedMs: 0, frames: 0, maxFrameGapMs: 0, maxRenderCpuMs: 0, drawCalls: 0,
    triangles: 0, drawnMeshes: 0, skinnedMeshes: 0, foliageInstances: 0,
    creatures: 0, animationSeconds: 0, pendingContent: false, assetIds: [],
  };
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb4c7ca);
  scene.fog = new THREE.Fog(0xb4c7ca, 35, 75);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(0, 1 + Math.sin(CAMERA.defaultPitch) * CAMERA.defaultDistance,
    Math.cos(CAMERA.defaultPitch) * CAMERA.defaultDistance);
  camera.lookAt(0, 1, 0);
  const resize = (): void => {
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  scene.add(new THREE.HemisphereLight(0xcac7c0, 0x66513d, 1));
  const sun = new THREE.DirectionalLight(0xffd3a3, 2.75);
  sun.position.set(15, 25, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 90 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const groundMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  groundMaterial.colorNode = mix(color(0x5d7645), color(0x899063),
    sin(positionLocal.x.mul(0.6)).mul(sin(positionLocal.z.mul(0.5))).mul(0.18).add(0.5));
  const groundGeometry = new THREE.PlaneGeometry(80, 80, 40, 40);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
  const assets = new AssetRegistry();
  const mixers: THREE.AnimationMixer[] = [];
  const drawn = new Set<number>();
  const markMeshes = (root: THREE.Object3D): void => {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.onAfterRender = () => { drawn.add(object.id); };
      if (object instanceof THREE.SkinnedMesh) state.skinnedMeshes++;
    });
  };
  const addCreature = async (id: string, x: number, z: number): Promise<THREE.Group> => {
    const source = await assets.load(id);
    const root = clone(source) as THREE.Group;
    root.position.set(x, -assets.baseY(id), z);
    const clip = assets.clipOf(id, 'Walk') ?? assets.clipsOf(id)[0];
    if (!clip) throw new Error(`POC creature has no animation: ${id}`);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixers.push(mixer);
    markMeshes(root);
    state.creatures++;
    state.assetIds.push(id);
    return root;
  };
  const addFoliage = async (id: string, count: number, radius: number): Promise<THREE.Group> => {
    const source = await assets.load(id);
    source.updateMatrixWorld(true);
    const root = new THREE.Group();
    const placement = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(object.geometry, object.material, count);
      for (let i = 0; i < count; i++) {
        const angle = ((i + 0.5) / count) * Math.PI * 1.6 + Math.PI * 0.2;
        // Leave the camera-to-creature corridor unobstructed.
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        placement.compose(new THREE.Vector3(x, -assets.baseY(id), z), q, scale);
        matrix.multiplyMatrices(placement, object.matrixWorld);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    });
    markMeshes(root);
    state.foliageInstances += count;
    state.assetIds.push(id);
    return root;
  };

  let streamed = false;
  const addContent = async (): Promise<PocState> => {
    if (!state.ready || state.pendingContent || streamed) return { ...state, assetIds: [...state.assetIds] };
    state.pendingContent = true;
    const start = performance.now();
    try {
      const group = new THREE.Group();
      group.add(await addCreature('fairy_garden_spriggle_gloamgarden', 2.5, -1));
      group.add(await addFoliage('tree_common_2', 8, 15));
      await renderer.compileAsync(group, camera, scene);
      scene.add(group);
      streamed = true;
    } catch (error) {
      state.error = String(error);
      throw error;
    } finally {
      state.pendingContent = false;
      state.streamedMs = performance.now() - start;
    }
    return { ...state, assetIds: [...state.assetIds] };
  };
  let stopped = false;
  const dispose = (): void => {
    stopped = true;
    void renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
  Object.assign(window, { __webgpuPoc: {
    getState: () => ({ ...state, assetIds: [...state.assetIds], assets: assets.getLoadStats() }),
    addContent,
    resetMeasurements: () => { state.maxFrameGapMs = 0; state.maxRenderCpuMs = 0; },
    dispose,
  } });
  try {
    await renderer.init();
    state.backend = 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend
      ? 'webgpu' : 'webgl2-fallback';
    await assets.loadManifest();
    scene.add(await addCreature('animal_deer', 0, 0));
    scene.add(await addFoliage('bush_common', 24, 9));
    scene.add(await addFoliage('tree_common_1', 6, 15));
    const compileStart = performance.now();
    await renderer.compileAsync(scene, camera);
    state.compileMs = performance.now() - compileStart;
    renderer.render(scene, camera);
    state.startupMs = performance.now() - began;
    state.ready = true;
    let previous = performance.now();
    await renderer.setAnimationLoop((now) => {
      if (stopped) return;
      const gap = now - previous;
      previous = now;
      state.maxFrameGapMs = Math.max(state.maxFrameGapMs, gap);
      const dt = Math.min(0.1, gap / 1000);
      for (const mixer of mixers) mixer.update(dt);
      state.animationSeconds += dt;
      const started = performance.now();
      renderer.render(scene, camera);
      state.maxRenderCpuMs = Math.max(state.maxRenderCpuMs, performance.now() - started);
      state.drawCalls = renderer.info.render.drawCalls;
      state.triangles = renderer.info.render.triangles;
      state.drawnMeshes = drawn.size;
      state.frames++;
    });
  } catch (error) {
    state.error = String(error);
    throw error;
  }
}
