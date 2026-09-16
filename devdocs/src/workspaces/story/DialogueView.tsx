import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { dialogueConditionSchema, dialogueEffectSchema, dialogueNodeSchema, dialogueOptionSchema } from "../../../../game/src/content/schema/story.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { titleCase, type SummaryContext } from "../../model/summaries.js";
import {
  Field, ListField, RefField, ReferencedBy, Section, Sheet, TextField, UnionList, fieldFromSchema, type RenderRef,
} from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { asRecord, clip, list, nameOf, PageState, RecordShell, RefCell, refRenderer, RowBlock, text, usePage, type Page } from "./shared.js";
import { EmptyCell, SearchInput, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../components/ui/index.js";
import { COUNT, PAGE, TOOLBAR } from "../../ui/layout.js";

interface Option extends ContentRow { id?: string; text?: string; next?: string | null; requires?: unknown; showIf?: unknown; effects?: unknown; nextIf?: unknown }
interface Node extends ContentRow { id: string; speaker?: string; text?: string; variants?: unknown; options?: Option[]; catalog?: string }

const node = (key: string) => fieldFromSchema(dialogueNodeSchema, key);
const option = (key: string) => fieldFromSchema(dialogueOptionSchema, key);

export default function DialogueView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <DialogueList navigate={navigate} />;
  return <DialoguePage id={recordId} navigate={navigate} />;
}

/* ---------- List ---------- */

function DialogueList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("dialogue"));
  const [search, setSearch] = useState("");
  const total = query.data ? contentRows(query.data).length : 0;
  const rows = useMemo(() => {
    const all = query.data ? contentRows(query.data) : [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(row => `${String(row.id)} ${text(row.speaker) ?? ""} ${text(row.text) ?? ""} ${list(row.options).map(entry => text(asRecord(entry).text) ?? "").join(" ")}`.toLowerCase().includes(needle));
  }, [query.data, search]);
  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className={PAGE}>
    <div className={TOOLBAR}>
      <SearchInput label="Search dialogue" placeholder="Search id, speaker, text…" value={search} onChange={setSearch} shortcut
        onEnter={() => { const first = rows[0]; if (first) navigate("dialogue", String(first.id)); }} />
      <span className={COUNT}>{search.trim() ? `${rows.length} of ${total}` : total}</span>
    </div>
    <TableFrame className="max-h-[calc(100vh-8.5rem)] w-full">
      <Table>
        <TableHeader><TableRow>
          <TableHead pin>Node</TableHead><TableHead>Speaker</TableHead><TableHead className="w-full">Text</TableHead><TableHead numeric>Options</TableHead><TableHead>Catalog</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => {
          const id = String(row.id);
          const line = text(row.text);
          return <TableRow key={id}>
            <TableCell pin className="font-normal"><TableLink className="font-mono text-[11px]" onClick={() => navigate("dialogue", id)}>{id}</TableLink></TableCell>
            <TableCell className="text-muted-foreground">{text(row.speaker) ?? <EmptyCell />}</TableCell>
            <TableCell className="text-muted-foreground" title={line}>{line ? <span className="block max-w-[48rem] min-w-80 truncate">{line}</span> : <EmptyCell />}</TableCell>
            <TableCell numeric>{list(row.options).length}</TableCell>
            <TableCell className="text-muted-foreground">{text(row.catalog) ?? <EmptyCell />}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableFrame>
  </div>;
}

/* ---------- Record ---------- */

/** The next option id: one past the highest `#n` already used, so a removal cannot make a collision. */
export function nextOptionId(nodeId: string, options: readonly Option[]): string {
  const used = new Set(options.map(entry => text(entry.id) ?? ""));
  let highest = 0;
  for (const entry of options) {
    const match = /#(\d+)$/.exec(text(entry.id) ?? "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let candidate = `${nodeId}#${highest + 1}`;
  for (let bump = highest + 2; used.has(candidate); bump++) candidate = `${nodeId}#${bump}`;
  return candidate;
}

function DialoguePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Node>("dialogue", id);
  const { draft, ctx } = page;
  const readOnly = !draft.editable;
  const renderRef = useMemo(() => refRenderer(readOnly), [readOnly]);
  return <PageState page={page} collection="dialogue" navigate={navigate}>{record => {
    const options = list(record.options).map(entry => entry as Option);
    const variants = list(record.variants).map(asRecord);
    return <RecordShell
      thumb={{ kind: "glyph", icon: MessageCircle }}
      title={text(record.speaker) ?? id} id={id}
      facts={[record.catalog && titleCase(record.catalog), `${options.length} option${options.length === 1 ? "" : "s"}`]}
      draft={draft}>
      <Sheet>
        <Section title="Line">
          <Field label={node("speaker").label} hint={node("speaker").hint}>
            <TextField value={record.speaker ?? ""} placeholder="NPC name" readOnly={readOnly} onChange={value => draft.setPath(["speaker"], value || undefined)} />
          </Field>
          <Field label={node("text").label}><TextField value={record.text ?? ""} multiline readOnly={readOnly} onChange={value => draft.setPath(["text"], value)} /></Field>
          <ListField<ContentRow> label={node("variants").label} hint={node("variants").hint} items={variants} ordered readOnly={readOnly}
            emptyText="None; the line above always plays." addLabel="Add variant" onAdd={() => ({ when: [], text: "" })}
            summarize={variant => `when ${conditionsText(variant.when, ctx)}: ${clip(text(variant.text), 80) || "…"}`}
            onChange={next => draft.setPath(["variants"], next.length ? next : undefined)}
            renderItem={(variant, api) => <RowBlock>
              <UnionList label="When" schema={dialogueConditionSchema} items={list(variant.when)} readOnly={readOnly} renderRef={renderRef}
                summarize={condition => conditionText(asRecord(condition), ctx)} addLabel="Add condition" emptyText="Always."
                onChange={next => api.update({ ...variant, when: next })} />
              <Field label="Text"><TextField value={text(variant.text) ?? ""} multiline readOnly={readOnly} ariaLabel={`Variant ${api.index + 1} text`} onChange={value => api.update({ ...variant, text: value })} /></Field>
            </RowBlock>} />
        </Section>

        <Section title={node("options").label}>
          <ListField<Option> items={options} ordered min={1} readOnly={readOnly}
            emptyText="No options; the conversation ends here." addLabel="Add option"
            onAdd={() => ({ id: nextOptionId(id, options), text: "", next: null })}
            summarize={entry => clip(text(entry.text), 96) || "(no text yet)"}
            removeLabel={(entry, index) => `Remove option ${index + 1}${text(entry.text) ? `: ${clip(text(entry.text), 40)}` : ""}`}
            onChange={next => draft.setPath(["options"], next)}
            renderItem={(entry, api) => <OptionFields option={entry} at={api.index} update={api.update} page={page} readOnly={readOnly} renderRef={renderRef} />} />
        </Section>

        <ReferencedBy collection="dialogue" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}

function OptionFields({ option: entry, at, update, page, readOnly, renderRef }: { option: Option; at: number; update: (next: Option) => void; page: Page<Node>; readOnly: boolean; renderRef: RenderRef }) {
  const { ctx } = page;
  const branches = list(entry.nextIf).map(asRecord);
  const conditionList = (key: "showIf" | "requires") => <UnionList key={key} label={option(key).label} hint={option(key).hint} schema={dialogueConditionSchema}
    items={list(entry[key])} readOnly={readOnly} renderRef={renderRef} addLabel="Add condition" emptyText="Always."
    summarize={condition => conditionText(asRecord(condition), ctx)}
    onChange={next => update({ ...entry, [key]: next.length ? next : undefined })} />;

  return <RowBlock>
    <Field label={option("text").label}><TextField value={entry.text ?? ""} multiline readOnly={readOnly} ariaLabel={`Option ${at + 1} text`} onChange={value => update({ ...entry, text: value })} /></Field>
    <RefField kind="dialogue" label={option("next").label} hint={option("next").hint} optional value={text(entry.next)} readOnly={readOnly}
      onChange={value => update({ ...entry, next: value ?? null })} />
    {conditionList("showIf")}
    {conditionList("requires")}
    <UnionList label={option("effects").label} schema={dialogueEffectSchema} items={list(entry.effects)} readOnly={readOnly} renderRef={renderRef}
      addLabel="Add effect" emptyText="None."
      summarize={effect => effectText(asRecord(effect), ctx)}
      onChange={next => update({ ...entry, effects: next.length ? next : undefined })} />
    <ListField<ContentRow> label={option("nextIf").label} hint={option("nextIf").hint} items={branches} ordered readOnly={readOnly}
      emptyText="None; the next node above always follows." addLabel="Add branch" onAdd={() => ({ when: [], next: null })}
      summarize={branch => `${conditionsText(branch.when, ctx)} → ${text(branch.next) ?? "ends"}`}
      onChange={next => update({ ...entry, nextIf: next.length ? next : undefined })}
      renderItem={(branch, api) => <RowBlock>
        <UnionList label="When" schema={dialogueConditionSchema} items={list(branch.when)} readOnly={readOnly} renderRef={renderRef}
          addLabel="Add condition" emptyText="Always."
          summarize={condition => conditionText(asRecord(condition), ctx)}
          onChange={next => api.update({ ...branch, when: next })} />
        <RefField kind="dialogue" label="Next node" optional value={text(branch.next)} readOnly={readOnly}
          onChange={value => api.update({ ...branch, next: value ?? null })} />
      </RowBlock>} />
    <Field label={option("id").label}><TextField value={entry.id ?? ""} mono width="id" readOnly ariaLabel={`Option ${at + 1} id`} onChange={() => undefined} /></Field>
  </RowBlock>;
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

export function conditionText(condition: ContentRow, ctx: SummaryContext): string {
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
    default: return text(condition.kind) ?? "condition";
  }
}

export function effectsText(value: unknown, ctx: SummaryContext): string {
  const effects = list(value).map(asRecord);
  if (!effects.length) return "none";
  return effects.map(effect => effectText(effect, ctx)).join(", ");
}

export function effectText(effect: ContentRow, ctx: SummaryContext): string {
  const quest = () => nameOf(ctx, "quest", text(effect.questId));
  switch (text(effect.kind)) {
    case "startQuest": return `start ${quest()}`;
    case "setFlag": return `set ${quest()} flag ${text(effect.flag) ?? "?"}${effect.value === false ? " off" : ""}`;
    case "bumpCounter": return `${quest()} ${text(effect.counter) ?? "?"} +${String(effect.by ?? 1)}`;
    case "giveItem": return `give ${String(effect.quantity ?? 1)} × ${nameOf(ctx, "item", text(effect.itemId))}`;
    case "takeItem": return `take ${String(effect.quantity ?? 1)} × ${nameOf(ctx, "item", text(effect.itemId))}`;
    case "grantXp": return `+${String(effect.amount ?? 0)} ${text(effect.skill) ?? "?"} xp`;
    case "grantCurrency": return `+${String(effect.amount ?? 0)} marks`;
    default: return text(effect.kind) ?? "effect";
  }
}
