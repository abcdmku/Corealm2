import "../tools/lib/repoContent.js";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import { generationRevisionPlugin } from "../tools/lib/generation-revision.js";
import { worldDataBuildGuard } from "../tools/lib/world-artifact.js";
import { releaseTexturePackPlugin } from '../tools/lib/asset-texture-pack.js';
import { releaseNavigationPlugin } from '../tools/lib/release-navigation.js';
import { runtimeCatalogPlugin } from '../tools/lib/runtime-catalog-plugin.js';
import { localWorldFilesPlugin } from '../tools/lib/local-world-files.js';

const APPLICATION_INITIAL_JS_GZIP_BUDGET = 1_000_000;
const CRITICAL_JS_AND_WASM_GZIP_BUDGET = 1_500_000;
/**
 * The local-play worker is its own bundle: the host core, the systems and recast's loader, and no
 * content tables, which it fetches at run time. It is fetched when local play is joined, never
 * before first render, so it has its own ceiling rather than a share of the initial one.
 */
const LOCAL_WORKER_JS_GZIP_BUDGET = 350_000;
export const LOCAL_WORKER_DIRECTORY = "assets/worker/";
const DEDICATED_ENGINE_CHUNKS = ["three", "recast"] as const;
const VENDOR_CHUNKS = new Set<string>([...DEDICATED_ENGINE_CHUNKS, "vendor"]);

export const BUNDLE_BUDGETS = Object.freeze({
  applicationInitialJsGzipBytes: APPLICATION_INITIAL_JS_GZIP_BUDGET,
  criticalInitialJsAndWasmGzipBytes: CRITICAL_JS_AND_WASM_GZIP_BUDGET,
  localWorkerJsGzipBytes: LOCAL_WORKER_JS_GZIP_BUDGET,
});

export interface BundleChunkArtifact {
  type: "chunk";
  fileName: string;
  name?: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  modules?: Record<string, unknown>;
}

export interface BundleAssetArtifact {
  type: "asset";
  fileName: string;
  source: string | Uint8Array;
}

export type BundleArtifact = BundleChunkArtifact | BundleAssetArtifact;

export interface CompressedArtifactSize {
  fileName: string;
  kind: "js" | "css" | "wasm";
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  initial: boolean;
}

export interface BundleBudgetReport {
  artifacts: CompressedArtifactSize[];
  initialChunks: string[];
  applicationInitialJsGzipBytes: number;
  criticalInitialJsAndWasmGzipBytes: number;
  wasmGzipBytes: number;
  wasmFiles: string[];
  /** Every script under `assets/worker/`: the worker entry and the chunks only it loads. */
  localWorkerJsGzipBytes: number;
  localWorkerFiles: string[];
  /** Worker files that carry compiled content tables. The worker fetches its catalog, so there must be none. */
  localWorkerCatalogFiles: string[];
  recastCompatibilityChunks: string[];
  sourceMaps: string[];
  missingDedicatedChunks: string[];
}

function bytesOf(artifact: BundleArtifact): string | Uint8Array {
  return artifact.type === "chunk" ? artifact.code : artifact.source;
}

function compressedSize(fileName: string, content: string | Uint8Array, initial: boolean): CompressedArtifactSize | null {
  const extension = path.posix.extname(fileName);
  const kind = extension === ".js" ? "js" : extension === ".css" ? "css" : extension === ".wasm" ? "wasm" : null;
  if (!kind) return null;
  const rawBytes = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
  return {
    fileName,
    kind,
    rawBytes,
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(content, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 },
    }).byteLength,
    initial,
  };
}

function resolveBundleImport(from: string, imported: string, bundle: Readonly<Record<string, BundleArtifact>>): string | null {
  if (bundle[imported]) return imported;
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), imported));
  return bundle[relative] ? relative : null;
}

function collectInitialChunks(bundle: Readonly<Record<string, BundleArtifact>>): Set<string> {
  const initial = new Set<string>();
  const queue = Object.values(bundle)
    .filter((artifact): artifact is BundleChunkArtifact => artifact.type === "chunk" && artifact.isEntry)
    .map((artifact) => artifact.fileName);
  while (queue.length > 0) {
    const fileName = queue.shift();
    if (!fileName || initial.has(fileName)) continue;
    const artifact = bundle[fileName];
    if (!artifact || artifact.type !== "chunk") continue;
    initial.add(fileName);
    for (const imported of artifact.imports) {
      const resolved = resolveBundleImport(fileName, imported, bundle);
      if (resolved && !initial.has(resolved)) queue.push(resolved);
    }
  }
  return initial;
}

function chunkPolicyName(chunk: BundleChunkArtifact): string | undefined {
  if (chunk.name && VENDOR_CHUNKS.has(chunk.name)) return chunk.name;
  const match = /(?:^|\/)(three|rapier|recast|vendor)-[^/]+\.js$/.exec(chunk.fileName);
  return match?.[1];
}

export function analyzeBundleBudget(bundle: Readonly<Record<string, BundleArtifact>>): BundleBudgetReport {
  const initialChunks = collectInitialChunks(bundle);
  const artifacts = Object.values(bundle)
    .map((artifact) => compressedSize(artifact.fileName, bytesOf(artifact), initialChunks.has(artifact.fileName)))
    .filter((artifact): artifact is CompressedArtifactSize => artifact !== null)
    .sort((left, right) => right.gzipBytes - left.gzipBytes || left.fileName.localeCompare(right.fileName));
  const chunks = Object.values(bundle).filter(
    (artifact): artifact is BundleChunkArtifact => artifact.type === "chunk",
  );
  const wasm = artifacts.filter((artifact) => artifact.kind === "wasm");
  const worker = artifacts.filter((artifact) => artifact.kind === "js" && artifact.fileName.startsWith(LOCAL_WORKER_DIRECTORY));
  // Two table names that only the compiled catalog spells as keys of an array.
  const carriesCatalog = (fileName: string): boolean => {
    const artifact = bundle[fileName], content = artifact ? bytesOf(artifact) : "";
    const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    return /["']?(?:compiledCreatures|lootTables)["']?\s*:\s*\[/.test(text);
  };
  const initialJs = artifacts.filter((artifact) => artifact.kind === "js" && artifact.initial);
  const criticalJs = artifacts.filter((artifact) => {
    if (artifact.kind !== "js") return false;
    if (artifact.initial) return true;
    const chunk = bundle[artifact.fileName];
    const policy = chunk?.type === "chunk" ? chunkPolicyName(chunk) : undefined;
    return policy !== undefined && DEDICATED_ENGINE_CHUNKS.includes(
      policy as (typeof DEDICATED_ENGINE_CHUNKS)[number],
    );
  });
  const applicationInitialJs = initialJs.filter((artifact) => {
    const chunk = bundle[artifact.fileName];
    return chunk?.type === "chunk" && !chunkPolicyName(chunk);
  });
  const presentChunkPolicies = new Set(chunks.map(chunkPolicyName).filter((name): name is string => Boolean(name)));
  const recastCompatibilityChunks = chunks
    .filter((chunk) => Object.keys(chunk.modules ?? {}).some((id) => /recast-navigation\.wasm-compat\.js$/.test(id.replaceAll("\\", "/"))))
    .map((chunk) => chunk.fileName)
    .sort();

  return {
    artifacts,
    initialChunks: [...initialChunks].sort(),
    applicationInitialJsGzipBytes: applicationInitialJs.reduce((total, artifact) => total + artifact.gzipBytes, 0),
    criticalInitialJsAndWasmGzipBytes:
      criticalJs.reduce((total, artifact) => total + artifact.gzipBytes, 0)
      + wasm.reduce((total, artifact) => total + artifact.gzipBytes, 0),
    wasmGzipBytes: wasm.reduce((total, artifact) => total + artifact.gzipBytes, 0),
    wasmFiles: wasm.map((artifact) => artifact.fileName),
    localWorkerJsGzipBytes: worker.reduce((total, artifact) => total + artifact.gzipBytes, 0),
    localWorkerFiles: worker.map((artifact) => artifact.fileName).sort(),
    localWorkerCatalogFiles: worker.map((artifact) => artifact.fileName).filter(carriesCatalog).sort(),
    recastCompatibilityChunks,
    sourceMaps: Object.keys(bundle).filter((fileName) => fileName.endsWith(".map")).sort(),
    missingDedicatedChunks: DEDICATED_ENGINE_CHUNKS.filter((name) => !presentChunkPolicies.has(name)),
  };
}

export function assertBundleBudgets(report: BundleBudgetReport): void {
  const failures: string[] = [];
  if (report.applicationInitialJsGzipBytes > BUNDLE_BUDGETS.applicationInitialJsGzipBytes) {
    failures.push(
      `initial application JavaScript is ${formatBytes(report.applicationInitialJsGzipBytes)} gzip; budget ${formatBytes(BUNDLE_BUDGETS.applicationInitialJsGzipBytes)}`,
    );
  }
  if (report.criticalInitialJsAndWasmGzipBytes > BUNDLE_BUDGETS.criticalInitialJsAndWasmGzipBytes) {
    failures.push(
      `critical JavaScript plus WASM is ${formatBytes(report.criticalInitialJsAndWasmGzipBytes)} gzip; budget ${formatBytes(BUNDLE_BUDGETS.criticalInitialJsAndWasmGzipBytes)}`,
    );
  }
  if (report.localWorkerJsGzipBytes > BUNDLE_BUDGETS.localWorkerJsGzipBytes) {
    failures.push(
      `local-play worker JavaScript is ${formatBytes(report.localWorkerJsGzipBytes)} gzip; budget ${formatBytes(BUNDLE_BUDGETS.localWorkerJsGzipBytes)}`,
    );
  }
  if (report.localWorkerCatalogFiles.length > 0) {
    failures.push(`the local-play worker bundles content tables it must fetch instead: ${report.localWorkerCatalogFiles.join(", ")}`);
  }
  if (report.sourceMaps.length > 0) failures.push(`production source maps emitted: ${report.sourceMaps.join(", ")}`);
  if (report.missingDedicatedChunks.length > 0) {
    failures.push(`missing dedicated engine chunks: ${report.missingDedicatedChunks.join(", ")}`);
  }
  if (failures.length > 0) throw new Error(`Corealm bundle budget failed\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(3)} MB`;
}

export function formatBundleBudgetReport(report: BundleBudgetReport): string {
  const rows = report.artifacts.map((artifact) => [
    artifact.initial ? "initial" : "deferred",
    artifact.fileName,
    `raw ${formatBytes(artifact.rawBytes)}`,
    `gzip ${formatBytes(artifact.gzipBytes)}`,
    `br ${formatBytes(artifact.brotliBytes)}`,
  ].join("  "));
  return [
    "Corealm compressed bundle report",
    ...rows,
    `initial application JS  ${formatBytes(report.applicationInitialJsGzipBytes)} / ${formatBytes(BUNDLE_BUDGETS.applicationInitialJsGzipBytes)} gzip`,
    `critical JS + WASM     ${formatBytes(report.criticalInitialJsAndWasmGzipBytes)} / ${formatBytes(BUNDLE_BUDGETS.criticalInitialJsAndWasmGzipBytes)} gzip`,
    `local-play worker JS   ${formatBytes(report.localWorkerJsGzipBytes)} / ${formatBytes(BUNDLE_BUDGETS.localWorkerJsGzipBytes)} gzip across ${report.localWorkerFiles.length} file(s)`,
    `external WASM          ${formatBytes(report.wasmGzipBytes)} gzip across ${report.wasmFiles.length} file(s)`,
    `Recast compat chunks   ${report.recastCompatibilityChunks.length > 0 ? report.recastCompatibilityChunks.join(", ") : "none"}`,
  ].join("\n");
}

function wasmMimePlugin(): Plugin {
  const install = (server: { middlewares: { use: (handler: (request: { url?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => void) => void } }): void => {
    server.middlewares.use((request, response, next) => {
      if (/\.wasm(?:$|[?#])/.test(request.url ?? "")) response.setHeader("Content-Type", "application/wasm");
      next();
    });
  };
  return {
    name: "corealm-wasm-mime",
    configureServer: install,
    configurePreviewServer: install,
  };
}

function compressedBundleBudgetPlugin(): Plugin {
  return {
    name: "corealm-compressed-bundle-budget",
    apply: "build",
    enforce: "post",
    generateBundle(_options, outputBundle) {
      const report = analyzeBundleBudget(outputBundle as unknown as Record<string, BundleArtifact>);
      console.info(formatBundleBudgetReport(report));
      if (report.wasmFiles.length === 0) this.warn("No external engine WASM was emitted; Recast is still using its compatibility JavaScript loader.");
      if (report.recastCompatibilityChunks.length > 0) {
        this.warn(`Recast compatibility loader remains in ${report.recastCompatibilityChunks.join(", ")}`);
      }
      assertBundleBudgets(report);
    },
  };
}

export default defineConfig({
  assetsInclude: ["**/*.wasm"],
  resolve: {
    // Core imports the compatibility entry internally. Redirect only that bare specifier; the
    // explicit external-WASM subpath must resolve normally.
    alias: [{ find: /^@recast-navigation\/wasm$/, replacement: "@recast-navigation/wasm/wasm" }],
  },
  optimizeDeps: {
    // Recast's generators and init must share core's mutable Raw singleton. Keep this pure ESM
    // graph outside the optimizer so a dependency rediscovery cannot give them different cached
    // core identities in a running lab. The WASM loaders also keep their package-owned URLs.
    exclude: [
      "@recast-navigation/core",
      "@recast-navigation/generators",
      "@recast-navigation/wasm",
      "@recast-navigation/wasm/wasm",
    ],
  },
  worker: {
    // A module worker, so its dynamic imports split: the entry installs the catalog it fetched and
    // only then loads the host graph. Its files go under one directory so the budget can find them.
    format: "es",
    plugins: () => [generationRevisionPlugin()],
    rollupOptions: {
      output: {
        entryFileNames: `${LOCAL_WORKER_DIRECTORY}[name]-[hash].js`,
        chunkFileNames: `${LOCAL_WORKER_DIRECTORY}[name]-[hash].js`,
        assetFileNames: (asset) => (asset.names[0] ?? "").endsWith(".wasm") ? "assets/wasm/[name]-[hash][extname]" : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [localWorldFilesPlugin(), runtimeCatalogPlugin(), generationRevisionPlugin(), releaseNavigationPlugin(), worldDataBuildGuard(), wasmMimePlugin(), compressedBundleBudgetPlugin(), releaseTexturePackPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: (filePath) => filePath.endsWith(".wasm") ? false : undefined,
    modulePreload: {
      polyfill: false,
    },
    // The budget plugin reports both gzip and Brotli, then enforces the gzip transfer limits.
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Rolldown groups only the package modules themselves. Recursively capturing dependencies
        // made the dynamically imported Recast group absorb shared Three modules and become a
        // static entry dependency again.
        codeSplitting: {
          groups: [
            {
              // Install before import, in the bundle too. Content modules are shared with the
              // dynamic chunks, so the bundler lifts `resolvedCatalog` into a chunk of its own, and a
              // chunk evaluates before the entry that imports it. Left alone, the entry's
              // `bundledCatalog` install runs after `resolvedCatalog` has looked for a catalog and
              // thrown. In one chunk with `catalogInstall`, which `resolvedCatalog` imports, the
              // install is a dependency of every content module instead of a sibling.
              name: "catalog",
              test: /[\\/]content[\\/](?:catalogInstall|bundledCatalog)\.ts$|[\\/]content[\\/]compiled[\\/]catalog\.json$/,
              priority: 4,
              includeDependenciesRecursively: false,
            },
            {
              name: "recast",
              test: /node_modules[\/](?:@recast-navigation|recast-navigation)[\/]/,
              priority: 3,
              includeDependenciesRecursively: false,
            },
            {
              name: "three",
              test: /node_modules[\/]three[\/]/,
              priority: 2,
              includeDependenciesRecursively: false,
            },
            {
              name: "vendor",
              test: /node_modules/,
              priority: 1,
              includeDependenciesRecursively: false,
            },
          ],
        },
        entryFileNames: "assets/entry/[name]-[hash].js",
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        assetFileNames: (asset) => {
          const name = asset.names[0] ?? "asset";
          if (name.endsWith(".wasm")) return "assets/wasm/[name]-[hash][extname]";
          if (name.endsWith(".css")) return "assets/styles/[name]-[hash][extname]";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: { fs: { strict: false } },
});
