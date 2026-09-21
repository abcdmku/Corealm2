import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/**
 * The page's module graph: every module `game/src/main.ts` can load on the main thread, through
 * static imports and through `import()`. esbuild reads it, so type-only imports count for nothing
 * and the answer is the bundler's, not a regular expression's. A `new Worker(new URL(...))` is not
 * an import, so the local-play worker and everything only it loads stay out, which is the point:
 * the worker runs on the server catalog, the page on the client catalog.
 *
 * `tests/client-catalog-page-graph.test.ts` uses this to find the content modules the page evaluates
 * and then evaluates exactly those against a client-only catalog.
 */
export interface PageModule {
  file: string; importedBy: string | null;
  /** Reached first through an `import()`. `staticClosure` answers whether a module evaluates before the entry's own code. */
  dynamic: boolean;
  /** Our own modules this one imports, in source order. */
  imports: { file: string; dynamic: boolean }[];
}

/**
 * Breadth first from `entry`, so `importedBy` is a shortest chain. `define` takes the build's
 * constants (`import.meta.env.DEV` and friends), so a branch the production bundle drops is dropped
 * here too, together with the `import()` inside it.
 */
export async function pageGraph(entry: string, options: { define?: Record<string, string> } = {}): Promise<Map<string, PageModule>> {
  const start = path.resolve(entry);
  const result = await build({
    entryPoints: [start], bundle: true, write: false, metafile: true, format: "esm", platform: "browser", splitting: true, outdir: "out",
    logLevel: "silent", treeShaking: true, minifySyntax: true, define: options.define ?? {}, absWorkingDir: path.dirname(start),
    plugins: [{ name: "page-graph-externals", setup(plugin) {
      // Packages, virtual modules and assets load no source of ours.
      plugin.onResolve({ filter: /^[^.]/ }, args => args.kind === "entry-point" ? null : { path: args.path, external: true });
      plugin.onResolve({ filter: /\.(css|json|glsl|png|webp|svg|wasm)(\?.*)?$/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  const inputs = result.metafile.inputs;
  const absolute = (file: string): string => path.resolve(path.dirname(start), file);
  const graph = new Map<string, PageModule>([[start, { file: start, importedBy: null, dynamic: false, imports: [] }]]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    const input = inputs[path.relative(path.dirname(start), file).replaceAll("\\", "/")];
    for (const edge of input?.imports ?? []) {
      if (edge.external) continue;
      const resolved = absolute(edge.path), dynamic = edge.kind === "dynamic-import";
      graph.get(file)!.imports.push({ file: resolved, dynamic });
      if (graph.has(resolved)) continue;
      graph.set(resolved, { file: resolved, importedBy: file, dynamic, imports: [] });
      queue.push(resolved);
    }
  }
  return graph;
}

/** What evaluates before `entry`'s own first statement: the modules it reaches through static imports alone. */
export function staticClosure(graph: Map<string, PageModule>, entry: string): Set<string> {
  const seen = new Set<string>([path.resolve(entry)]);
  for (const queue = [...seen]; queue.length;) for (const edge of graph.get(queue.shift()!)?.imports ?? []) {
    if (edge.dynamic || seen.has(edge.file)) continue;
    seen.add(edge.file); queue.push(edge.file);
  }
  return seen;
}

/** Dependencies before dependents, so the first module that fails to evaluate is the one at fault and not one of its importers. */
export function evaluationOrder(graph: Map<string, PageModule>): string[] {
  const order: string[] = [], seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const edge of graph.get(file)?.imports ?? []) if (!edge.dynamic) visit(edge.file);
    order.push(file);
  };
  for (const file of graph.keys()) visit(file);
  return order;
}

export function chainTo(graph: Map<string, PageModule>, file: string, root: string): string[] {
  const chain: string[] = [];
  for (let at: string | null = path.resolve(file); at; at = graph.get(at)?.importedBy ?? null) chain.unshift(path.relative(root, at).replaceAll("\\", "/"));
  return chain;
}

/** The tables a module reads straight off the installed catalog: `RESOLVED_TABLES[...]`, `.tables.x`. */
export function tablesReadBy(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (!/RESOLVED_(TABLES|CATALOG)/.test(text)) return [];
  const names = new Set<string>();
  for (const match of text.matchAll(/RESOLVED_TABLES\s*(?:\[\s*["']([^"']+)["']\s*\]|\.(\w+))/g)) names.add(match[1] ?? match[2]!);
  for (const match of text.matchAll(/\btables\s*(?:\[\s*["']([^"']+)["']\s*\]|\.(\w+))/g)) names.add(match[1] ?? match[2]!);
  return [...names].sort();
}
