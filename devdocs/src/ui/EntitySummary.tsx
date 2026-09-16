import { Suspense, useMemo, useState } from "react";
import { lazyComponent } from "../workspaces/lazyView.js";
import { ArrowRight, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { incomingReferences, outgoingReferences, refTargetCollection, summaryContext, type IncomingReference, type ReferenceIndex } from "../model/refs.js";
import { rowName } from "../model/rows.js";
import { percent, rangeText, summarize, titleCase, type SummaryContext } from "../model/summaries.js";
import { viewerSource } from "../model/viewerSource.js";
import { RefChip, RefRow } from "./RefChip.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";
import { Button, Badge } from "../components/ui/index.js";
import { chipVariants } from "../components/ui/chip.js";
import { EMPTY } from "./layout.js";
import { cn } from "../lib/utils.js";

const AssetViewer = lazyComponent(() => import("../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })));
const asRecord = (value: unknown): ContentRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentRow : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

/** A titled block in the rail: a small faint heading with an optional mono count, then its content. */
const BLOCK = "flex flex-col gap-[5px] [&>h3]:flex [&>h3]:items-center [&>h3]:gap-[5px] [&>h3]:text-[11px] [&>h3]:font-semibold [&>h3]:text-faint [&_h3_small]:font-mono [&_h3_small]:font-normal";
const STAT_GRID = "grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1";
const STAT = "flex min-w-0 flex-col gap-px rounded-md bg-secondary px-2 py-[5px] [&_dd]:m-0 [&_dd]:font-mono [&_dd]:text-xs [&_dd]:font-medium [&_dd]:text-foreground [&_dd_small]:ml-[3px] [&_dd_small]:text-[11px] [&_dd_small]:text-faint [&_dt]:truncate [&_dt]:text-[11px] [&_dt]:text-faint";
const MAP = "aspect-[16/10] h-auto w-full rounded-md border border-border";
const INDEX = "grid h-[17px] place-items-center rounded-sm bg-secondary font-mono text-[11px] text-faint";

interface Props { collection: string; record: ContentRow; recordId: string; index: ReferenceIndex; navigate: AppProps["navigate"]; /** When the sheet beside this column is editable, field-backed blocks are left to the sheet. */ editing?: boolean; /** Inside a record page's rail: no panel of its own, the rail is the frame. */ bare?: boolean }

/** The context half of a record: model, derived numbers, and everything that points at it. */
export function EntitySummary({ collection, record, recordId, index, navigate, editing = false, bare = false }: Props) {
  const ctx = useMemo(() => summaryContext(index), [index]);
  const summary = summarize(collection, record, ctx);
  const source = viewerSource(collection, record);
  const incoming = useMemo(() => incomingReferences(index, collection, recordId), [index, collection, recordId]);
  const outgoing = useMemo(() => outgoingReferences(record), [record]);
  const open = (target: string, id: string) => navigate(target, id);
  const base = collection.replace(/^compiled-/, "");
  return <div className={cn("flex min-w-0 flex-col gap-3", !bare && "border-r border-border-subtle bg-sidebar px-3 pt-2.5 pb-8 max-[1100px]:border-r-0 max-[1100px]:border-b max-md:px-2.5")}>
    {source && <ModelStage source={source} label={summary.title} />}
    {/* Beside an editable sheet the numbers are already on the page, live; repeating them here only adds noise. */}
    {!editing && summary.stats.length > 0 && <div className={BLOCK}><h3>Key numbers</h3><dl className={STAT_GRID}>{summary.stats.map(stat => <div className={STAT} key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl></div>}
    {editing ? <ContextBlocks collection={base} record={record} ctx={ctx} index={index} incoming={incoming} open={open} /> : <DomainBlocks collection={base} record={record} recordId={recordId} ctx={ctx} index={index} incoming={incoming} open={open} />}
    {!editing && <OutgoingBlock outgoing={outgoing} ctx={ctx} index={index} open={open} skip={domainHandledPaths(base)} />}
    {/* An editable sheet ends with its own "Referenced by" section, so the rail does not repeat it. */}
    {!editing && <IncomingBlock incoming={incoming} ctx={ctx} open={open} skipCollections={domainHandledIncoming(base)} />}
  </div>;
}

/**
 * A record's 3D model in a square frame, with a toggle for the viewer's controls and one for a
 * taller frame. `className` sets the frame's shape for a wider page (`aspect-video`, say).
 */
export function ModelStage({ source, label, className, largeClassName = "aspect-[3/4]" }: { source: NonNullable<ReturnType<typeof viewerSource>>; label: string; className?: string; largeClassName?: string }) {
  const [large, setLarge] = useState(false);
  const [controls, setControls] = useState(false);
  return <div className={cn("relative aspect-square overflow-hidden rounded-md border border-border bg-art", className, large && largeClassName, controls && "aspect-auto")} data-large={large} data-controls={controls}>
    <div className="absolute top-1.5 right-1.5 z-2 flex gap-[3px]">
      <Button variant="ghost" size="icon-sm" aria-pressed={controls} aria-label={controls ? "Hide viewer controls" : "Show viewer controls"} title="Animation, pose and material controls" onClick={() => setControls(value => !value)}><SlidersHorizontal size={13} /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={large ? "Smaller preview" : "Larger preview"} onClick={() => setLarge(value => !value)}>{large ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Button>
    </div>
    <Suspense fallback={<p className={cn(EMPTY, "p-3")}>Loading model…</p>}><AssetViewer source={source} label={label} stage controls={controls} /></Suspense>
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
  // The creature sheet carries its own loot and spawn map; the rail keeps the model and references.
  if (collection === "encounters") {
    const placements = incoming.filter(reference => reference.collection === "placements");
    return <div className={BLOCK}><h3>Placements<small>{placements.length}</small></h3>{placements.length ? <div className="flex flex-col gap-0.5">{placements.map(placement => <RefRow key={placement.recordId} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>×{String(placement.record.count ?? 1)}</span>} />)}</div> : <span className={EMPTY}>Not placed yet.</span>}</div>;
  }
  if (collection === "placements") return <div className={BLOCK}><h3>Location</h3><Thumb spec={{ kind: "map", x: Number(list(record.centre)[0] ?? 0), z: Number(list(record.centre)[1] ?? 0), span: Math.max(120, Number(record.radius ?? 10) * 8) }} size="fill" className={MAP} /></div>;
  if (collection === "worldRegions") return <div className={BLOCK}><h3>Map</h3><Thumb spec={summarize("worldRegions", record).thumb} size="fill" className={MAP} /></div>;
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
        <div className={BLOCK}><h3>Lineage</h3><div className="flex flex-wrap gap-1">
          {text(record.profileId) && <RefChip collection="creatureProfiles" id={record.profileId as string} record={ctx.lookup("creatureProfile", record.profileId as string)} ctx={ctx} onOpen={open} detail="profile" />}
          {text(record.baseId) && <RefChip collection={creatureCollection} id={record.baseId as string} record={ctx.lookup("enemy", record.baseId as string)} ctx={ctx} onOpen={open} detail="base" />}
          {text(asRecord(record.presentation).assetId) && <RefChip collection="assets" id={asRecord(record.presentation).assetId as string} record={ctx.lookup("asset", asRecord(record.presentation).assetId as string)} ctx={ctx} onOpen={open} detail="model" />}
          {!text(record.profileId) && !text(record.baseId) && <span className={EMPTY}>No profile or base creature.</span>}
        </div></div>
        <DropsBlock drops={list(loot.drops).length ? list(loot.drops) : list(table?.drops)} ctx={ctx} itemCollection={itemCollection} open={open} title={tableId ? "Drops" : "Inline drops"} action={tableId ? <Button variant="link" size="inline" onClick={() => open("lootTables", tableId)}>{table ? rowName(table) : tableId} <ArrowRight size={12} /></Button> : undefined} />
        <div className={BLOCK}><h3>Spawns<small>{placements.length} placements</small></h3>
          {placements.length ? <div className="flex flex-col gap-0.5">{placements.slice(0, 12).map(placement => <RefRow key={`${placement.recordId}:${placement.path}`} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>{titleCase(text(placement.record.regionId) ?? "")}</span>} />)}{placements.length > 12 && <span className={EMPTY}>{placements.length - 12} more on the map.</span>}</div>
            : encounters.length ? <div className="flex flex-wrap gap-1">{encounters.map(encounter => <RefChip key={encounter.recordId} collection="encounters" id={encounter.recordId} record={encounter.record} ctx={ctx} onOpen={open} />)}</div>
            : <span className={EMPTY}>Not placed in any encounter.</span>}
        </div>
      </>;
    }
    case "recipes": {
      const inputs = list(record.inputs).map(asRecord);
      const output = asRecord(record.output);
      return <div className={BLOCK}><h3>Crafting</h3><div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">{inputs.map((input, index) => <RefChip key={index} collection={itemCollection} id={text(input.itemId) ?? ""} record={ctx.lookup("item", text(input.itemId) ?? "")} ctx={ctx} onOpen={open} size="l" detail={`×${rangeText(input.quantity) || 1}`} />)}</div>
        <ArrowRight size={16} className="text-faint" />
        <div className="flex flex-wrap gap-1">{text(output.itemId) && <RefChip collection={itemCollection} id={output.itemId as string} record={ctx.lookup("item", output.itemId as string)} ctx={ctx} onOpen={open} size="l" detail={`×${rangeText(output.quantity) || 1}`} />}{text(record.burntItemId) && <RefChip collection={itemCollection} id={record.burntItemId as string} record={ctx.lookup("item", record.burntItemId as string)} ctx={ctx} onOpen={open} detail="burnt" />}</div>
      </div></div>;
    }
    case "equipmentSets": {
      const members = asRecord(record.members);
      const thresholds = list(record.thresholds).map(asRecord);
      return <>
        <div className={BLOCK}><h3>Pieces</h3><div className="flex flex-wrap gap-1">{["head", "body", "legs", "hands", "feet"].map(slot => text(members[slot]) ? <RefChip key={slot} collection={itemCollection} id={members[slot] as string} record={ctx.lookup("item", members[slot] as string)} ctx={ctx} onOpen={open} size="l" detail={slot} /> : <span key={slot} className={cn(chipVariants({ state: "missing", size: "lg" }), "cursor-default border-border pl-2.5 text-faint hover:bg-transparent")}><span>{titleCase(slot)}</span><small>empty</small></span>)}</div></div>
        {thresholds.length > 0 && <div className={BLOCK}><h3>Set bonuses</h3><dl className={STAT_GRID}>{thresholds.map((threshold, index) => <div className={STAT} key={index}><dt>{String(threshold.pieces)} pieces</dt><dd>{Object.entries(asRecord(threshold.bonuses)).filter(([, value]) => typeof value === "number" && value !== 0).map(([key, value]) => `${titleCase(key)} +${value}`).join(", ") || "—"}</dd></div>)}</dl></div>}
      </>;
    }
    case "shops": {
      const stock = list(record.stock).map(asRecord);
      return <div className={BLOCK}><h3>Stock<small>{stock.length} lines</small></h3><div className="flex flex-wrap gap-1">{stock.map((entry, index) => <RefChip key={index} collection={itemCollection} id={text(entry.itemId) ?? ""} record={ctx.lookup("item", text(entry.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${rangeText(entry.quantity) || 1}`} />)}</div></div>;
    }
    case "quests": {
      const stages = list(record.stages).map(asRecord);
      const rewards = asRecord(record.rewards);
      const giver = text(record.giverNpcId);
      return <>
        <div className={BLOCK}><h3>Quest</h3><div className="flex flex-wrap gap-1">
          {giver && <RefChip collection="npcs" id={giver} record={ctx.lookup("npc", giver)} ctx={ctx} onOpen={open} detail="giver" />}
          {list(record.prerequisiteQuestIds).map(id => <RefChip key={String(id)} collection="quests" id={String(id)} record={ctx.lookup("quest", String(id))} ctx={ctx} onOpen={open} detail="requires" />)}
        </div></div>
        <div className={BLOCK}><h3>Stages<small>{stages.length}</small></h3><ol className="m-0 flex list-none flex-col gap-1 p-0 [&_li]:grid [&_li]:grid-cols-[18px_minmax(0,1fr)] [&_li]:items-start [&_li]:gap-1.5 [&_li]:text-xs">{stages.map((stage, stageIndex) => {
          const refs = list(stage.refs).map(asRecord);
          const completion = asRecord(stage.completion);
          return <li key={stageIndex}><span className={INDEX}>{String(stage.index ?? stageIndex)}</span><div><p>{text(stage.objective) ?? titleCase(text(completion.kind) ?? "stage")}</p>{refs.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{refs.map((ref, refIndex) => { const kind = text(ref.kind) ?? ""; const target = kind === "item" ? itemCollection : kind === "recipe" ? (refTargetCollection("recipe", index.available) ?? "recipes") : kind === "spell" ? "spells" : undefined; return target ? <RefChip key={refIndex} collection={target} id={text(ref.id) ?? ""} record={ctx.lookup(kind, text(ref.id) ?? "")} ctx={ctx} onOpen={open} /> : <Badge key={refIndex}>{kind}: {text(ref.id)}</Badge>; })}</div>}</div></li>;
        })}</ol></div>
        <div className={BLOCK}><h3>Rewards</h3><div className="flex flex-wrap gap-1">
          {list(rewards.items).map(asRecord).map((entry, index) => <RefChip key={index} collection={itemCollection} id={text(entry.itemId) ?? ""} record={ctx.lookup("item", text(entry.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${rangeText(entry.quantity) || 1}`} />)}
          {Object.entries(asRecord(rewards.xp)).map(([skill, xp]) => <Badge variant="info" key={skill}>{titleCase(skill)} +{String(xp)} xp</Badge>)}
          {typeof rewards.currency === "number" && <Badge variant="accent">{rewards.currency} coins</Badge>}
        </div></div>
      </>;
    }
    case "encounters": {
      const members = list(record.members).map(asRecord);
      const placements = incoming.filter(reference => reference.collection === "placements");
      return <>
        <div className={BLOCK}><h3>Members</h3><div className="flex flex-wrap gap-1">{members.map((member, index) => <RefChip key={index} collection={creatureCollection} id={text(member.creatureId) ?? ""} record={ctx.lookup("enemy", text(member.creatureId) ?? "")} ctx={ctx} onOpen={open} size="l" detail={`weight ${String(member.weight ?? 1)}`} />)}</div></div>
        <div className={BLOCK}><h3>Placements<small>{placements.length}</small></h3>{placements.length ? <div className="flex flex-col gap-0.5">{placements.map(placement => <RefRow key={placement.recordId} collection="placements" id={placement.recordId} record={placement.record} ctx={ctx} onOpen={open} meta={<span>×{String(placement.record.count ?? 1)}</span>} />)}</div> : <span className={EMPTY}>Not placed yet.</span>}</div>
      </>;
    }
    case "placements": {
      const encounterId = text(record.encounterId);
      const encounter = encounterId ? ctx.lookup("encounter", encounterId) : undefined;
      const members = list(encounter?.members).map(asRecord);
      return <>
        <div className={BLOCK}><h3>Location</h3><Thumb spec={{ kind: "map", x: Number(list(record.centre)[0] ?? 0), z: Number(list(record.centre)[1] ?? 0), span: Math.max(120, Number(record.radius ?? 10) * 8) }} size="fill" className={MAP} /></div>
        <div className={BLOCK}><h3>Encounter</h3><div className="flex flex-wrap gap-1">{encounterId && <RefChip collection="encounters" id={encounterId} record={encounter} ctx={ctx} onOpen={open} size="l" />}{members.map((member, index) => <RefChip key={index} collection={creatureCollection} id={text(member.creatureId) ?? ""} record={ctx.lookup("enemy", text(member.creatureId) ?? "")} ctx={ctx} onOpen={open} detail={`w ${String(member.weight ?? 1)}`} />)}</div></div>
      </>;
    }
    case "worldRegions": {
      const locations = list(record.locations).map(asRecord);
      return <>
        <div className={BLOCK}><h3>Map</h3><Thumb spec={summarize("worldRegions", record).thumb} size="fill" className={MAP} /></div>
        <div className={BLOCK}><h3>Locations<small>{locations.length}</small></h3><div className="flex flex-wrap gap-1">{locations.map((location, index) => <Badge key={index} title={text(location.id)}>{titleCase(text(location.kind) ?? "")}: {text(location.name) ?? text(location.id)}</Badge>)}</div></div>
      </>;
    }
    case "npcs": return <div className={BLOCK}><h3>Story</h3><div className="flex flex-wrap gap-1">
      {text(record.dialogueRootId) && <RefChip collection="dialogue" id={record.dialogueRootId as string} record={ctx.lookup("dialogue", record.dialogueRootId as string)} ctx={ctx} onOpen={open} detail="dialogue" />}
      {list(record.questIds).map(id => <RefChip key={String(id)} collection="quests" id={String(id)} record={ctx.lookup("quest", String(id))} ctx={ctx} onOpen={open} detail="quest" />)}
      {text(record.regionId) && <RefChip collection="worldRegions" id={record.regionId as string} record={ctx.lookup("region", record.regionId as string)} ctx={ctx} onOpen={open} detail="region" />}
    </div></div>;
    case "dialogue": {
      const options = list(record.options).map(asRecord);
      return <div className={BLOCK}><h3>Options<small>{options.length}</small></h3><div className="flex flex-col gap-0.5">{options.map((option, index) => {
        const next = text(option.next);
        return <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-[3px]" key={index}><span className={INDEX}>{index + 1}</span><span className="flex min-w-0 flex-col"><span className="truncate text-xs font-medium">{text(option.text)}</span><span className="truncate text-[11px] text-muted-foreground">{next ? `→ ${next}` : "ends conversation"}</span></span>{next && <Button variant="link" size="inline" onClick={() => open("dialogue", next)}>Open <ArrowRight size={12} /></Button>}</div>;
      })}</div></div>;
    }
    case "spells": {
      const cost = asRecord(record.cost);
      const runes = list(cost.runes).map(asRecord);
      return runes.length ? <div className={BLOCK}><h3>Rune cost</h3><div className="flex flex-wrap gap-1">{runes.map((rune, index) => <RefChip key={index} collection={itemCollection} id={text(rune.itemId) ?? ""} record={ctx.lookup("item", text(rune.itemId) ?? "")} ctx={ctx} onOpen={open} detail={`×${String(rune.quantity ?? 1)}`} />)}</div></div> : null;
    }
    case "progression": {
      const materials = asRecord(record.materials);
      return <>
        <div className={BLOCK}><h3>Materials<small>{Object.keys(materials).length}</small></h3><div className="flex flex-wrap gap-1">{Object.entries(materials).map(([slot, id]) => <RefChip key={slot} collection={itemCollection} id={String(id)} record={ctx.lookup("item", String(id))} ctx={ctx} onOpen={open} detail={slot} />)}</div></div>
        <div className={BLOCK}><h3>Gathering</h3><div className="flex flex-wrap gap-1">{list(record.resourceIds).map(id => <RefChip key={String(id)} collection="resources" id={String(id)} record={ctx.lookup("resource", String(id))} ctx={ctx} onOpen={open} />)}</div></div>
        <div className={BLOCK}><h3>Generated gear<small>{list(record.equipment).length}</small></h3><div className="flex flex-wrap gap-1">{list(record.equipment).map(asRecord).map(gear => <RefChip key={String(gear.id)} collection={itemCollection} id={String(gear.id)} record={ctx.lookup("item", String(gear.id))} ctx={ctx} onOpen={open} />)}</div></div>
      </>;
    }
    default: return null;
  }
}

function DropsBlock({ drops, ctx, itemCollection, open, title, action }: { drops: unknown[]; ctx: SummaryContext; itemCollection: string; open: (collection: string, id: string) => void; title: string; action?: React.ReactNode }) {
  const rows = drops.map(asRecord);
  return <div className={BLOCK}><h3>{title}<small>{rows.length}</small>{action}</h3>
    {rows.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-1">{rows.map((drop, index) => {
      const itemId = text(drop.itemId) ?? "";
      const chance = typeof drop.chance === "number" ? drop.chance : undefined;
      return <button type="button" className="relative flex min-w-0 cursor-pointer flex-col items-center gap-[3px] rounded-md border border-border-subtle bg-secondary px-1 pt-1.5 pb-[5px] text-center hover:border-faint" key={index} onClick={() => open(itemCollection, itemId)} title={itemId}>
        <Thumb spec={{ kind: "item", id: itemId }} size="l" />
        <span className="w-full truncate text-xs leading-tight font-medium">{rowName(ctx.lookup("item", itemId) ?? { id: itemId })}</span>
        <span className="flex items-center gap-[5px] font-mono text-[11px] text-muted-foreground"><span>×{rangeText(drop.quantity) || "1"}</span>{chance !== undefined && <span className="rounded-sm px-1 text-foreground" style={{ background: `linear-gradient(90deg, var(--accent-soft) ${chance * 100}%, transparent 0)` }}>{percent(chance)}</span>}</span>
        {text(drop.exclusiveGroup) && <Badge variant="info" className="absolute top-1 right-1 h-[15px] px-1 text-[11px]">{drop.exclusiveGroup as string}</Badge>}
      </button>;
    })}</div> : <span className={EMPTY}>No drops.</span>}
  </div>;
}

function OutgoingBlock({ outgoing, ctx, index, open, skip }: { outgoing: ReturnType<typeof outgoingReferences>; ctx: SummaryContext; index: ReferenceIndex; open: (collection: string, id: string) => void; skip?: RegExp }) {
  const shown = outgoing.filter(reference => !skip?.test(reference.path));
  if (!shown.length) return null;
  const seen = new Set<string>();
  return <div className={BLOCK}><h3>Links</h3><div className="flex flex-wrap gap-1">{shown.flatMap(reference => {
    const key = `${reference.kind}:${reference.targetId}:${reference.role}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const target = refTargetCollection(reference.kind, index.available);
    if (!target) return [<Badge key={key} title={reference.path}>{reference.role}: {reference.targetId}</Badge>];
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
  if (!groups.size) return <div className={BLOCK}><h3>Used by</h3><span className={EMPTY}>Nothing references this record.</span></div>;
  return <div className={BLOCK}><h3>Used by<small>{[...groups.values()].reduce((sum, bucket) => sum + bucket.length, 0)}</small></h3>
    {[...groups.entries()].map(([collection, references]) => <div key={collection} className="mt-0.5 flex flex-col gap-[3px]">
      <span className="flex items-center gap-[5px] text-[11px] font-semibold text-faint [&_small]:font-mono [&_small]:font-normal">{labelFor(collection)}<small>{references.length}</small></span>
      <div className="flex flex-wrap gap-1">{references.slice(0, 40).map(reference => <RefChip key={`${reference.recordId}:${reference.path}`} collection={reference.collection} id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} detail={reference.role} />)}{references.length > 40 && <span className={EMPTY}>{references.length - 40} more</span>}</div>
    </div>)}
  </div>;
}
