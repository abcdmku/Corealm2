import assert from "node:assert/strict";
import type { Page } from "playwright";

export async function verifyEquipmentHardware(page: Page): Promise<string> {
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  assert(renderer && /D3D11|Direct3D11/i.test(renderer) && !/swiftshader|llvmpipe|software|basic render/i.test(renderer), `Hardware D3D11 required: ${renderer}`);
  return renderer;
}
