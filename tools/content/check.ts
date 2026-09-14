import { compileContent, readContentSources } from './compile.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { CONTENT_COLLECTIONS } from './collections.js';
export interface ContentCheckReport {ok: boolean; collections: number; errors: string[]; warnings: string[]}
export async function checkContent(_options: {allowIdentityChange?: boolean; crossTables?: boolean} = {}): Promise<ContentCheckReport> {
  try { const build = compileContent(await readContentSources()); return {ok:build.ok,collections:CONTENT_COLLECTIONS.length, errors:build.diagnostics.filter(d=>d.severity==='error').map(d=>`${d.path}: ${d.message}`), warnings:build.diagnostics.filter(d=>d.severity==='warning').map(d=>`${d.path}: ${d.message}`)}; }
  catch(error) {return {ok:false,collections:CONTENT_COLLECTIONS.length,errors:[String(error)],warnings:[]};}
}
if(import.meta.url===pathToFileURL(path.resolve(process.argv[1]??'')).href){ const report=await checkContent(); console.log(JSON.stringify(report,null,2)); process.exitCode=report.ok?0:1; }
