import type { Page } from "playwright";

/** Reads the already-created game context; a missing identity cannot pass a hardware benchmark. */
export async function assertPerformanceHardware(page: Page) {
  const hardware = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
    const gl = canvas?.getContext("webgl2");
    if (!gl) return null;
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null,
      vendor: extension ? String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)) : null,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      contextLost: gl.isContextLost() };
  });
  if (!hardware?.renderer || hardware.contextLost) throw new Error(`Hardware identity unavailable: ${JSON.stringify(hardware)}`);
  if (/swiftshader|software|llvmpipe|basic render/i.test(hardware.renderer)) throw new Error(`Software renderer rejected: ${hardware.renderer}`);
  return hardware;
}
