import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { devdocsPlugin } from "./server/plugin.js";

const here = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => ({
  root: here,
  // The game lab runs concurrently. Its optimizer must not replace the editor's dependency cache.
  cacheDir: fileURLToPath(new URL(`../node_modules/.vite-devdocs-${mode}`, import.meta.url)),
  base: "./",
  publicDir: mode === "player" ? false : "../game/public",
  plugins: [react(), tailwindcss(), ...(mode === "player" ? [] : [devdocsPlugin({ contentRoot: process.env.DEVDOCS_CONTENT_ROOT })])],
  define: { __DEVDOCS_PLAYER__: JSON.stringify(mode === "player") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@game": fileURLToPath(new URL("../game/src", import.meta.url)), "@content": fileURLToPath(new URL("../game/content", import.meta.url)) } },
  optimizeDeps: { include: ["react", "react-dom/client", "react-dom", "sonner", "react-hook-form", "shiki/core", "shiki/engine/oniguruma", "shiki/wasm", "@shikijs/langs/typescript", "@shikijs/themes/github-light", "@shikijs/themes/github-dark"] },
  server: { host: "127.0.0.1", port: 4190, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: { outDir: mode === "player" ? "../dist" : "../dist-devdocs", emptyOutDir: true, copyPublicDir: false },
}));
