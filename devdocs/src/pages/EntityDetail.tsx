import { Check, Copy } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { lazyComponent } from "../workspaces/lazyView.js";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { ObjectSchema, type Schema } from "../../../game/src/content/schema/core.js";
import { apiGet } from "../api/client.js";
import type { ContentRow, EntityDetailProps } from "../model/contracts.js";
import { fieldCore, serialFieldSpec } from "../model/fields.js";
import { rowName } from "../model/rows.js";
import { summaryContext, useReferenceIndex } from "../model/refs.js";
import { summarize, titleCase } from "../model/summaries.js";
import { primaryAssetId } from "../model/viewerSource.js";
import type { MetaResponse } from "../../shared/metaContracts.js";
import { EntitySummary } from "../ui/EntitySummary.js";
import { Facts, Field, RefField, ReferencedBy, SchemaControl, Sheet, type RenderRef, Static } from "../ui/field/index.js";
import { Thumb } from "../ui/Thumb.js";
import { labelFor } from "../ui/library.js";
import { Badge } from "../components/ui/index.js";
import { toneVariant } from "../components/ui/badge.js";
import { cn } from "../lib/utils.js";
import { EMPTY, RECORD, RECORD_HEAD, RECORD_RAIL, RECORD_TITLE } from "../ui/layout.js";

const SetPiecePanel = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../dev/SetPiecePanel.js"));
const NotesPanel = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../dev/NotesPanel.js"));
const EntityEditor = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../dev/EntityEditor.js"));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../dev/RecordActions.js"), null);
const AssetCandidates = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../dev/AssetCandidates.js"));
const ADVANCED_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration", "__compiled"]);

/** A record page's tabs: a sticky strip of quiet text tabs, the active one on the selected surface. */
const TAB = "inline-flex h-6 cursor-pointer items-center gap-[5px] rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=active]:bg-selected data-[state=active]:text-foreground [&_small]:font-mono [&_small]:text-[11px] [&_small]:text-faint";
const TAB_PANEL = "focus-visible:outline-offset-4";

const schemaByCollection = new Map(CONTENT_COLLECTIONS.map(spec => [spec.name, spec.schema]));
const noop = () => undefined;
const readOnlyRef: RenderRef = (kind, value, _onChange, spec) => <RefField kind={kind} value={value} onChange={noop} label={spec.label} hint={spec.hint} readOnly bare />;

/**
 * A record nobody can edit here — a compiled row, or the player build — read through the same
 * fields the editor uses, with every control read-only. References stay references: the chip peeks
 * at the target instead of printing an id.
 */
export function RecordFields({ collection, record }: { collection: string; record: ContentRow }) {
  const schema = schemaByCollection.get(collection) ?? schemaByCollection.get(collection.replace(/^compiled-/, ""));
  const node = schema ? fieldCore(schema) : undefined;
  if (!(node instanceof ObjectSchema)) return <pre className="overflow-auto font-mono text-xs leading-relaxed">{JSON.stringify(record, null, 2)}</pre>;
  const entries = (Object.entries(node.fields) as [string, Schema][])
    .map(([key, field]) => [key, field, serialFieldSpec(field, key)] as const)
    .filter(([key, , spec]) => !ADVANCED_FIELDS.has(key) && !spec.hidden && record[key] !== undefined);
  return <Sheet>
    {/* A reference is the one field that brings its own label, so it is rendered as itself. */}
    {entries.map(([key, field, spec]) => spec.ref
      ? <RefField key={key} kind={spec.ref} value={typeof record[key] === "string" ? record[key] : undefined} onChange={noop} label={spec.label} hint={spec.help} readOnly />
      : <SchemaControl key={key} schema={field} name={key} value={record[key]} onChange={noop} renderRef={readOnlyRef} readOnly />)}
    {!entries.length && <Field label="Record"><Static muted>This record has no readable fields.</Static></Field>}
  </Sheet>;
}

/**
 * The generic record page: used by every collection without a purpose-built view. One column of
 * fields with a context rail. Rows expanded from a tier or a role are edited like any other; the
 * page does not call them generated.
 */
export function EntityDetail(props: EntityDetailProps) {
  const { collection, record, navigate } = props;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("edit");
  const [visited, setVisited] = useState(() => new Set(["edit"]));
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const summary = summarize(collection, record, ctx);
  const id = props.recordId ?? String(record.id ?? record.itemId ?? record.logItemId ?? record.tier ?? "");
  const generated = record.__compiled === true || collection.startsWith("compiled-");
  const canEdit = !__DEVDOCS_PLAYER__ && props.editable && !generated;
  const description = typeof record.description === "string" ? record.description : "";
  const assetId = primaryAssetId(collection, record);
  const idKey = collection === "campfireFuels" ? "logItemId" : collection === "spellRunes" ? "itemId" : undefined;
  const meta = useQuery({ queryKey: ["meta", collection, props.collectionShape === "object" ? "$collection" : id], queryFn: () => apiGet<MetaResponse>(`meta/${collection.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(props.collectionShape === "object" ? "$collection" : id)}`), enabled: !__DEVDOCS_PLAYER__ && !generated, staleTime: 10_000, refetchOnWindowFocus: false, retry: false });
  const status = meta.data?.data.status;
  const openRequests = meta.data?.data.notes.filter(note => note.request && note.request.state !== "closed").length ?? 0;
  const facts = summary.badges.filter(badge => !badge.tone || !["ok", "warn", "danger"].includes(badge.tone)).filter(badge => badge.text !== "Generated").map(badge => badge.text);
  async function copyId() { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } }
  const select = (value: string) => { setTab(value); setVisited(previous => new Set(previous).add(value)); };

  return <article className={cn(RECORD, "max-w-[87.5rem] px-4 pt-3 pb-10")}>
    <div className="min-w-0">
      <header className={RECORD_HEAD}>
        <Thumb spec={summary.thumb} size="l" alt="" />
        <div className={RECORD_TITLE}>
          <h1 title={rowName(record)}>{summary.title}</h1>
          <Facts items={[
            labelFor(collection),
            summary.tier !== undefined && `Tier ${summary.tier}`,
            ...facts,
            <button key="id" className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-faint hover:text-primary" title="Copy record ID" onClick={() => void copyId()}><code>{id}</code>{copied ? <Check size={12} /> : <Copy size={12} />}</button>,
            status && status !== "draft" && <Badge variant={toneVariant(status === "live" || status === "approved" ? "ok" : status === "rejected" ? "danger" : "warn")}>{titleCase(status)}</Badge>,
            openRequests > 0 && <Badge variant="warn">{openRequests} open request{openRequests === 1 ? "" : "s"}</Badge>,
          ]} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && props.collectionShape === "array" && RecordActions && <Suspense fallback={null}><RecordActions collection={collection} record={record} recordId={id} editable={canEdit} idKey={idKey} navigate={navigate} compact /></Suspense>}
        </div>
      </header>
      <Tabs.Root value={tab} onValueChange={select}>
        <Tabs.List aria-label="Record detail" className="sticky top-0 z-3 mb-1 flex gap-0.5 border-b border-border-subtle bg-background py-1.5">
          <Tabs.Trigger className={TAB} value="edit">{canEdit ? "Record" : "Fields"}</Tabs.Trigger>
          {canEdit && collection === "equipmentSets" && <Tabs.Trigger className={TAB} value="pieces">Pieces</Tabs.Trigger>}
          {!__DEVDOCS_PLAYER__ && assetId && <Tabs.Trigger className={TAB} value="model">Model candidates</Tabs.Trigger>}
          {!__DEVDOCS_PLAYER__ && !generated && <Tabs.Trigger className={TAB} value="notes">Notes</Tabs.Trigger>}
          <Tabs.Trigger className={TAB} value="raw">JSON</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className={TAB_PANEL} value="edit" forceMount hidden={tab !== "edit"}>
          {description && !canEdit && <p className="max-w-[47.5rem] text-xs leading-normal text-muted-foreground mb-3">{description}</p>}
          {canEdit && EntityEditor ? <Suspense fallback={<p className={EMPTY}>Loading editor…</p>}><EntityEditor collection={collection} recordId={id} /></Suspense> : <RecordFields collection={collection} record={record} />}
          <ReferencedBy collection={collection} id={id} navigate={navigate} />
        </Tabs.Content>
        {canEdit && collection === "equipmentSets" && SetPiecePanel && visited.has("pieces") && <Tabs.Content className={TAB_PANEL} value="pieces" forceMount hidden={tab !== "pieces"}><Suspense fallback={<p className={EMPTY}>Loading pieces…</p>}><SetPiecePanel collection={collection} recordId={id} /></Suspense></Tabs.Content>}
        {!__DEVDOCS_PLAYER__ && assetId && AssetCandidates && visited.has("model") && <Tabs.Content className={TAB_PANEL} value="model" forceMount hidden={tab !== "model"}><Suspense fallback={<p className={EMPTY}>Loading candidates…</p>}><AssetCandidates collection={collection} entityId={id} currentAssetId={assetId} targetLabel={`Candidates for ${summary.title}`} /></Suspense></Tabs.Content>}
        {!__DEVDOCS_PLAYER__ && !generated && NotesPanel && visited.has("notes") && <Tabs.Content className={TAB_PANEL} value="notes" forceMount hidden={tab !== "notes"}><Suspense fallback={<p className={EMPTY}>Loading notes…</p>}><NotesPanel collection={collection} entityId={props.collectionShape === "object" ? "$collection" : id} /></Suspense></Tabs.Content>}
        <Tabs.Content className={TAB_PANEL} value="raw"><pre className="overflow-auto font-mono text-xs leading-relaxed">{JSON.stringify(record, null, 2)}</pre></Tabs.Content>
      </Tabs.Root>
    </div>
    <aside className={RECORD_RAIL}>
      <EntitySummary collection={collection} record={record} recordId={id} index={index} navigate={navigate} editing={canEdit} bare />
    </aside>
  </article>;
}

export default EntityDetail;
