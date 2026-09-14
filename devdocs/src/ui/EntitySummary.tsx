import { lazy, Suspense, useMemo, useState } from "react";
import { ArrowRight, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { incomingReferences, outgoingReferences, refTargetCollection, summaryContext, type IncomingReference, type ReferenceIndex } from "../model/refs.js";
import { rowName } from "../model/rows.js";
import { percent, rangeText, summarize, titleCase, type SummaryContext } from "../model/summaries.js";
import { viewerSource } from "../model/viewerSource.js";
import { RefChip, RefRow } from "./RefChip.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";

const AssetViewer = lazy(() => import("../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })));
const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

interface Props { collection: string; record: ContentRow; recordId: string; index: ReferenceIndex; navigate: AppProps["navigate"]; /** When the sheet beside this column is editable, field-backed blocks are left to the sheet. */ editing?: boolean }

/** The context half of a record: model, derived numbers, and everything that points at it. */
export function EntitySummary({ collection, record, recordId, index, navigate, editing = false }: Props) {
  const ctx = useMemo(() => summaryContext(index), [index]);
  const summary = summarize(collection, record, ctx);
  const source = viewerSource(collection, record);
  const incoming = useMemo(() => incomingReferences(index, collection, recordId), [index, collection, recordId]);
  const outgoing = useMemo(() => outgoingReferences(record), [record]);
  const open = (target: string, id: string) => navigate(target, id);
  const base = collection.replace(/^compiled-/, "");
  return <div className="entity-summary">
    {source && <ModelStage source={source} label={summary.title} />}
    {summary.stats.length > 0 && <div className="summary-block"><h3>{editing ? "Resolved" : "Key numbers"}</h3><dl className="stat-grid">{summary.stats.map(stat => <div className="stat" key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl></div>}
    {editing ? <ContextBlocks collection={base} record={record} ctx={ctx} index={index} incoming={incoming} open={open} /> : <DomainBlocks collection={base} record={record} recordId={recordId} ctx={ctx} index={index} incoming={incoming} open={open} />}
    {!editing && <OutgoingBlock outgoing={outgoing} ctx={ctx} index={index} open={open} skip={domainHandledPaths(base)} />}
    <IncomingBlock incoming={incoming} ctx={ctx} open={open} skipCollections={domainHandledIncoming(base)} />
  </div>;
}

function ModelStage({ source, label }: { source: NonNullable<ReturnType<typeof viewerSource>>; label: string }) {
  const [large, setLarge] = useState(false);
  const [controls, setControls] = useState(false);
  return <div className="model-stage" data-large={large} data-controls={controls}>
    <div className="model-stage-actions">
      <button className={`icon-button${controls ? " is-active" : ""}`} aria-label={controls ? "Hide viewer controls" : "Show viewer controls"} title="Animation, pose and material controls" onClick={() => setControls(value => !value)}><SlidersHorizontal size={13} /></button>
      <button className="icon-button" aria-label={large ? "Smaller preview" : "Larger preview"} onClick={() => setLarge(value => !value)}>{large ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
    </div>
    <Suspense fallback={<p className="empty-inline" style={{ padding: 12 }}>Loading model…</p>}><AssetViewer source={source} label={label} /></Suspense>
  </div>;
}

function domainHandledPaths(base: string): RegExp | undefined {
  switch (base) {
    case "lootTables": return /^drops\[/;
    case "creatureDefinitions": return /^(loot\.|baseId|profileId|presentation\.assetId)/;
    case "recipes": return /^(inputs\[|output\.|burntItemId)/;
    case "equipmentSets": return /^members\./;
    case "shops": return /^stock\[/;
    case "quests": return /^(stages\[|rewards\.|giverNpcId|prerequisiteQuestIds)/;
    case "encounters": return /^members\[/;
    case "progression": return /^(materials\.|resourceIds|equipment\[|production\[)/;
    case "npcs": return /^(dialogueRootId|questIds)/;
    case "dialogue": return /^options\[/;
    case "spells": return /^cost\./;
    case "enemies": case "species": return /^(drops\[|stats\.drops)/;
    default: return undefined;
  }
}

function domainHandledIncoming(base: string): ReadonlySet<string> {
  switch (base) {
    case "creatureDefinitions": return new Set(["encounters"]);
    case "encounters": return new Set(["placements"]);
    default: return new Set();
  }
}

/** Blocks that are not fields on the record: where a creature spawns, where an encounter is placed, what a loot table feeds. */
function ContextBlocks({ collection, record, ctx, index, incoming, open }: { collection: string; record: ContentRow; ctx: SummaryContext; index: ReferenceIndex; incoming: IncomingReference[]; open: (collection: string, id: string) => void }) {
  if (collection === "creatureDefinitions") {
    const loot = asRecord(record.loot);
    const tableId = text(loot.tableId);
    const table = tableId ? ctx.lookup("lootTable", tableId) : undefined;
    const encounters = incoming.filter(reference => reference.collection === "encounters");
    const placements = encounters.flatMap(encounter => incomingReferences(index, "encounters", encounter.recordId).filter(reference => reference.collection === "placements"));
    return <>
      {tableId && <div className="summary-block"><h3>Shared drops<button className="text-button" onClick={() => open("lootTables", tableId)}>{table ? rowName(table) : tableId} <ArrowRight size={11} /></button></h3><div className="drop-grid">{list(table?.drops).map(asRecord).slice(0, 8).map((drop, i) => <button type="button" className="drop-tile" key={i} onClick={() => open("items", text(drop.itemId) ?? "")}><Thumb spec={{ kind: "item", id: text(drop.itemId) ?? "" }} size="m" /><span className="drop-tile-meta">{typeof drop.chance === "number" ? percent(drop.chance) : ""}</span></button>)}</div></div>}
      <div className="summary-block"><h3>Spawns<small>{placements.length}</small></h3>
        {placements.length ? <div className="ref-rows">{placements.slice(0, 10).map(placement => <RefRow key={`${placement.recordId}:${placement.path}`} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>{titleCase(text(placement.record.regionId) ?? "")}</span>} />)}{placements.length > 10 && <span className="empty-inline">{placements.length - 10} more on the map.</span>}</div>
          : encounters.length ? <div className="ref-list">{encounters.map(encounter => <RefChip key={encounter.recordId} collection="encounters" id={encounter.recordId} record={encounter.record} ctx={ctx} onOpen={open} />)}</div>
          : <span className="empty-inline">Not placed in any encounter.</span>}
      </div>
    </>;
  }
  if (collection === "encounters") {
    const placements = incoming.filter(reference => reference.collection === "placements");
    return <div className="summary-block"><h3>Placements<small>{placements.length}</small></h3>{placements.length ? <div className="ref-rows">{placements.map(placement => <RefRow key={placement.recordId} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>×{String(placement.record.count ?? 1)}</span>} />)}</div> : <span className="empty-inline">Not placed yet.</span>}</div>;
  }
  if (collection === "placements") return <div className="summary-block"><h3>Location</h3><Thumb spec={{ kind: "map", x: Number(list(record.centre)[0] ?? 0), z: Number(list(record.centre)[1] ?? 0), span: Math.max(120, Number(record.radius ?? 10) * 8) }} size="fill" className="map-large" /></div>;
  if (collection === "worldRegions") return <div className="summary-block"><h3>Map</h3><Thumb spec={summarize("worldRegions", record).thumb} size="fill" className="map-large" /></div>;
  return null;
}

function DomainBlocks({ collection, record, recordId, ctx, index, incoming, open }: { collection: string; record: ContentRow; recordId: string; ctx: SummaryContext; index: ReferenceIndex; incoming: IncomingReference[]; open: (collection: string, id: string) => void }) {
  const itemCollection = refTargetCollection("item", index.available) ?? "items";
  const creatureCollection = refTargetCollection("enemy", index.available) ?? "creatureDefinitions";
  switch (collection) {
    case "lootTables": return <DropsBlock drops={list(record.drops)} ctx={ctx} itemCollection={itemCollection} open={open} title="Drops" />;
    case "enemies": case "species": return <DropsBlock drops={list(record.drops).length ? list(record.drops) : list(asRecord(record.stats).drops)} ctx={ctx} itemCollection={itemCollection} open={open} title="Drops" />;
    case "creatureDefinitions": {
      const loot = asRecord(record.loot);
      const tableId = text(loot.tableId);
      const table = tableId ? ctx.lookup("lootTable", tableId) : undefined;
      const encounters = incoming.filter(reference => reference.collection === "encounters");
      const placements = encounters.flatMap(encounter => incomingReferences(index, "encounters", encounter.recordId).filter(reference => reference.collection === "placements"));
      return <>
        <div className="summary-block"><h3>Lineage</h3><div className="ref-list">
          {text(record.profileId) && <RefChip collection="creatureProfiles" id={record.profileId as string} record={ctx.lookup("creatureProfile", record.profileId as string)} ctx={ctx} onOpen={open} detail="profile" />}
          {text(record.baseId) && <RefChip collection={creatureCollection} id={record.baseId as string} record={ctx.lookup("enemy", record.baseId as string)} ctx={ctx} onOpen={open} detail="base" />}
          {text(asRecord(record.presentation).assetId) && <RefChip collection="assets" id={asRecord(record.presentation).assetId as string} record={ctx.lookup("asset", asRecord(record.presentation).assetId as string)} ctx={ctx} onOpen={open} detail="model" />}
          {!text(record.profileId) && !text(record.baseId) && <span className="empty-inline">No profile or base creature.</span>}
        </div></div>
        <DropsBlock drops={list(loot.drops).length ? list(loot.drops) : list(table?.drops)} ctx={ctx} itemCollection={itemCollection} open={open} title={tableId ? "Drops" : "Inline drops"} action={tableId ? <button className="text-button" onClick={() => open("lootTables", tableId)}>{table ? rowName(table) : tableId} <ArrowRight size={12} /></button> : undefined} />
        <div className="summary-block"><h3>Spawns<small>{placements.length} placements</small></h3>
          {placements.length ? <div className="ref-rows">{placements.slice(0, 12).map(placement => <RefRow key={`${placement.recordId}:${placement.path}`} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>{titleCase(text(placement.record.regionId) ?? "")}</span>} />)}{placements.length > 12 && <span className="empty-inline">{placements.length - 12} more on the map.</span>}</div>
            : encounters.length ? <div className="ref-list">{encounters.map(encounter => <RefChip key={encounter.recordId} collection="encounters" id={encounter.recordId} record={encounter.record} ctx={ctx} onOpen={open} />)}</div>
            : <span className="empty-inline">Not placed in any encounter.</span>}
        </div>
      </>;
    }
    case "recipes": {
      const inputs = list(record.inputs).map(asRecord);
      const output = asRecord(record.output);
      return <div className="summary-block"><h3>Crafting</h3><div className="recipe-flow">
        <div className="ref-list">{inputs.map((input, index) => <RefChip key={index} collection={itemCollection} id={text(input.itemId) ?? ""} record={ctx.lookup("item", text(input.itemId) ?? "")} ctx={ctx} onOpen={open} size="l" detail={`×${rangeText(input.quantity) || 1}`} />)}</div>
        <ArrowRight size={16} className="muted" />
        <div className="ref-list">{text(output.itemId) && <RefChip collection={itemCollection} id={output.itemId as string} record={ctx.lookup("item", output.itemId as string)} ctx={ctx} onOpen={open} size="l" detail={`×${rangeText(output.quantity) || 1}`} />}{text(record.burntItemId) && <RefChip collection={itemCollection} id={record.burntItemId as string} record={ctx.lookup("item", record.burntItemId as string)} ctx={ctx} onOpen={open} detail="burnt" />}</div>
      </div></div>;
    }
    case "equipmentSets": {
      const members = asRecord(record.members);
      const thresholds = list(record.thresholds).map(asRecord);
      return <>
        <div className="summary-block"><h3>Pieces</h3><div className="ref-list">{["head", "body", "legs", "hands", "feet"].map(slot => text(members[slot]) ? <RefChip key={slot} collection={itemCollection} id={members[slot] as string} record={ctx.lookup("item", members[slot] as string)} ctx={ctx} onOpen={open} size="l" detail={slot} /> : <span key={slot} className="ref-chip is-missing" data-size="l"><span>{titleCase(slot)}</span><small>empty</small></span>)}</div></div>
        {thresholds.length > 0 && <div className="summary-block"><h3>Set bonuses</h3><dl className="stat-grid">{thresholds.map((threshold, index) => <div className="stat" key={index}><dt>{String(threshold.pieces)} pieces</dt><dd>{Object.entries(asRecord(threshold.bonuses)).filter(([, value]) => typeof value === "number" && value !== 0).map(([key, value]) => `${titleCase(key)} +${value}`).join(", ") || "—"}</dd></div>)}</dl></div>}
      </>;
    }
    case "shops": {
      const stock = list(record.stock).map(asRecord);
      return <div className="summary-block"><h3>Stock<small>{stock.length} lines</small></h3><div className="ref-list">{stock.map((entry, index) => <RefChip key={index} collection={itemCollection} id={text(entry.itemId) ?? ""} record={ctx.lookup("item", text(entry.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${rangeText(entry.quantity) || 1}`} />)}</div></div>;
    }
    case "quests": {
      const stages = list(record.stages).map(asRecord);
      const rewards = asRecord(record.rewards);
      const giver = text(record.giverNpcId);
      return <>
        <div className="summary-block"><h3>Quest</h3><div className="ref-list">
          {giver && <RefChip collection="npcs" id={giver} record={ctx.lookup("npc", giver)} ctx={ctx} onOpen={open} detail="giver" />}
          {list(record.prerequisiteQuestIds).map(id => <RefChip key={String(id)} collection="quests" id={String(id)} record={ctx.lookup("quest", String(id))} ctx={ctx} onOpen={open} detail="requires" />)}
        </div></div>
        <div className="summary-block"><h3>Stages<small>{stages.length}</small></h3><ol className="stage-list">{stages.map((stage, stageIndex) => {
          const refs = list(stage.refs).map(asRecord);
          const completion = asRecord(stage.completion);
          return <li key={stageIndex}><span className="entry-number">{String(stage.index ?? stageIndex)}</span><div><p>{text(stage.objective) ?? titleCase(text(completion.kind) ?? "stage")}</p>{refs.length > 0 && <div className="ref-list" style={{ marginTop: 4 }}>{refs.map((ref, refIndex) => { const kind = text(ref.kind) ?? ""; const target = kind === "item" ? itemCollection : kind === "recipe" ? (refTargetCollection("recipe", index.available) ?? "recipes") : kind === "spell" ? "spells" : undefined; return target ? <RefChip key={refIndex} collection={target} id={text(ref.id) ?? ""} record={ctx.lookup(kind, text(ref.id) ?? "")} ctx={ctx} onOpen={open} /> : <span key={refIndex} className="badge">{kind}: {text(ref.id)}</span>; })}</div>}</div></li>;
        })}</ol></div>
        <div className="summary-block"><h3>Rewards</h3><div className="ref-list">
          {list(rewards.items).map(asRecord).map((entry, index) => <RefChip key={index} collection={itemCollection} id={text(entry.itemId) ?? ""} record={ctx.lookup("item", text(entry.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${rangeText(entry.quantity) || 1}`} />)}
          {Object.entries(asRecord(rewards.xp)).map(([skill, xp]) => <span className="badge" data-tone="info" key={skill}>{titleCase(skill)} +{String(xp)} xp</span>)}
          {typeof rewards.currency === "number" && <span className="badge" data-tone="accent">{rewards.currency} coins</span>}
        </div></div>
      </>;
    }
    case "encounters": {
      const members = list(record.members).map(asRecord);
      const placements = incoming.filter(reference => reference.collection === "placements");
      return <>
        <div className="summary-block"><h3>Members</h3><div className="ref-list">{members.map((member, index) => <RefChip key={index} collection={creatureCollection} id={text(member.creatureId) ?? ""} record={ctx.lookup("enemy", text(member.creatureId) ?? "")} ctx={ctx} onOpen={open} size="l" detail={`weight ${String(member.weight ?? 1)}`} />)}</div></div>
        <div className="summary-block"><h3>Placements<small>{placements.length}</small></h3>{placements.length ? <div className="ref-rows">{placements.map(placement => <RefRow key={placement.recordId} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>×{String(placement.record.count ?? 1)}</span>} />)}</div> : <span className="empty-inline">Not placed yet.</span>}</div>
      </>;
    }
    case "placements": {
      const encounterId = text(record.encounterId);
      const encounter = encounterId ? ctx.lookup("encounter", encounterId) : undefined;
      const members = list(encounter?.members).map(asRecord);
      return <>
        <div className="summary-block"><h3>Location</h3><Thumb spec={{ kind: "map", x: Number(list(record.centre)[0] ?? 0), z: Number(list(record.centre)[1] ?? 0), span: Math.max(120, Number(record.radius ?? 10) * 8) }} size="fill" className="map-large" /></div>
        <div className="summary-block"><h3>Encounter</h3><div className="ref-list">{encounterId && <RefChip collection="encounters" id={encounterId} record={encounter} ctx={ctx} onOpen={open} size="l" />}{members.map((member, index) => <RefChip key={index} collection={creatureCollection} id={text(member.creatureId) ?? ""} record={ctx.lookup("enemy", text(member.creatureId) ?? "")} ctx={ctx} onOpen={open} detail={`w ${String(member.weight ?? 1)}`} />)}</div></div>
      </>;
    }
    case "worldRegions": {
      const locations = list(record.locations).map(asRecord);
      return <>
        <div className="summary-block"><h3>Map</h3><Thumb spec={summarize("worldRegions", record).thumb} size="fill" className="map-large" /></div>
        <div className="summary-block"><h3>Locations<small>{locations.length}</small></h3><div className="ref-list">{locations.map((location, index) => <span className="badge" key={index} title={text(location.id)}>{titleCase(text(location.kind) ?? "")}: {text(location.name) ?? text(location.id)}</span>)}</div></div>
      </>;
    }
    case "npcs": return <div className="summary-block"><h3>Story</h3><div className="ref-list">
      {text(record.dialogueRootId) && <RefChip collection="dialogue" id={record.dialogueRootId as string} record={ctx.lookup("dialogue", record.dialogueRootId as string)} ctx={ctx} onOpen={open} detail="dialogue" />}
      {list(record.questIds).map(id => <RefChip key={String(id)} collection="quests" id={String(id)} record={ctx.lookup("quest", String(id))} ctx={ctx} onOpen={open} detail="quest" />)}
      {text(record.regionId) && <RefChip collection="worldRegions" id={record.regionId as string} record={ctx.lookup("region", record.regionId as string)} ctx={ctx} onOpen={open} detail="region" />}
    </div></div>;
    case "dialogue": {
      const options = list(record.options).map(asRecord);
      return <div className="summary-block"><h3>Options<small>{options.length}</small></h3><div className="ref-rows">{options.map((option, index) => {
        const next = text(option.next);
        return <div className="ref-row" key={index} style={{ cursor: "default" }}><span className="entry-number">{index + 1}</span><span className="ref-row-body"><span className="ref-row-title">{text(option.text)}</span><span className="ref-row-sub">{next ? `→ ${next}` : "ends conversation"}</span></span>{next && <button className="text-button" onClick={() => open("dialogue", next)}>Open <ArrowRight size={12} /></button>}</div>;
      })}</div></div>;
    }
    case "spells": {
      const cost = asRecord(record.cost);
      const runes = list(cost.runes).map(asRecord);
      return runes.length ? <div className="summary-block"><h3>Rune cost</h3><div className="ref-list">{runes.map((rune, index) => <RefChip key={index} collection={itemCollection} id={text(rune.itemId) ?? ""} record={ctx.lookup("item", text(rune.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${String(rune.quantity ?? 1)}`} />)}</div></div> : null;
    }
    case "progression": {
      const materials = asRecord(record.materials);
      return <>
        <div className="summary-block"><h3>Materials<small>{Object.keys(materials).length}</small></h3><div className="ref-list">{Object.entries(materials).map(([slot, id]) => <RefChip key={slot} collection={itemCollection} id={String(id)} record={ctx.lookup("item", String(id))} ctx={ctx} onOpen={open} detail={slot} />)}</div></div>
        <div className="summary-block"><h3>Gathering</h3><div className="ref-list">{list(record.resourceIds).map(id => <RefChip key={String(id)} collection="resources" id={String(id)} record={ctx.lookup("resource", String(id))} ctx={ctx} onOpen={open} />)}</div></div>
        <div className="summary-block"><h3>Generated gear<small>{list(record.equipment).length}</small></h3><div className="ref-list">{list(record.equipment).map(asRecord).map(gear => <RefChip key={String(gear.id)} collection={itemCollection} id={String(gear.id)} record={ctx.lookup("item", String(gear.id))} ctx={ctx} onOpen={open} />)}</div></div>
      </>;
    }
    default: return null;
  }
}

function DropsBlock({ drops, ctx, itemCollection, open, title, action }: { drops: unknown[]; ctx: SummaryContext; itemCollection: string; open: (collection: string, id: string) => void; title: string; action?: React.ReactNode }) {
  const rows = drops.map(asRecord);
  return <div className="summary-block"><h3>{title}<small>{rows.length}</small>{action}</h3>
    {rows.length ? <div className="drop-grid">{rows.map((drop, index) => {
      const itemId = text(drop.itemId) ?? "";
      const chance = typeof drop.chance === "number" ? drop.chance : undefined;
      return <button type="button" className="drop-tile" key={index} onClick={() => open(itemCollection, itemId)} title={itemId}>
        <Thumb spec={{ kind: "item", id: itemId }} size="l" />
        <span className="drop-tile-name">{rowName(ctx.lookup("item", itemId) ?? { id: itemId })}</span>
        <span className="drop-tile-meta"><span>×{rangeText(drop.quantity) || "1"}</span>{chance !== undefined && <span className="drop-chance" style={{ "--chance": chance } as React.CSSProperties}>{percent(chance)}</span>}</span>
        {text(drop.exclusiveGroup) && <span className="badge" data-tone="info">{drop.exclusiveGroup as string}</span>}
      </button>;
    })}</div> : <span className="empty-inline">No drops.</span>}
  </div>;
}

function OutgoingBlock({ outgoing, ctx, index, open, skip }: { outgoing: ReturnType<typeof outgoingReferences>; ctx: SummaryContext; index: ReferenceIndex; open: (collection: string, id: string) => void; skip?: RegExp }) {
  const shown = outgoing.filter(reference => !skip?.test(reference.path));
  if (!shown.length) return null;
  const seen = new Set<string>();
  return <div className="summary-block"><h3>Links</h3><div className="ref-list">{shown.flatMap(reference => {
    const key = `${reference.kind}:${reference.targetId}:${reference.role}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const target = refTargetCollection(reference.kind, index.available);
    if (!target) return [<span className="badge" key={key} title={reference.path}>{reference.role}: {reference.targetId}</span>];
    return [<RefChip key={key} collection={target} id={reference.targetId} record={ctx.lookup(reference.kind, reference.targetId)} ctx={ctx} onOpen={open} detail={reference.role} />];
  })}</div></div>;
}

function IncomingBlock({ incoming, ctx, open, skipCollections }: { incoming: IncomingReference[]; ctx: SummaryContext; open: (collection: string, id: string) => void; skipCollections: ReadonlySet<string> }) {
  const groups = new Map<string, IncomingReference[]>();
  for (const reference of incoming) {
    if (skipCollections.has(reference.collection)) continue;
    const key = reference.collection;
    const bucket = groups.get(key) ?? [];
    if (!bucket.some(existing => existing.recordId === reference.recordId)) bucket.push(reference);
    groups.set(key, bucket);
  }
  if (!groups.size) return <div className="summary-block"><h3>Used by</h3><span className="empty-inline">Nothing references this record.</span></div>;
  return <div className="summary-block"><h3>Used by<small>{[...groups.values()].reduce((sum, bucket) => sum + bucket.length, 0)}</small></h3>
    {[...groups.entries()].map(([collection, references]) => <div key={collection} className="incoming-group">
      <span className="summary-title">{labelFor(collection)}<small>{references.length}</small></span>
      <div className="ref-list">{references.slice(0, 40).map(reference => <RefChip key={`${reference.recordId}:${reference.path}`} collection={reference.collection} id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} detail={reference.role} />)}{references.length > 40 && <span className="empty-inline">{references.length - 40} more</span>}</div>
    </div>)}
  </div>;
}
