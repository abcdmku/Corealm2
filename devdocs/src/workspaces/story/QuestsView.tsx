import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ScrollText, SquareArrowOutUpRight } from "lucide-react";
import type { Schema } from "../../../../game/src/content/schema/core.js";
import { questGrantSchema, questObjectiveRefSchema, questPredicateSchema, questSchema, questStageSchema } from "../../../../game/src/content/schema/story.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import type { Path } from "../../model/draft.js";
import { serialFieldSpec } from "../../model/fields.js";
import { summaryContext, useReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext } from "../../model/summaries.js";
import {
  ChoiceField, Field, ListField, MapField, NumberField, RefField, ReferencedBy, SchemaControl,
  Section, Sheet, TextField, UnionField, fieldFromSchema, type RenderRef,
} from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { cn } from "../../lib/utils.js";
import {
  asRecord, itemOf, list, ListMap, nameOf, num, PageState, RecordShell, RefCell, refRenderer, regionName, RowBlock,
  regionOptions, skillKeys, StackList, strings, sub, text, usePage, type Page,
} from "./shared.js";
import { EMPTY, PAGE, RAIL_BLOCK } from "../../ui/layout.js";
import { PointsMap, type MapPoint } from "../../ui/PointsMap.js";
import { Badge, Button, ChoiceChips, EmptyCell, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../components/ui/index.js";
import { DialogueNodeEditor } from "./DialogueView.js";
import { pins, predicatePlaces, refPlaces, worldPlaces, type Place } from "./places.js";
import { ROLE_LABEL, stageDialogue } from "./questLinks.js";

interface Stage extends ContentRow { index?: number; objective?: string; hint?: string; refs?: ContentRow[]; completion?: unknown; grants?: ContentRow; onFlag?: unknown }
interface Quest extends ContentRow {
  id: string; name: string; regionId?: string; kind?: string; summary?: string; giverNpcId?: string;
  requirements?: Record<string, number>; prerequisiteQuestIds?: string[]; onStart?: ContentRow; stages?: Stage[]; rewards?: ContentRow;
}

const quest = (key: string) => fieldFromSchema(questSchema, key);
const stageField = (key: string) => fieldFromSchema(questStageSchema, key);
const REF_KINDS = (serialFieldSpec(questObjectiveRefSchema).variants ?? []).map(variant => ({ value: variant.key, label: variant.label }));
const rewardsSchema = sub(questSchema, "rewards");

export default function QuestsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <QuestList navigate={navigate} />;
  return <QuestPage id={recordId} navigate={navigate} />;
}

/* ---------- List ---------- */

function QuestList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("quests"));
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const rows = useMemo(() => query.data ? contentRows(query.data) : [], [query.data]);
  const givers = useMemo(() => {
    const places = worldPlaces(index);
    return rows.flatMap(row => { const place = places.npcs.get(text(row.giverNpcId) ?? ""); return place ? [{ id: String(row.id), x: place.x, z: place.z, label: String(row.name), regionId: place.regionId }] : []; });
  }, [rows, index]);
  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className={PAGE}>
    <ListMap points={givers} onOpen={questId => navigate("quests", questId)} />
    <TableFrame className="max-h-[calc(100vh-6rem)]">
      <Table>
        <TableHeader><TableRow>
          <TableHead pin>Quest</TableHead><TableHead>Region</TableHead><TableHead>Kind</TableHead><TableHead>Giver</TableHead>
          <TableHead numeric>Stages</TableHead><TableHead>Requires</TableHead><TableHead>Rewards</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const id = String(row.id);
          const giver = text(row.giverNpcId);
          const requirements = Object.entries(asRecord(row.requirements));
          const rewards = asRecord(row.rewards);
          const xp = Object.entries(asRecord(rewards.xp)).map(([skill, amount]) => `${titleCase(skill)} ${String(amount)}`);
          const rewardLine = [...xp, typeof rewards.currency === "number" ? `${rewards.currency} marks` : "", list(rewards.items).length ? `${list(rewards.items).length} items` : ""].filter(Boolean).join(" · ");
          return <TableRow key={id}>
            <TableCell pin><TableLink title={id} onClick={() => navigate("quests", id)}>{String(row.name)}</TableLink></TableCell>
            <TableCell className="text-muted-foreground">{regionName(index, text(row.regionId))}</TableCell>
            <TableCell className="text-muted-foreground">{titleCase(text(row.kind) ?? "")}</TableCell>
            <TableCell>{giver ? <TableLink title={giver} onClick={() => navigate("npcs", giver)}>{nameOf(ctx, "npc", giver)}</TableLink> : <EmptyCell />}</TableCell>
            <TableCell numeric>{list(row.stages).length}</TableCell>
            <TableCell className="text-muted-foreground">{requirements.length ? requirements.map(([skill, level]) => `${titleCase(skill)} ${String(level)}`).join(", ") : <EmptyCell />}</TableCell>
            <TableCell className="text-muted-foreground">{rewardLine || <EmptyCell />}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableFrame>
  </div>;
}

/* ---------- Record ---------- */

function QuestPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Quest>("quests", id);
  const { draft, index, ctx } = page;
  const readOnly = !draft.editable;
  const renderRef = useMemo(() => refRenderer(readOnly), [readOnly]);
  const regions = useMemo(() => regionOptions(index), [index]);
  const skills = useMemo(() => skillKeys(index), [index]);
  return <PageState page={page} collection="quests" navigate={navigate}>{record => {
    const stages = list(record.stages).map(stage => stage as Stage);
    const requirements = Object.fromEntries(Object.entries(asRecord(record.requirements)).map(([skill, level]) => [skill, num(level) ?? 1]));
    const prerequisites = strings(record.prerequisiteQuestIds);
    return <RecordShell
      thumb={{ kind: "glyph", icon: ScrollText }}
      title={record.name} id={id}
      facts={[regionName(index, record.regionId), record.kind && titleCase(record.kind), `${stages.length} stage${stages.length === 1 ? "" : "s"}`]}
      draft={draft}
      rail={<QuestMap quest={record} stages={stages} page={page} navigate={navigate} />}>
      <Sheet>
        <Section title="Quest">
          <Field label={quest("name").label}><TextField value={record.name ?? ""} readOnly={readOnly} onChange={value => draft.setPath(["name"], value)} /></Field>
          <Field label={quest("summary").label} hint={quest("summary").hint}><TextField value={record.summary ?? ""} multiline readOnly={readOnly} onChange={value => draft.setPath(["summary"], value)} /></Field>
          <RefField kind="npc" label={quest("giverNpcId").label} hint={quest("giverNpcId").hint} optional value={text(record.giverNpcId)} readOnly={readOnly} onChange={value => draft.setPath(["giverNpcId"], value)} />
          <Field label={quest("kind").label}><ChoiceField value={text(record.kind)} options={(quest("kind").choices ?? []).map(choice => ({ value: choice, label: titleCase(choice) }))} readOnly={readOnly} onChange={value => draft.setPath(["kind"], value)} /></Field>
          <Field label={quest("regionId").label}><ChoiceField value={text(record.regionId)} options={regions} readOnly={readOnly} onChange={value => draft.setPath(["regionId"], value)} /></Field>
        </Section>

        <Section title="Progression">
          <MapField<number> label={quest("requirements").label} hint={quest("requirements").hint} value={requirements} keys={skills} keyLabel="skill"
            emptyText="No skill requirements." readOnly={readOnly} defaultValue={() => 1} counts={{ min: 1, max: 99 }}
            onChange={next => draft.setPath(["requirements"], next)}
            renderValue={(skill, level, update) => <NumberField value={level} integer min={1} max={99} ariaLabel={`${titleCase(skill)} level`} readOnly={readOnly} onChange={value => update(value ?? 1)} />} />
          <ListField<string> label={quest("prerequisiteQuestIds").label} items={prerequisites} readOnly={readOnly}
            emptyText="No prerequisites." addLabel="Add prerequisite" onAdd={() => ""}
            onChange={next => draft.setPath(["prerequisiteQuestIds"], next)}
            removeLabel={questId => `Remove ${nameOf(ctx, "quest", questId)}`}
            renderItem={(questId, api) => <RefCell label="Prerequisite quest" kind="quest" value={questId || undefined} readOnly={readOnly}
              exclude={new Set([id, ...prerequisites.filter((_, at) => at !== api.index)])}
              onChange={value => api.update(value ?? "")} />} />
        </Section>

        <Section title={fieldFromSchema(questSchema, "onStart").label} collapsible open={record.onStart !== undefined}>
          <GrantFields schema={questGrantSchema} grant={asRecord(record.onStart)} path={["onStart"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} sparse />
        </Section>

        <Section title={quest("stages").label}>
          <StageList questId={id} regionId={text(record.regionId)} stages={stages} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} ctx={ctx} navigate={navigate} />
        </Section>

        <Section title="Rewards">
          <GrantFields schema={rewardsSchema ?? questGrantSchema} grant={asRecord(record.rewards)} path={["rewards"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} only={["xp", "items", "currency", "unlocks", "worldState"]} />
        </Section>

        <ReferencedBy collection="quests" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

/* ---------- Map ---------- */

/** Where the quest happens: the giver, then each stage's places numbered by stage. Clicking a pin opens it on the world map. */
function QuestMap({ quest: record, stages, page, navigate }: { quest: Quest; stages: Stage[]; page: Page<Quest>; navigate: ViewProps["navigate"] }) {
  const { index, ctx } = page;
  const points = useMemo(() => {
    const giver = worldPlaces(index).npcs.get(text(record.giverNpcId) ?? "");
    return [
      ...(giver ? pins([giver], "Giver") : []),
      ...stages.flatMap((stage, at) => pins([...predicatePlaces(stage.completion, index, text(record.regionId)), ...refPlaces(stage.refs, index)], String(stage.index ?? at))),
    ];
  }, [record.giverNpcId, record.regionId, stages, index]);
  const open = (point: MapPoint) => { if (point.target) navigate("world/map", point.target); };
  return <section className={RAIL_BLOCK}>
    <h3>Where</h3>
    {points.length ? <PointsMap points={points} onOpen={open} /> : <p className={EMPTY}>No stage names a place on the map.</p>}
    <ol className="flex flex-col gap-0.5 text-xs">
      {stages.map((stage, at) => <li key={at} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline gap-1.5">
        <span className="font-mono text-[11px] text-faint">{stage.index ?? at}</span>
        <a href={`#stage-${at}`} className="truncate text-muted-foreground hover:text-foreground" title={stage.objective}>{stage.objective || predicateLine(stage.completion, ctx)}</a>
      </li>)}
    </ol>
  </section>;
}

/* ---------- Stages ---------- */

interface StageProps { questId: string; regionId: string | undefined; stages: Stage[]; page: Page<Quest>; readOnly: boolean; skills: { value: string; label?: string }[]; renderRef: RenderRef; ctx: SummaryContext; navigate: ViewProps["navigate"] }

/**
 * Every stage is shown as the step the player takes: what it asks, where on the map, the dialogue
 * that offers, advances or completes it, and what it grants, all editable in place. A step folds to
 * its one-line summary; the handle and Alt+Up/Down reorder steps.
 */
function StageList({ questId, regionId, stages, page, readOnly, skills, renderRef, ctx, navigate }: StageProps) {
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const toggle = (at: number) => setClosed(previous => { const next = new Set(previous); if (next.has(at)) next.delete(at); else next.add(at); return next; });
  const commit = (next: Stage[]) => page.draft.setPath(["stages"], next.map((stage, index) => ({ ...stage, index })));
  return <>
    <div className="mb-1 flex gap-1">
      <Button variant="ghost" size="xs" onClick={() => setClosed(new Set())}>Expand all</Button>
      <Button variant="ghost" size="xs" onClick={() => setClosed(new Set(stages.map((_, at) => at)))}>Collapse all</Button>
    </div>
    <ListField<Stage> items={stages} ordered min={1} readOnly={readOnly}
      rowClassName="grid-cols-[0.875rem_minmax(0,1fr)_auto]! items-start [&>.field-list-handle]:mt-1 [&>button]:mt-1 border-b border-border-subtle pb-2 mb-1"
      emptyText="No stages." addLabel="Add stage"
      onAdd={() => ({ index: stages.length, objective: "", hint: "", refs: [], completion: { kind: "flag", flag: "" } })}
      onChange={next => { if (next.length !== stages.length) setClosed(new Set()); commit(next); }}
      removeLabel={(_, index) => `Remove stage ${index}`}
      renderItem={(stage, api) => {
        const open = !closed.has(api.index);
        return <>
          <button type="button" id={`stage-${api.index}`} className="group/stage grid min-h-7 flex-[1_1_100%] cursor-pointer scroll-mt-4 grid-cols-[0.875rem_1.375rem_minmax(0,1fr)_minmax(0,auto)] items-center gap-2 text-left" aria-expanded={open} onClick={() => toggle(api.index)}>
            {open ? <ChevronDown className="size-3.5 text-faint" /> : <ChevronRight className="size-3.5 text-faint" />}
            <span className="grid size-5 place-items-center rounded-full border border-border bg-secondary font-mono text-[11px] font-semibold text-muted-foreground">{stage.index ?? api.index}</span>
            <span className={cn("truncate text-[13px] font-medium group-hover/stage:text-primary", !stage.objective && "text-faint")}>{stage.objective || "No objective yet"}</span>
            <span className="max-w-80 truncate text-[11px] text-muted-foreground" title={predicateLine(stage.completion, ctx)}>{predicateLine(stage.completion, ctx)}</span>
          </button>
          {open && <StageBody stage={stage} at={api.index} update={api.update} questId={questId} regionId={regionId} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} navigate={navigate} />}
        </>;
      }} />
  </>;
}

function StageBody({ stage, at, update, questId, regionId, page, readOnly, skills, renderRef, navigate }: {
  stage: Stage; at: number; update: (next: Stage) => void; questId: string; regionId: string | undefined; page: Page<Quest>; readOnly: boolean;
  skills: { value: string; label?: string }[]; renderRef: RenderRef; navigate: ViewProps["navigate"];
}) {
  const { index } = page;
  const places: Place[] = useMemo(() => [...predicatePlaces(stage.completion, index, regionId), ...refPlaces(stage.refs, index)], [stage.completion, stage.refs, index, regionId]);
  const dialogue = useMemo(() => stageDialogue(index, questId, stage, stage.index ?? at), [index, questId, stage, at]);
  return <RowBlock className="mt-1 ml-6">
    <Field label={stageField("objective").label}><TextField value={stage.objective ?? ""} multiline readOnly={readOnly} ariaLabel={`Stage ${at} objective`} onChange={value => update({ ...stage, objective: value })} /></Field>
    <Field label={stageField("hint").label}><TextField value={stage.hint ?? ""} multiline readOnly={readOnly} ariaLabel={`Stage ${at} hint`} onChange={value => update({ ...stage, hint: value })} /></Field>
    <UnionField schema={questPredicateSchema} kindLabel="Player does" value={stage.completion} renderRef={renderRef} readOnly={readOnly}
      onChange={value => update({ ...stage, completion: value })} />
    {places.length > 0 && <Field label="Where">
      <PointsMap className="max-w-[26rem]" points={pins(places)} onOpen={point => { if (point.target) navigate("world/map", point.target); }} />
    </Field>}
    <Field label="Dialogue">
      {dialogue.length
        ? <div className="flex w-full max-w-[52rem] min-w-0 flex-col gap-1">{dialogue.map(entry => <StageLine key={entry.nodeId} entry={entry} page={page} navigate={navigate} />)}</div>
        : <span className="inline-flex h-7 items-center text-xs text-faint">No dialogue offers, advances or completes this step.</span>}
    </Field>
    <ListField<ContentRow> label={stageField("refs").label} items={list(stage.refs).map(asRecord)} readOnly={readOnly}
      emptyText="None." addLabel="Add ref" onAdd={() => ({ kind: "item", id: "" })}
      onChange={next => update({ ...stage, refs: next.length ? next : undefined })}
      renderItem={(entry, row) => <>
        <ChoiceField display="select" value={text(entry.kind)} options={REF_KINDS} readOnly={readOnly} ariaLabel={`Ref ${row.index + 1} kind`} onChange={value => row.update({ kind: value ?? "item", id: "" })} />
        <RefCell label={`Ref ${row.index + 1}`} kind={text(entry.kind) ?? "item"} value={text(entry.id)} readOnly={readOnly} onChange={value => row.update({ ...entry, id: value ?? "" })} />
      </>} />
    <GrantFields schema={questGrantSchema} grant={asRecord(stage.grants)} path={["stages", at, "grants"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} sparse />
    {stage.onFlag !== undefined && sub(questStageSchema, "onFlag") && <SchemaControl schema={sub(questStageSchema, "onFlag")!} name="onFlag" value={stage.onFlag} renderRef={renderRef} readOnly={readOnly}
      onChange={value => update({ ...stage, onFlag: value })} />}
  </RowBlock>;
}

/** One line of dialogue tied to the step: who says what and why it is here; open it to edit the line and its options in place. */
function StageLine({ entry, page, navigate }: { entry: ReturnType<typeof stageDialogue>[number]; page: Page<Quest>; navigate: ViewProps["navigate"] }) {
  const [open, setOpen] = useState(entry.roles.includes("completes"));
  const node = page.ctx.lookup("dialogue", entry.nodeId);
  const speaker = text(node?.speaker);
  const line = text(node?.text);
  return <div className="@container min-w-0 rounded-md border border-border-subtle bg-card">
    <div className="flex min-h-8 items-center gap-2 px-2">
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        <Badge variant={entry.roles.includes("completes") ? "accent" : "default"} className="shrink-0">{ROLE_LABEL[entry.roles[0]!]}</Badge>
        <span className="min-w-0 flex-1 truncate">{speaker && <strong className="font-medium">{speaker}: </strong>}{line ?? <span className="text-faint">(no text)</span>}</span>
        <span className="hidden shrink-0 font-mono text-[11px] text-faint @min-[36rem]:inline">{[...entry.detail, entry.nodeId].join(" · ")}</span>
      </button>
      <Button variant="ghost" size="icon-xs" title="Open the dialogue node" aria-label={`Open ${entry.nodeId}`} onClick={() => navigate("dialogue", entry.nodeId)}><SquareArrowOutUpRight /></Button>
    </div>
    {open && <div className="border-t border-border-subtle px-2 pt-2 pb-1">{node ? <DialogueNodeEditor id={entry.nodeId} /> : <p className={EMPTY}>Dialogue node {entry.nodeId} does not exist.</p>}</div>}
  </div>;
}

/* ---------- Grants (stage grants, on start, rewards) ---------- */

const GRANT_KEYS = ["xp", "items", "takeItems", "currency", "flags", "unlocks", "worldState"] as const;
type GrantKey = typeof GRANT_KEYS[number];

/** One grant block as fields: xp per skill, marks, item stacks, flags, unlocks and world state. */
function GrantFields({ schema, grant, path, page, readOnly, skills, renderRef, only = GRANT_KEYS, sparse = false }: {
  schema: Schema; grant: ContentRow; path: Path; page: Page<Quest>; readOnly: boolean;
  skills: { value: string; label?: string }[]; renderRef: RenderRef; only?: readonly GrantKey[];
  /** Show only what is granted, with one row to add the rest; a stage grants little, so six empty fields per stage is noise. */
  sparse?: boolean;
}) {
  const { draft } = page;
  const [added, setAdded] = useState<ReadonlySet<GrantKey>>(new Set());
  const spec = (key: GrantKey) => fieldFromSchema(schema, key);
  const write = (key: GrantKey, value: unknown) => draft.setPath([...path, key], value);
  const keep = (key: GrantKey, next: readonly unknown[]) => write(key, next.length || !spec(key).optional ? [...next] : undefined);
  const has = (key: GrantKey) => { const value = grant[key]; return value !== undefined && value !== null && !(Array.isArray(value) && !value.length) && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length); };
  const available = (key: GrantKey) => only.includes(key) && sub(schema, key) !== undefined;
  const shown = (key: GrantKey) => available(key) && (!sparse || has(key) || added.has(key));
  const missing = sparse ? only.filter(key => available(key) && !shown(key)) : [];
  const xp = Object.fromEntries(Object.entries(asRecord(grant.xp)).map(([skill, amount]) => [skill, num(amount) ?? 0]));
  const worldStateItem = itemOf(sub(schema, "worldState"));

  return <>
    {shown("xp") && <MapField<number> label={spec("xp").label} hint={spec("xp").hint} value={xp} keys={skills} keyLabel="skill"
      emptyText="No xp." readOnly={readOnly} defaultValue={() => 0} counts={{ min: 0, integer: false }}
      onChange={next => write("xp", Object.keys(next).length || !spec("xp").optional ? next : undefined)}
      renderValue={(skill, amount, update) => <NumberField value={amount} min={0} unit="xp" ariaLabel={`${titleCase(skill)} xp`} readOnly={readOnly} onChange={value => update(value ?? 0)} />} />}
    {shown("currency") && <Field label={spec("currency").label}><NumberField value={num(grant.currency)} integer min={0} optional={spec("currency").optional} placeholder={spec("currency").optional ? "none" : undefined} readOnly={readOnly} ariaLabel={spec("currency").label} onChange={value => write("currency", value)} /></Field>}
    {shown("items") && <StackList label={spec("items").label} items={list(grant.items).map(asRecord)} readOnly={readOnly} onChange={next => keep("items", next)} />}
    {shown("takeItems") && <StackList label={spec("takeItems").label} items={list(grant.takeItems).map(asRecord)} readOnly={readOnly} onChange={next => keep("takeItems", next)} />}
    {shown("flags") && <ListField<string> label={spec("flags").label} items={strings(grant.flags)} readOnly={readOnly} addOnEnter
      emptyText="None." addLabel="Add flag" onAdd={() => ""} onChange={next => keep("flags", next)}
      renderItem={(flag, api) => <TextField value={flag} mono width="id" placeholder="flag_name" ariaLabel={`Flag ${api.index + 1}`} readOnly={readOnly} onChange={api.update} />} />}
    {shown("unlocks") && <ListField<string> label={spec("unlocks").label} items={strings(grant.unlocks)} readOnly={readOnly} addOnEnter
      emptyText="None." addLabel="Add unlock" onAdd={() => ""} onChange={next => keep("unlocks", next)}
      renderItem={(unlock, api) => <TextField value={unlock} width="text" placeholder="What this opens up" ariaLabel={`Unlock ${api.index + 1}`} readOnly={readOnly} onChange={api.update} />} />}
    {shown("worldState") && worldStateItem && <ListField<ContentRow> label={spec("worldState").label} items={list(grant.worldState).map(asRecord)} readOnly={readOnly}
      emptyText="None." addLabel="Add world state" onAdd={() => ({ entityId: "", state: "" })}
      summarize={entry => `${text(entry.entityId) ?? "?"} → ${text(entry.state) ?? "?"}`}
      onChange={next => keep("worldState", next)}
      renderItem={(entry, api) => <SchemaControl schema={worldStateItem} name="worldState" value={entry} renderRef={renderRef} readOnly={readOnly} onChange={value => api.update(asRecord(value))} />} />}
    {sparse && missing.length > 0 && !readOnly && <Field label={missing.length === only.filter(available).length ? "Grants" : "Add grant"}>
      <ChoiceChips aria-label="Add a grant" value={[]} items={missing.map(key => ({ value: key, label: spec(key).label }))}
        onValueChange={next => setAdded(previous => new Set([...previous, ...next as GrantKey[]]))} />
    </Field>}
  </>;
}

/* ---------- Predicate sentences ---------- */

/** A quest completion predicate as one line, used as the collapsed stage summary. */
export function predicateLine(value: unknown, ctx: SummaryContext): string {
  const node = asRecord(value);
  const kind = text(node.kind);
  if (!kind) return "no completion rule";
  if (kind === "all") return `all of: ${list(node.of).map(child => predicateLine(child, ctx)).join("; ")}`;
  const item = () => nameOf(ctx, "item", text(node.itemId));
  const radius = num(node.radius) !== undefined ? ` within ${String(num(node.radius))} m` : "";
  switch (kind) {
    case "gather": return `gather ${String(node.count ?? 1)} × ${item()}`;
    case "kill": return `kill ${String(node.count ?? 1)} × ${text(node.enemyFamily) ?? "?"}`;
    case "have": return `have ${String(node.quantity ?? 1)} × ${item()}${text(node.orAwakenedAltarId) ? ` (or awakened ${String(node.orAwakenedAltarId)})` : ""}`;
    case "banked": return `banked ${String(node.quantity ?? 1)} × ${item()}`;
    case "equipped": return `equipped ${item()}`;
    case "produce": return `produce ${String(node.count ?? 1)} × ${nameOf(ctx, "recipe", text(node.recipeId))}`;
    case "deplete": return `deplete ${String(node.count ?? 1)} × ${item()}`;
    case "reach": return `reach ${text(node.locationId) ?? "?"}${radius}`;
    case "visit": return `visit ${text(node.locationId) ?? "?"}${radius}`;
    case "nearEntity": return `near ${text(node.entityId) ?? "?"}${radius}`;
    case "traverse": return `traverse ${text(node.obstacleId) ?? "?"}`;
    case "entityState": return `${text(node.entityId) ?? "?"} is ${text(node.state) ?? "?"}`;
    case "skill": return `${titleCase(text(node.skill) ?? "?")} ${String(node.level ?? "?")}`;
    case "flag": return `flag ${text(node.flag) ?? "?"}${node.value === false ? " is unset" : ""}`;
    case "counter": return `${text(node.counter) ?? "?"} ≥ ${String(node.atLeast ?? 0)}`;
    case "talk": return `talk to ${nameOf(ctx, "npc", text(node.npcId))} at ${text(node.dialogueNodeId) ?? "?"}`;
    default: return kind;
  }
}
