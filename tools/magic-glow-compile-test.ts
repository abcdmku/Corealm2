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
const scenery = args.includes('--scenery');
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
  const result = await page.evaluate(async ({ threePath, scenery }) => {
    const THREE = await import(threePath);
    const glowPath = '/src/render/magicGlow.ts';
    const shaderPath = '/src/render/shaderPreparation.ts';
    const namesPath = '/src/render/stableNodeBuilder.ts';
    const completionPath = '/src/render/framePacer.ts';
    const sharedGeometryPath = '/src/render/sharedGeometryBuffers.ts';
    const sharedGeometry = scenery ? await import(sharedGeometryPath) : null;
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
      sharedGeometry?.installSharedGeometryBuffers(gpu);
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
      const probeScenery = async () => {
        const modulePath = '/src/render/sceneryInstances.ts';
        const { SceneryInstances } = await import(modulePath);
        const sceneryScene = new THREE.Scene();
        sceneryScene.background = new THREE.Color(0);
        const view = new THREE.OrthographicCamera(-3, 3, 2, -2, .1, 20);
        view.position.z = 5; view.lookAt(0, 0, 0); view.updateMatrixWorld();
        const sourceGeometry = new THREE.PlaneGeometry(.6, .6);
        const sourceMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
        const first = new SceneryInstances(sourceGeometry, sourceMaterial, 2, { colors: true });
        const second = new SceneryInstances(sourceGeometry, sourceMaterial, 5, { colors: true });
        first.name = 'scenery-two'; second.name = 'scenery-five';
        const matrix = new THREE.Matrix4();
        const place = (cluster: any, index: number, x: number, y: number, color: number): void => {
          cluster.setMatrixAt(index, matrix.makeTranslation(x, y, 0));
          cluster.setColorAt(index, new THREE.Color(color));
        };
        place(first, 0, -2, 0, 0xff0000); place(first, 1, -1, 0, 0x0000ff);
        place(second, 0, .5, 0, 0x00ff00); place(second, 1, 1.5, 0, 0xffff00); place(second, 2, 2.5, 0, 0xff00ff);
        const publish = (cluster: any, count: number): void => {
          cluster.instanceCount = count;
          cluster.instanceTransforms.needsUpdate = true;
          cluster.instanceColors.needsUpdate = true;
          cluster.computeBoundingBox(); cluster.computeBoundingSphere();
        };
        publish(first, 2); publish(second, 3);
        sceneryScene.add(first, second);
        const submitted = new Map<any, { nodeState: unknown; cacheKey: unknown; transformBuffer: unknown; colorBuffer: unknown }>();
        const nativeDraw = gpu.backend.draw;
        gpu.backend.draw = function (object: any, ...rest: any[]) {
          nativeDraw.call(this, object, ...rest);
          const mesh = object.object;
          if (mesh !== first && mesh !== second) return;
          submitted.set(mesh, { nodeState: object.getNodeBuilderState(), cacheKey: object.getCacheKey(),
            transformBuffer: this.get(mesh.instanceTransforms).buffer, colorBuffer: this.get(mesh.instanceColors).buffer });
        };
        const readFrame = async () => {
          gpu.setRenderTarget(target);
          await validateGraphicsWork(gpu, 'Scenery native frame', async () => {
            gpu.render(sceneryScene, view); await complete();
          });
          const raw = await gpu.readRenderTargetPixelsAsync(target, 0, 0, size, size);
          return Float32Array.from(raw as Uint16Array, value => THREE.DataUtils.fromHalfFloat(value));
        };
        const sample = (data: Float32Array, x: number, y: number): number[] => {
          const px = Math.floor((x + 3) / 6 * size), py = Math.floor((2 - y) / 4 * size);
          const start = (py * size + px) * 4;
          return Array.from(data.slice(start, start + 3));
        };
        let firstDisposed = false;
        let secondDisposed = false;
        let replacement: any = null;
        try {
          gpu.setRenderTarget(target);
          await validateGraphicsWork(gpu, 'Scenery native preparation', () => gpu.compileAsync(sceneryScene, view));
          const before = await readFrame();
          const a = submitted.get(first), b = submitted.get(second);
          const sharing = {
            submittedClusters: submitted.size,
            nodeStateShared: Boolean(a?.nodeState && a.nodeState === b?.nodeState),
            cacheKeyShared: Boolean(a && b && a.cacheKey === b.cacheKey),
            independentTransformBuffers: Boolean(a?.transformBuffer && b?.transformBuffer && a.transformBuffer !== b.transformBuffer),
            independentColorBuffers: Boolean(a?.colorBuffer && b?.colorBuffer && a.colorBuffer !== b.colorBuffer),
          };
          sceneryScene.remove(first); first.dispose(); firstDisposed = true;
          const afterDispose = await readFrame();
          place(second, 0, .5, .8, 0x00ffff); publish(second, 3);
          const afterUpdate = await readFrame();
          sceneryScene.remove(second); second.dispose(); secondDisposed = true;
          replacement = new SceneryInstances(sourceGeometry, sourceMaterial, 1, { colors: true });
          place(replacement, 0, -2, 0, 0xff0000); publish(replacement, 1);
          sceneryScene.add(replacement);
          await validateGraphicsWork(gpu, 'Recreated scenery preparation', () => gpu.compileAsync(sceneryScene, view));
          const afterRecreate = await readFrame();
          return { ...sharing, capacities: [2, 5], counts: [2, 3],
            before: { red: sample(before, -2, 0), blue: sample(before, -1, 0), green: sample(before, .5, 0),
              yellow: sample(before, 1.5, 0), magenta: sample(before, 2.5, 0), unused: sample(before, 0, 0) },
            afterDispose: { removed: sample(afterDispose, -2, 0), surviving: sample(afterDispose, .5, 0) },
            afterUpdate: { oldPosition: sample(afterUpdate, .5, 0), movedCyan: sample(afterUpdate, .5, .8),
              otherInstance: sample(afterUpdate, 1.5, 0) },
            afterRecreate: { recreated: sample(afterRecreate, -2, 0), removed: sample(afterRecreate, 1.5, 0) } };
        } finally {
          gpu.backend.draw = nativeDraw;
          if (!firstDisposed) first.dispose();
          if (!secondDisposed) second.dispose();
          replacement?.dispose(); sourceGeometry.dispose(); sourceMaterial.dispose();
        }
      };
      const sceneryResult = scenery ? await probeScenery() : null;
      await waitForGraphicsValidation(gpu);
      return { backend: 'webgpu', ordinaryObjects: ordinaryIds.size, preparedOrdinary, preparedEmitter,
        compiledObjects: compiled.size, selectedPreparationMs, visible: compare(visibleBase, visibleGlow, true),
        occluded: compare(occludedBase, occludedGlow, false), visibleState,
        scenery: sceneryResult, validation: graphicsValidationState(gpu), programs: gpu.info.memory.programs };
    } finally {
      unregister(); complete.dispose?.(); glow.dispose(); target.dispose();
      emitter.geometry.dispose(); emission.dispose(); wall.geometry.dispose(); wall.material.dispose();
      ordinaryGeometry.dispose(); ordinaryMaterial.dispose(); disposeGraphicsValidation(gpu); gpu.dispose();
    }
  }, { threePath, scenery });
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
  if (scenery) {
    const proof = result.scenery;
    assert.ok(proof, 'Scenery proof must run when requested');
    assert.equal(proof.submittedClusters, 2);
    assert.ok(proof.nodeStateShared && proof.cacheKeyShared, 'Different cluster capacities must share the actual native node-builder state/cache');
    assert.ok(proof.independentTransformBuffers && proof.independentColorBuffers, 'Shared graphs must bind distinct native instance buffers');
    const colorMatches = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) < .02);
    for (const [name, expected] of Object.entries({ red: [1, 0, 0], blue: [0, 0, 1], green: [0, 1, 0],
      yellow: [1, 1, 0], magenta: [1, 0, 1], unused: [0, 0, 0] })) {
      assert.ok(colorMatches(proof.before[name as keyof typeof proof.before], expected), `${name} instance must draw at its own transform with its own color`);
    }
    assert.ok(colorMatches(proof.afterDispose.removed, [0, 0, 0]) && colorMatches(proof.afterDispose.surviving, [0, 1, 0]),
      'Disposing one cluster must leave the other native buffers drawing');
    assert.ok(colorMatches(proof.afterUpdate.oldPosition, [0, 0, 0]) && colorMatches(proof.afterUpdate.movedCyan, [0, 1, 1])
      && colorMatches(proof.afterUpdate.otherInstance, [1, 1, 0]), 'Remaining transforms and colors must still update independently after disposal');
    assert.ok(colorMatches(proof.afterRecreate.recreated, [1, 0, 0]) && colorMatches(proof.afterRecreate.removed, [0, 0, 0]),
      'After every cluster is disposed, unchanged CPU source geometry must support a fresh cluster');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, channel: channel ?? 'chromium', browserVersion: browser.version() }));
} finally { await browser.close(); await server.close(); clear(); }
