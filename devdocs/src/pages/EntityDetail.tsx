import { Check, ChevronRight, Copy, ExternalLink, Sparkles } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { apiGet } from "../api/client.js";
import type { AppProps, EntityDetailProps } from "../model/contracts.js";
import { rowName } from "../model/rows.js";
import { summaryContext, useReferenceIndex } from "../model/refs.js";
import { summarize, titleCase } from "../model/summaries.js";
import { primaryAssetId } from "../model/viewerSource.js";
import type { FormulaConsumer } from "../../shared/formulas.js";
import type { MetaResponse } from "../../shared/metaContracts.js";
import { EntitySummary } from "../ui/EntitySummary.js";
import { Badges } from "../ui/RecordTile.js";
import { Thumb } from "../ui/Thumb.js";
import { labelFor } from "../ui/library.js";

const SetPiecePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/SetPiecePanel.js"));
const NotesPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/NotesPanel.js"));
const EntityEditor = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/EntityEditor.js"));
const BalancePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BalancePanel.js"));
const RecordFormulaStatus = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordFormulaStatus.js"));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordActions.js"));
const AssetCandidates = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/AssetCandidates.js"));
const ADVANCED_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration", "__compiled"]);

export function fieldLabel(key: string) { return key.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()).replace(/\bXp\b/g, "XP").replace(/\bId\b/g, "ID"); }
export function compactValue(value: unknown): string {
  if (value === undefined || value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? value.every(v => typeof v !== "object") ? value.join(", ") : `${value.length} entries` : "None";
  return `${Object.keys(value as object).length} fields`;
}

const references: Record<string, string> = { itemId: "items", outputItemId: "items", yieldItemId: "items", logItemId: "items", burntItemId: "items", baseId: "creatureDefinitions", creatureId: "creatureDefinitions", profileId: "creatureProfiles", lootTableId: "lootTables", tableId: "lootTables", assetId: "assets", resourceId: "resources", npcId: "npcs", giverNpcId: "npcs", questId: "quests", shopId: "shops", encounterId: "encounters", regionId: "worldRegions", templateId: "recipeTemplates", familyId: "equipmentFamilies", dialogueRootId: "dialogue", next: "dialogue" };

/** Read-only rendering of any value. Reference-shaped keys become links. */
export function ValueView({ value, name = "", navigate, depth = 0 }: { value: unknown; name?: string; navigate?: AppProps["navigate"]; depth?: number }) {
  if (value === null || value === undefined) return <span className="muted">Not set</span>;
  if (typeof value !== "object") {
    if (typeof value === "string" && navigate && references[name]) return <button className="reference-link" onClick={() => navigate(references[name], value)}>{value}<ChevronRight size={12} /></button>;
    return <span className={typeof value === "number" ? "numeric-value" : undefined}>{compactValue(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">None</span>;
    if (value.every(v => typeof v !== "object")) return <div className="value-tags">{value.map((v, i) => <span className="value-tag" key={i}>{compactValue(v)}</span>)}</div>;
    return <div className="value-list">{value.map((entry, index) => <div className="value-list-entry" key={index}><span className="entry-number">{index + 1}</span><ValueView value={entry} navigate={navigate} depth={depth + 1} /></div>)}</div>;
  }
  return <dl className={`field-list${depth ? " nested-fields" : ""}`}>{Object.entries(value).filter(([key]) => !ADVANCED_FIELDS.has(key)).map(([key, entry]) => <div className="field-row" key={key}><dt>{fieldLabel(key)}</dt><dd><ValueView value={entry} name={key} navigate={navigate} depth={depth + 1} /></dd></div>)}</dl>;
}

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
  const isBalance = collection.startsWith("balance/");
  const fields = Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "name", "title"].includes(key) && !ADVANCED_FIELDS.has(key)));
  const description = typeof record.description === "string" ? record.description : "";
  const assetId = primaryAssetId(collection, record);
  const idKey = collection === "campfireFuels" ? "logItemId" : collection === "spellRunes" ? "itemId" : undefined;
  const meta = useQuery({ queryKey: ["meta", collection, props.collectionShape === "object" ? "$collection" : id], queryFn: () => apiGet<MetaResponse>(`meta/${collection.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(props.collectionShape === "object" ? "$collection" : id)}`), enabled: !__DEVDOCS_PLAYER__ && !generated, staleTime: 10_000, refetchOnWindowFocus: false, retry: false });
  const status = meta.data?.data.status;
  const openRequests = meta.data?.data.notes.filter(note => note.request && note.request.state !== "closed").length ?? 0;
  const statusBadges: typeof summary.badges = [
    ...(status && status !== "draft" ? [{ text: titleCase(status), tone: (status === "live" || status === "approved" ? "ok" : status === "rejected" ? "danger" : "warn") as "ok" | "danger" | "warn" }] : []),
    ...(openRequests ? [{ text: `${openRequests} open request${openRequests === 1 ? "" : "s"}`, tone: "warn" as const }] : []),
  ];
  async function copyId() { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } }
  const select = (value: string) => { setTab(value); setVisited(previous => new Set(previous).add(value)); };

  return <article className="entity-detail">
    <header className="entity-header">
      <Thumb spec={summary.thumb} size="l" alt="" />
      <div className="entity-heading">
        <h1 title={rowName(record)}>{summary.title}</h1>
        <div className="entity-heading-meta">
          <span>{labelFor(collection)}</span>
          <button className="id-copy" title="Copy record ID" onClick={() => void copyId()}><code>{id}</code>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
          {summary.tier !== undefined && <span className="tier-tag">T{summary.tier}</span>}
          <Badges badges={generated ? [{ text: "Generated · read only", tone: "warn" }, ...summary.badges] : [...statusBadges, ...summary.badges]} limit={6} />
        </div>
      </div>
      <div className="entity-header-actions">
        {canEdit && props.collectionShape === "array" && RecordActions && <Suspense fallback={null}><RecordActions collection={collection} record={record} recordId={id} editable={canEdit} idKey={idKey} navigate={navigate} compact /></Suspense>}
      </div>
    </header>
    <div className="entity-layout">
      <EntitySummary collection={collection} record={record} recordId={id} index={index} navigate={navigate} editing={canEdit} />
      <div className="entity-work">
        <Tabs.Root className="entity-tabs" value={tab} onValueChange={select}>
          <Tabs.List aria-label="Record detail" className="entity-tab-list">
            <Tabs.Trigger value="edit">{canEdit ? "Record" : "Fields"}</Tabs.Trigger>
            {canEdit && isBalance && <Tabs.Trigger value="formula">Formula</Tabs.Trigger>}
            {canEdit && collection === "equipmentSets" && <Tabs.Trigger value="pieces">Pieces</Tabs.Trigger>}
            {!__DEVDOCS_PLAYER__ && assetId && <Tabs.Trigger value="model">Model candidates</Tabs.Trigger>}
            {!__DEVDOCS_PLAYER__ && !generated && <Tabs.Trigger value="notes">Notes</Tabs.Trigger>}
            <Tabs.Trigger value="raw">JSON</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="edit" forceMount hidden={tab !== "edit"}>
            {description && !canEdit && <p className="entity-description" style={{ marginBottom: 12 }}>{description}</p>}
            {generated && <GeneratedRecordNotice collection={collection} recordId={id} navigate={navigate} />}
            {canEdit && props.collectionShape === "array" && RecordFormulaStatus && <Suspense fallback={null}><RecordFormulaStatus collection={collection} recordId={id} /></Suspense>}
            {canEdit && EntityEditor ? <Suspense fallback={<p className="empty-inline">Loading editor…</p>}><EntityEditor collection={collection} recordId={id} navigate={navigate} /></Suspense> : <ValueView value={fields} navigate={navigate} />}
          </Tabs.Content>
          {canEdit && isBalance && BalancePanel && visited.has("formula") && <Tabs.Content value="formula" forceMount hidden={tab !== "formula"}><Suspense fallback={<p className="empty-inline">Loading formula…</p>}><BalancePanel collection={collection} recordId={id} /></Suspense></Tabs.Content>}
          {canEdit && collection === "equipmentSets" && SetPiecePanel && visited.has("pieces") && <Tabs.Content value="pieces" forceMount hidden={tab !== "pieces"}><Suspense fallback={<p className="empty-inline">Loading pieces…</p>}><SetPiecePanel collection={collection} recordId={id} /></Suspense></Tabs.Content>}
          {!__DEVDOCS_PLAYER__ && assetId && AssetCandidates && visited.has("model") && <Tabs.Content value="model" forceMount hidden={tab !== "model"}><Suspense fallback={<p className="empty-inline">Loading candidates…</p>}><AssetCandidates collection={collection} entityId={id} currentAssetId={assetId} targetLabel={`Candidates for ${summary.title}`} /></Suspense></Tabs.Content>}
          {!__DEVDOCS_PLAYER__ && !generated && NotesPanel && visited.has("notes") && <Tabs.Content value="notes" forceMount hidden={tab !== "notes"}><Suspense fallback={<p className="empty-inline">Loading notes…</p>}><NotesPanel collection={collection} entityId={props.collectionShape === "object" ? "$collection" : id} /></Suspense></Tabs.Content>}
          <Tabs.Content value="raw"><pre className="record-source" style={{ padding: 0 }}>{JSON.stringify(record, null, 2)}</pre></Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  </article>;
}

interface FormulaSourceResponse { formulas?: readonly { consumers?: readonly FormulaConsumer[] }[] }

function GeneratedRecordNotice({ collection, recordId, navigate }: { collection: string; recordId: string; navigate: AppProps["navigate"] }) {
  const query = useQuery({ queryKey: ["generated-source", collection, recordId], queryFn: () => apiGet<FormulaSourceResponse>("formulas"), enabled: !__DEVDOCS_PLAYER__, staleTime: 30_000 });
  const sourceCollectionKey = collection.replace(/^compiled-/, "");
  const consumer = query.data?.formulas?.flatMap(formula => formula.consumers ?? []).find(row => row.record === `${collection}:${recordId}` || row.record === `${sourceCollectionKey}:${recordId}`);
  return <div className="panel" style={{ marginBottom: 12 }}><div className="panel-body" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><Sparkles size={15} color="var(--accent)" /><div style={{ flex: 1, fontSize: 12 }}><strong>Generated record.</strong> <span className="muted">Values are compiled from an authored source.</span>{consumer?.collection && consumer.id && <div style={{ marginTop: 6 }}><button type="button" className="reference-link" onClick={() => navigate(consumer.collection, consumer.id)}>Edit source: {labelFor(consumer.collection)} / {consumer.id}<ExternalLink size={12} /></button></div>}</div></div></div>;
}

export default EntityDetail;
