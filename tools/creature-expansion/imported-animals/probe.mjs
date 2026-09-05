import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const id = process.argv[2] ?? 'quarry_snail';
const destination = path.resolve('test-results/creature-expansion/imported-animals');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', error => console.error(error.message));
await page.goto('http://127.0.0.1:59099/tools/creature-expansion/convert.html');
const report = await page.evaluate(async id => {
  const THREE = await import('three');
  const { buildSpecies } = await import('/tools/creature-expansion/imported-animals.mjs');
  const built = await buildSpecies(id);
  document.body.replaceChildren();
  document.body.style.margin = '0';
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#8c9caa');
  scene.add(built.object);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1100, 800); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  document.body.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xc9e1ff, 0x565039, 2.2));
  const light = new THREE.DirectionalLight(0xffefdc, 3.5); light.position.set(3, 6, 5); scene.add(light);
  const box = new THREE.Box3().setFromObject(built.object);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.MeshStandardMaterial({ color: 0x677664, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = box.min.y; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(34, 1100 / 800, 0.001, 100);
  const fitCamera = direction => {
    const viewDirection = new THREE.Vector3(...direction).normalize();
    let distance = span * 2.8;
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    for (let attempt = 0; attempt < 4; attempt++) {
      camera.position.copy(center).addScaledVector(viewDirection, distance); camera.lookAt(center); camera.updateMatrixWorld(true);
      const projected = corners.map(point => point.clone().project(camera));
      const occupied = Math.max(...projected.map(point => Math.max(Math.abs(point.x) / .83, Math.abs(point.y) / .82)));
      distance *= THREE.MathUtils.clamp(occupied, .65, 1.5);
    }
    camera.position.copy(center).addScaledVector(viewDirection, distance); camera.lookAt(center); camera.updateMatrixWorld(true);
  };
  fitCamera([1.7, .8, 1.4]);
  const mixer = new THREE.AnimationMixer(built.object);
  window.assetPose = (name, normalized) => {
    mixer.stopAllAction();
    const clip = built.clips.find(clip => clip.name === name);
    const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    mixer.setTime(Math.min(clip.duration - 0.000001, clip.duration * normalized));
    built.object.updateMatrixWorld(true); renderer.render(scene, camera);
  };
  window.assetView = direction => { fitCamera(direction); renderer.render(scene, camera); };
  window.assetClay = () => {
    built.object.traverse(node => {
      if (!node.isMesh) return;
      node.material = new THREE.MeshStandardMaterial({ color: 0xb8a38e, roughness: .68, side: THREE.DoubleSide });
    });
    renderer.render(scene, camera);
  };
  window.assetPose('Idle', 0);
  const support = id === 'quarry_snail' ? ['Snail_RigidShell'] : built.meta.gaitFootBones;
  const supportReport = {};
  for (const name of ['Attack', 'Hit', 'HitLeft', 'HitRight']) {
    window.assetPose('Idle', 0);
    const initial = support.map(name => built.object.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
    let maxTravel = 0;
    for (let i = 0; i <= 30; i++) {
      window.assetPose(name, i / 30);
      for (let b = 0; b < support.length; b++) maxTravel = Math.max(maxTravel, built.object.getObjectByName(support[b]).getWorldPosition(new THREE.Vector3()).distanceTo(initial[b]));
    }
    supportReport[name] = maxTravel;
  }
  window.assetPose('Idle', 0);
  return { id, meta: built.meta, clips: built.clips.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })), size: size.toArray(), supportTravelM: supportReport };
}, id);
console.log(JSON.stringify(report, null, 2));
await writeFile(path.join(destination, `${id}.json`), JSON.stringify(report, null, 2));
for (const [clip, time] of [['Idle', 0], ['Attack', report.meta.contactNormalized], ['HitLeft', .2], ['Run', .35]]) {
  await page.evaluate(([clip, time]) => window.assetPose(clip, time), [clip, time]);
  await page.screenshot({ path: path.join(destination, `${id}-${clip}.png`) });
}
await page.evaluate(() => window.assetPose('Idle', 0));
for (const [label, direction] of [['Left', [-2.2, .5, .5]], ['Right', [2.2, .5, .5]]]) {
  await page.evaluate(direction => window.assetView(direction), direction);
  await page.screenshot({ path: path.join(destination, `${id}-${label}.png`) });
}
if (id === 'quarry_snail') {
  await page.evaluate(() => { window.assetView([-2.2, .5, .5]); window.assetClay(); });
  await page.screenshot({ path: path.join(destination, `${id}-ClayLeft.png`) });
}
await browser.close();
