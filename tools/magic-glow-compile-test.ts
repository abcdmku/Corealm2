/** Real WebGL shader-key regression; visual and interaction proof lives in the spell lab. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const clear = installTestDeadline('Glow compilation', 60_000);
const server = await startGameServer();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/glow-probe', route => route.fulfill({
    contentType: 'text/html', body: '<canvas id="viewport"></canvas>',
  }));
  await page.goto(`${server.url}/glow-probe`);
  const result = await page.evaluate(async (threePath) => {
    const modulePath = '/src/render/renderer.ts';
    const { Renderer } = await import(modulePath);
    const renderer = new Renderer(document.querySelector('canvas'));
    const effectsPath='/src/render/vfx.ts';
    const {Ambience}=await import(effectsPath);
    const ambience=new Ambience(renderer.scene);
    const THREE=await import(threePath);
    try {
      renderer.scene.background = null;
      renderer.playerSilhouette.source = renderer.scene;
      renderer.compileEffects(ambience.preparationRoot());
      const prepared = new Set(renderer.renderer.info.programs.map((p: any) => p.cacheKey));
      renderer.magicGlow.prepare(renderer.renderer, renderer.scene, renderer.camera);
      ambience.burst('dust',[0,0.02,0],2,0);ambience.burst('spark',[0,0,0],3,0);
      ambience.update(100,new THREE.Vector3());
      renderer.drawFrame();
      await renderer.waitForFrame();
      const added=renderer.renderer.info.programs.filter((p: any) => !prepared.has(p.cacheKey)).map((p: any) => p.name);
      const gl=renderer.renderer.getContext(), getParameter=gl.getParameter.bind(gl);
      let unpackQueries=0;
      const unpack=[gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS];
      gl.getParameter=(parameter:number)=>{if(unpack.includes(parameter))unpackQueries++;return getParameter(parameter);};
      const texture=new THREE.DataTexture(new Uint8Array(4*4*4),4,4);
      try {
        texture.needsUpdate=true;renderer.renderer.initTexture(texture);
        texture.image.data.fill(255,16,32);texture.addUpdateRange(16,16);
        texture.needsUpdate=true;renderer.renderer.initTexture(texture);
      } finally { texture.dispose();gl.getParameter=getParameter; }
      return { prepared: prepared.size, added, particles:ambience.liveParticles(), unpackQueries, unpackValues:unpack.map(getParameter) };
    } finally { ambience.dispose();renderer.dispose(); }
  },'/@fs/'+path.resolve('node_modules/three/build/three.module.js').replaceAll('\\','/'));
  assert.ok(result.prepared >= 12);
  assert.deepEqual(result.added, [], 'The first postprocessed frame must reuse the submitted shaders');
  assert.equal(result.particles,5,'Both initially hidden particle batches must be exercised');
  assert.equal(result.unpackQueries,0,'Partial animation texture uploads must not synchronously query the GPU');
  assert.deepEqual(result.unpackValues,[0,0,0],'Partial uploads restore texture unpack defaults');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); await server.close(); clear(); }
