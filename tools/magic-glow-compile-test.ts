/** Native GPU correctness probe; normal gameplay and spell art acceptance stay in the feature lab. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};
const url = option('--url'), channel = option('--channel');
const clear = installTestDeadline('Glow compilation', 60_000);
const server = url ? { url, close: async () => {} } : await startGameServer();
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}),
  args: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 192, height: 192 } });
  await page.addInitScript('window.__name = (fn) => fn');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const source = await page.request.get(`${server.url}/src/render/magicGlow.ts`);
  assert.ok(source.ok() && /javascript/.test(source.headers()['content-type'] ?? ''),
    '--url must point to the existing Vite source server; a production preview cannot serve this narrow module probe');
  // Use Vite's exact Three module instance: mixing a raw build with optimized TSL creates two node stacks.
  const threePath = (await source.text()).match(/import\s+\*\s+as\s+THREE\s+from\s+["']([^"']+)["']/)?.[1];
  assert.ok(threePath, 'The production glow module must expose its resolved Three import');
  await page.route('**/glow-probe', route => route.fulfill({
    contentType: 'text/html', body: '<style>body{margin:0}canvas{width:192px;height:192px}</style><canvas id="viewport"></canvas>',
  }));
  await page.goto(`${server.url}/glow-probe`);
  const result = await page.evaluate(async (threePath) => {
    const THREE = await import(threePath);
    const glowPath = '/src/render/magicGlow.ts';
    const shaderPath = '/src/render/shaderPreparation.ts';
    const namesPath = '/src/render/stableNodeBuilder.ts';
    const completionPath = '/src/render/framePacer.ts';
    const { MagicGlow, registerMagicGlow, isolateMagicEmission } = await import(glowPath);
    const { installGraphicsValidation, validateGraphicsWork, waitForGraphicsValidation,
      graphicsValidationState, disposeGraphicsValidation } = await import(shaderPath);
    const { installStableShaderNames } = await import(namesPath);
    const { createGpuCompletion } = await import(completionPath);
    const gpu = new THREE.WebGPURenderer({ canvas: document.querySelector('canvas'), antialias: true, stencil: true });
    const glow = new MagicGlow();
    const size = 192;
    // Match production's main-frame color, depth/stencil and per-sample coverage attachment.
    const target = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 4 });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    const camera = new THREE.PerspectiveCamera(55, 1, .1, 30);
    camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const emission = new THREE.MeshStandardNodeMaterial({ color: 0x080808, emissive: 0xff6611, emissiveIntensity: 8 });
    isolateMagicEmission(emission);
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(.35, 16, 12), emission);
    emitter.name = 'probe-emitter'; emitter.userData.magicGlow = true;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 5, .5), new THREE.MeshBasicNodeMaterial({ color: 0x303030 }));
    wall.name = 'opaque-world-wall'; wall.position.z = 1;
    scene.add(emitter, wall);
    const unregister = registerMagicGlow(emitter);
    const ordinary = new THREE.Group();
    const ordinaryGeometry = new THREE.BoxGeometry(.1, .1, .1);
    const ordinaryMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x445544 });
    const ordinaryIds = new Set<number>();
    for (let i = 0; i < 2048; i++) {
      const mesh = new THREE.Mesh(ordinaryGeometry, ordinaryMaterial);
      mesh.position.set((i % 64) * .2 - 6.4, Math.floor(i / 64) * .2 - 3.2, -2);
      ordinary.add(mesh); ordinaryIds.add(mesh.id);
    }
    let complete: (() => Promise<void>) & { dispose?(): void } = async () => {};
    try {
      await gpu.init();
      if (!gpu.backend.isWebGPUBackend) throw new Error('Glow probe requires the native WebGPU backend');
      installStableShaderNames(gpu); installGraphicsValidation(gpu);
      complete = createGpuCompletion(gpu);
      gpu.setPixelRatio(1); gpu.setSize(size, size, false);
      gpu.toneMapping = THREE.NoToneMapping;
      gpu.info.autoReset = false;
      gpu.setRenderTarget(target);
      await validateGraphicsWork(gpu, 'Glow postprocess preparation', () => glow.compile(gpu, target));
      scene.add(ordinary);
      const compiled = new Set<number>();
      const originalCompile = gpu.compileAsync;
      gpu.compileAsync = function (view: any, ...rest: any[]) {
        view.traverse((object: any) => { if (object.isMesh) compiled.add(object.id); });
        return originalCompile.call(this, view, ...rest);
      };
      const prepareStarted = performance.now();
      try { await glow.compileOcclusion(gpu, scene, camera); }
      finally { gpu.compileAsync = originalCompile; scene.remove(ordinary); }
      const selectedPreparationMs = performance.now() - prepareStarted;
      const preparedOrdinary = [...compiled].filter(id => ordinaryIds.has(id)).length;
      const preparedEmitter = compiled.has(emitter.id);
      await validateGraphicsWork(gpu, 'Probe scene preparation', () => gpu.compileAsync(scene, camera));
      await validateGraphicsWork(gpu, 'Probe glow preparation', () => glow.prepare(gpu, scene, camera, target));
      await complete();
      const pixels = async (occluded: boolean, enabled: boolean): Promise<Float32Array> => {
        wall.visible = occluded; glow.enabled = enabled;
        gpu.setRenderTarget(target);
        await validateGraphicsWork(gpu, 'Probe frame', async () => {
          glow.renderBase(gpu, scene, camera);
          glow.render(gpu, scene, camera);
          await complete();
        });
        // Actual native texture readback is asynchronous; never query a GL context or infer pixels from scene objects.
        const raw = await gpu.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        return Float32Array.from(raw as Uint16Array, value => THREE.DataUtils.fromHalfFloat(value));
      };
      const visibleBase = await pixels(false, false);
      const visibleGlow = await pixels(false, true);
      const visibleState = glow.snapshot();
      const occludedBase = await pixels(true, false);
      const occludedGlow = await pixels(true, true);
      const compare = (base: Float32Array, lit: Float32Array, excludeCore: boolean) => {
        let samples = 0, changedPixels = 0, meanAbs = 0, positive = 0, peak = 0;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          if (excludeCore && Math.hypot(x - size / 2, y - size / 2) < 18) continue;
          let difference = 0;
          for (let component = 0; component < 3; component++) {
            const offset = (y * size + x) * 4 + component;
            const delta = lit[offset]! - base[offset]!;
            if (!Number.isFinite(delta)) throw new Error('Native pixel readback contained non-finite values');
            meanAbs += Math.abs(delta); positive += Math.max(0, delta);
            difference = Math.max(difference, Math.abs(delta)); peak = Math.max(peak, Math.abs(delta)); samples++;
          }
          if (difference > .002) changedPixels++;
        }
        return { samples, changedPixels, meanAbs: meanAbs / samples, positive: positive / samples, peak };
      };
      await waitForGraphicsValidation(gpu);
      return { backend: 'webgpu', ordinaryObjects: ordinaryIds.size, preparedOrdinary, preparedEmitter,
        compiledObjects: compiled.size, selectedPreparationMs, visible: compare(visibleBase, visibleGlow, true),
        occluded: compare(occludedBase, occludedGlow, false), visibleState,
        validation: graphicsValidationState(gpu), programs: gpu.info.memory.programs };
    } finally {
      unregister(); complete.dispose?.(); glow.dispose(); target.dispose();
      emitter.geometry.dispose(); emission.dispose(); wall.geometry.dispose(); wall.material.dispose();
      ordinaryGeometry.dispose(); ordinaryMaterial.dispose(); disposeGraphicsValidation(gpu); gpu.dispose();
    }
  }, threePath);
  console.log(JSON.stringify({ ...result, errors }));
  assert.equal(result.backend, 'webgpu');
  assert.equal(result.preparedEmitter, true, 'Native glow preparation must include the selected emitter');
  assert.equal(result.preparedOrdinary, 0, 'Glow must not compile the 2,048 ordinary world objects again');
  assert.equal(result.compiledObjects, 1, 'Selected-only preparation must not clone the world wall either');
  assert.ok(result.visibleState.rendered && result.visibleState.activeMeshes === 1);
  assert.ok(result.visible.changedPixels > 24 && result.visible.positive > .00001,
    'A visible emitter must add a measurable halo outside its own geometry');
  assert.ok(result.occluded.meanAbs < .00001 && result.occluded.peak < .001,
    'Opaque world depth must suppress glow from a fully hidden emitter');
  assert.equal(result.validation.failed, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, channel: channel ?? 'chromium', browserVersion: browser.version() }));
} finally { await browser.close(); await server.close(); clear(); }
