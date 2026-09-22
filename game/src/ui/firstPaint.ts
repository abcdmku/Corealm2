/** Let the HUD's first raster work run before filling the shared GPU queue with game shaders. */
export async function prepareUiFirstPaint(root: HTMLElement): Promise<{ images: number; timedOut: boolean }> {
  const images = [...root.querySelectorAll<HTMLImageElement>('img')];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // Decorative artwork or a font host must not hold startup indefinitely.
  const timedOut = await Promise.race([
    Promise.all([
      ...images.map(image => image.decode().catch(() => {})),
      root.ownerDocument.fonts.ready,
    ]).then(() => false),
    new Promise<true>(resolve => { timeout = setTimeout(() => resolve(true), 2000); }),
  ]);
  clearTimeout(timeout);
  // A RAF callback runs before paint. Cross two frames and a task, rather than starting
  // shader compilation in the same callback that first makes the decoded icons drawable.
  await new Promise<void>(resolve => requestAnimationFrame(() =>
    requestAnimationFrame(() => { setTimeout(resolve, 0); })));
  return { images: images.length, timedOut };
}
