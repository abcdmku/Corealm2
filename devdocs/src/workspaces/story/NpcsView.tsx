import { useMemo } from "react";
import { Users } from "lucide-react";
import { fairyNpcSchema, npcSchema } from "../../../../game/src/content/schema/people.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { titleCase } from "../../model/summaries.js";
import { CollectionPage } from "../../pages/CollectionPage.js";
import { ChoiceField, Field, ListField, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, fieldFromSchema } from "../../ui/field/index.js";
import { PointsMap } from "../../ui/PointsMap.js";
import type { ViewProps } from "../types.js";
import { clip, findStand, list, nameOf, PageState, position, RecordShell, RefCell, regionName, regionOptions, strings, text, usePage, type Page } from "./shared.js";

interface Npc extends ContentRow {
  id: string; name: string; regionId?: string; settlementId?: string; role?: string; voice?: string;
  dialogueRootId?: string; questIds?: string[]; locationId?: string; assetId?: string; bindHeightMetres?: number; catalog?: string;
}

const npc = (key: string) => fieldFromSchema(npcSchema, key);
const fairy = (key: string) => fieldFromSchema(fairyNpcSchema, key);

export default function NpcsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <CollectionPage collection="npcs" recordId={undefined} navigate={navigate} />;
  return <NpcPage id={recordId} navigate={navigate} />;
}

function NpcPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Npc>("npcs", id);
  const { draft, index, ctx } = page;
  const readOnly = !draft.editable;
  const stand = useMemo(() => findStand(index, "npcs", id), [index, id]);
  const regions = useMemo(() => regionOptions(index), [index]);
  return <PageState page={page} collection="npcs" navigate={navigate}>{record => {
    const questIds = strings(record.questIds);
    const point = position(stand?.stand.position);
    const settlementName = text(stand?.settlement.name) ?? record.settlementId;
    const root = text(record.dialogueRootId);
    return <RecordShell
      thumb={record.assetId ? { kind: "asset", assetId: record.assetId, icon: Users } : { kind: "glyph", icon: Users }}
      title={record.name} id={id}
      facts={[regionName(index, record.regionId), settlementName, record.catalog && titleCase(record.catalog)]}
      draft={draft}
      rail={<div className="entity-summary"><div className="summary-block"><h3>Where</h3>
        {stand
          ? <div className="story-where">
            {point && <PointsMap points={[{ id, x: point.x, z: point.z, label: String(stand.settlement.name) }]} onOpen={() => navigate("world/map", `npcs:${id}`)} onOpenAt={() => navigate("world/map", `npcs:${id}`)} />}
            <div className="story-where-text">
              <span>{stand.regionName} · {String(stand.settlement.name)}{point && <span className="muted mono"> · {point.x}, {point.z}</span>}</span>
              <span><button type="button" className="text-button" onClick={() => navigate("world/map", `npcs:${id}`)}>Show on map</button></span>
            </div>
          </div>
          : <span className="empty-inline">Not standing in any settlement.</span>}
      </div></div>}>
      <Sheet>
        <Section title="Identity">
          <Field label={npc("name").label}><TextField value={record.name ?? ""} readOnly={readOnly} onChange={value => draft.setPath(["name"], value)} /></Field>
          <Field label={npc("role").label}><TextField value={record.role ?? ""} multiline readOnly={readOnly} onChange={value => draft.setPath(["role"], value)} /></Field>
          <Field label={npc("voice").label}><TextField value={record.voice ?? ""} multiline readOnly={readOnly} onChange={value => draft.setPath(["voice"], value)} /></Field>
          <Field label={npc("regionId").label}><ChoiceField value={text(record.regionId)} options={regions} readOnly={readOnly} onChange={value => draft.setPath(["regionId"], value)} /></Field>
          <RefField kind="settlement" label={npc("settlementId").label} hint={npc("settlementId").hint} value={text(record.settlementId)} readOnly={readOnly} onChange={value => draft.setPath(["settlementId"], value)} />
          <RefField kind="location" label={npc("locationId").label} hint={npc("locationId").hint} value={text(record.locationId)} readOnly={readOnly} onChange={value => draft.setPath(["locationId"], value)} />
          {record.catalog === "fairy" && <>
            <RefField kind="asset" label={fairy("assetId").label} value={text(record.assetId)} readOnly={readOnly} onChange={value => draft.setPath(["assetId"], value)} />
            <Field label={fairy("bindHeightMetres").label} unit={fairy("bindHeightMetres").unit}>
              <NumberField value={typeof record.bindHeightMetres === "number" ? record.bindHeightMetres : undefined} min={fairy("bindHeightMetres").min} step={0.05} unit={fairy("bindHeightMetres").unit} readOnly={readOnly} ariaLabel={fairy("bindHeightMetres").label} onChange={value => draft.setPath(["bindHeightMetres"], value)} />
            </Field>
          </>}
        </Section>

        <Section title="Dialogue">
          <RefField kind="dialogue" label={npc("dialogueRootId").label} optional value={root} readOnly={readOnly} onChange={value => draft.setPath(["dialogueRootId"], value)} />
          {root && <Field label="Outline"><DialogueOutline rootId={root} page={page} navigate={navigate} /></Field>}
        </Section>

        <Section title={npc("questIds").label}>
          <ListField<string> hint={npc("questIds").hint} items={questIds} ordered readOnly={readOnly}
            emptyText="No quests offered." addLabel="Add quest" onAdd={() => ""}
            onChange={next => draft.setPath(["questIds"], next)}
            removeLabel={questId => `Remove ${nameOf(ctx, "quest", questId)}`}
            renderItem={(questId, api) => <RefCell label={`Quest ${api.index + 1}`} kind="quest" value={questId || undefined} readOnly={readOnly}
              exclude={new Set(questIds.filter((_, at) => at !== api.index))}
              onChange={value => api.update(value ?? "")} />} />
        </Section>

        <ReferencedBy collection="npcs" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

/* ---------- Conversation outline ---------- */

const MAX_DEPTH = 6;

/** Walk dialogue nodes from a root, following `options[].next`, as an indented tree. */
function DialogueOutline({ rootId, page, navigate }: { rootId: string; page: Page<Npc>; navigate: ViewProps["navigate"] }) {
  const nodes = useMemo(() => {
    const response = page.index.collections.get("dialogue");
    return new Map(response ? contentRows(response).map(row => [String(row.id), row]) : []);
  }, [page.index]);
  if (!nodes.size) return <span className="story-empty">Loading dialogue…</span>;
  return <ul className="dlg-outline"><OutlineNode id={rootId} nodes={nodes} depth={0} seen={new Set()} navigate={navigate} /></ul>;
}

function OutlineNode({ id, nodes, depth, seen, navigate }: { id: string; nodes: Map<string, ContentRow>; depth: number; seen: Set<string>; navigate: ViewProps["navigate"] }) {
  const node = nodes.get(id);
  const open = () => navigate("dialogue", id);
  if (!node) return <li><button type="button" className="dlg-node" onClick={open}><span className="dlg-speaker">?</span><span className="dlg-text">{id} is missing</span></button></li>;
  const branch = new Set(seen).add(id);
  const options = list(node.options).map(option => option as ContentRow);
  return <li>
    <button type="button" className="dlg-node" onClick={open} title={`${id}\n${String(node.text ?? "")}`}>
      <span className="dlg-speaker">{text(node.speaker) ?? "—"}</span>
      <span className="dlg-text">{clip(text(node.text), 120)}</span>
    </button>
    {options.length > 0 && <ul>{options.map((option, index) => {
      const next = text(option.next);
      const cycle = next !== undefined && branch.has(next);
      const tooDeep = depth + 1 >= MAX_DEPTH;
      return <li key={String(option.id ?? index)}>
        <button type="button" className="dlg-option" onClick={() => navigate("dialogue", next ?? id)} title={String(option.id ?? "")}>
          <span className="dlg-text">{clip(text(option.text), 100)}</span>
          {next === undefined && <span className="dlg-end">ends</span>}
          {cycle && <span className="dlg-loop">↺ {next}</span>}
          {!cycle && tooDeep && next !== undefined && <span className="dlg-loop">→ {next}</span>}
        </button>
        {next !== undefined && !cycle && !tooDeep && <ul><OutlineNode id={next} nodes={nodes} depth={depth + 1} seen={branch} navigate={navigate} /></ul>}
      </li>;
    })}</ul>}
  </li>;
}
