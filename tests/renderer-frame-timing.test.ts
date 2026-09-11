import { expect, it } from "vitest";
import { Color } from "three";
import { Renderer } from "../game/src/render/renderer.js";

it("excludes an explicitly stopped interval from resumed frame-rate measurements", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene: { background: null }, frameTimes: [], lastFrameAt: 0, gpuTimer: null,
    transmissionOcclusion: { active: false },
    playerSilhouette: { render() {} },
    elementalRefraction: { render() {} },
    biomeAtmosphere: { render() {}, updateEnvironment() {}, sky: { nightAmount: 0, magicAmount: 0 } },
    magicGlow: { render() {}, renderBase(renderer: { render(): void }) { renderer.render(); } },
    sun: { color: new Color(), intensity: 0 }, hemisphere: { intensity: 0 },
    daylightSun: new Color(), moonlight: new Color(), arcaneMoonlight: new Color(),
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
