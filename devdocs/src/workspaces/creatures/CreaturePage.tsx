import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GitBranch, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CreatureDefinitionSchema } from "../../../../game/src/content/schema/creatureDefinitions.js";
import { SpeciesFields } from "../../../../game/src/content/schema/creatures.js";
import { EnemyOverridesSchema } from "../../../../game/src/content/schema/enemies.js";
import { collectionQuery } from "../../api/client.js";
import { COMBAT_FIELDS, UNCOMPUTED_FIELDS, deriveCreature } from "../../model/derive.js";
import { getPath, runTransaction, useRecordDraft, type Path, type RecordDraft } from "../../model/draft.js";
import { fieldIssues } from "../../model/fields.js";
import { fmtValue, type RecordRef, type Resolved } from "../../model/origin.js";
import { rowName } from "../../model/rows.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { ListRow } from "../../ui/ListRow.js";
import { RefRow } from "../../ui/RefChip.js";
import {ChoiceField, DerivedChoice, DerivedNumber, Facts, Field, FieldRows, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, fieldFromSchema, usePeek, variantSchema, Static } from "../../ui/field/index.js";
import { PointsMap } from "../../ui/PointsMap.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { goldRoll } from "../../../../game/src/content/lootCompiler.js";
import { DROP, PART, SEGMENT } from "./LootCards.js";
import { LootRollRows } from "./LootRollRows.js";
import { CurveTable, RoleDrawer } from "./RoleDrawer.js";
import { CURVE_LEVELS, identityChain, mapResolved, resolveCreature, thumbFor, titleCase, useCreatureData, type Adjustments, type Creature, type CreatureData, type Loot, type Presentation, type Profile, type Spawn } from "./shared.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { EMPTY, PAGE, RAIL_BLOCK, RECORD, RECORD_HEAD, RECORD_RAIL, RECORD_TITLE } from "../../ui/layout.js";

/*
  One creature (docs/devdocs-inputs.md §3.12). Every value in Identity and Combat is one field
  with a dot and a provenance line built from its chain: authored here, taken from the base, or
  computed by the role curve at this level. Editing an inherited or curve value makes it the
  creature's own; the field's revert glyph and Backspace hand it back. Labels, units, help and
  steps come from the schema. Loot is a three-way choice whose value is the loot block's shape.
*/

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const GOLD_ITEM_ID = "gold";
const RAIL_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "maxHit"] as const;
const PRESENTATION_KINDS = ["basic", "rpg"] as const;

const combatSpec = (key: string) => fieldFromSchema(EnemyOverridesSchema, key);
const identitySpec = (key: string) => fieldFromSchema(CreatureDefinitionSchema, key);
const speciesSpec = (key: keyof typeof SpeciesFields) => fieldFromSchema(SpeciesFields[key], key);

const withoutEmpty = (record: Creature, key: "adjustments" | "loot" | "presentation"): Creature => {
  const value = record[key];
  if (value && typeof value === "object" && Object.keys(value).length === 0) { const next = { ...record }; delete next[key]; return next; }
  return record;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function CreaturePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const draft = useRecordDraft<Creature>("creatureDefinitions", id);
  const queryClient = useQueryClient();
  const peek = usePeek();
  const [roleOpen, setRoleOpen] = useState(false);
  const [liveProfile, setLiveProfile] = useState<Profile>();
  const working = draft.draft ?? draft.record;
  const editable = draft.editable;
  const base = working?.baseId ? data.byId.get(working.baseId) : undefined;
  const profileId = working?.profileId ?? base?.profileId;
  const profile = liveProfile && liveProfile.id === profileId ? liveProfile : profileId ? data.profileById.get(profileId) : undefined;
  const derived = useMemo(() => working ? deriveCreature(working, base, profile) : undefined, [working, base, profile]);
  const variants = data.variantsOf(id);
  const borrowedAsset = variants.find(variant => variant.assetId)?.assetId;
  const thumb = useMemo(() => working ? thumbFor({ ...resolveCreature(working, data.byId, data.profileById), assetId: working.presentation?.assetId ?? base?.presentation?.assetId ?? borrowedAsset }, data.ctx) : undefined, [working, data, base, borrowedAsset]);
  const spawns = data.spawnsFor(id);
  const baseExclude = useMemo(() => new Set([id, ...data.resolved.filter(entry => entry.variant).map(entry => entry.id)]), [data, id]);

  if (draft.loading || (data.loading && !working)) return <div className={PAGE}><LoadingRows /></div>;
  if (!working || !derived || !thumb) return <div className={PAGE}><EmptyState title="Creature not found">"{id}" is not in the bestiary. <Button variant="link" size="inline" onClick={() => navigate("creatures")}>Back to the bestiary</Button></EmptyState></div>;

  const row = derived.row;
  const baseName = base ? rowName(base) : undefined;
  const dirtyAt = (path: Path): boolean => draft.dirty && !same(getPath(draft.draft, path), getPath(draft.record, path));
  const setAdjustment = (key: string, value: unknown) => draft.set(current => {
    const adjustments = { ...current.adjustments } as Record<string, unknown>;
    if (value === undefined) delete adjustments[key]; else adjustments[key] = value;
    return withoutEmpty({ ...current, adjustments: adjustments as Adjustments }, "adjustments");
  });
  const detach = () => base && draft.set(current => {
    const { baseId: _baseId, ...own } = current;
    const merged = { ...base, ...own, adjustments: { ...base.adjustments, ...current.adjustments } as Adjustments, id: current.id } as Creature;
    return withoutEmpty(merged, "adjustments");
  });
  const openRole = () => { if (profileId) setRoleOpen(true); };
  /** A role name in a provenance line opens the curve beside the record; any other record peeks. */
  const openRef = (ref: RecordRef) => { if (ref.collection === "creatureProfiles" && ref.id === profileId) openRole(); else peek.open(ref); };
  const identity = <K extends Parameters<typeof identityChain>[2]>(key: K) => identityChain(working, base, key);

  async function newVariant() {
    const known = new Set(data.creatures.map(entry => entry.id));
    let count = 1;
    let newId = `${id}_variant_${count}`;
    while (known.has(newId)) newId = `${id}_variant_${++count}`;
    const record = { id: newId, baseId: id, availability: working!.availability };
    const issues = fieldIssues(CreatureDefinitionSchema, record).filter(issue => issue.severity === "error");
    if (!ID_PATTERN.test(newId) || issues.length) { toast.error(issues[0]?.message ?? `"${newId}" is not a valid id.`); return; }
    const revision = draft.revision ?? data.revisionOf("creatureDefinitions");
    if (!revision) return;
    try {
      await runTransaction("save", { creatureDefinitions: revision }, [{ kind: "put", collection: "creatureDefinitions", id: newId, record, create: true }]);
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureDefinitions").queryKey });
      toast.success(`Created ${newId}`);
      navigate("creatureDefinitions", newId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The variant could not be created.");
    }
  }

  const facts = [
    `Level ${derived.level}`,
    profile ? <Button variant="link" size="inline" onClick={openRole}>{profile.name}</Button> : undefined,
    row.family ? titleCase(row.family) : undefined,
    row.availability,
    base ? <>variant of <Button variant="link" size="inline" onClick={() => navigate("creatureDefinitions", base.id)}>{baseName}</Button></> : undefined,
  ];
  const name = identity("name");
  const family = identity("family");
  const level = identity("level");
  const role = identity("profileId");
  const beaten = new Set(RAIL_FIELDS.filter(key => derived.combat[key]?.resolved.chain[0]?.origin.kind !== "curve"));
  const ownValues = Object.fromEntries(RAIL_FIELDS.map(key => [key, derived.combat[key]?.value]));

  return <div className={PAGE}>
    <div className={RECORD}>
      <div className="min-w-0">
        <header className={RECORD_HEAD}>
          <Thumb spec={thumb} size="xl" alt="" />
          <div className={RECORD_TITLE}>
            <h1 className={name.chain[0]?.origin.kind === "own" ? undefined : "text-muted-foreground"} title={name.chain[0]?.origin.kind === "own" ? undefined : `Name inherited from ${baseName}`}>{row.name ?? id}</h1>
            <Facts items={facts} />
            <code>{id}</code>
          </div>
        </header>
        <Sheet>
          <Section title="Identity" aside={editable && base ? <Button variant="link" size="inline" title="Copy the inherited fields into this record and clear the base" onClick={detach}>Detach from {baseName}</Button> : undefined}>
            <Field label={identitySpec("name").label} resolved={name} dirty={dirtyAt(["name"])} onRevert={() => draft.setPath(["name"], undefined)} onOpenRef={openRef} disabled={!editable}>
              <TextField value={name.value ?? ""} placeholder={id} readOnly={!editable} onChange={value => draft.setPath(["name"], value.trim() || undefined)} />
            </Field>
            <RefField kind={identitySpec("family").ref} label={identitySpec("family").label} value={family.value} resolved={family} optional dirty={dirtyAt(["family"])} readOnly={!editable} onOpenRef={openRef} onChange={value => draft.setPath(["family"], value)} />
            <Field label={identitySpec("level").label} hint={identitySpec("level").hint} resolved={level} dirty={dirtyAt(["level"])} onRevert={() => draft.setPath(["level"], undefined)} onOpenRef={openRef} disabled={!editable}>
              <NumberField value={level.value} integer min={identitySpec("level").min} readOnly={!editable} onChange={value => draft.setPath(["level"], value)} />
            </Field>
            <Field label={identitySpec("availability").label} dirty={dirtyAt(["availability"])} disabled={!editable}>
              <ChoiceField value={working.availability} options={identitySpec("availability").choices ?? []} width="short" readOnly={!editable} onChange={value => draft.setPath(["availability"], value)} />
            </Field>
            <RefField kind={identitySpec("profileId").ref} label={identitySpec("profileId").label} value={role.value} resolved={role} optional dirty={dirtyAt(["profileId"])} readOnly={!editable} onOpenRef={openRole} onChange={value => draft.setPath(["profileId"], value)} />
            <RefField kind={identitySpec("baseId").ref} collection="creatureDefinitions" label={identitySpec("baseId").label} hint={variants.length ? `Base of ${variants.length} ${variants.length === 1 ? "variant" : "variants"}. ${identitySpec("baseId").hint ?? ""}`.trim() : identitySpec("baseId").hint}
              value={working.baseId} optional exclude={baseExclude} dirty={dirtyAt(["baseId"])} readOnly={!editable || variants.length > 0} onChange={value => draft.setPath(["baseId"], value)} />
          </Section>

          <Section title="Combat" aside={profile ? <span>{profile.name} curve at level {derived.level}</span> : <span>No role: numbers are not derived</span>}>
            <FieldRows>
              {COMBAT_FIELDS.filter(key => key !== "gold").map(key => {
                const spec = combatSpec(key);
                const derivation = derived.combat[key]!;
                const shared = { label: spec.label, hint: spec.hint, onOpenRef: openRef, dirty: dirtyAt(["adjustments", key]), readOnly: !editable } as const;
                if (spec.kind === "enum") {
                  return <DerivedChoice key={key} {...shared} resolved={derivation.resolved as Resolved<string | undefined>} options={spec.choices ?? []} onChange={value => setAdjustment(key, value)} />;
                }
                return <DerivedNumber key={key} {...shared} resolved={derivation.resolved as Resolved<number | undefined>} unit={spec.unit} integer={spec.integer ?? false} min={spec.min} step={spec.step} onChange={value => setAdjustment(key, value)} />;
              })}
              {UNCOMPUTED_FIELDS.map(key => {
                const spec = combatSpec(key);
                const movement = derived.combat[key]!.resolved as Resolved<number | undefined>;
                return <Field key={key} label={spec.label} hint={spec.hint} unit={spec.unit} resolved={movement} dirty={dirtyAt(["adjustments", key])} onOpenRef={openRef} disabled={!editable}
                  onRevert={editable ? () => setAdjustment(key, undefined) : undefined}>
                  <NumberField value={movement.value} optional min={spec.min} step={spec.step ?? 0.1} unit={spec.unit} placeholder="none" readOnly={!editable} onChange={value => setAdjustment(key, value)} />
                </Field>;
              })}
            </FieldRows>
          </Section>

          <Section title="Spawns" aside={spawns.length ? <span>{spawns.length} {spawns.length === 1 ? "place" : "places"} · click a pin to edit it on the map</span> : undefined}>
            {spawns.length
              ? <>
                <PointsMap points={spawns.filter(spawn => spawn.placement.centre).map(spawn => ({ id: spawn.placement.id, x: spawn.placement.centre![0], z: spawn.placement.centre![1], radius: spawn.placement.radius, label: `${data.regionName(spawn.placement.regionId)} ×${spawn.placement.count ?? 1}` }))}
                  onOpen={point => navigate("placements", point.id)} onOpenAt={() => navigate("placements", spawns[0]!.placement.id)} />
                <div className="flex flex-col gap-0.5">{spawns.map(spawn => <SpawnRow key={spawn.placement.id} spawn={spawn} data={data} onOpen={() => navigate("placements", spawn.placement.id)} />)}</div>
              </>
              : <p className={EMPTY}>Not placed in any encounter.</p>}
          </Section>

          <LootSection data={data} working={working} base={base} editable={editable} draft={draft} dirtyAt={dirtyAt} openRef={openRef}
            gold={derived.combat.gold!.resolved as Resolved<[number, number] | undefined>} onGold={value => setAdjustment("gold", value)} />
          <PresentationSection data={data} working={working} base={base} editable={editable} draft={draft} dirtyAt={dirtyAt} openRef={openRef} />

          <Section title="Variants" aside={editable && !working.baseId ? <Button variant="secondary" size="sm" onClick={() => void newVariant()}><GitBranch size={12} /> New variant</Button> : undefined}>
            {variants.length
              ? <div className="flex flex-col gap-0.5">{variants.map(variant => <RefRow key={variant.id} collection="creatureDefinitions" id={variant.id} record={variant.row} ctx={data.ctx} onOpen={(_collection, target) => navigate("creatureDefinitions", target)} subtitle={variant.id} meta={<Facts items={[`Level ${variant.level}`, variant.regionId ? data.regionName(variant.regionId) : undefined]} />} />)}</div>
              : <p className={EMPTY}>{working.baseId ? "A variant cannot have variants of its own." : "No variants inherit from this creature."}</p>}
          </Section>

          <ReferencedBy collection="creatureDefinitions" id={id} navigate={navigate} />
        </Sheet>
      </div>
      <aside className={RECORD_RAIL}>
        <EntitySummary collection="creatureDefinitions" record={row.presentation ? row : { ...row, presentation: variants.find(variant => variant.row.presentation)?.row.presentation }} recordId={id} index={data.index} navigate={navigate} editing bare />
        {profile && <div className={RAIL_BLOCK}>
          <h3>Role curve</h3>
          <CurveTable profile={profile} levels={CURVE_LEVELS} fields={RAIL_FIELDS} highlight={derived.level} beaten={beaten} ownValues={ownValues} compact />
          <Button variant="link" size="inline" onClick={openRole}>{profile.name} parameters <ArrowRight size={11} /></Button>
        </div>}
      </aside>
    </div>
    {roleOpen && profileId && <RoleDrawer profileId={profileId} data={data} navigate={navigate} onClose={() => { setRoleOpen(false); setLiveProfile(undefined); }} onLive={setLiveProfile} />}
  </div>;
}

/* ---------- Loot ---------- */

interface BlockProps { data: CreatureData; working: Creature; base?: Creature; editable: boolean; draft: RecordDraft<Creature>; dirtyAt: (path: Path) => boolean; openRef: (ref: RecordRef) => void }

function LootSection({ data, working, base, editable, draft, dirtyAt, openRef, gold, onGold }: BlockProps & { gold: Resolved<[number, number] | undefined>; onGold: (value: [number, number] | undefined) => void }) {
  const loot = identityChain(working, base, "loot");
  const inherited = loot.chain[0]?.origin.kind === "inherited";
  const drop = goldRoll(gold.value)?.drops[0];
  const [low, high] = gold.value ?? [0, 0];
  return <Section title={identitySpec("loot").label} aside={base && (inherited
    ? <span>Inherited from {rowName(base)}</span>
    : editable && working.loot && base.loot ? <Button variant="link" size="inline" title={`Drop this creature's own loot and use ${rowName(base)}'s`} onClick={() => draft.setPath(["loot"], undefined)}>Reset to {rowName(base)}</Button> : undefined)}>
    <LootRollRows rolls={loot.value?.rolls ?? []} tables={data.lootTables} readOnly={!editable} tableUsers={tableId => data.usersOfTable(tableId).length}
      onChange={rolls => draft.setPath(["loot"], { rolls })}
      leadFacts={[drop ? <><strong className="font-mono font-semibold">{drop.quantity[0] === drop.quantity[1] ? drop.quantity[0] : `${drop.quantity[0]} to ${drop.quantity[1]}`}</strong> gold every kill</> : "No gold"]}
      lead={<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-1">
        <div data-slot="stack-field" className={DROP}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1"><Thumb spec={{ kind: "item", id: GOLD_ITEM_ID }} size="s" alt="" /><span className="truncate">Gold</span></span>
          <Field<[number, number] | undefined> bare className="h-full border-l border-border-subtle pr-1 [&_.field-body]:h-full [&_.field-control]:h-full" label={combatSpec("gold").label} hint={combatSpec("gold").hint} resolved={gold} dirty={dirtyAt(["adjustments", "gold"])} onOpenRef={openRef} disabled={!editable}
            onRevert={editable ? () => onGold(undefined) : undefined}>
            <span className={cn(SEGMENT, "h-full min-w-[4.25rem] justify-center border-l-0")}>
              <span aria-hidden className="pl-1.5 text-faint">×</span>
              <NumberField className={PART} value={low} integer min={0} readOnly={!editable} ariaLabel="Gold minimum" onChange={next => { const value = next ?? 0; onGold([value, Math.max(value, high)]); }} />
              <span aria-hidden className="text-faint">–</span>
              <NumberField className={PART} value={high} integer min={low} readOnly={!editable} ariaLabel="Gold maximum" onChange={next => onGold([low, Math.max(low, next ?? low)])} />
            </span>
          </Field>
          <span className={cn(SEGMENT, "px-2 text-[11px] text-muted-foreground")}>every kill</span>
        </div>
      </div>} />
  </Section>;
}

/* ---------- Presentation ---------- */

type PresentationKey = keyof Presentation & string;

function PresentationSection({ data, working, base, editable, draft, dirtyAt, openRef }: BlockProps) {
  const block = identityChain(working, base, "presentation");
  const presentation = block.value;
  const regionSpec = speciesSpec("regionId");
  const regionOptions = useMemo(() => {
    const ids = new Set<string>([...(regionSpec.choices ?? []), ...data.regions.map(region => region.id)]);
    return [...ids].map(value => ({ value, label: data.regionName(value) }));
  }, [data, regionSpec.choices]);
  const at = <K extends PresentationKey>(key: K) => mapResolved(block, value => value?.[key as keyof Presentation] as Presentation[K] | undefined);
  /** Any edit writes the whole block as this creature's own: the base's copy, or fresh defaults, with the one key changed. */
  const set = (key: PresentationKey, value: unknown) => draft.set(current => {
    const seed: Presentation = current.presentation ?? base?.presentation ?? { kind: "basic", id: current.id, assetId: "", scale: 1, regionId: regionSpec.choices?.[0] ?? "", activity: speciesSpec("activity").choices?.[0] ?? "", description: current.name ?? base?.name ?? current.id } as Presentation;
    const next = { ...structuredClone(seed) } as Record<string, unknown>;
    if (value === undefined) delete next[key]; else next[key] = value;
    return { ...current, presentation: next as unknown as Presentation };
  });
  /** Hand one key back to the base; when nothing else differs from the base the whole block is inherited again. */
  const revert = (key: PresentationKey) => editable && working.presentation && base?.presentation ? () => {
    const restored = { ...working.presentation, [key]: (base.presentation as Record<string, unknown>)[key] } as Record<string, unknown>;
    if ((base.presentation as Record<string, unknown>)[key] === undefined) delete restored[key];
    draft.setPath(["presentation"], same(restored, base.presentation) ? undefined : restored);
  } : undefined;
  const dirty = dirtyAt(["presentation"]);
  const shared = (key: PresentationKey) => ({ resolved: at(key), dirty, onOpenRef: openRef, onRevert: revert(key), disabled: !editable });
  const scale = speciesSpec("scale");
  const activity = speciesSpec("activity");
  const description = speciesSpec("description");
  return <Section title={identitySpec("presentation").label} aside={presentation && presentation.id !== working.id ? <span className="font-mono">as {presentation.id}</span> : undefined}>
    <RefField kind={speciesSpec("assetId").ref} label={speciesSpec("assetId").label} value={presentation?.assetId || undefined} {...shared("assetId")} resolved={mapResolved(block, value => value?.assetId || undefined)} readOnly={!editable} onChange={value => set("assetId", value ?? "")} />
    <Field label={scale.label} hint={scale.hint} {...shared("scale")}>
      <NumberField value={presentation?.scale} min={scale.min} step={0.05} readOnly={!editable} onChange={value => set("scale", value)} />
    </Field>
    <Field label={regionSpec.label} hint={regionSpec.hint} {...shared("regionId")}>
      <ChoiceField value={presentation?.regionId} options={regionOptions} allowEmpty={presentation ? undefined : "Choose region"} readOnly={!editable} onChange={value => set("regionId", value)} />
    </Field>
    <Field label={activity.label} hint={activity.hint} {...shared("activity")}>
      <ChoiceField value={presentation?.activity} options={activity.choices ?? []} allowEmpty={presentation ? undefined : "Choose activity"} readOnly={!editable} onChange={value => set("activity", value)} />
    </Field>
    <Field label="Kind" hint="Basic creatures use the species fields only; rpg creatures add body and rig data." {...shared("kind")}>
      <ChoiceField value={presentation?.kind} options={PRESENTATION_KINDS} allowEmpty={presentation ? undefined : "Choose kind"} readOnly={!editable} onChange={value => set("kind", value)} />
    </Field>
    <Field label={description.label} hint={description.hint} {...shared("description")}>
      <TextField value={presentation?.description ?? ""} multiline readOnly={!editable} onChange={value => set("description", value)} />
    </Field>
  </Section>;
}

/* ---------- Spawns ---------- */

function SpawnRow({ spawn, data, onOpen }: { spawn: Spawn; data: CreatureData; onOpen: () => void }) {
  const { placement, encounter, weight } = spawn;
  const [x, z] = placement.centre ?? [0, 0];
  const members = encounter.members?.length ?? 1;
  return <ListRow onClick={onOpen} hint={placement.id}
    art={<Thumb spec={{ kind: "map", x, z, span: 120, icon: MapPin }} size="m" alt="" />}
    title={encounter.name ?? titleCase(placement.id)}
    subtitle={<Facts items={[data.regionName(placement.regionId), `${placement.count ?? 1} × ${encounter.activity ?? "spawn"}`, members > 1 ? `${members} kinds${weight !== undefined ? `, weight ${weight}` : ""}` : undefined]} />}
    meta={`${Math.round(x)}, ${Math.round(z)}`} />;
}
