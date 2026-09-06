import { expect, it } from "vitest";
import { Renderer } from "../game/src/render/renderer.js";

it("excludes an explicitly stopped interval from resumed frame-rate measurements", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene: { background: null }, frameTimes: [], lastFrameAt: 0, gpuTimer: null,
    transmissionOcclusion: { active: false },
    playerSilhouette: { render() {} },
    biomeAtmosphere: { render() {}, updateEnvironment() {} },
    screenAntialiasing: { render() {} },
    camera: { updateMatrixWorld() {} },
    renderer: { getContext: () => ({}), render() {}, info: { render: { calls: 2, triangles: 100 }, programs: [] } },
  }) as Renderer;
  renderer.render(100);
  renderer.render(116);
  expect(renderer.getStats().frameMs).toBe(16);
  renderer.resetFrameTiming();
  renderer.render(40_116);
  renderer.render(40_132);
  expect(renderer.getStats()).toMatchObject({ frameMs: 16, fps: 63, drawCalls: 2, triangles: 100 });
});
