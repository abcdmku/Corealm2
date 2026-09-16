import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GitBranch, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CreatureDefinitionSchema, CreatureLootSchema } from "../../../../game/src/content/schema/creatureDefinitions.js";
import { SpeciesFields } from "../../../../game/src/content/schema/creatures.js";
import { EnemyOverridesSchema } from "../../../../game/src/content/schema/enemies.js";
import { collectionQuery } from "../../api/client.js";
import { deriveCreature } from "../../model/derive.js";
import { getPath, runTransaction, useRecordDraft, type Path, type RecordDraft } from "../../model/draft.js";
import { fieldIssues } from "../../model/fields.js";
import type { RecordRef } from "../../model/origin.js";
import { rowName } from "../../model/rows.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { RefRow } from "../../ui/RefChip.js";
import { ChoiceField, Facts, Field, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, fieldFromSchema, usePeek, variantSchema } from "../../ui/field/index.js";
import { CardMeta, CardRule } from "../../ui/gamecard/Card.js";
import { CreaturePlate } from "./CreaturePlate.js";
import { PointsMap } from "../../ui/PointsMap.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { DropRows, dropList, type Drop } from "./DropRows.js";
import { CurveTable, RoleDrawer } from "./RoleDrawer.js";
import { CURVE_LEVELS, identityChain, lootMode, mapResolved, resolveCreature, thumbFor, titleCase, useCreatureData, type Adjustments, type Creature, type CreatureData, type Loot, type LootMode, type Presentation, type Profile, type Spawn } from "./shared.js";

/*
  One creature (docs/devdocs-inputs.md §3.12). Every value in Identity and Combat is one field
  with a dot and a provenance line built from its chain: authored here, taken from the base, or
  computed by the role curve at this level. Editing an inherited or curve value makes it the
  creature's own; the field's revert glyph and Backspace hand it back. Labels, units, help and
  steps come from the schema. Loot is a three-way choice whose value is the loot block's shape.
*/

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RAIL_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "maxHit"] as const;
const PRESENTATION_KINDS = ["basic", "rpg"] as const;

const combatSpec = (key: string) => fieldFromSchema(EnemyOverridesSchema, key);
const identitySpec = (key: string) => fieldFromSchema(CreatureDefinitionSchema, key);
const speciesSpec = (key: keyof typeof SpeciesFields) => fieldFromSchema(SpeciesFields[key], key);
const LOOT_TABLE = fieldFromSchema(variantSchema(CreatureLootSchema, "0")!, "tableId");
const LOOT_DROPS = fieldFromSchema(variantSchema(CreatureLootSchema, "1")!, "drops");
const LOOT_MODES: readonly { value: LootMode; label: string }[] = [{ value: "none", label: "None" }, { value: "table", label: "Shared table" }, { value: "drops", label: "Own drops" }];

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

  if (draft.loading || (data.loading && !working)) return <div className="ws-page"><LoadingRows /></div>;
  if (!working || !derived || !thumb) return <div className="ws-page"><EmptyState title="Creature not found">"{id}" is not in the bestiary. <button type="button" className="text-button" onClick={() => navigate("creatures")}>Back to the bestiary</button></EmptyState></div>;

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

  const name = identity("name");
  const family = identity("family");
  const level = identity("level");
  const role = identity("profileId");
  const beaten = new Set(RAIL_FIELDS.filter(key => derived.combat[key]?.resolved.chain[0]?.origin.kind !== "curve"));
  const ownValues = Object.fromEntries(RAIL_FIELDS.map(key => [key, derived.combat[key]?.value]));

  /*
    The line under the name is what the plate says about the creature: how strong it is, what it
    fights like, what family it belongs to, and whether it exists in the world at all. Each of
    those is the field that sets it, so the sentence and the form are the same thing.
  */
  const sub = <CardMeta parts={[
    <Field key="level" compact label="Level" resolved={level} dirty={dirtyAt(["level"])} disabled={!editable} onOpenRef={openRef}
      onRevert={editable ? () => draft.setPath(["level"], undefined) : undefined}>
      <NumberField value={level.value} integer min={identitySpec("level").min} readOnly={!editable} ariaLabel="Level" onChange={value => draft.setPath(["level"], value)} />
    </Field>,
    <RefField key="family" kind={identitySpec("family").ref} label={identitySpec("family").label} value={family.value} resolved={family} optional compact className="gamecard-chip"
      dirty={dirtyAt(["family"])} readOnly={!editable} onOpenRef={openRef} onChange={value => draft.setPath(["family"], value)} />,
    <Field key="availability" compact label="" hint={identitySpec("availability").hint} dirty={dirtyAt(["availability"])} disabled={!editable}>
      <ChoiceField value={working.availability} options={identitySpec("availability").choices ?? []} readOnly={!editable} ariaLabel="Availability" onChange={value => draft.setPath(["availability"], value)} />
    </Field>,
    base ? <span key="base" className="gamecard-variant">variant of <button type="button" className="text-button" onClick={() => navigate("creatureDefinitions", base.id)}>{baseName}</button></span> : undefined,
  ]} />;

  return <div className="ws-page creature-page">
    <div className="record">
      <div className="record-main">
        <CreaturePlate art={<Thumb spec={thumb} size="xl" alt="" />} name={name} placeholder={id} facts={sub} derived={derived} editable={editable}
          note={profile ? <><button type="button" className="text-button" onClick={openRole}>{profile.name} curve</button> at level {derived.level}</> : <span>No role: these numbers are not derived</span>}
          dirtyAt={dirtyAt} setName={value => draft.setPath(["name"], value)} setAdjustment={setAdjustment} onOpenRef={openRef}>
          <CardRule />
          <LootSection data={data} working={working} base={base} editable={editable} draft={draft} dirtyAt={dirtyAt} openRef={openRef} />
        </CreaturePlate>

        <Sheet className="record-backstage">
          <Section title="Spawns" aside={spawns.length ? <span>{spawns.length} {spawns.length === 1 ? "place" : "places"} · click a pin to edit it on the map</span> : undefined}>
            {spawns.length
              ? <>
                <PointsMap points={spawns.filter(spawn => spawn.placement.centre).map(spawn => ({ id: spawn.placement.id, x: spawn.placement.centre![0], z: spawn.placement.centre![1], radius: spawn.placement.radius, label: `${data.regionName(spawn.placement.regionId)} x${spawn.placement.count ?? 1}` }))}
                  onOpen={point => navigate("placements", point.id)} onOpenAt={() => navigate("placements", spawns[0]!.placement.id)} />
                <div className="ref-rows">{spawns.map(spawn => <SpawnRow key={spawn.placement.id} spawn={spawn} data={data} onOpen={() => navigate("placements", spawn.placement.id)} />)}</div>
              </>
              : <p className="empty-inline">Not placed in any encounter.</p>}
          </Section>

          <PresentationSection data={data} working={working} base={base} editable={editable} draft={draft} dirtyAt={dirtyAt} openRef={openRef} />

          <Section title="Curve and lineage" aside={editable && base ? <button type="button" className="text-button" title="Copy the inherited fields into this record and clear the base" onClick={detach}>Detach from {baseName}</button> : undefined}>
            <RefField kind={identitySpec("profileId").ref} label={identitySpec("profileId").label} hint={identitySpec("profileId").hint} value={role.value} resolved={role} optional
              dirty={dirtyAt(["profileId"])} readOnly={!editable} onOpenRef={openRole} onChange={value => draft.setPath(["profileId"], value)} />
            <RefField kind={identitySpec("baseId").ref} collection="creatureDefinitions" label={identitySpec("baseId").label} hint={variants.length ? `Base of ${variants.length} ${variants.length === 1 ? "variant" : "variants"}. ${identitySpec("baseId").hint ?? ""}`.trim() : identitySpec("baseId").hint}
              value={working.baseId} optional exclude={baseExclude} dirty={dirtyAt(["baseId"])} readOnly={!editable || variants.length > 0} onChange={value => draft.setPath(["baseId"], value)} />
            {variants.length
              ? <div className="ref-rows">{variants.map(variant => <RefRow key={variant.id} collection="creatureDefinitions" id={variant.id} record={variant.row} ctx={data.ctx} onOpen={(_collection, target) => navigate("creatureDefinitions", target)} subtitle={variant.id} meta={<Facts items={[`Level ${variant.level}`, variant.regionId ? data.regionName(variant.regionId) : undefined]} />} />)}</div>
              : <p className="empty-inline">{working.baseId ? "A variant cannot have variants of its own." : "No variants inherit from this creature."}</p>}
            {editable && !working.baseId && <button type="button" className="button button-small" onClick={() => void newVariant()}><GitBranch size={12} /> New variant</button>}
          </Section>

          <ReferencedBy collection="creatureDefinitions" id={id} navigate={navigate} />
        </Sheet>
      </div>
      <aside className="record-rail creature-rail">
        <EntitySummary collection="creatureDefinitions" record={row.presentation ? row : { ...row, presentation: variants.find(variant => variant.row.presentation)?.row.presentation }} recordId={id} index={data.index} navigate={navigate} editing />
        {profile && <div className="rail-block">
          <h3>Role curve</h3>
          <CurveTable profile={profile} levels={CURVE_LEVELS} fields={RAIL_FIELDS} highlight={derived.level} beaten={beaten} ownValues={ownValues} compact />
          <button type="button" className="text-button" onClick={openRole}>{profile.name} parameters <ArrowRight size={11} /></button>
        </div>}
      </aside>
    </div>
    {roleOpen && profileId && <RoleDrawer profileId={profileId} data={data} navigate={navigate} onClose={() => { setRoleOpen(false); setLiveProfile(undefined); }} onLive={setLiveProfile} />}
  </div>;
}

/* ---------- Loot ---------- */

interface BlockProps { data: CreatureData; working: Creature; base?: Creature; editable: boolean; draft: RecordDraft<Creature>; dirtyAt: (path: Path) => boolean; openRef: (ref: RecordRef) => void }

function LootSection({ data, working, base, editable, draft, dirtyAt, openRef }: BlockProps) {
  const loot = identityChain(working, base, "loot");
  const mode = mapResolved(loot, lootMode);
  const current: Loot | undefined = loot.value;
  const tableId = current && "tableId" in current ? current.tableId : undefined;
  const table = tableId ? data.lootById.get(tableId) : undefined;
  const drops = current && "drops" in current ? dropList(current.drops) : dropList(table?.drops);
  const revert = editable ? () => draft.setPath(["loot"], undefined) : undefined;
  /**
   * What a switch to "own drops" starts from. The drops on show when there are any, otherwise the
   * nearest list the chain still remembers, so going table → own drops → table → own drops does not
   * quietly empty a creature's loot on the way through an empty table.
   */
  const seedDrops = (): Drop[] => {
    if (drops.length) return structuredClone(drops);
    for (const link of loot.chain) {
      const value = link.value;
      if (value && "drops" in value) return structuredClone(dropList(value.drops));
      if (value && "tableId" in value) {
        const carried = data.lootById.get(value.tableId);
        if (carried?.drops?.length) return structuredClone(dropList(carried.drops));
      }
    }
    return [];
  };
  const switchTo = (next: LootMode | undefined) => {
    if (next === "table") draft.setPath(["loot"], { tableId: tableId ?? "" });
    else if (next === "drops") draft.setPath(["loot"], { drops: seedDrops() });
    else draft.setPath(["loot"], undefined);
  };
  const others = tableId ? data.usersOfTable(tableId).filter(entry => entry.id !== working.id).length : 0;
  // The section already says "Loot"; the field names the shape of the block, which the schema's
  // union has no label for.
  return <Section title={identitySpec("loot").label}>
    <Field label="Source" resolved={mode} dirty={dirtyAt(["loot"])} onRevert={revert} onOpenRef={openRef} disabled={!editable}>
      <ChoiceField value={mode.value} options={LOOT_MODES} width="short" readOnly={!editable} onChange={switchTo} />
    </Field>
    {mode.value === "table" && <RefField kind={LOOT_TABLE.ref} label={LOOT_TABLE.label} value={tableId || undefined} resolved={mapResolved(loot, value => value && "tableId" in value ? value.tableId : undefined)} onRevert={revert}
      hint={tableId ? (others ? `Shared with ${others} other ${others === 1 ? "creature" : "creatures"}. Click the chip to edit the table here.` : "Only this creature rolls on it. Click the chip to edit the table here.") : undefined}
      dirty={dirtyAt(["loot"])} readOnly={!editable} onOpenRef={openRef} onChange={value => draft.setPath(["loot"], { tableId: value ?? "" })} />}
    {(mode.value === "drops" || table) && <Field label={LOOT_DROPS.label} hint={mode.value === "table" ? `What ${table?.name ?? "the table"} drops. Edit them on the table.` : undefined} className="field-has-list" disabled={!editable}>
      <DropRows drops={drops} readOnly={!editable || mode.value === "table"} onChange={next => draft.setPath(["loot"], { drops: next })} />
    </Field>}
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
  return <Section title={identitySpec("presentation").label} aside={presentation && presentation.id !== working.id ? <span className="mono">as {presentation.id}</span> : undefined}>
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
  return <button type="button" className="ref-row" onClick={onOpen} title={placement.id}>
    <Thumb spec={{ kind: "map", x, z, span: 120, icon: MapPin }} size="m" alt="" />
    <span className="ref-row-body">
      <span className="ref-row-title">{encounter.name ?? titleCase(placement.id)}</span>
      <span className="ref-row-sub"><Facts items={[data.regionName(placement.regionId), `${placement.count ?? 1} × ${encounter.activity ?? "spawn"}`, members > 1 ? `${members} kinds${weight !== undefined ? `, weight ${weight}` : ""}` : undefined]} /></span>
    </span>
    <span className="ref-row-meta">{x}, {z}</span>
  </button>;
}
