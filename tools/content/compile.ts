import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { repoRoot } from '../lib/paths.js';
import { pathToFileURL } from 'node:url';
import { CONTENT_COLLECTIONS } from '../../game/src/content/compiler/collections.js';
import { contentRoot, contentRevision, formatContentJson } from './format.js';
import { compileContent as compileWithFormulas, type ContentBuild } from '../../game/src/content/compiler/catalog.js';
import type { ReferencePools } from '../../game/src/content/compiler/references.js';
import { withFileLock } from './locks.js';
import { atomicReplaceFile } from '../lib/atomic-replace-file.js';
export type { ContentBuild };
/**
 * A checkout names its formula code by hashing it. File names and line endings are normalised so
 * Windows and Linux checkouts of one commit agree. The compiled catalog records the value as
 * `formulaRevision`, which is what a bundled server with no source tree compiles with.
 */
export function formulaSourceRevision(): string {
  const directory=path.join(repoRoot,'game/src/content');
  return contentRevision(readdirSync(directory,{recursive:true}).map(file=>String(file).split(path.sep).join('/')).filter(file=>file.endsWith('.ts')).sort()
    .map(file=>`${file}\n${readFileSync(path.join(directory,file),'utf8').replaceAll('\r\n','\n')}`).join('\n'));
}
/** The repo compile: the pure compiler with this checkout's formula revision. */
export function compileContent(values: ReadonlyMap<string, unknown>, external: ReferencePools = {}): ContentBuild {
  return compileWithFormulas(values, external, formulaSourceRevision());
}
export async function readContentSources(root = contentRoot) {
  return new Map(await Promise.all(CONTENT_COLLECTIONS.map(async spec => [spec.name, JSON.parse(await readFile(path.join(root,spec.file),'utf8'))] as const)));
}
export async function compileAndPublish(root = contentRoot, checkedSourceRevision?: string): Promise<ContentBuild> {
  return withFileLock(path.join(root,'.collection-write'), async () => {
  if(checkedSourceRevision&&formulaSourceRevision()!==checkedSourceRevision)throw new Error('Formula source changed after type checking');
  const build = compileContent(await readContentSources(root));
  if(checkedSourceRevision&&formulaSourceRevision()!==checkedSourceRevision)throw new Error('Formula source changed during compilation');
  if (build.ok) { await mkdir(path.join(root,'compiled'),{recursive:true}); await atomicReplaceFile(path.join(root,'compiled/catalog.json'),formatContentJson(build)); }
  return build;
  });
}
// Run as a command, not imported. The work is inside a function because a top-level await here would
// stop this module being bundled into the server executable, which reaches it through `repoBaseCatalog`.
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) void (async () => {
  const build = await compileAndPublish(process.argv[2],process.argv[3]); console.log(JSON.stringify({ok:build.ok,revision:build.revision,diagnostics:build.diagnostics})); process.exitCode = build.ok ? 0 : 1;
})();
