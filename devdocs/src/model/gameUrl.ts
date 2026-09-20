import { backend } from "../api/backend.js";

/**
 * Where a game asset lives. The guide and the local editor both serve them beside the page, so the
 * document base answers. A live game server serves no assets at all: its worlds name an asset host,
 * and models, icons, map tiles and audio all come from there.
 */
export function gameUrl(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) throw new Error("Game asset paths must be relative");
  const relative = path.replace(/^\/+/, "");
  const base = backend().assetBaseUrl;
  return new URL(relative, base ? base.replace(/\/*$/, "/") : document.baseURI).href;
}
