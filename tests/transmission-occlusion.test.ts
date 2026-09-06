import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TransmissionOcclusion, transmissionProbeBounds, isTransmissionDepthOccluder } from "../game/src/render/transmissionOcclusion.js";

function fixture() {
  let available = false;
  const gl = { ANY_SAMPLES_PASSED: 1, CURRENT_QUERY: 2, QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, SAMPLES: 5,
    isContextLost: () => false, getParameter: () => 4, getQuery: () => null,
    createQuery: vi.fn(() => ({})), deleteQuery: vi.fn(), beginQuery: vi.fn(), endQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: unknown, parameter: number) => {
      if (parameter === 3) return available;
      if (!available) throw new Error("Blocking occlusion query read");
      return false;
    }) };
  const renderer = { getContext: () => gl, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1440, 900),
    getRenderTarget: () => null, getViewport: (v: THREE.Vector4) => v.set(0, 0, 1440, 900),
    getScissor: (v: THREE.Vector4) => v.set(0, 0, 1440, 900), getScissorTest: () => false,
    setRenderTarget: vi.fn(), setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(),
    autoClear: true, clear: vi.fn(), render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.onBeforeRender(renderer as unknown as THREE.WebGLRenderer, scene, camera, mesh.geometry, mesh.material as THREE.Material, null as never);
        mesh.onAfterRender(renderer as unknown as THREE.WebGLRenderer, scene, camera, mesh.geometry, mesh.material as THREE.Material, null as never);
      });
    }), info: { render: { triangles: 12 } } };
  const camera = new THREE.PerspectiveCamera(50, 1.6, .1, 200);
  camera.position.set(0, 2, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const terrain = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30)); ground.name = "terrain-chunk-0-0"; terrain.add(ground);
  const surface = new THREE.Mesh(new THREE.BoxGeometry(1, .1, 1), new THREE.MeshPhysicalMaterial({ transmission: .94 }));
  const probe = new TransmissionOcclusion();
  const update = () => probe.update(renderer as unknown as THREE.WebGLRenderer, camera, terrain, [surface]);
  return { probe, gl, renderer, camera, terrain, ground, surface, update, available: () => { available = true; } };
}

describe("conservative transmissive terrain occlusion", () => {
  it("deletes uncommitted queries and fails open when a native draw hook throws", () => {
    const f = fixture();
    const after = () => { throw new Error("native after hook failed"); };
    f.surface.onAfterRender = after;
    f.probe.setProbeMode("exact-diagnostic"); f.probe.setEnabled(true);
    expect(() => f.update()).not.toThrow();
    expect(f.gl.deleteQuery).toHaveBeenCalledOnce();
    expect(f.gl.endQuery).toHaveBeenCalledOnce();
    expect(f.surface.visible).toBe(true);
    expect(f.surface.material.transmission).toBe(.94);
    expect(f.surface.material.colorWrite).toBe(true);
    expect(f.surface.onAfterRender).toBe(after);
    expect(f.renderer.autoClear).toBe(true);
    expect(f.probe.active).toBe(false);
    expect(f.probe.snapshot().pendingQueries).toBe(0);
    expect(f.probe.snapshot().lastFailure).toBe("native after hook failed");
    f.update(); expect(f.gl.createQuery).toHaveBeenCalledOnce(); f.probe.dispose();
  });

  it("keeps native opaque alpha/depth behavior and rejects ineligible occluders", () => {
    const f = fixture();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ alphaTest: .5 }));
    expect(isTransmissionDepthOccluder(shell, f.camera)).toBe(true);
    shell.material.transparent = true; expect(isTransmissionDepthOccluder(shell, f.camera)).toBe(false);
    shell.material.transparent = false; shell.material.depthWrite = false;
    expect(isTransmissionDepthOccluder(shell, f.camera)).toBe(false);
    shell.material.depthWrite = true;
    const before = vi.fn(() => { expect(shell.material.colorWrite).toBe(false); expect(shell.material.alphaTest).toBe(.5); });
    shell.onBeforeRender = before;
    f.probe.setProbeMode("exact-diagnostic"); f.probe.setEnabled(true);
    const update = (revision: string) => f.probe.update(f.renderer as unknown as THREE.WebGLRenderer, f.camera, f.terrain, [f.surface], [{ mesh: shell, revision }]);
    update("a"); expect(before).toHaveBeenCalledOnce(); expect(shell.material.colorWrite).toBe(true);
    f.available(); update("a"); expect(f.gl.createQuery).toHaveBeenCalledTimes(1);
    update("b"); expect(f.gl.createQuery).toHaveBeenCalledTimes(2);
    expect(f.surface.visible).toBe(true); f.probe.dispose();
  });

  it("queries the original source with its hooks in diagnostic mode and restores material state", () => {
    const f = fixture();
    const material = f.surface.material;
    const before = vi.fn(() => {
      expect(material.transmission).toBe(0);
      expect(material.colorWrite).toBe(false);
      expect(material.depthWrite).toBe(false);
    });
    const after = vi.fn();
    f.surface.onBeforeRender = before; f.surface.onAfterRender = after;
    f.probe.setProbeMode("exact-diagnostic"); f.probe.setEnabled(true); f.update();
    expect(before).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledOnce();
    expect(f.surface.onBeforeRender).toBe(before); expect(f.surface.onAfterRender).toBe(after);
    expect(material.transmission).toBe(.94); expect(material.colorWrite).toBe(true); expect(material.depthWrite).toBe(true);
    expect(f.renderer.render.mock.calls.some(([object]) => object === (f.surface as unknown))).toBe(true);
    f.available(); f.update();
    expect(f.probe.snapshot().probes[0]?.hidden).toBe(true);
    expect(f.surface.visible).toBe(true);
    f.camera.position.x += 1; f.camera.updateMatrixWorld(); f.update();
    expect(f.gl.createQuery).toHaveBeenCalledTimes(2);
    expect(f.surface.visible).toBe(true); f.probe.dispose();
  });

  it("does nothing by default and keeps uncertain query results visible", () => {
    const f = fixture(); f.update(); expect(f.gl.createQuery).not.toHaveBeenCalled();
    f.probe.setEnabled(true); f.update(); f.update();
    expect(f.surface.visible).toBe(true);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(1);
    expect(f.probe.snapshot().pendingQueries).toBe(1);
    expect(f.renderer.autoClear).toBe(true);
    f.probe.dispose();
  });

  it("hides only a completed negative query and restores immediately when the camera moves", () => {
    const f = fixture(); f.probe.setEnabled(true); f.update(); f.available(); f.update();
    expect(f.surface.visible).toBe(false);
    f.camera.position.x += .01; f.camera.updateMatrixWorld(); f.update();
    expect(f.surface.visible).toBe(true);
    expect(f.gl.createQuery).toHaveBeenCalledTimes(2);
    f.update(); expect(f.surface.visible).toBe(false);
    f.probe.setEnabled(false); expect(f.surface.visible).toBe(true);
    f.probe.dispose();
  });

  it("invalidates on terrain or target changes and never hides shadow casters or near-plane boxes", () => {
    const f = fixture(); f.probe.setEnabled(true); f.update(); f.available(); f.update();
    f.ground.geometry.getAttribute("position").needsUpdate = true; f.update();
    expect(f.surface.visible).toBe(true);
    f.update(); expect(f.surface.visible).toBe(false);
    f.surface.position.x += .1; f.update(); expect(f.surface.visible).toBe(true);
    f.surface.castShadow = true; f.update(); expect(f.surface.visible).toBe(true);
    expect(f.probe.snapshot().pendingQueries).toBe(0);
    f.surface.castShadow = false; f.surface.position.copy(f.camera.position); f.update();
    expect(f.probe.snapshot().pendingQueries).toBe(0);
    f.probe.dispose();
  });

  it("does not revive deliberately invisible surfaces", () => {
    const f = fixture(); f.surface.visible = false; f.probe.setEnabled(true); f.update();
    f.probe.setEnabled(false); expect(f.surface.visible).toBe(false);
    expect(f.gl.createQuery).not.toHaveBeenCalled(); f.probe.dispose();
  });

  it("pads the complete geometric bounds instead of testing sampled corner rays", () => {
    const f = fixture();
    const source = new THREE.Box3(new THREE.Vector3(-1, -.1, -1), new THREE.Vector3(1, .1, 1));
    const padded = transmissionProbeBounds(source, f.camera, 900);
    expect(padded.containsBox(source)).toBe(true);
    expect(padded.min.x).toBeLessThan(source.min.x);
    expect(source.min.toArray()).toEqual([-1, -.1, -1]);
    f.probe.dispose();
  });
});
