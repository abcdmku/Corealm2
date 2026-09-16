import { useState } from "react";
import type { Link, RecordRef, Resolved } from "../../model/origin.js";
import {
  ChoiceField, DerivedChoice, DerivedNumber, Field, FieldLegend, Fields, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, ToggleField,
} from "../../ui/field/index.js";
import type { ViewProps } from "../types.js";
import { ListField, MapField, UnionList, WeightedList, type RenderRef } from "../../ui/field/index.js";
import { questPredicateSchema } from "../../../../game/src/content/schema/story.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { PAGE, PAGE_HEADING } from "../../ui/layout.js";

/*
  Every field component in every state, on fake chains, with a live log of commits. Hidden from
  the tab strip; reach it at #/tuning/fields. Local state only: nothing here writes to the server.
*/

const grazer: RecordRef = { collection: "creatureProfiles", id: "grazer", label: "Grazer" };
const heathJack: RecordRef = { collection: "creatureDefinitions", id: "heath_jack", label: "Heath Jack" };
const stitched: RecordRef = { collection: "equipmentFamilies", id: "stitched", label: "Stitched" };

const own = <T,>(value: T): Link<T> => ({ origin: { kind: "own" }, value });
const curve = <T,>(value: T, expression: string, source = grazer): Link<T> => ({ origin: { kind: "curve", source, expression }, value });
const inherited = <T,>(value: T, from = heathJack): Link<T> => ({ origin: { kind: "inherited", from }, value });
const fallback = <T,>(value: T): Link<T> => ({ origin: { kind: "default" }, value });

function resolve<T>(path: string, ownValue: T | undefined, beaten: readonly Link<T | undefined>[]): Resolved<T | undefined> {
  const chain = ownValue !== undefined ? [own<T | undefined>(ownValue), ...beaten] : beaten;
  return { value: chain[0]?.value, chain, path: [path] };
}

type Owns = Record<string, number | undefined>;
type Picks = Record<string, string | undefined>;

const ATTACK_CURVE = "max(1, round(0 + 1 × 2400))";
const BEHAVIOURS = ["passive", "defensive", "aggressive", "skittish"] as const;

const COMPACT: readonly { key: string; label: string; beaten: Link<number | undefined>[]; unit?: string }[] = [
  { key: "health", label: "Health", beaten: [curve(48, "round(12 + 4 × 9)")] },
  { key: "defence", label: "Defence", beaten: [curve(9, "round(3 + 0.6 × 10)")] },
  { key: "meleePower", label: "Melee power", beaten: [inherited(11), curve(9, "round(2 + 0.7 × 10)")] },
  { key: "meleeAccuracy", label: "Melee accuracy", beaten: [curve(14, "round(4 + 1 × 10)")] },
  { key: "attackSpeed", label: "Attack speed", beaten: [curve(2400, ATTACK_CURVE)], unit: "ms" },
  { key: "xp", label: "XP", beaten: [curve(36, "round(6 × 6)")], unit: "xp" },
  { key: "aggroRange", label: "Aggro range", beaten: [fallback(8)], unit: "m" },
  { key: "respawn", label: "Respawn", beaten: [inherited(45)], unit: "s" },
];

export default function FieldGallery({ navigate }: ViewProps) {
  const [owns, setOwns] = useState<Owns>({ own: 1800, over2: 1500, over3: 1500, attackSpeed: 1800, meleePower: 13, health: 52 });
  const [picks, setPicks] = useState<Picks>({ behaviour: "berserk", family: undefined });
  const [text, setText] = useState("Heath Jack");
  const [notes, setNotes] = useState("Grazes the heath at dawn.\nFlees when hit below half health.");
  const [flag, setFlag] = useState(true);
  const [optional, setOptional] = useState<number | undefined>(undefined);
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const [refs, setRefs] = useState<Picks>({ item: "crown_trout", missing: "iron_sword_of_nowhere", optionalItem: undefined, inheritedLoot: undefined, skill: "smithing", station: undefined });

  const record = (name: string, value: unknown) => {
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    setLog(entries => [`${time}  ${name} ← ${value === undefined ? "(revert)" : JSON.stringify(value)}`, ...entries].slice(0, 40));
  };
  const setOwn = (key: string, label: string) => (value: number | undefined) => { setOwns(current => ({ ...current, [key]: value })); record(label, value); };
  const setPick = (key: string, label: string) => (value: string | undefined) => { setPicks(current => ({ ...current, [key]: value })); record(label, value); };
  const setRef = (key: string, label: string) => (value: string | undefined) => { setRefs(current => ({ ...current, [key]: value })); record(label, value); };
  const openRef = (ref: RecordRef) => { record(`open ${ref.label}`, `${ref.collection}/${ref.id}`); navigate(ref.collection, ref.id); };

  const rowStates = [
    { key: "own", label: "Own", hint: "An own value that beats only the schema default. No dot, no revert.", beaten: [] as Link<number | undefined>[] },
    { key: "curve", label: "Curve", hint: "Computed by the role curve. Typing makes it your own.", beaten: [curve(2400, ATTACK_CURVE)] },
    { key: "inherited", label: "Inherited", hint: "Copied from the base creature, which itself beats the curve.", beaten: [inherited(1800), curve(2400, ATTACK_CURVE)] },
    { key: "over2", label: "Overridden", hint: "Own value beats the curve. Backspace or the glyph hands it back.", beaten: [curve(2400, ATTACK_CURVE)] },
    { key: "over3", label: "Overridden, three links", hint: "Own beats the base, which beats the curve.", beaten: [inherited(1800), curve(2400, ATTACK_CURVE)] },
    { key: "absent", label: "Absent", hint: "Optional and not set anywhere. An empty commit keeps it absent.", beaten: [] as Link<number | undefined>[] },
  ];

  // The peek provider belongs in the app shell; until it is mounted there this local one lets the reference fields peek.
  return <div className={cn(PAGE, "grid max-w-[67.5rem] grid-cols-[minmax(0,1fr)_17.5rem] items-start gap-6 @max-[52rem]:grid-cols-1")}>
    <div className="min-w-0">
      <div className={PAGE_HEADING}><h1>Fields</h1><FieldLegend /></div>
      <Sheet>
        <Section title="Provenance states">
          {rowStates.map(state => <DerivedNumber key={state.key} label={state.label} hint={state.hint} unit="ms" resolved={resolve(state.key, owns[state.key], state.beaten)} onChange={setOwn(state.key, state.label)} onOpenRef={openRef} optional={state.key === "absent"} />)}
          <Field label="Mixed" hint="Three selected creatures disagree. +10, -5, *1.1 and /2 apply per record." unit="ms" mixed>
            <NumberField value={undefined} mixed unit="ms" onChange={value => record("Mixed", value)} onMixedEdit={(raw, op) => record("Mixed", `${raw} → ${op.kind} ${op.value}`)} />
          </Field>
          <Field label="Invalid" hint="Validation failed on the draft." unit="ms" error="Must be at least 400 ms" resolved={resolve("invalid", 120, [curve(2400, ATTACK_CURVE)])} onRevert={() => record("Invalid", undefined)} onOpenRef={openRef}>
            <NumberField value={120} unit="ms" onChange={value => record("Invalid", value)} />
          </Field>
          <Field label="Stale" hint="The record changed on disk after this draft was loaded." unit="ms" stale resolved={resolve("stale", undefined, [curve(2400, ATTACK_CURVE)])} onOpenRef={openRef}>
            <NumberField value={2400} unit="ms" onChange={value => record("Stale", value)} />
          </Field>
          <Field label="Disabled" unit="ms" disabled resolved={resolve("disabled", 1500, [curve(2400, ATTACK_CURVE)])} onRevert={() => record("Disabled", undefined)} onOpenRef={openRef}>
            <NumberField value={1500} unit="ms" disabled onChange={value => record("Disabled", value)} />
          </Field>
          <Field label="Dirty" hint="Draft differs from disk. The bar marks it until save." unit="ms" dirty resolved={resolve("dirty", 1650, [curve(2400, ATTACK_CURVE)])} onRevert={() => record("Dirty", undefined)} onOpenRef={openRef}>
            <NumberField value={1650} unit="ms" onChange={value => record("Dirty", value)} />
          </Field>
        </Section>

        <Section title="Controls">
          <Field label="Optional number" hint="Empty commit clears it. Alt+drag this label to scrub; Shift and Alt change the step.">
            <NumberField value={optional} optional unit="m" step={0.5} min={0} max={100} placeholder="none" onChange={value => { setOptional(value); setPreview(undefined); record("Optional number", value); }} onPreview={setPreview} />
            {preview !== undefined && <span className="text-[11px] text-muted-foreground">scrubbing {preview}</span>}
          </Field>
          <Field label="Integer" hint="Integers never step by less than one.">
            <NumberField value={owns.health ?? 0} integer min={1} onChange={setOwn("health", "Integer")} />
          </Field>
          <Field label="Name" hint="Enter commits; Escape restores.">
            <TextField value={text} onChange={value => { setText(value); record("Name", value); }} />
          </Field>
          <Field label="Asset id" hint="Ids are mono.">
            <TextField value="creature_heath_jack" mono width="id" onChange={value => record("Asset id", value)} />
          </Field>
          <Field label="Notes" hint="Ctrl+Enter commits. Enter is a newline.">
            <TextField value={notes} multiline onChange={value => { setNotes(value); record("Notes", value); }} />
          </Field>
          <DerivedChoice label="Behaviour" hint="An off-list value is flagged, not silently accepted." resolved={resolve("behaviour", picks.behaviour, [inherited<string | undefined>("passive")])} options={BEHAVIOURS} onChange={setPick("behaviour", "Behaviour")} onOpenRef={openRef} />
          <Field label="Family" hint="An empty row clears the value.">
            <ChoiceField value={picks.family} allowEmpty="None" options={[{ value: "stitched", label: "Stitched" }, { value: "bronze", label: "Bronze" }, { value: "iron", label: "Iron" }]} onChange={setPick("family", "Family")} />
          </Field>
          <Field label="Aggressive" hint="Space flips it.">
            <ToggleField value={flag} onChange={value => { setFlag(value); record("Aggressive", value); }} />
          </Field>
          <DerivedNumber label="Read only" unit="ms" readOnly resolved={resolve("ro", undefined, [curve(2400, ATTACK_CURVE)])} onChange={() => undefined} onOpenRef={openRef} />
          <DerivedNumber label="Balance target" hint="The stored value is compared against a balance target." unit="xp" resolved={{ value: 36, chain: [own(36), { origin: { kind: "balance", source: stitched }, value: 40 }], path: ["xp"] }} onChange={value => record("Balance target", value)} onOpenRef={openRef} />
        </Section>

        <Section title="Compact grid">
          <Fields columns={4}>
            {COMPACT.map(entry => <DerivedNumber key={entry.key} compact label={entry.label} unit={entry.unit} hint={`${entry.label} of this creature.`} resolved={resolve(entry.key, owns[entry.key], entry.beaten)} onChange={setOwn(entry.key, entry.label)} onOpenRef={openRef} dirty={entry.key === "health"} />)}
          </Fields>
        </Section>

        <Section title="References" aside={<span>chip: Space peeks · Enter picks · Backspace unlinks</span>}>
          <RefField kind="item" label="Item" hint="A reference with a target. Click the chip or press Space to peek; hover for the card." value={refs.item} onChange={setRef("item", "Item")} />
          <RefField kind="item" label="Missing" hint="The id is not in the collection: dashed chip, red dot, and the picker opens on click." value={refs.missing} onChange={setRef("missing", "Missing")} />
          <RefField kind="item" label="Optional item" hint="Backspace clears it; the picker offers a None row." value={refs.optionalItem} optional onChange={setRef("optionalItem", "Optional item")} />
          <RefField kind="lootTable" label="Loot table" hint="Inherited from the base creature. Picking makes it your own; Backspace hands it back." value={refs.inheritedLoot} resolved={resolve("loot.tableId", refs.inheritedLoot, [inherited<string | undefined>("shared_marsh_gland_raw_venison")])} onChange={setRef("inheritedLoot", "Loot table")} />
          <RefField kind="skill" label="Skill" hint="No collection: the options come from the schema enum." value={refs.skill} onChange={setRef("skill", "Skill")} />
          <RefField kind="station" label="Station" hint="Derived from recipe templates. Optional." value={refs.station} optional onChange={setRef("station", "Station")} />
          <RefField kind="item" label="Read only" readOnly value="cooked_crown_trout" onChange={() => undefined} />
          <RefField kind="item" label="Create new" hint="A page passes createNew; the picker shows the row and Ctrl+Enter runs it." value={refs.created} optional onChange={setRef("created", "Create new")} createNew={() => { record("Create new", "dialog"); return Promise.resolve("crown_tuna"); }} />
        </Section>
        <ReferencedBy collection="lootTables" id="shared_marsh_gland_raw_venison" title="Referenced by · Marsh gland loot table" />
        <ListsSection record={record} />
      </Sheet>
    </div>

    <aside className="sticky top-3 flex min-w-0 flex-col gap-1 @max-[52rem]:static">
      <div className="flex min-h-6 items-center gap-2 border-b border-border-subtle pb-1">
        <h3 className="text-[13px] font-semibold">Commits</h3>
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-muted-foreground"><span data-testid="commit-count" className="font-mono">{log.length}</span>{log.length > 0 && <Button variant="link" size="inline" onClick={() => setLog([])}>Clear</Button>}</span>
      </div>
      <ol data-testid="commit-log" className="flex list-none flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
        {log.length === 0 && <li className="font-sans text-xs text-faint">Nothing committed yet. Typing does not commit; Enter, Tab, blur, a step or a scrub release does.</li>}
        {log.map((entry, index) => <li key={`${index}-${entry}`} className="wrap-anywhere">{entry}</li>)}
      </ol>
    </aside>
  </div>;
}

/* ---------- Lists: ListField, MapField, WeightedList, UnionList (§3.6) ---------- */

type Member = { creatureId: string; weight: number };
type Drop = { itemId: string; quantity: [number, number]; chance: number; exclusiveGroup?: string };

const CREATURES = [{ value: "heath_jack", label: "Heath Jack" }, { value: "grazer", label: "Grazer" }, { value: "fox", label: "Fox" }, { value: "marsh_hen", label: "Marsh Hen" }];
const ITEMS = [{ value: "fox_fur", label: "Fox Fur" }, { value: "bone", label: "Bone" }, { value: "ember_stone", label: "Ember Stone" }, { value: "raw_meat", label: "Raw Meat" }];
const SKILLS = ["woodcutting", "mining", "fishing", "cooking", "smithing", "crafting"];
const nameOf = (options: readonly { value: string; label: string }[], id: unknown): string => options.find(option => option.value === id)?.label ?? (typeof id === "string" && id ? id : "?");
const titleCase = (text: string): string => text.replace(/^./, first => first.toUpperCase());

/** The gallery's own sentence for a predicate; the story workspace keeps the real one. */
function predicateSummary(item: unknown): string {
  const node = (item ?? {}) as Record<string, unknown>;
  const count = (key: string) => String(node[key] ?? 1);
  switch (node.kind) {
    case "have": return `Has ${count("quantity")} × ${nameOf(ITEMS, node.itemId)}`;
    case "banked": return `Banked ${count("quantity")} × ${nameOf(ITEMS, node.itemId)}`;
    case "equipped": return `Equipped ${nameOf(ITEMS, node.itemId)}`;
    case "gather": return `Gather ${count("count")} × ${nameOf(ITEMS, node.itemId)}`;
    case "deplete": return `Deplete ${count("count")} × ${nameOf(ITEMS, node.itemId)}`;
    case "kill": return `Kill ${count("count")} × ${String(node.enemyFamily || "?")}`;
    case "produce": return `Produce ${count("count")} × ${String(node.recipeId || "?")}`;
    case "skill": return `${titleCase(String(node.skill ?? "?"))} ${String(node.level ?? "?")}`;
    case "flag": return `Flag ${String(node.flag || "?")}${node.value === false ? " is unset" : ""}`;
    case "counter": return `${String(node.counter || "?")} ≥ ${String(node.atLeast ?? 0)}`;
    case "talk": return `Talk to ${String(node.npcId || "?")} at ${String(node.dialogueNodeId || "?")}`;
    case "reach": case "visit": return `${titleCase(String(node.kind))} ${String(node.locationId || "?")}${node.radius !== undefined ? ` within ${String(node.radius)} m` : ""}`;
    case "nearEntity": return `Near ${String(node.entityId || "?")}`;
    case "traverse": return `Traverse ${String(node.obstacleId || "?")}`;
    case "entityState": return `${String(node.entityId || "?")} is ${String(node.state || "?")}`;
    case "all": return `All of ${Array.isArray(node.of) ? node.of.length : 0} predicates`;
    default: return String(node.kind ?? "?");
  }
}

function ListsSection({ record }: { record: (name: string, value: unknown) => void }) {
  const [steps, setSteps] = useState<string[]>(["Gather fox fur", "Return to Heath Jack", "Light the beacon"]);
  const [skills, setSkills] = useState<Record<string, number>>({ woodcutting: 10, fishing: 5 });
  const [members, setMembers] = useState<Member[]>([{ creatureId: "heath_jack", weight: 3 }, { creatureId: "grazer", weight: 1 }, { creatureId: "fox", weight: 1 }]);
  const [drops, setDrops] = useState<Drop[]>([{ itemId: "fox_fur", quantity: [1, 2], chance: 0.6, exclusiveGroup: "pelt" }, { itemId: "bone", quantity: [1, 1], chance: 1 }, { itemId: "ember_stone", quantity: [1, 1], chance: 0.05 }]);
  const [predicates, setPredicates] = useState<unknown[]>([{ kind: "have", itemId: "fox_fur", quantity: 3 }, { kind: "kill", enemyFamily: "fox", count: 5 }, { kind: "skill", skill: "woodcutting", level: 10 }]);
  const renderRef: RenderRef = (kind, value, onChange) => <TextField value={value ?? ""} mono width="id" placeholder={kind} ariaLabel={kind} onChange={next => onChange(next || undefined)} />;

  return <Section title="Lists">
    <ListField<string> label="Stages" hint="Drag the handle or Alt+Up/Down to reorder. Backspace on a focused row removes it. Enter in the last row adds another."
      items={steps} ordered addOnEnter addLabel="Add stage" emptyText="No stages." onAdd={() => ""}
      onChange={next => { setSteps(next); record("Stages", next); }}
      renderItem={(step, api) => <TextField value={step} placeholder="Describe the stage" ariaLabel={`Stage ${api.index + 1}`} onChange={api.update} />} />
    <MapField<number> label="Skill levels" hint="Keys come from the schema enum; the add row offers only the unused ones."
      value={skills} keys={SKILLS.map(skill => ({ value: skill, label: titleCase(skill) }))} keyLabel="skill" emptyText="No requirements." defaultValue={() => 1}
      onChange={next => { setSkills(next); record("Skill levels", next); }}
      renderValue={(skill, level, update) => <NumberField value={level} integer min={1} max={99} ariaLabel={`${titleCase(skill)} level`} onChange={next => update(next ?? 1)} />} />
    <WeightedList<Member> label="Members" hint="Weights share one roll: 3/1/1 reads 60/20/20. Editing one unlocked weight moves the other unlocked weights to keep the total. Lock a row to pin it."
      items={members} weightKey="weight" keepTotal keyOf={member => member.creatureId} min={1} addLabel="Add creature" onAdd={() => ({ creatureId: CREATURES.find(creature => !members.some(member => member.creatureId === creature.value))?.value ?? "fox", weight: 1 })}
      onChange={next => { setMembers(next); record("Members", next.map(member => `${member.creatureId}:${member.weight}`).join(" ")); }}
      renderItem={(member, api) => <ChoiceField value={member.creatureId} options={CREATURES} ariaLabel={`Creature ${api.index + 1}`} onChange={next => api.update({ ...member, creatureId: next ?? member.creatureId })} />} />
    <WeightedList<Drop> label="Drops" hint="Each drop rolls on its own, so chances are independent and do not sum to 100."
      items={drops} probabilityKey="chance" keyOf={drop => drop.itemId} addLabel="Add drop" onAdd={() => ({ itemId: ITEMS.find(item => !drops.some(drop => drop.itemId === item.value))?.value ?? "bone", quantity: [1, 1], chance: 1 })}
      onChange={next => { setDrops(next); record("Drops", next.map(drop => `${drop.itemId} ${drop.quantity.join("–")} ${Math.round(drop.chance * 100)}%${drop.exclusiveGroup ? ` [${drop.exclusiveGroup}]` : ""}`).join(", ")); }}
      renderItem={(drop, api) => <>
        <ChoiceField display="select" value={drop.itemId} options={ITEMS} ariaLabel={`Item ${api.index + 1}`} onChange={next => api.update({ ...drop, itemId: next ?? drop.itemId })} />
        <NumberField value={drop.quantity[0]} integer min={1} ariaLabel={`Minimum ${api.index + 1}`} onChange={next => api.update({ ...drop, quantity: [next ?? 1, Math.max(next ?? 1, drop.quantity[1])] })} />
        <span className="shrink-0 text-[11px] text-faint">to</span>
        <NumberField value={drop.quantity[1]} integer min={drop.quantity[0]} ariaLabel={`Maximum ${api.index + 1}`} onChange={next => api.update({ ...drop, quantity: [drop.quantity[0], Math.max(drop.quantity[0], next ?? drop.quantity[0])] })} />
        <TextField value={drop.exclusiveGroup ?? ""} width="short" className="w-28" placeholder="no group" ariaLabel={`Exclusive group ${api.index + 1}`} onChange={next => { const { exclusiveGroup, ...bare } = drop; void exclusiveGroup; api.update(next ? { ...bare, exclusiveGroup: next } : bare); }} />
      </>} />
    <UnionList label="Completion" hint="Each row is one predicate, collapsed to its sentence. Enter or click expands it. Switching kind keeps same-named fields and asks before dropping a value."
      schema={questPredicateSchema} items={predicates} summarize={predicateSummary} renderRef={renderRef} addLabel="Add predicate" emptyText="Completes at once."
      onChange={next => { setPredicates(next); record("Completion", next.map(predicateSummary).join(" · ")); }} />
  </Section>;
}
