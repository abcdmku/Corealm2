import { Copy, Check, ChevronRight, ExternalLink, Sparkles } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, collectionQuery } from "../api/client.js";
import type { AppProps, EntityDetailProps } from "../model/contracts.js";
import { contentRows, rowName } from "../model/rows.js";
import type { FormulaConsumer } from "../../shared/formulas.js";
import { ItemIcon } from "../ui/ItemIcon.js";
import { iconFor, labelFor } from "../ui/library.js";
import { EntityModel, ItemConnections, viewerSource } from "./EntityExtras.js";
import * as Tabs from "@radix-ui/react-tabs";
import { CreatureDetails } from './CreatureDetails.js';
const SetPiecePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/SetPiecePanel.js"));
const NotesPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/NotesPanel.js"));
const EntityEditor = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/EntityEditor.js"));
const BalancePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BalancePanel.js"));
const RecordFormulaStatus = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import('../dev/RecordFormulaStatus.js'));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import('../dev/RecordActions.js'));
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
export function ValueView({ value, name = "", navigate, depth = 0 }: { value: unknown; name?: string; navigate?: AppProps["navigate"]; depth?: number }) {
  if (value === null || value === undefined) return <span className="muted">Not set</span>;
  if (typeof value !== "object") {
    const references: Record<string, string> = { itemId: 'items', outputItemId: 'items', yieldItemId: 'items', blockId: 'enemies', speciesId: 'creatures', baseId: 'creatureDefinitions', profileId: 'creatureProfiles', lootTableId: 'lootTables', tableId: 'lootTables', assetId: 'assets', resourceId: 'resources', npcId: 'npcs', questId: 'quests', shopId: 'shops' };
    if (typeof value === "string" && navigate && references[name]) return <button className="reference-link" onClick={() => navigate(references[name], value)}>{value}<ChevronRight size={13}/></button>;
    return <span className={typeof value === "number" ? "numeric-value" : undefined}>{compactValue(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">None</span>;
    if (value.every(v => typeof v !== "object")) return <div className="value-tags">{value.map((v, i) => <span className="value-tag" key={i}>{compactValue(v)}</span>)}</div>;
    return <div className="value-list">{value.map((entry, index) => <div className="value-list-entry" key={index}><span className="entry-number">{index + 1}</span><ValueView value={entry} navigate={navigate} depth={depth + 1}/></div>)}</div>;
  }
  return <dl className={`field-list${depth ? " nested-fields" : ""}`}>{Object.entries(value).filter(([key]) => !ADVANCED_FIELDS.has(key)).map(([key, entry]) => <div className="field-row" key={key}><dt>{fieldLabel(key)}</dt><dd><ValueView value={entry} name={key} navigate={navigate} depth={depth + 1}/></dd></div>)}</dl>;
}

export function EntityDetail(props: EntityDetailProps) {
  const { collection, record, navigate } = props;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("overview");
  const [visited, setVisited] = useState(() => new Set(["overview"]));
  const display = props.displayRecord ?? record;
  const name = rowName(display, record.id === undefined && record.itemId ? "itemId" : record.id === undefined && record.tier !== undefined ? "tier" : "id");
  const id = props.recordId ?? String(record.id ?? record.itemId ?? record.logItemId ?? record.tier ?? "");
  const generated = record.__compiled === true;
  const canEdit = !__DEVDOCS_PLAYER__ && props.editable && !generated;
  const Icon = iconFor(collection);
  const fields = Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "name", "title", "description"].includes(key) && !ADVANCED_FIELDS.has(key)));
  const description = typeof record.description === "string" ? record.description : "";
  const hasModel = Boolean(viewerSource(props));
  const resolvedCreatureQuery = useQuery({ ...collectionQuery("compiled-enemies"), enabled: collection === "creatureDefinitions" });
  const resolvedCreature = collection === "creatureDefinitions" && resolvedCreatureQuery.data
    ? contentRows(resolvedCreatureQuery.data).find(row => String(row.id) === id)
    : undefined;
  async function copyId() { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  return <article className="entity-detail">
    <header className="entity-header"><div className="entity-heading">
      {collection === "items" || collection === "compiled-items" ? <ItemIcon key={id} id={id} name="" large/> : <span className="entity-symbol"><Icon size={32}/></span>}
      <div><div className="eyebrow">{labelFor(collection)}{display.tier !== undefined && <> / Tier {String(display.tier)}</>}</div>
        <h1>{name}</h1><button className="id-copy" title="Copy record ID" onClick={() => void copyId()}><code>{id}</code>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>
      </div></div>{description && <p className="entity-description">{description}</p>}
      {canEdit && props.collectionShape === "array" && RecordActions && <div style={{ marginTop: 18 }}><Suspense fallback={null}><RecordActions collection={collection} record={record} recordId={id} editable={canEdit} idKey={collection === "campfireFuels" ? "logItemId" : undefined} navigate={navigate} /></Suspense></div>}
    </header>
    {generated && <GeneratedRecordNotice collection={collection} recordId={id} navigate={navigate} />}
    {canEdit && props.collectionShape === 'array' && RecordFormulaStatus && <Suspense fallback={null}><RecordFormulaStatus collection={collection} recordId={id}/></Suspense>}
    <Tabs.Root className="entity-tabs" value={tab} onValueChange={value => { setTab(value); setVisited(previous => new Set(previous).add(value)); }}>
      <Tabs.List aria-label="Record detail" className="entity-tab-list">
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        {hasModel && <Tabs.Trigger value="model">3D model</Tabs.Trigger>}
        {(collection === "items" || collection === "compiled-items") && <Tabs.Trigger value="connections">Sources and uses</Tabs.Trigger>}
        {canEdit && collection.startsWith("balance/") && <Tabs.Trigger value="formula">Formula</Tabs.Trigger>}
        {canEdit && <Tabs.Trigger value="notes">Notes</Tabs.Trigger>}
      </Tabs.List>
      <div className="detail-body">
        <Tabs.Content value="overview" forceMount hidden={tab !== "overview"}><section className="detail-section"><div className="section-heading"><h2>{collection.startsWith("balance/") ? "Parameters" : "Overview"}</h2><span>{Object.keys(fields).length} fields</span></div>{canEdit && EntityEditor ? <div className="entity-editor-inline"><Suspense fallback={<p>Loading editor...</p>}><EntityEditor collection={collection} recordId={id}/></Suspense></div> : <ValueView value={fields} navigate={navigate}/>}</section>{canEdit && collection === "equipmentSets" && SetPiecePanel && <Suspense fallback={<p>Loading armor pieces...</p>}><SetPiecePanel collection={collection} recordId={id}/></Suspense>}{['creatures', 'enemies', 'enemyAliases'].includes(collection) && (record.blockId || record.lootTableId) ? <CreatureDetails {...props}/> : null}{collection === "creatureDefinitions" ? <CreatureDefinitionDetails record={record} resolved={resolvedCreature} loading={resolvedCreatureQuery.isPending} navigate={navigate}/> : null}</Tabs.Content>
        {hasModel && <Tabs.Content value="model"><EntityModel {...props}/></Tabs.Content>}
        {(collection === "items" || collection === "compiled-items") && <Tabs.Content value="connections"><ItemConnections {...props}/></Tabs.Content>}
        {canEdit && NotesPanel && visited.has("notes") && <Tabs.Content value="notes" forceMount hidden={tab !== "notes"}><Suspense fallback={<p>Loading notes...</p>}><NotesPanel collection={collection} entityId={props.collectionShape === "object" ? "$collection" : id}/></Suspense></Tabs.Content>}
        {canEdit && BalancePanel && collection.startsWith("balance/") && visited.has("formula") && <Tabs.Content value="formula" forceMount hidden={tab !== "formula"}><Suspense fallback={<p>Loading formula...</p>}><BalancePanel collection={collection} recordId={id}/></Suspense></Tabs.Content>}
      </div>
      <details className="source-disclosure"><summary>Advanced data <span>raw record · storage metadata</span></summary><pre>{JSON.stringify(record, null, 2)}</pre></details>
    </Tabs.Root>
  </article>;
}

interface FormulaSourceResponse { formulas?: readonly { consumers?: readonly FormulaConsumer[] }[] }

function GeneratedRecordNotice({ collection, recordId, navigate }: { collection: string; recordId: string; navigate: AppProps["navigate"] }) {
  const query = useQuery({
    queryKey: ["generated-source", collection, recordId],
    queryFn: () => apiGet<FormulaSourceResponse>("formulas"),
    enabled: !__DEVDOCS_PLAYER__,
    staleTime: 30_000,
  });
  const sourceCollectionKey = collection.replace(/^compiled-/, "");
  const consumer = query.data?.formulas?.flatMap(formula => formula.consumers ?? []).find(row => row.record === `${collection}:${recordId}` || row.record === `${sourceCollectionKey}:${recordId}`);
  const sourceCollection = consumer?.collection;
  const sourceId = consumer?.id;
  return <section className="detail-section" style={{ margin: "20px 36px 0", padding: "14px 16px", border: "1px solid var(--border)", background: "var(--panel)" }} aria-label="Generated record notice">
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><Sparkles size={16} color="var(--accent)" /><div style={{ flex: 1 }}><strong>Generated record</strong><p className="muted" style={{ margin: "5px 0 0", lineHeight: 1.6 }}>This value is compiled from an authored source and is read only.</p>{sourceCollection && sourceId && <button type="button" className="reference-link" style={{ marginTop: 9 }} onClick={() => navigate(sourceCollection, sourceId)}>Edit source: {labelFor(sourceCollection)} / {sourceId}<ExternalLink size={13} /></button>}</div></div>
  </section>;
}

function CreatureDefinitionDetails({ record, resolved, loading, navigate }: { record: Record<string, unknown>; resolved?: Record<string, unknown>; loading: boolean; navigate: AppProps["navigate"] }) {
  const presentation = record.presentation;
  const profileId = typeof record.profileId === "string" ? record.profileId : undefined;
  const baseId = typeof record.baseId === "string" ? record.baseId : undefined;
  const loot = record.loot;
  const combat = resolved ? Object.fromEntries(Object.entries(resolved).filter(([key]) => !["id", "name", "family", "tier", "drops"].includes(key) && !ADVANCED_FIELDS.has(key))) : undefined;
  return <section className="detail-section" style={{ marginTop: 30 }}><div className="section-heading"><h2>Presentation and combat</h2><span>{loading ? "Resolving..." : resolved ? "Resolved view" : "No compiled view"}</span></div>
    {presentation !== undefined && <div className="field-group"><h3>Presentation</h3><ValueView value={presentation} navigate={navigate}/></div>}
    {profileId && <div className="field-row"><strong>Combat profile</strong><span><button className="reference-link" onClick={() => navigate("creatureProfiles", profileId)}>{profileId}<ChevronRight size={13}/></button></span></div>}
    {baseId && <div className="field-row"><strong>Inherited combat</strong><span><button className="reference-link" onClick={() => navigate("creatureDefinitions", baseId)}>{baseId}<ChevronRight size={13}/></button></span></div>}
    {combat && <div className="field-group"><h3>Resolved combat values</h3><ValueView value={combat} navigate={navigate}/></div>}
    {loot !== undefined && <div className="field-group"><h3>Drop source</h3><ValueView value={loot} navigate={navigate}/></div>}
    {!loading && !resolved && <p className="muted">The compiled combat table is unavailable in this snapshot.</p>}
  </section>;
}

export default EntityDetail;
