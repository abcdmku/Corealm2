import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
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
import {
  asRecord, itemOf, list, nameOf, num, PageState, RecordShell, RefCell, refRenderer, regionName,
  regionOptions, skillKeys, StackList, strings, sub, text, usePage, type Page,
} from "./shared.js";

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
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className="ws-page">
    <div className="matrix story-table"><table>
      <thead><tr><th>Quest</th><th>Region</th><th>Kind</th><th>Giver</th><th>Stages</th><th>Requires</th><th>Rewards</th></tr></thead>
      <tbody>{rows.map(row => {
        const id = String(row.id);
        const requirements = Object.entries(asRecord(row.requirements));
        const rewards = asRecord(row.rewards);
        const xp = Object.entries(asRecord(rewards.xp)).map(([skill, amount]) => `${titleCase(skill)} ${String(amount)}`);
        return <tr key={id}>
          <td><button type="button" className="cell" onClick={() => navigate("quests", id)}>{String(row.name)}</button></td>
          <td className="is-muted">{regionName(index, text(row.regionId))}</td>
          <td className="is-muted">{titleCase(text(row.kind) ?? "")}</td>
          <td>{text(row.giverNpcId) ? <button type="button" className="cell" onClick={() => navigate("npcs", row.giverNpcId as string)}>{nameOf(ctx, "npc", text(row.giverNpcId))}</button> : "—"}</td>
          <td className="cell-num">{list(row.stages).length}</td>
          <td className="is-muted">{requirements.length ? requirements.map(([skill, level]) => `${titleCase(skill)} ${String(level)}`).join(", ") : "—"}</td>
          <td className="is-muted">{[...xp, typeof rewards.currency === "number" ? `${rewards.currency} marks` : "", list(rewards.items).length ? `${list(rewards.items).length} items` : ""].filter(Boolean).join(" · ") || "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
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
      draft={draft}>
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
            emptyText="No skill requirements." readOnly={readOnly} defaultValue={() => 1}
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
          <GrantFields schema={questGrantSchema} grant={asRecord(record.onStart)} path={["onStart"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} />
        </Section>

        <Section title={quest("stages").label}>
          <StageList stages={stages} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} ctx={ctx} />
        </Section>

        <Section title="Rewards">
          <GrantFields schema={rewardsSchema ?? questGrantSchema} grant={asRecord(record.rewards)} path={["rewards"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} only={["xp", "items", "currency", "unlocks", "worldState"]} />
        </Section>

        <ReferencedBy collection="quests" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

/* ---------- Stages ---------- */

interface StageProps { stages: Stage[]; page: Page<Quest>; readOnly: boolean; skills: { value: string; label?: string }[]; renderRef: RenderRef; ctx: SummaryContext }

/** Stages read as one line each; one is open at a time. The handle and Alt+Up/Down reorder them. */
function StageList({ stages, page, readOnly, skills, renderRef, ctx }: StageProps) {
  const [open, setOpen] = useState<number | undefined>(stages.length === 1 ? 0 : undefined);
  const commit = (next: Stage[]) => page.draft.setPath(["stages"], next.map((stage, index) => ({ ...stage, index })));
  return <ListField<Stage> items={stages} ordered min={1} readOnly={readOnly} className="quest-stages"
    emptyText="No stages." addLabel="Add stage"
    onAdd={() => ({ index: stages.length, objective: "", hint: "", refs: [], completion: { kind: "flag", flag: "" } })}
    onChange={next => { if (next.length !== stages.length) setOpen(undefined); commit(next); }}
    removeLabel={(_, index) => `Remove stage ${index}`}
    renderItem={(stage, api) => <>
      <button type="button" className="quest-stage-head" aria-expanded={open === api.index} onClick={() => setOpen(open === api.index ? undefined : api.index)}>
        <span className="quest-stage-marker">{stage.index ?? api.index}</span>
        <span className="quest-stage-objective">{stage.objective || "No objective yet"}</span>
        <span className="quest-stage-summary">{predicateLine(stage.completion, ctx)}</span>
      </button>
      {open === api.index && <div className="quest-stage-open">
        <Field label={stageField("objective").label}><TextField value={stage.objective ?? ""} multiline readOnly={readOnly} ariaLabel={`Stage ${api.index} objective`} onChange={value => api.update({ ...stage, objective: value })} /></Field>
        <Field label={stageField("hint").label}><TextField value={stage.hint ?? ""} multiline readOnly={readOnly} ariaLabel={`Stage ${api.index} hint`} onChange={value => api.update({ ...stage, hint: value })} /></Field>
        <ListField<ContentRow> label={stageField("refs").label} items={list(stage.refs).map(asRecord)} readOnly={readOnly}
          emptyText="None." addLabel="Add ref" onAdd={() => ({ kind: "item", id: "" })}
          onChange={next => api.update({ ...stage, refs: next.length ? next : undefined })}
          renderItem={(entry, row) => <>
            <ChoiceField value={text(entry.kind)} options={REF_KINDS} readOnly={readOnly} ariaLabel={`Ref ${row.index + 1} kind`} onChange={value => row.update({ kind: value ?? "item", id: "" })} />
            <RefCell label={`Ref ${row.index + 1}`} kind={text(entry.kind) ?? "item"} value={text(entry.id)} readOnly={readOnly} onChange={value => row.update({ ...entry, id: value ?? "" })} />
          </>} />
        <UnionField schema={questPredicateSchema} kindLabel="Completion" className="quest-completion" value={stage.completion} renderRef={renderRef} readOnly={readOnly}
          onChange={value => api.update({ ...stage, completion: value })} />
        <GrantFields schema={questGrantSchema} grant={asRecord(stage.grants)} path={["stages", api.index, "grants"]} page={page} readOnly={readOnly} skills={skills} renderRef={renderRef} />
        {stage.onFlag !== undefined && sub(questStageSchema, "onFlag") && <SchemaControl schema={sub(questStageSchema, "onFlag")!} name="onFlag" value={stage.onFlag} renderRef={renderRef} readOnly={readOnly}
          onChange={value => api.update({ ...stage, onFlag: value })} />}
      </div>}
    </>} />;
}

/* ---------- Grants (stage grants, on start, rewards) ---------- */

const GRANT_KEYS = ["xp", "items", "takeItems", "currency", "flags", "unlocks", "worldState"] as const;
type GrantKey = typeof GRANT_KEYS[number];

/** One grant block as fields: xp per skill, marks, item stacks, flags, unlocks and world state. */
function GrantFields({ schema, grant, path, page, readOnly, skills, renderRef, only = GRANT_KEYS }: {
  schema: Schema; grant: ContentRow; path: Path; page: Page<Quest>; readOnly: boolean;
  skills: { value: string; label?: string }[]; renderRef: RenderRef; only?: readonly GrantKey[];
}) {
  const { draft } = page;
  const spec = (key: GrantKey) => fieldFromSchema(schema, key);
  const write = (key: GrantKey, value: unknown) => draft.setPath([...path, key], value);
  const keep = (key: GrantKey, next: readonly unknown[]) => write(key, next.length || !spec(key).optional ? [...next] : undefined);
  const shown = (key: GrantKey) => only.includes(key) && sub(schema, key) !== undefined;
  const xp = Object.fromEntries(Object.entries(asRecord(grant.xp)).map(([skill, amount]) => [skill, num(amount) ?? 0]));
  const worldStateItem = itemOf(sub(schema, "worldState"));

  return <>
    {shown("xp") && <MapField<number> label={spec("xp").label} hint={spec("xp").hint} value={xp} keys={skills} keyLabel="skill"
      emptyText="No xp." readOnly={readOnly} defaultValue={() => 0}
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
