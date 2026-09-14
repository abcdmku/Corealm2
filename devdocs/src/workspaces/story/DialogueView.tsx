import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Search, X } from "lucide-react";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { incomingReferences } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext } from "../../model/summaries.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { RefChip, RefRow } from "../../ui/RefChip.js";
import { Row, Section, Sheet, Static } from "../../ui/Sheet.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { AddButton, asRecord, clip, list, nameOf, PageState, ReadableOrJson, RecordShell, RemoveButton, text, TextField, usePage } from "./shared.js";

interface Option extends ContentRow { id?: string; text?: string; next?: string | null; requires?: unknown; showIf?: unknown; effects?: unknown; nextIf?: unknown }
interface Node extends ContentRow { id: string; speaker?: string; text?: string; variants?: unknown; options?: Option[]; catalog?: string }

export default function DialogueView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <DialogueList navigate={navigate} />;
  return <DialoguePage id={recordId} navigate={navigate} />;
}

/* ---------- List ---------- */

function DialogueList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("dialogue"));
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const all = query.data ? contentRows(query.data) : [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(row => `${String(row.id)} ${text(row.speaker) ?? ""} ${text(row.text) ?? ""} ${list(row.options).map(option => text(asRecord(option).text) ?? "").join(" ")}`.toLowerCase().includes(needle));
  }, [query.data, search]);
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className="ws-page">
    <div className="story-table-tools">
      <label className="search-field"><Search size={14} /><input aria-label="Search dialogue" placeholder="Search id, speaker, text…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" className="icon-button" onClick={() => setSearch("")}><X size={13} /></button>}</label>
      <span className="result-count">{rows.length}</span>
    </div>
    <div className="matrix story-table"><table>
      <thead><tr><th>Node</th><th>Speaker</th><th>Text</th><th>Options</th><th>Catalog</th></tr></thead>
      <tbody>{rows.map(row => {
        const id = String(row.id);
        return <tr key={id}>
          <td><button type="button" className="cell mono" onClick={() => navigate("dialogue", id)}>{id}</button></td>
          <td className="is-muted">{text(row.speaker) ?? "—"}</td>
          <td className="is-text is-muted" title={text(row.text)}>{clip(text(row.text), 110)}</td>
          <td className="cell-num">{list(row.options).length}</td>
          <td className="is-muted">{text(row.catalog) ?? "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}

/* ---------- Record ---------- */

function DialoguePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Node>("dialogue", id);
  const { draft, index, ctx } = page;
  const editable = draft.editable;
  const open = (collection: string, target: string) => navigate(collection, target);
  const referencedBy = useMemo(() => {
    const response = index.collections.get("dialogue");
    const nodes = response ? contentRows(response).filter(row => String(row.id) !== id && list(row.options).some(option => asRecord(option).next === id || list(asRecord(option).nextIf).some(branch => asRecord(branch).next === id))) : [];
    const incoming = incomingReferences(index, "dialogue", id);
    const npcs = incoming.filter(reference => reference.collection === "npcs");
    const quests = incoming.filter(reference => reference.collection === "quests");
    return { nodes, npcs, quests };
  }, [index, id]);
  return <PageState page={page} collection="dialogue" navigate={navigate}>{node => {
    const options = list(node.options).map(option => option as Option);
    const variants = list(node.variants).map(asRecord);
    return <RecordShell
      thumb={{ kind: "glyph", icon: MessageCircle }}
      title={text(node.speaker) ?? id} id={id}
      facts={[node.catalog && titleCase(node.catalog), `${options.length} option${options.length === 1 ? "" : "s"}`]}
      draft={draft}
      rail={<div className="entity-summary">
        <div className="summary-block"><h3>Spoken by</h3>{referencedBy.npcs.length ? <div className="ref-rows">{referencedBy.npcs.map(reference => <RefRow key={reference.recordId} collection="npcs" id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} subtitle="dialogue root" />)}</div> : <span className="empty-inline">Not a root node.</span>}</div>
        <div className="summary-block"><h3>Reached from</h3>{referencedBy.nodes.length ? <div className="ref-rows">{referencedBy.nodes.map(row => <RefRow key={String(row.id)} collection="dialogue" id={String(row.id)} record={row} ctx={ctx} onOpen={open} />)}</div> : <span className="empty-inline">No option leads here.</span>}</div>
        {referencedBy.quests.length > 0 && <div className="summary-block"><h3>Completes</h3><div className="ref-rows">{referencedBy.quests.map(reference => <RefRow key={`${reference.recordId}:${reference.path}`} collection="quests" id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} subtitle={reference.path} />)}</div></div>}
      </div>}>
      <Sheet>
        <Section title="Line">
          <Row label="Speaker"><TextField editable={editable} value={node.speaker} onChange={value => draft.setPath(["speaker"], value || undefined)} ariaLabel="Speaker" placeholder="NPC name by default" /></Row>
          <Row label="Text" align="start"><TextField editable={editable} value={node.text} onChange={value => draft.setPath(["text"], value)} multiline ariaLabel="Text" /></Row>
          {(variants.length > 0) && <Row label="Variants" align="start">
            <ReadableOrJson editable={editable} value={node.variants} onChange={value => draft.setPath(["variants"], value)} ariaLabel="Variants" readable={<span className="dlg-facts">{variants.map((variant, at) => <span key={at}><span className="dlg-fact-key">when {conditionsText(variant.when, ctx)}:</span> {clip(text(variant.text), 140)}</span>)}</span>} />
          </Row>}
        </Section>
        <Section title="Options" aside={editable && <AddButton label="Add option" onClick={() => draft.setPath(["options", options.length], { id: `${id}#${options.length + 1}`, text: "", next: null })}>Add</AddButton>}>
          <div className="dlg-options">{options.map((option, at) => <OptionBlock key={at} option={option} at={at} page={page} editable={editable} navigate={navigate} onRemove={() => draft.setPath(["options"], options.filter((_, index) => index !== at))} />)}</div>
          {!options.length && <span className="story-empty">No options; the conversation ends here.</span>}
        </Section>
        <Section title="Referenced by">
          <Row label="NPC roots" align="start">{referencedBy.npcs.length ? <span className="ref-list">{referencedBy.npcs.map(reference => <RefChip key={reference.recordId} collection="npcs" id={reference.recordId} record={reference.record} ctx={ctx} onOpen={open} />)}</span> : <Static muted>None</Static>}</Row>
          <Row label="Nodes" align="start">{referencedBy.nodes.length ? <span className="ref-list">{referencedBy.nodes.map(row => <RefChip key={String(row.id)} collection="dialogue" id={String(row.id)} record={row} ctx={ctx} onOpen={open} />)}</span> : <Static muted>None</Static>}</Row>
        </Section>
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

function OptionBlock({ option, at, page, editable, navigate, onRemove }: { option: Option; at: number; page: ReturnType<typeof usePage<Node>>; editable: boolean; navigate: ViewProps["navigate"]; onRemove: () => void }) {
  const { draft, ctx } = page;
  const base = ["options", at];
  const next = text(option.next);
  const facts: ReactNode[] = [];
  if (option.showIf !== undefined) facts.push(<Fact key="showIf" label="Show if" value={option.showIf} editable={editable} onChange={value => draft.setPath([...base, "showIf"], value)} ariaLabel={`Option ${at} show-if conditions`}>{conditionsText(option.showIf, ctx)}</Fact>);
  if (option.requires !== undefined) facts.push(<Fact key="requires" label="Requires" value={option.requires} editable={editable} onChange={value => draft.setPath([...base, "requires"], value)} ariaLabel={`Option ${at} requirements`}>{conditionsText(option.requires, ctx)}</Fact>);
  if (option.effects !== undefined) facts.push(<Fact key="effects" label="Effects" value={option.effects} editable={editable} onChange={value => draft.setPath([...base, "effects"], value)} ariaLabel={`Option ${at} effects`}>{effectsText(option.effects, ctx)}</Fact>);
  if (option.nextIf !== undefined) facts.push(<Fact key="nextIf" label="Next if" value={option.nextIf} editable={editable} onChange={value => draft.setPath([...base, "nextIf"], value)} ariaLabel={`Option ${at} branches`}>{list(option.nextIf).map(asRecord).map((branch, index) => <span key={index}>{conditionsText(branch.when, ctx)} → <button type="button" className="text-button" onClick={() => branch.next && navigate("dialogue", String(branch.next))}>{branch.next === null ? "end" : String(branch.next)}</button></span>)}</Fact>);
  return <div className="dlg-opt">
    <span className="quest-stage-marker" aria-label={`Option ${at + 1}`}>{at + 1}</span>
    <div className="dlg-opt-body">
      <div className="dlg-opt-head">
        <TextField editable={editable} value={option.text} onChange={value => draft.setPath([...base, "text"], value)} width="full" ariaLabel={`Option ${at} text`} />
        {editable && <RemoveButton label={`Remove option ${at + 1}`} onClick={onRemove} />}
      </div>
      <div className="kv">
        <Row label="Next">
          {next ? <RefChip collection="dialogue" id={next} record={ctx.lookup("dialogue", next)} ctx={ctx} onOpen={(collection, target) => navigate(collection, target)} /> : <Static muted>Ends the conversation</Static>}
          {editable && <RecordPicker collection="dialogue" value={next} ctx={ctx} onPick={picked => draft.setPath([...base, "next"], picked)} trigger={<button type="button" className="button button-small" aria-label={`Change option ${at + 1} next node`}>{next ? "Change" : "Choose"}</button>} />}
          {editable && next && <RemoveButton label={`End conversation after option ${at + 1}`} onClick={() => draft.setPath([...base, "next"], null)} />}
        </Row>
        {facts}
        {editable && (option.showIf === undefined || option.requires === undefined || option.effects === undefined || option.nextIf === undefined) && <Row label="Add"><span className="ref-list">
          {option.showIf === undefined && <button type="button" className="filter-chip" aria-label={`Add show-if conditions to option ${at + 1}`} onClick={() => draft.setPath([...base, "showIf"], [])}>+ show if</button>}
          {option.requires === undefined && <button type="button" className="filter-chip" aria-label={`Add requirements to option ${at + 1}`} onClick={() => draft.setPath([...base, "requires"], [])}>+ requires</button>}
          {option.effects === undefined && <button type="button" className="filter-chip" aria-label={`Add effects to option ${at + 1}`} onClick={() => draft.setPath([...base, "effects"], [])}>+ effects</button>}
          {option.nextIf === undefined && <button type="button" className="filter-chip" aria-label={`Add branches to option ${at + 1}`} onClick={() => draft.setPath([...base, "nextIf"], [])}>+ next if</button>}
        </span></Row>}
        <Row label="Id"><Static mono muted>{text(option.id) ?? "—"}</Static></Row>
      </div>
    </div>
  </div>;
}

function Fact({ label, value, editable, onChange, ariaLabel, children }: { label: string; value: unknown; editable: boolean; onChange: (value: unknown) => void; ariaLabel: string; children: ReactNode }) {
  return <Row label={label} align="start">
    <ReadableOrJson editable={editable} value={value} onChange={onChange} ariaLabel={ariaLabel} readable={<span className="dlg-facts">{children}</span>}
      aside={<button type="button" className="text-button story-readable-toggle" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange(undefined)}>Remove</button>} />
  </Row>;
}

/* ---------- Readable conditions and effects ---------- */

export function conditionsText(value: unknown, ctx: SummaryContext): string {
  const conditions = list(value).map(asRecord);
  if (!conditions.length) return "always";
  return conditions.map(condition => conditionText(condition, ctx)).join(" and ");
}

function range(min: unknown, max: unknown): string {
  if (min !== undefined && max !== undefined) return `${String(min)}–${String(max)}`;
  if (min !== undefined) return `≥ ${String(min)}`;
  if (max !== undefined) return `≤ ${String(max)}`;
  return "any";
}

function conditionText(condition: ContentRow, ctx: SummaryContext): string {
  const quest = () => nameOf(ctx, "quest", text(condition.questId));
  switch (text(condition.kind)) {
    case "questStatus": return `${quest()} is ${text(condition.status) ?? "?"}`;
    case "questStage": return `${quest()} stage ${range(condition.min, condition.max)}`;
    case "questFlag": return `${quest()} flag ${text(condition.flag) ?? "?"}${condition.value === false ? " unset" : ""}`;
    case "questCounter": return `${quest()} ${text(condition.counter) ?? "?"} ${range(condition.min, condition.max)}`;
    case "questOffer": return `${quest()} can be offered`;
    case "skill": return `${titleCase(text(condition.skill) ?? "?")} ${String(condition.level ?? "?")}`;
    case "item": return `carrying ${String(condition.quantity ?? 1)} × ${nameOf(ctx, "item", text(condition.itemId))}`;
    case "lacksItem": return `fewer than ${String(condition.quantity ?? 1)} × ${nameOf(ctx, "item", text(condition.itemId))}`;
    case "currency": return `${String(condition.amount ?? 0)} marks`;
    default: return JSON.stringify(condition);
  }
}

export function effectsText(value: unknown, ctx: SummaryContext): string {
  const effects = list(value).map(asRecord);
  if (!effects.length) return "none";
  return effects.map(effect => {
    const quest = () => nameOf(ctx, "quest", text(effect.questId));
    switch (text(effect.kind)) {
      case "startQuest": return `start ${quest()}`;
      case "setFlag": return `set ${quest()} flag ${text(effect.flag) ?? "?"}${effect.value === false ? " off" : ""}`;
      case "bumpCounter": return `${quest()} ${text(effect.counter) ?? "?"} +${String(effect.by ?? 1)}`;
      case "giveItem": return `give ${String(effect.quantity ?? 1)} × ${nameOf(ctx, "item", text(effect.itemId))}`;
      case "takeItem": return `take ${String(effect.quantity ?? 1)} × ${nameOf(ctx, "item", text(effect.itemId))}`;
      case "grantXp": return `+${String(effect.amount ?? 0)} ${text(effect.skill) ?? "?"} xp`;
      case "grantCurrency": return `+${String(effect.amount ?? 0)} marks`;
      default: return JSON.stringify(effect);
    }
  }).join(", ");
}
