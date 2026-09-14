import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, ScrollText } from "lucide-react";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { incomingReferences, summaryContext, useReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext } from "../../model/summaries.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { RefChip, RefRow } from "../../ui/RefChip.js";
import { Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { AddButton, asRecord, ChipList, ItemStack, list, nameOf, num, NumberField, PageState, ReadableOrJson, RecordShell, regionName, regionOptions, RemoveButton, SelectField, SKILLS, strings, text, TextField, usePage, type Page } from "./shared.js";

interface Stage extends ContentRow { index?: number; objective?: string; hint?: string; refs?: { kind: string; id: string }[]; completion?: unknown; grants?: ContentRow; onFlag?: unknown }
interface Quest extends ContentRow {
  id: string; name: string; regionId?: string; kind?: string; summary?: string; giverNpcId?: string;
  requirements?: Record<string, number>; prerequisiteQuestIds?: string[]; onStart?: ContentRow; stages?: Stage[]; rewards?: ContentRow;
}

const KINDS = ["skill", "puzzle", "local", "chain"] as const;

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
  const editable = draft.editable;
  const open = (collection: string, target: string) => navigate(collection, target);
  const incoming = useMemo(() => incomingReferences(index, "quests", id), [index, id]);
  return <PageState page={page} collection="quests" navigate={navigate}>{quest => {
    const stages = list(quest.stages).map(stage => stage as Stage);
    const requirements = asRecord(quest.requirements) as Record<string, unknown>;
    const prerequisites = strings(quest.prerequisiteQuestIds);
    const rewards = asRecord(quest.rewards);
    const giver = text(quest.giverNpcId);
    const npcUsers = incoming.filter(reference => reference.collection === "npcs" && reference.path.startsWith("questIds"));
    const dialogueUsers = incoming.filter(reference => reference.collection === "dialogue");
    const seen = new Set<string>();
    const uniqueDialogue = dialogueUsers.filter(reference => { if (seen.has(reference.recordId)) return false; seen.add(reference.recordId); return true; });
    const unusedSkills = SKILLS.filter(skill => !(skill in requirements));
    return <RecordShell
      thumb={{ kind: "glyph", icon: ScrollText }}
      title={quest.name} id={id}
      facts={[regionName(index, quest.regionId), quest.kind && titleCase(quest.kind), `${stages.length} stage${stages.length === 1 ? "" : "s"}`]}
      draft={draft}
      rail={<div className="entity-summary">
        <div className="summary-block"><h3>Giver</h3>{giver ? <div className="ref-rows"><RefRow collection="npcs" id={giver} record={ctx.lookup("npc", giver)} ctx={ctx} onOpen={open} /></div> : <span className="empty-inline">No giver.</span>}</div>
        <div className="summary-block"><h3>Offered by</h3>{npcUsers.length ? <div className="ref-rows">{npcUsers.map(reference => <RefRow key={reference.recordId} collection="npcs" id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} />)}</div> : <span className="empty-inline">No NPC lists this quest.</span>}</div>
        <div className="summary-block"><h3>Dialogue</h3>{uniqueDialogue.length ? <div className="ref-rows">{uniqueDialogue.map(reference => <RefRow key={reference.recordId} collection="dialogue" id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} subtitle={reference.role} />)}</div> : <span className="empty-inline">No dialogue mentions this quest.</span>}</div>
      </div>}>
      <Sheet>
        <Section title="Summary">
          <Row label="Name"><TextField editable={editable} value={quest.name} onChange={value => draft.setPath(["name"], value)} ariaLabel="Name" /></Row>
          <Row label="Summary" align="start"><TextField editable={editable} value={quest.summary} onChange={value => draft.setPath(["summary"], value)} multiline ariaLabel="Summary" /></Row>
          <Row label="Giver">
            {giver ? <RefChip collection="npcs" id={giver} record={ctx.lookup("npc", giver)} ctx={ctx} onOpen={open} /> : <Static muted>No giver</Static>}
            {editable && <RecordPicker collection="npcs" value={giver} ctx={ctx} onPick={picked => draft.setPath(["giverNpcId"], picked)} trigger={<button type="button" className="button button-small" aria-label="Change giver">{giver ? "Change" : "Choose"}</button>} />}
          </Row>
          <Row label="Kind"><SelectField editable={editable} value={quest.kind} onChange={value => draft.setPath(["kind"], value)} options={KINDS.map(kind => ({ value: kind, label: titleCase(kind) }))} ariaLabel="Kind" /></Row>
          <Row label="Region"><SelectField editable={editable} value={quest.regionId} onChange={value => draft.setPath(["regionId"], value)} options={regionOptions(index)} ariaLabel="Region" /></Row>
        </Section>
        <Section title="Requirements" aside={editable && unusedSkills.length > 0 && <SkillAdder skills={unusedSkills} onAdd={skill => draft.setPath(["requirements", skill], 1)} />}>
          {Object.keys(requirements).length
            ? <div className="story-lines">{Object.entries(requirements).map(([skill, level]) => <div className="story-line" key={skill}>
              <span className="story-line-key">{titleCase(skill)}</span>
              <NumberField editable={editable} value={num(level)} onChange={value => draft.setPath(["requirements", skill], value ?? 1)} integer min={1} ariaLabel={`${titleCase(skill)} level`} />
              {editable && <RemoveButton label={`Remove ${titleCase(skill)} requirement`} onClick={() => draft.setPath(["requirements", skill], undefined)} />}
            </div>)}</div>
            : <span className="story-empty">No skill requirements.</span>}
        </Section>
        <Section title="Prerequisites" aside={editable && <RecordPicker collection="quests" ctx={ctx} exclude={new Set([id, ...prerequisites])} onPick={picked => draft.setPath(["prerequisiteQuestIds"], [...prerequisites, picked])} trigger={<AddButton label="Add prerequisite quest">Add</AddButton>} />}>
          <ChipList ids={prerequisites} collection="quests" kind="quest" page={page} open={navigate} onRemove={editable ? at => draft.setPath(["prerequisiteQuestIds"], prerequisites.filter((_, index) => index !== at)) : undefined} empty="No prerequisites." />
        </Section>
        {quest.onStart && <Section title="On start"><GrantLines grant={asRecord(quest.onStart)} path={["onStart"]} page={page} editable={editable} navigate={navigate} /></Section>}
        <Section title="Stages" aside={editable && <AddButton label="Add stage" onClick={() => draft.setPath(["stages", stages.length], { index: stages.length, objective: "", refs: [], hint: "", completion: { kind: "flag", flag: "" } })}>Add</AddButton>}>
          <div className="quest-stages">{stages.map((stage, at) => <StageBlock key={at} stage={stage} at={at} page={page} editable={editable} navigate={navigate} onRemove={() => draft.setPath(["stages"], stages.filter((_, index) => index !== at).map((entry, index) => ({ ...entry, index })))} />)}</div>
          {!stages.length && <span className="story-empty">No stages.</span>}
        </Section>
        <Section title="Rewards">
          <GrantLines grant={rewards} path={["rewards"]} page={page} editable={editable} navigate={navigate} />
        </Section>
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

function SkillAdder({ skills, onAdd }: { skills: readonly string[]; onAdd: (skill: string) => void }) {
  return <select className="kv-input kv-select" data-width="short" value="" aria-label="Add skill requirement" onChange={event => { if (event.target.value) onAdd(event.target.value); }}>
    <option value="">Add skill…</option>
    {skills.map(skill => <option key={skill} value={skill}>{titleCase(skill)}</option>)}
  </select>;
}

/* ---------- Stage ---------- */

function StageBlock({ stage, at, page, editable, navigate, onRemove }: { stage: Stage; at: number; page: Page<Quest>; editable: boolean; navigate: ViewProps["navigate"]; onRemove: () => void }) {
  const { draft, ctx } = page;
  const base = ["stages", at];
  const refs = list(stage.refs).map(asRecord);
  const grants = asRecord(stage.grants);
  return <div className="quest-stage">
    <span className="quest-stage-marker" aria-label={`Stage ${stage.index ?? at}`}>{stage.index ?? at}</span>
    <div className="quest-stage-body">
      <div className="kv">
        <Row label="Objective" align="start"><TextField editable={editable} value={stage.objective} onChange={value => draft.setPath([...base, "objective"], value)} multiline ariaLabel={`Stage ${at} objective`} /></Row>
        <Row label="Hint" align="start"><TextField editable={editable} value={stage.hint} onChange={value => draft.setPath([...base, "hint"], value)} multiline ariaLabel={`Stage ${at} hint`} /></Row>
        <Row label="Refs" align="start">
          <span className="ref-list">
            {refs.map((ref, refAt) => <StageRef key={refAt} kind={text(ref.kind) ?? ""} id={text(ref.id) ?? ""} page={page} navigate={navigate} onRemove={editable ? () => draft.setPath([...base, "refs"], refs.filter((_, index) => index !== refAt)) : undefined} />)}
            {!refs.length && <span className="story-empty">No refs.</span>}
            {editable && <RecordPicker collection={page.itemCollection} ctx={ctx} onPick={picked => draft.setPath([...base, "refs", refs.length], { kind: "item", id: picked })} trigger={<AddButton label={`Add item ref to stage ${at}`}>Item</AddButton>} />}
          </span>
        </Row>
        <Row label="Completion" align="start">
          <ReadableOrJson editable={editable} value={stage.completion} onChange={value => draft.setPath([...base, "completion"], value)} ariaLabel={`Stage ${at} completion`} readable={<PredicateText predicate={stage.completion} ctx={ctx} />} />
        </Row>
        {(Object.keys(grants).length > 0 || editable) && <Row label="Grants" align="start"><GrantLines grant={grants} path={[...base, "grants"]} page={page} editable={editable} navigate={navigate} compact /></Row>}
        {stage.onFlag !== undefined && <Row label="On flag" align="start"><ReadableOrJson editable={editable} value={stage.onFlag} onChange={value => draft.setPath([...base, "onFlag"], value)} ariaLabel={`Stage ${at} flag grants`} readable={<span>{list(stage.onFlag).map(asRecord).map(entry => `${text(entry.flag) ?? "?"} → ${grantSummary(asRecord(entry.grant), ctx)}`).join(" · ")}</span>} /></Row>}
      </div>
      {editable && <div className="story-line-add"><button type="button" className="text-button" aria-label={`Remove stage ${at}`} onClick={onRemove}>Remove stage</button></div>}
    </div>
  </div>;
}

function StageRef({ kind, id, page, navigate, onRemove }: { kind: string; id: string; page: Page<Quest>; navigate: ViewProps["navigate"]; onRemove?: () => void }) {
  const { ctx, itemCollection } = page;
  const target = kind === "item" ? itemCollection : kind === "recipe" ? "compiled-recipes" : kind === "spell" ? "spells" : undefined;
  return <span className="story-chip">
    {target
      ? <RefChip collection={target} id={id} record={ctx.lookup(kind, id)} ctx={ctx} onOpen={(collection, targetId) => navigate(collection, targetId)} detail={kind !== "item" ? kind : undefined} />
      : <span className="quest-tag"><small>{kind}</small>{id}</span>}
    {onRemove && <RemoveButton label={`Remove ref ${id}`} onClick={onRemove} />}
  </span>;
}

/* ---------- Grants (stage grants, on-start, rewards) ---------- */

function GrantLines({ grant, path, page, editable, navigate, compact = false }: { grant: ContentRow; path: readonly (string | number)[]; page: Page<Quest>; editable: boolean; navigate: ViewProps["navigate"]; compact?: boolean }) {
  const { draft, ctx } = page;
  const xp = asRecord(grant.xp) as Record<string, unknown>;
  const items = list(grant.items).map(asRecord);
  const takeItems = list(grant.takeItems).map(asRecord);
  const unlocks = strings(grant.unlocks);
  const flags = strings(grant.flags);
  const worldState = list(grant.worldState).map(asRecord);
  const unusedSkills = SKILLS.filter(skill => !(skill in xp));
  const empty = !Object.keys(xp).length && !items.length && !takeItems.length && !unlocks.length && !flags.length && !worldState.length && grant.currency === undefined;
  const lines: ReactNode[] = [];
  for (const [skill, amount] of Object.entries(xp)) lines.push(<div className="story-line" key={`xp:${skill}`}>
    <span className="story-line-key">{titleCase(skill)} xp</span>
    <NumberField editable={editable} value={num(amount)} onChange={value => draft.setPath([...path, "xp", skill], value ?? 0)} min={0} ariaLabel={`${titleCase(skill)} xp`} />
    {editable && <RemoveButton label={`Remove ${titleCase(skill)} xp`} onClick={() => draft.setPath([...path, "xp", skill], undefined)} />}
  </div>);
  if (grant.currency !== undefined) lines.push(<div className="story-line" key="currency">
    <span className="story-line-key">Marks</span>
    <NumberField editable={editable} value={num(grant.currency)} onChange={value => draft.setPath([...path, "currency"], value)} integer min={0} ariaLabel="Currency" />
    {editable && <RemoveButton label="Remove currency reward" onClick={() => draft.setPath([...path, "currency"], undefined)} />}
  </div>);
  if (items.length) lines.push(<div className="story-line" key="items" style={{ alignItems: "flex-start" }}>
    <span className="story-line-key" style={{ paddingTop: 4 }}>Items</span>
    <span className="ref-list">
      {items.map((entry, at) => <ItemStack key={at} itemId={text(entry.itemId) ?? ""} quantity={num(entry.quantity)} editable={editable} page={page} open={navigate} onQuantity={value => draft.setPath([...path, "items", at, "quantity"], value ?? 1)} onRemove={() => { const next = items.filter((_, index) => index !== at); draft.setPath([...path, "items"], next.length ? next : undefined); }} />)}
    </span>
  </div>);
  if (takeItems.length) lines.push(<div className="story-line" key="take" style={{ alignItems: "flex-start" }}>
    <span className="story-line-key" style={{ paddingTop: 4 }}>Takes</span>
    <span className="ref-list">{takeItems.map((entry, at) => <ItemStack key={at} itemId={text(entry.itemId) ?? ""} quantity={num(entry.quantity)} editable={editable} page={page} open={navigate} onQuantity={value => draft.setPath([...path, "takeItems", at, "quantity"], value ?? 1)} onRemove={() => draft.setPath([...path, "takeItems"], takeItems.filter((_, index) => index !== at))} />)}</span>
  </div>);
  if (grant.flags !== undefined || (editable && !compact)) lines.push(<div className="story-line" key="flags">
    <span className="story-line-key">Flags</span>
    <TextField editable={editable} value={flags.join(", ")} onChange={value => draft.setPath([...path, "flags"], value.trim() ? value.split(",").map(entry => entry.trim()).filter(Boolean) : undefined)} width="text" mono ariaLabel="Flags" placeholder="flag_a, flag_b" />
  </div>);
  if (unlocks.length || (editable && !compact)) lines.push(<div className="story-line" key="unlocks" style={{ alignItems: "flex-start" }}>
    <span className="story-line-key" style={{ paddingTop: 4 }}>Unlocks</span>
    <TextField editable={editable} value={unlocks.join("\n")} onChange={value => draft.setPath([...path, "unlocks"], value.trim() ? value.split("\n").map(entry => entry.trim()).filter(Boolean) : undefined)} multiline ariaLabel="Unlocks" placeholder="One line per unlock" />
  </div>);
  if (worldState.length) lines.push(<div className="story-line" key="world" style={{ alignItems: "flex-start" }}>
    <span className="story-line-key" style={{ paddingTop: 4 }}>World state</span>
    <ReadableOrJson editable={editable} value={grant.worldState} onChange={value => draft.setPath([...path, "worldState"], value)} ariaLabel="World state" readable={<span>{worldState.map(entry => `${text(entry.entityId) ?? "?"} → ${text(entry.state) ?? "?"}`).join(" · ")}</span>} />
  </div>);
  if (editable) lines.push(<div className="story-line-add" key="add">
    {unusedSkills.length > 0 && <select className="kv-input kv-select" data-width="short" value="" aria-label="Add skill xp" onChange={event => { if (event.target.value) draft.setPath([...path, "xp", event.target.value], 0); }}><option value="">Add skill xp…</option>{unusedSkills.map(skill => <option key={skill} value={skill}>{titleCase(skill)}</option>)}</select>}
    <RecordPicker collection={page.itemCollection} ctx={ctx} onPick={picked => draft.setPath([...path, "items", items.length], { itemId: picked, quantity: 1 })} trigger={<AddButton label={`Add item to ${path.join(".")}`}>Item</AddButton>} />
    {grant.currency === undefined && <button type="button" className="button button-small" aria-label={`Add currency to ${path.join(".")}`} onClick={() => draft.setPath([...path, "currency"], 0)}><Plus size={12} />Marks</button>}
    {compact && grant.flags === undefined && <button type="button" className="button button-small" aria-label={`Add flags to ${path.join(".")}`} onClick={() => draft.setPath([...path, "flags"], [])}><Plus size={12} />Flags</button>}
  </div>);
  if (empty && !editable) return <span className="story-empty">None.</span>;
  return <div className="story-lines">{lines}</div>;
}

function grantSummary(grant: ContentRow, ctx: SummaryContext): string {
  const parts: string[] = [];
  for (const [skill, amount] of Object.entries(asRecord(grant.xp))) parts.push(`${String(amount)} ${skill} xp`);
  for (const entry of list(grant.items).map(asRecord)) parts.push(`${String(entry.quantity ?? 1)} × ${nameOf(ctx, "item", text(entry.itemId))}`);
  if (typeof grant.currency === "number") parts.push(`${grant.currency} marks`);
  for (const flag of strings(grant.flags)) parts.push(`flag ${flag}`);
  return parts.join(", ") || "nothing";
}

/* ---------- Predicates ---------- */

/** A quest completion predicate as one readable line, nested for all/any/not. */
export function PredicateText({ predicate, ctx }: { predicate: unknown; ctx: SummaryContext }) {
  const node = asRecord(predicate);
  const kind = text(node.kind);
  if (!kind) return <span className="story-empty">No completion rule.</span>;
  if (kind === "all" || kind === "any") return <span className="quest-pred-list"><span>{kind === "all" ? "all of:" : "any of:"}</span>{list(node.of).map((child, index) => <span key={index} className="quest-pred-list"><PredicateText predicate={child} ctx={ctx} /></span>)}</span>;
  if (kind === "not") return <span className="quest-pred-list"><span>not:</span><span className="quest-pred-list"><PredicateText predicate={node.of ?? node.predicate} ctx={ctx} /></span></span>;
  return <span>{predicateLine(node, ctx)}</span>;
}

function predicateLine(node: ContentRow, ctx: SummaryContext): string {
  const item = () => nameOf(ctx, "item", text(node.itemId));
  const radius = num(node.radius) !== undefined ? ` within ${num(node.radius)} m` : "";
  switch (text(node.kind)) {
    case "gather": return `gather ${String(node.count ?? 1)} × ${item()}`;
    case "kill": return `kill ${String(node.count ?? 1)} × ${text(node.enemyFamily) ?? "?"}`;
    case "have": return `have ${String(node.quantity ?? 1)} × ${item()}${text(node.orAwakenedAltarId) ? ` (or awakened ${node.orAwakenedAltarId})` : ""}`;
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
    default: return `${text(node.kind) ?? "?"} ${JSON.stringify({ ...node, kind: undefined })}`;
  }
}
