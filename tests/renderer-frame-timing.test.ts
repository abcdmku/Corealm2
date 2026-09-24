import { expect, it } from "vitest";
import { Color } from "three";
import { Renderer } from "../game/src/render/renderer.js";

it("excludes an explicitly stopped interval from resumed frame-rate measurements", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    initialized: true, scene: { background: null }, frameTimes: [], lastFrameAt: 0, gpuTimer: null,
    framePacer: { ready: () => true, submit() {}, resetTiming() {} },
    transmissionOcclusion: { active: false },
    biomeAtmosphere: { updateEnvironment() {}, sky: { nightAmount: 0, magicAmount: 0 } },
    sun: { color: new Color(), intensity: 0 }, hemisphere: { intensity: 0 },
    daylightSun: new Color(), moonlight: new Color(), arcaneMoonlight: new Color(),
    camera: { updateMatrixWorld() {} },
    // Frame timing is the subject; the passes themselves have their own tests.
    drawFrame() {},
    renderer: { info: { reset() {}, render: { drawCalls: 2, triangles: 100 }, memory: { programs: 0 } } },
  }) as Renderer;
  renderer.render(100);
  renderer.render(116);
  expect(renderer.getStats().frameMs).toBe(16);
  renderer.resetFrameTiming();
  renderer.render(40_116);
  renderer.render(40_132);
  expect(renderer.getStats()).toMatchObject({ frameMs: 16, fps: 63, drawCalls: 2, triangles: 100 });
});
