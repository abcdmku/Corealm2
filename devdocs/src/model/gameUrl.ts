/** Game assets use document base in the guide, and the shared public root in local development. */
export function gameUrl(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) throw new Error("Game asset paths must be relative");
  return new URL(path.replace(/^\/+/, ""), document.baseURI).href;
}
