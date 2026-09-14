import { useMemo } from "react";
import { MapPin, Users } from "lucide-react";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { titleCase } from "../../model/summaries.js";
import { CollectionPage } from "../../pages/CollectionPage.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { RefChip, RefRow } from "../../ui/RefChip.js";
import { Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { AddButton, clip, findStand, list, PageState, position, regionName, regionOptions, RecordShell, RemoveButton, SelectField, strings, text, TextField, usePage, type Page } from "./shared.js";

interface Npc extends ContentRow {
  id: string; name: string; regionId?: string; settlementId?: string; role?: string; voice?: string;
  dialogueRootId?: string; questIds?: string[]; locationId?: string; assetId?: string; catalog?: string;
}

export default function NpcsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <CollectionPage collection="npcs" recordId={undefined} navigate={navigate} />;
  return <NpcPage id={recordId} navigate={navigate} />;
}

function NpcPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Npc>("npcs", id);
  const { draft, index, ctx } = page;
  const editable = draft.editable;
  const stand = useMemo(() => findStand(index, "npcs", id), [index, id]);
  return <PageState page={page} collection="npcs" navigate={navigate}>{(npc, record) => {
    const questIds = strings(npc.questIds);
    const point = position(stand?.stand.position);
    const settlementName = text(stand?.settlement.name) ?? npc.settlementId;
    const root = text(npc.dialogueRootId);
    const asset = npc.assetId ? ctx.lookup("asset", npc.assetId) : undefined;
    return <RecordShell
      thumb={npc.assetId ? { kind: "asset", assetId: npc.assetId, icon: Users } : { kind: "glyph", icon: Users }}
      title={npc.name} id={id}
      facts={[regionName(index, npc.regionId), settlementName, npc.catalog && titleCase(npc.catalog)]}
      draft={draft}
      rail={<EntitySummary collection="npcs" record={record} recordId={id} index={index} navigate={navigate} editing />}>
      <Sheet>
        <Section title="Identity">
          <Row label="Name"><TextField editable={editable} value={npc.name} onChange={value => draft.setPath(["name"], value)} ariaLabel="Name" /></Row>
          <Row label="Role" align="start"><TextField editable={editable} value={npc.role} onChange={value => draft.setPath(["role"], value)} multiline ariaLabel="Role" /></Row>
          <Row label="Voice" align="start"><TextField editable={editable} value={npc.voice} onChange={value => draft.setPath(["voice"], value)} multiline ariaLabel="Voice" /></Row>
          <Row label="Region"><SelectField editable={editable} value={npc.regionId} onChange={value => draft.setPath(["regionId"], value)} options={regionOptions(index)} ariaLabel="Region" /></Row>
          <Row label="Settlement"><TextField editable={editable} value={npc.settlementId} onChange={value => draft.setPath(["settlementId"], value || undefined)} width="id" mono ariaLabel="Settlement" /></Row>
          <Row label="Location"><TextField editable={editable} value={npc.locationId} onChange={value => draft.setPath(["locationId"], value || undefined)} width="id" mono ariaLabel="Location" /></Row>
          <Row label="Model">
            {npc.assetId ? <RefChip collection="assets" id={npc.assetId} record={asset} ctx={ctx} onOpen={(collection, target) => navigate(collection, target)} /> : <Static muted>No model</Static>}
            {editable && <RecordPicker collection="assets" value={npc.assetId} ctx={ctx} onPick={picked => draft.setPath(["assetId"], picked)} trigger={<button type="button" className="button button-small" aria-label="Change model">{npc.assetId ? "Change" : "Choose"}</button>} />}
            {editable && npc.assetId && <RemoveButton label="Clear model" onClick={() => draft.setPath(["assetId"], undefined)} />}
          </Row>
        </Section>
        <Section title="Dialogue">
          <Row label="Root">
            {root ? <RefChip collection="dialogue" id={root} record={ctx.lookup("dialogue", root)} ctx={ctx} onOpen={(collection, target) => navigate(collection, target)} /> : <Static muted>No dialogue</Static>}
            {editable && <RecordPicker collection="dialogue" value={root} ctx={ctx} onPick={picked => draft.setPath(["dialogueRootId"], picked)} trigger={<button type="button" className="button button-small" aria-label="Change dialogue root">{root ? "Change" : "Choose"}</button>} />}
          </Row>
          {root && <Row label="Outline" align="start"><DialogueOutline rootId={root} page={page} navigate={navigate} /></Row>}
        </Section>
        <Section title="Quests" aside={editable && <RecordPicker collection="quests" ctx={ctx} exclude={new Set(questIds)} onPick={picked => draft.setPath(["questIds"], [...questIds, picked])} trigger={<AddButton label="Add quest">Add</AddButton>} />}>
          {questIds.length
            ? <div className="ref-rows">{questIds.map((questId, position) => {
              const quest = ctx.lookup("quest", questId);
              return <RefRow key={questId} collection="quests" id={questId} record={quest} ctx={ctx} onOpen={(collection, target) => navigate(collection, target)}
                meta={quest ? <span>{titleCase(text(quest.kind) ?? "")}</span> : undefined}
                trailing={editable ? <RemoveButton label={`Remove ${quest ? String(quest.name) : questId}`} onClick={() => draft.setPath(["questIds"], questIds.filter((_, at) => at !== position))} /> : undefined} />;
            })}</div>
            : <span className="story-empty">No quests offered.</span>}
        </Section>
        <Section title="Where">
          {stand
            ? <div className="story-where">
              <Thumb spec={point ? { kind: "map", x: point.x, z: point.z, span: 80, icon: MapPin } : { kind: "glyph", icon: MapPin }} size="l" alt="" />
              <div className="story-where-text">
                <span>{stand.regionName} · {String(stand.settlement.name)}{point && <span className="muted mono"> · {point.x}, {point.z}</span>}</span>
                <span><button type="button" className="text-button" onClick={() => navigate("world/map", `npcs:${id}`)}>Show on map</button></span>
              </div>
            </div>
            : <span className="story-empty">Not standing in any settlement.</span>}
        </Section>
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


