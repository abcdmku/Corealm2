import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { devdocsPlugin } from "./server/plugin.js";

const here = fileURLToPath(new URL(".", import.meta.url));

function htmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function playerBasePlugin(): Plugin {
  const gameBase = process.env.GAME_BASE?.trim() || "/";
  if (!gameBase.startsWith("/") || /[\"'<>]/.test(gameBase)) {
    throw new Error(`GAME_BASE must be a root-relative path: ${gameBase}`);
  }
  const href = `${gameBase.replace(/\/+$/, "")}/`;
  return {
    name: "corealm-player-base",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/<head>/i, `<head><base href="${htmlAttribute(href)}">`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: here,
  // The game lab runs concurrently. Its optimizer must not replace the editor's dependency cache.
  cacheDir: fileURLToPath(new URL(`../node_modules/.vite-devdocs-${mode}`, import.meta.url)),
  // The guide is staged under `<game-base>/docs/`, while game assets remain under `<game-base>/`.
  // Absolute docs URLs work in Pages builds; local builds keep Vite's relative default.
  // The server-mode build is served at `/admin/` by a game server and from the root by a static
  // host, so its URLs stay relative and it never assumes where it was mounted.
  base: mode === "player" ? (process.env.DOCS_BASE?.trim() || "./") : "./",
  // A live server serves no assets, so the server build carries no public directory: models, icons
  // and map tiles come from the asset host its descriptor names. It also must stay empty because the
  // admin API owns the first path segment under `/admin/` for `info`, `setup`, `session`, `me`,
  // `roles`, `bans`, `tokens`, `audit`, `content`, `stats`, `players` and `settings`. The build emits
  // `index.html` and `assets/` only, so nothing it writes can shadow an endpoint.
  publicDir: mode === "player" ? fileURLToPath(new URL("./generated/", import.meta.url)) : mode === "server" ? false : "../game/public",
  plugins: [react(), tailwindcss(), ...(mode === "player" ? [playerBasePlugin()]
    : mode === "server" ? []
    : [devdocsPlugin({ contentRoot: process.env.DEVDOCS_CONTENT_ROOT })])],
  define: { __DEVDOCS_PLAYER__: JSON.stringify(mode === "player"), __DEVDOCS_MODE__: JSON.stringify(mode === "player" || mode === "server" ? mode : "repo") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@game": fileURLToPath(new URL("../game/src", import.meta.url)), "@content": fileURLToPath(new URL("../game/content", import.meta.url)) } },
  optimizeDeps: { include: ["react", "react-dom/client", "react-dom", "sonner", "react-hook-form", "shiki/core", "shiki/engine/oniguruma", "shiki/wasm", "@shikijs/langs/typescript", "@shikijs/themes/github-light", "@shikijs/themes/github-dark"] },
  server: { host: "127.0.0.1", port: 4190, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: { outDir: mode === "player" ? "../dist" : mode === "server" ? "../dist/devdocs-server" : "../dist-devdocs", emptyOutDir: true, copyPublicDir: mode === "player" },
}));
