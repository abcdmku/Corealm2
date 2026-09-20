import { transact } from './transaction.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arr, bool, discriminated, enumOf, num, obj, opt, parseValue, refine, str, type ParseContext } from '../../../game/src/content/schema/core.js';
import { CONTENT_COLLECTIONS } from '../../../game/src/content/compiler/collections.js';
import { contentRevision, formatContentJson } from '../../../tools/content/format.js';
import { withFileLock } from '../../../tools/content/locks.js';
import { emptyMetaRecord, MetaFileSchema } from '../../../tools/content/meta.js';
import type { ReferencePools } from '../../../game/src/content/compiler/references.js';
import { atomicReplaceFile } from '../../../tools/lib/atomic-replace-file.js';
import { repoRoot } from '../../../tools/lib/paths.js';
import type { ApiDiagnostic, BulkRequest, BulkResponse } from '../../shared/contracts.js';
import { collectionFile, parseAuthoredCollection } from '../lib/validateCollections.js';
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from './collections.js';
import { applyMetaOperation, metadataFile, readMetadataSnapshot } from './meta.js';

export interface BulkHandlerOptions {
  contentRoot?: string;
  referencePools?: () => Promise<ReferencePools>;
  actor?: string;
  now?: () => string;
}
export type BulkHandlerRequest = DevdocsRequest & { body?: unknown };
export type BulkHandler = (request: BulkHandlerRequest) => Promise<DevdocsJsonResponse | undefined>;
const PREFIX = '/__devdocs/bulk';
const nonblank = refine(str({ nonEmpty: true }), value => value.trim().length > 0, 'must not be blank');
const revision = str({ pattern: /^[a-f0-9]{64}$/ });
const actionSchema = discriminated('kind', {
  status: obj({ kind: enumOf(['status'] as const), status: enumOf(['draft', 'candidate', 'rejected'] as const) }),
  note: obj({ kind: enumOf(['note'] as const), text: nonblank, label: opt(str()) }),
  retier: obj({ kind: enumOf(['retier'] as const), tier: num({ integer: true, min: 1 }) }),
});
const requestSchema = obj({
  operation: enumOf(['preview', 'apply'] as const), collection: nonblank,
  recordIds: refine(arr(nonblank, { minLength: 1, maxLength: 1000 }), ids => new Set(ids).size === ids.length, 'recordIds must be unique'),
  action: actionSchema, revisions: opt(obj({ content: revision, meta: opt(revision) })),
});
function json(status: number, data: unknown, headers: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(data) };
}
function failure(status: number, error: string, diagnostics?: ApiDiagnostic[]): DevdocsJsonResponse {
  return json(status, { error, ...(diagnostics === undefined ? {} : { diagnostics }) });
}
function rawPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let raw = url.split(/[?#]/, 1)[0]!;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const start = raw.indexOf('/', raw.indexOf('://') + 3);
    raw = start < 0 ? '/' : raw.slice(start);
  }
  return raw.startsWith('/') ? raw : undefined;
}
export function isBulkPath(url: string | undefined): boolean {
  const pathname = rawPath(url);
  return pathname === PREFIX || pathname?.startsWith(`${PREFIX}/`) === true;
}

/** A bulk operation is one validated replacement, never a sequence of row writes. */
export function createBulkHandler(options: BulkHandlerOptions = {}): BulkHandler {
  const root = path.resolve(options.contentRoot ?? path.join(repoRoot, 'game', 'content'));
  const actor = options.actor ?? 'user';
  const now = options.now ?? (() => new Date().toISOString());
  if (!actor.trim()) throw new Error('Metadata actor must not be blank');
  return async request => {
    if (!isBulkPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return failure(403, 'Dev docs API accepts loopback requests only');
    if (rawPath(request.url) !== PREFIX) return failure(400, 'Malformed bulk URL');
    if ((request.method ?? 'GET').toUpperCase() !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
    const context: ParseContext = { issues: [] };
    const body: BulkRequest = requestSchema.parse(request.body, 'body', context);
    if (context.issues.length) return failure(422, 'Invalid bulk request', context.issues);
    if (body.operation === 'apply' && (!body.revisions || (body.action.kind !== 'retier' && !body.revisions.meta))) {
      return failure(422, 'Apply requires content revision and metadata revision for status or note actions');
    }
    const spec = CONTENT_COLLECTIONS.find(collection => collection.name === body.collection);
    if (!spec) return failure(404, 'Unknown collection');
    if (spec.shape !== 'array') return failure(422, 'Bulk operations require an array collection');
    try {
      if(body.action.kind==='retier'){
        const text=await readFile(collectionFile(root,spec),'utf8');const rows=JSON.parse(text) as Record<string,unknown>[];
        const current=contentRevision(text);const selected=rows.filter(row=>body.recordIds.includes(String(row[spec.idKey])));
        if(selected.length!==body.recordIds.length)return failure(422,'Every selected record must exist');
        const tier=body.action.tier;
        if(selected.some(row=>typeof row.tier!=='number'))return failure(422,'Every selected record must own a numeric tier');
        const result=await transact({operation:body.operation==='apply'?'save':'preview',revisions:{[spec.name]:body.revisions?.content??current},changes:selected.map(row=>({kind:'put',collection:spec.name,id:String(row[spec.idKey]),record:{...row,tier}}))},options);
        if(result.status!==200)return result;
        const payload=JSON.parse(result.body);
        return json(200,{collection:spec.name,recordIds:body.recordIds,action:body.action,revisions:{content:body.operation==='apply'?(payload.revisions[spec.name]??current):current},diffs:selected.filter(row=>row.tier!==tier).map(row=>({recordId:String(row[spec.idKey]),before:{tier:row.tier},after:{tier}})),diagnostics:payload.diagnostics});
      }
      const file = collectionFile(root, spec);
      return await withFileLock(path.join(root, '.collection-write'), () => withFileLock(file, async () => {
        const currentText = await readFile(file, 'utf8');
        const content = contentRevision(currentText);
        if (body.operation === 'apply' && body.revisions!.content !== content) {
          return json(409, { error: 'Collection changed since preview. Preview again before applying.', revisions: { content } });
        }
        const raw: unknown = JSON.parse(currentText);
        const parsed = parseAuthoredCollection(spec, raw);
        if (parsed.diagnostics.some(issue => issue.severity === 'error')) return failure(422, 'Collection failed validation', parsed.diagnostics);
        const rows = raw as Record<string, unknown>[];
        const wanted = new Set(body.recordIds);
        const selected = rows.filter(row => wanted.has(String(row[spec.idKey])));
        if (selected.length !== wanted.size) return failure(422, 'Every selected record must exist', body.recordIds
          .filter(id => !selected.some(row => String(row[spec.idKey]) === id))
          .map(id => ({ path: `${spec.name}.${id}`, message: 'Unknown record', severity: 'error' })));
        const recordIds = selected.map(row => String(row[spec.idKey]));
        const action = body.action;
        if(action.kind==='retier')throw new Error('Retier must use the content transaction');
        const metaFile = metadataFile(root, spec.name);
        // Coordinate with individual metadata and CLI writers after taking content locks.
        return withFileLock(metaFile, async () => {
          const current = await readMetadataSnapshot(metaFile, spec.name);
          if (body.operation === 'apply' && body.revisions!.meta !== current.revision) {
            return json(409, { error: 'Metadata changed since preview. Preview again before applying.', revisions: { content, meta: current.revision } });
          }
          const updated = structuredClone(current.records);
          const at = now();
          const diffs = selected.flatMap(row => {
            const recordId = String(row[spec.idKey]);
            const before = Object.hasOwn(current.records, recordId) ? current.records[recordId]! : emptyMetaRecord();
            if (action.kind === 'status' && before.status === action.status) return [];
            applyMetaOperation(updated, spec.name, recordId, row, action, actor, at);
            const after = updated[recordId]!;
            return [{ recordId,
              before: action.kind === 'status' ? { status: before.status } : { notesCount: before.notes.length },
              after: action.kind === 'status' ? { status: after.status } : { notesCount: after.notes.length, note: after.notes.at(-1) } }];
          });
          const validated = parseValue(MetaFileSchema, updated, `${spec.name}.meta`);
          let meta = current.revision;
          if (body.operation === 'apply' && diffs.length) {
            const ordered = Object.fromEntries(Object.keys(validated).sort().map(id => [id, validated[id]]));
            const text = formatContentJson(ordered);
            await atomicReplaceFile(metaFile, text);
            meta = contentRevision(text);
          }
          return json(200, { collection: spec.name, recordIds, action, revisions: { content, meta }, diffs, diagnostics: [] } satisfies BulkResponse);
        });
      }));
    } catch (error) {

      return failure(500, 'Unable to process bulk operation');
    }
  };
}
