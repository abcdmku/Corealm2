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
  base: mode === "player" ? (process.env.DOCS_BASE?.trim() || "./") : "./",
  publicDir: mode === "player" ? fileURLToPath(new URL("./generated/", import.meta.url)) : "../game/public",
  plugins: [react(), tailwindcss(), ...(mode === "player"
    ? [playerBasePlugin()]
    : [devdocsPlugin({ contentRoot: process.env.DEVDOCS_CONTENT_ROOT })])],
  define: { __DEVDOCS_PLAYER__: JSON.stringify(mode === "player") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@game": fileURLToPath(new URL("../game/src", import.meta.url)), "@content": fileURLToPath(new URL("../game/content", import.meta.url)) } },
  optimizeDeps: { include: ["react", "react-dom/client", "react-dom", "sonner", "react-hook-form", "shiki/core", "shiki/engine/oniguruma", "shiki/wasm", "@shikijs/langs/typescript", "@shikijs/themes/github-light", "@shikijs/themes/github-dark"] },
  server: { host: "127.0.0.1", port: 4190, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: { outDir: mode === "player" ? "../dist" : "../dist-devdocs", emptyOutDir: true, copyPublicDir: mode === "player" },
}));
