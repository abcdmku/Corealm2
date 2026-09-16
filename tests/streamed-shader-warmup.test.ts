import * as THREE from "three";
import { expect, it } from "vitest";
import { StreamedShaderWarmup } from "../game/src/render/streamedShaderWarmup.js";

function fixture() {
  const scene = new THREE.Scene();
  let target: THREE.WebGLRenderTarget | null = null;
  const calls: { material: THREE.Material; linear: boolean }[] = [];
  const programs = [{ program: { ready: false }, getUniforms: () => ({}), getAttributes: () => ({}) }, { program: { ready: false }, getUniforms: () => ({}), getAttributes: () => ({}) }];
  const renderer = {
    initTexture: (_texture: THREE.Texture) => {},
    debug: { checkShaderErrors: true },
    info: { programs },
    getContext: () => ({ getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }), isProgram: () => true,
      getProgramParameter: (program: { ready: boolean }) => program.ready }),
    getRenderTarget: () => target,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => { target = value; },
    compile: (view: THREE.Object3D) => {
      view.traverse(object => { if (object instanceof THREE.Mesh) calls.push({ material: object.material as THREE.Material,
        linear: target !== null }); });
    },
  } as unknown as THREE.WebGLRenderer;
  const gate = new StreamedShaderWarmup(renderer, scene, new THREE.PerspectiveCamera());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  return { scene, calls, gate, mesh, renderer, programs };
}

it("keeps a replacement gameplay actor drawable while its shaders prepare", () => {
  const { scene, gate, mesh } = fixture();
  mesh.userData.entityId = "nearby-creature";
  scene.add(mesh);gate.prepare();
  expect(gate.getState().waiting).toBe(1);
  expect(mesh.visible).toBe(true);
  gate.restore();gate.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

it('defers the first draw of an actor with a retained sampled replacement', () => {
  const { scene, gate, mesh, programs } = fixture();
  mesh.userData.entityId = 'prepared-creature';
  mesh.userData.deferFirstDraw = true;
  scene.add(mesh); gate.prepare();
  expect(mesh.visible).toBe(false); expect(gate.hasPending(mesh)).toBe(true);
  gate.restore();
  for (const program of programs) program.program.ready = true;
  gate.prepare();
  expect(mesh.visible).toBe(true); expect(gate.hasPending(mesh)).toBe(false);
  gate.restore(); gate.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

it('avoids successful shader log queries and restores diagnostics after reflection fails', () => {
  const { scene, gate, mesh, renderer, programs } = fixture();
  scene.add(mesh); gate.prepare(); gate.restore();
  for (const program of programs) program.program.ready = true;
  programs[1]!.getUniforms = () => {
    expect(renderer.debug.checkShaderErrors).toBe(false);
    throw new Error('reflection failed');
  };
  try {
    expect(() => gate.prepare()).toThrow('reflection failed');
    expect(renderer.debug.checkShaderErrors).toBe(true);
  } finally { gate.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});

it("waits for every program, restores materials and visibility between frames", () => {
  const { scene, calls, gate, mesh, renderer, programs } = fixture();
  const material = mesh.material;
  scene.add(mesh);gate.prepare();
  expect(mesh.visible).toBe(false);
  expect(gate.hasPending(scene)).toBe(true);
  expect(gate.hasPending(new THREE.Group())).toBe(false);
  expect(mesh.material).toBe(material);
  expect(calls[0]!.material).not.toBe(material);
  expect(calls[1]!.linear).toBe(true);
  expect(renderer.getRenderTarget()).toBeNull();
  gate.restore();expect(mesh.visible).toBe(true);
  programs[1]!.program.ready = true;
  gate.prepare();expect(mesh.visible).toBe(false);gate.restore();
  programs[0]!.program.ready = true;
  gate.prepare();expect(mesh.visible).toBe(true);expect(gate.getState().waiting).toBe(0);
  expect(gate.hasPending(scene)).toBe(false);
  gate.dispose();mesh.geometry.dispose();material.dispose();
});

it("preserves requeued meshes until their new batch completes and cancels pending work on disposal", () => {
  const { scene, calls, gate, mesh, programs } = fixture();
  scene.add(mesh);gate.prepare();gate.restore();
  scene.remove(mesh);expect(gate.getState().waiting).toBe(0);
  scene.add(mesh);
  for (const program of programs) program.program.ready = true;
  gate.prepare();gate.restore();
  expect(gate.getState().waiting).toBe(1);
  expect(calls).toHaveLength(4);
  let disposed = false;calls[0]!.material.addEventListener("dispose", () => { disposed = true; });
  mesh.material.dispose();expect(disposed).toBe(false);
  gate.dispose();expect(disposed).toBe(true);
  gate.prepare();expect(mesh.visible).toBe(true);mesh.geometry.dispose();
});


it("prepares custom creature shadow materials with the production alpha and side settings", () => {
  const { scene, calls, gate, mesh } = fixture();
  mesh.castShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.customDepthMaterial.customProgramCacheKey = () => "sampled-skeleton-v2";
  mesh.material.alphaTest = 0.4;
  scene.add(mesh);gate.prepare();gate.restore();
  const shadow = calls.at(-1)!.material as THREE.MeshDepthMaterial;
  expect(shadow.isMeshDepthMaterial).toBe(true);
  expect(shadow.side).toBe(THREE.BackSide);
  expect(shadow.alphaTest).toBe(0.4);
  expect(shadow.customProgramCacheKey()).toBe("sampled-skeleton-v2");
  expect(mesh.material.isMeshStandardMaterial).toBe(true);
  gate.dispose();mesh.geometry.dispose();mesh.material.dispose();mesh.customDepthMaterial.dispose();
});

it("does not retain stale program handles after renderer caches are replaced", () => {
  const { scene, gate, mesh, renderer } = fixture();
  scene.add(mesh);gate.prepare();gate.restore();
  renderer.info.programs = [];
  gate.prepare();expect(mesh.visible).toBe(true);
  expect(gate.getState().waiting).toBe(0);
  gate.dispose();mesh.geometry.dispose();mesh.material.dispose();
});


it("uploads maps and custom palette textures in bounded batches before revealing scenery", () => {
  const { scene, gate, mesh, renderer, programs } = fixture();
  const textures = Array.from({ length: 5 }, () => new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const target = new THREE.WebGLRenderTarget(1, 1);
  mesh.material.map = textures[0]!;
  mesh.material.normalMap = textures[1]!;
  mesh.material.onBeforeCompile = shader => {
    shader.uniforms.palettes = { value: [textures[2], textures[3], textures[4], target.texture] };
  };
  const uploaded: THREE.Texture[] = [];
  renderer.initTexture = texture => { uploaded.push(texture); };
  renderer.compile = view => {
    view.traverse(object => {
      if (object instanceof THREE.Mesh) {
        (object.material as THREE.Material).onBeforeCompile({ uniforms: {} } as never, renderer);
      }
    });
    return new Set();
  };
  scene.add(mesh); gate.prepare(); gate.restore();
  expect(uploaded).toHaveLength(0);
  expect(gate.getState().textures).toBe(5);
  for (const program of programs) program.program.ready = true;
  for (let frame = 0; frame < 10 && gate.hasPending(scene); frame++) {
    const before = uploaded.length;
    gate.prepare();
    expect(uploaded.length - before).toBeLessThanOrEqual(2);
    if (uploaded.length < textures.length) expect(mesh.visible).toBe(false);
    gate.restore();
  }
  expect(new Set(uploaded)).toEqual(new Set(textures));
  expect(gate.hasPending(scene)).toBe(false);
  expect(mesh.visible).toBe(true);
  gate.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
  textures.forEach(texture => texture.dispose()); target.dispose();
});


it('reuses prepared map versions across batches and reuploads changed or disposed maps', () => {
  const { scene, gate, mesh, renderer, programs } = fixture();
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  mesh.material.map = texture;
  const uploaded: THREE.Texture[] = [];
  renderer.initTexture = value => { uploaded.push(value); };
  for (const program of programs) program.program.ready = true;
  const prepare = () => {
    scene.remove(mesh); scene.add(mesh);
    for (let frame = 0; frame < 10 && gate.hasPending(scene); frame++) {
      gate.prepare(); gate.restore();
    }
    expect(gate.hasPending(scene)).toBe(false);
  };
  prepare(); expect(uploaded).toHaveLength(1);
  prepare(); expect(uploaded).toHaveLength(1);
  texture.needsUpdate = true;
  prepare(); expect(uploaded).toHaveLength(2);
  texture.dispose();
  prepare(); expect(uploaded).toHaveLength(3);
  gate.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
});

it("prepares the source ShaderMaterial textures without uploading cloned uniform textures", () => {
  const { scene, gate, renderer, programs } = fixture();
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const material = new THREE.ShaderMaterial({ uniforms: { image: { value: texture } } });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const uploaded: THREE.Texture[] = [];
  renderer.initTexture = value => { uploaded.push(value); };
  renderer.compile = view => {
    view.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const compiled = object.material as THREE.ShaderMaterial;
        expect(compiled.uniforms.image!.value).toBe(texture);
        compiled.onBeforeCompile({ uniforms: compiled.uniforms } as never, renderer);
      }
    });
    return new Set();
  };
  scene.add(mesh); gate.prepare(); gate.restore();
  for (const program of programs) program.program.ready = true;
  gate.prepare(); gate.restore();
  expect(uploaded).toEqual([texture]);
  expect(gate.hasPending(scene)).toBe(false);
  gate.dispose(); mesh.geometry.dispose(); material.dispose(); texture.dispose();
});


it("keeps selection feedback visible while a streamed batch prepares", () => {
  const { scene, gate, mesh } = fixture();
  const marker = new THREE.Group();
  marker.userData.keepVisibleDuringWarmup = true;
  marker.add(mesh); scene.add(marker);
  gate.prepare();
  expect(gate.hasPending(marker)).toBe(true);
  expect(mesh.visible).toBe(true);
  gate.restore(); gate.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});
