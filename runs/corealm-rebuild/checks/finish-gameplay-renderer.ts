import assert from "node:assert/strict";
import type { Page } from "playwright";

export const GAMEPLAY_HARDWARE_ARGS = [
  "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
];

/** Launch flags are a request; the live WebGL renderer identifies what actually rendered. */
export async function assertGameplayHardware(page: Page): Promise<string> {
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  assert(typeof renderer === "string" && /D3D11|Direct3D11/i.test(renderer)
    && !/SwiftShader|llvmpipe|software/i.test(renderer), `Hardware D3D11 required; actual renderer: ${renderer}`);
  return renderer;
}
