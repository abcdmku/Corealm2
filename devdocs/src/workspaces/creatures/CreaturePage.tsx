import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GitBranch, MapPin, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { arr } from "../../../../game/src/content/schema/core.js";
import { DropSchema } from "../../../../game/src/content/schema/loot.js";
import { collectionQuery } from "../../api/client.js";
import { EditorContext, LootDropsEditor } from "../../dev/editors.js";
import { COMBAT_FIELDS, COMBAT_LABELS, deriveCreature, type Derivation } from "../../model/derive.js";
import { runTransaction, useRecordDraft, type RecordDraft } from "../../model/draft.js";
import { rowName } from "../../model/rows.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { RefChip, RefRow } from "../../ui/RefChip.js";
import { Derived, Facts, Field, Fields, NumberInput, Row, SaveBar, Section, Select, Sheet, Static, TextInput } from "../../ui/Sheet.js";
import { PointsMap } from "../../ui/PointsMap.js";
import { EmptyState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { dropList, DropGrid } from "./DropGrid.js";
import { CurveTable, RoleDrawer } from "./RoleDrawer.js";
import { ACTIVITIES, AVAILABILITIES, CURVE_LEVELS, REGION_IDS, resolveCreature, thumbFor, titleCase, useCreatureData, type Adjustments, type Creature, type CreatureData, type Loot, type Presentation, type Profile, type Spawn } from "./shared.js";

/*
  One creature: identity, the combat block derived from its role curve at its level with every
  adjustment shown as an override, loot, presentation, variants and spawns. A variant inherits
  from its base; inherited fields are marked and can be overridden or handed back.
*/

const DROPS_SCHEMA = arr(DropSchema);
const BEHAVIOURS = ["passive", "aggressive"] as const;
const STYLES = ["melee", "magic"] as const;
const MOVEMENT = ["moveSpeedMps", "walkSpeedMps"] as const;
const UNITS: Partial<Record<string, string>> = { attackSpeedMs: "ms", aggroRadius: "m", attackRangeM: "m" };
const FRACTIONAL = new Set(["aggroRadius", "attackRangeM"]);

const withoutEmpty = (record: Creature, key: "adjustments" | "loot" | "presentation"): Creature => {
  const value = record[key];
  if (value && typeof value === "object" && Object.keys(value).length === 0) { const next = { ...record }; delete next[key]; return next; }
  return record;
};

export function CreaturePage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const draft = useRecordDraft<Creature>("creatureDefinitions", id);
  const queryClient = useQueryClient();
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
  const errorText = draft.saveError || draft.diagnostics.filter(entry => entry.severity === "error").map(entry => `${entry.path}: ${entry.message}`).join(" · ");

  useEffect(() => {
    if (!draft.dirty || !editable) return;
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void draft.save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.dirty, editable, draft.save]);

  if (draft.loading || (data.loading && !working)) return <div className="ws-page"><LoadingRows /></div>;
  if (!working || !derived || !thumb) return <div className="ws-page"><EmptyState title="Creature not found">"{id}" is not in the bestiary. <button type="button" className="text-button" onClick={() => navigate("creatures")}>Back to the bestiary</button></EmptyState></div>;

  const row = derived.row;
  const ownName = working.name !== undefined;
  const baseName = base ? rowName(base) : undefined;
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

  async function newVariant() {
    const known = new Set(data.creatures.map(entry => entry.id));
    let count = 1;
    let newId = `${id}_variant_${count}`;
    while (known.has(newId)) newId = `${id}_variant_${++count}`;
    const revision = draft.revision ?? data.revisionOf("creatureDefinitions");
    if (!revision) return;
    try {
      await runTransaction("save", { creatureDefinitions: revision }, [{ kind: "put", collection: "creatureDefinitions", id: newId, record: { id: newId, baseId: id, availability: working!.availability }, create: true }]);
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureDefinitions").queryKey });
      toast.success(`Created ${newId}`);
      navigate("creatureDefinitions", newId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The variant could not be created.");
    }
  }

  const facts = [
    `Level ${derived.level}`,
    profile ? <button type="button" className="text-button" onClick={openRole}>{profile.name}</button> : undefined,
    row.family ? titleCase(row.family) : undefined,
    row.availability,
    base ? <>variant of <button type="button" className="text-button" onClick={() => navigate("creatureDefinitions", base.id)}>{baseName}</button></> : undefined,
  ];

  return <div className="ws-page creature-page">
    <div className="record">
      <div className="record-main">
        {editable && <SaveBar dirty={draft.dirty} saving={draft.saving} error={errorText || undefined} conflict={draft.conflict} onSave={() => void draft.save()} onReset={draft.reset} />}
        <header className="record-head">
          <Thumb spec={thumb} size="xl" alt="" />
          <div className="record-title">
            <h1 className={ownName ? undefined : "is-inherited"} title={ownName ? undefined : `Name inherited from ${baseName}`}>{derived.row.name ?? id}</h1>
            <Facts items={facts} />
            <code>{id}</code>
          </div>
        </header>
        <Sheet>
          <Section title="Identity">
            <InheritRow label="Name" field="name" working={working} base={base} editable={editable} draft={draft} show={value => String(value)}
              control={editable ? <TextInput value={working.name ?? ""} onChange={value => draft.setPath(["name"], value || undefined)} ariaLabel="Name" placeholder={baseName} /> : <Static>{working.name ?? "—"}</Static>} />
            <InheritRow label="Family" field="family" working={working} base={base} editable={editable} draft={draft} show={value => titleCase(String(value))}
              control={editable ? <TextInput value={working.family ?? ""} onChange={value => draft.setPath(["family"], value || undefined)} width="short" ariaLabel="Family" /> : <Static>{working.family ? titleCase(working.family) : "—"}</Static>} />
            <InheritRow label="Level" field="level" working={working} base={base} editable={editable} draft={draft} show={value => String(value)}
              control={editable ? <NumberInput value={working.level} onChange={value => draft.setPath(["level"], value)} min={1} integer ariaLabel="Level" /> : <Static mono>{working.level ?? "—"}</Static>} />
            <Row label="Availability">
              {editable ? <Select value={working.availability} onChange={value => draft.setPath(["availability"], value)} options={AVAILABILITIES} ariaLabel="Availability" width="num" /> : <Static>{working.availability}</Static>}
            </Row>
            <InheritRow label="Role" field="profileId" working={working} base={base} editable={editable} draft={draft} show={value => data.profileById.get(String(value))?.name ?? String(value)}
              control={<>
                {editable ? <Select value={working.profileId} onChange={value => draft.setPath(["profileId"], value)} options={data.profiles.map(entry => ({ value: entry.id, label: entry.name }))} allowEmpty="No role" ariaLabel="Role" /> : <Static>{profile?.name ?? "—"}</Static>}
                {profileId && <button type="button" className="text-button" onClick={openRole}>Open role <ArrowRight size={11} /></button>}
              </>} />
            <Row label="Base creature">
              {base ? <>
                <RefChip collection="creatureDefinitions" id={base.id} record={base} ctx={data.ctx} onOpen={(_collection, target) => navigate("creatureDefinitions", target)} />
                {editable && <BasePicker data={data} selfId={id} value={base.id} onPick={target => draft.setPath(["baseId"], target)} label="Change" />}
                {editable && <button type="button" className="button button-small" aria-label="Detach from base" title="Copy the inherited fields into this record and clear the base" onClick={detach}>Detach</button>}
              </> : variants.length
                ? <Static muted>Base of {variants.length} {variants.length === 1 ? "variant" : "variants"}</Static>
                : editable ? <BasePicker data={data} selfId={id} onPick={target => draft.setPath(["baseId"], target)} label="Make a variant of…" /> : <Static muted>None</Static>}
            </Row>
          </Section>

          <Section title="Combat" aside={profile ? <span>{profile.name} curve at level {derived.level} · edit a cell to override it</span> : <span>No role: numbers are not derived</span>}>
            <Fields>
              {COMBAT_FIELDS.map(key => {
                const derivation = derived.combat[key]!;
                const fromBase = base?.adjustments && key in base.adjustments && !(working.adjustments && key in working.adjustments);
                const mark = fromBase ? <InheritMark from={baseName!} /> : undefined;
                if (key === "behaviour" || key === "attackStyle") {
                  return <Field key={key} label={COMBAT_LABELS[key]} span={2}>
                    <ChoiceDerived derivation={derivation} options={key === "behaviour" ? BEHAVIOURS : STYLES} editable={editable} onOverride={value => setAdjustment(key, value)} onOpenSource={openRole} />{mark}
                  </Field>;
                }
                return <Field key={key} label={COMBAT_LABELS[key]}>
                  <Derived derivation={derivation} unit={UNITS[key]} integer={!FRACTIONAL.has(key)} readOnly={!editable} onOverride={editable && key !== "marks" ? value => setAdjustment(key, value) : undefined} onOpenSource={profile ? openRole : undefined} />{mark}
                </Field>;
              })}
              {MOVEMENT.map(key => {
                const value = row.adjustments[key] as number | undefined;
                const own = working.adjustments && key in working.adjustments;
                return <Field key={key} label={COMBAT_LABELS[key]}>
                  {value === undefined
                    ? editable ? <button type="button" className="filter-chip" onClick={() => setAdjustment(key, 1)}><Plus size={11} /> Add</button> : <Static muted>—</Static>
                    : <>
                      {editable ? <NumberInput value={value} onChange={next => setAdjustment(key, next)} unit="m/s" step={0.01} min={0} ariaLabel={COMBAT_LABELS[key]} /> : <Static mono>{value} m/s</Static>}
                      {editable && own && <button type="button" className="derived-clear" aria-label={`Remove ${COMBAT_LABELS[key]}`} onClick={() => setAdjustment(key, undefined)}><X size={11} /></button>}
                      {!own && base && <InheritMark from={baseName!} />}
                    </>}
                </Field>;
              })}
            </Fields>
          </Section>

          <Section title="Spawns" aside={spawns.length ? <span>{spawns.length} {spawns.length === 1 ? "place" : "places"} · click a pin to edit it on the map</span> : undefined}>
            {spawns.length
              ? <>
                <PointsMap points={spawns.filter(spawn => spawn.placement.centre).map(spawn => ({ id: spawn.placement.id, x: spawn.placement.centre![0], z: spawn.placement.centre![1], radius: spawn.placement.radius, label: `${data.regionName(spawn.placement.regionId)} ×${spawn.placement.count ?? 1}` }))}
                  onOpen={point => navigate("placements", point.id)} onOpenAt={() => navigate("placements", spawns[0]!.placement.id)} />
                <div className="ref-rows">{spawns.map(spawn => <SpawnRow key={spawn.placement.id} spawn={spawn} data={data} onOpen={() => navigate("placements", spawn.placement.id)} />)}</div>
              </>
              : <p className="empty-inline">Not placed in any encounter.</p>}
          </Section>

          <LootSection data={data} working={working} base={base} editable={editable} draft={draft} navigate={navigate} selfId={id} />
          <PresentationSection data={data} working={working} base={base} editable={editable} draft={draft} navigate={navigate} />

          <Section title="Variants" aside={editable && !working.baseId ? <button type="button" className="button button-small" onClick={() => void newVariant()}><GitBranch size={12} /> New variant</button> : undefined}>
            {variants.length
              ? <div className="ref-rows">{variants.map(variant => <RefRow key={variant.id} collection="creatureDefinitions" id={variant.id} record={variant.row} ctx={data.ctx} onOpen={(_collection, target) => navigate("creatureDefinitions", target)} subtitle={variant.id} meta={<Facts items={[`Level ${variant.level}`, variant.regionId ? data.regionName(variant.regionId) : undefined]} />} />)}</div>
              : <p className="empty-inline">{working.baseId ? "A variant cannot have variants of its own." : "No variants inherit from this creature."}</p>}
          </Section>

        </Sheet>
      </div>
      <aside className="record-rail creature-rail">
        <EntitySummary collection="creatureDefinitions" record={row.presentation ? row : { ...row, presentation: variants.find(variant => variant.row.presentation)?.row.presentation }} recordId={id} index={data.index} navigate={navigate} editing />
        {profile && <div className="rail-block">
          <h3>Role curve</h3>
          <CurveTable profile={profile} levels={CURVE_LEVELS} fields={["maxHealth", "attackLevel", "defenceLevel", "maxHit"]} highlight={derived.level} compact />
          <button type="button" className="text-button" onClick={openRole}>{profile.name} parameters <ArrowRight size={11} /></button>
        </div>}
      </aside>
    </div>
    {roleOpen && profileId && <RoleDrawer profileId={profileId} data={data} navigate={navigate} onClose={() => { setRoleOpen(false); setLiveProfile(undefined); }} onLive={setLiveProfile} />}
  </div>;
}

/* ---------- Inheritance helpers ---------- */

function InheritMark({ from }: { from: string }) { return <span className="inherit-mark" title={`Inherited from ${from}`}>inherited</span>; }

function UseBase({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="derived-clear" aria-label={`Use base ${label.toLowerCase()}`} title="Clear the override and use the base value" onClick={onClick}><X size={11} /></button>;
}

function InheritRow({ label, field, working, base, editable, draft, control, show }: { label: string; field: "name" | "family" | "level" | "profileId"; working: Creature; base?: Creature; editable: boolean; draft: RecordDraft<Creature>; control: ReactNode; show: (value: unknown) => ReactNode }) {
  const owned = working[field] !== undefined;
  const inherited = base?.[field];
  if (!owned && base && inherited !== undefined) {
    return <Row label={label}>
      <Static muted>{show(inherited)}</Static>
      <InheritMark from={rowName(base)} />
      {editable && <button type="button" className="button button-small" aria-label={`Override ${label.toLowerCase()}`} onClick={() => draft.setPath([field], structuredClone(inherited))}>Override</button>}
    </Row>;
  }
  return <Row label={label}>{control}{owned && editable && base && inherited !== undefined && <UseBase label={label} onClick={() => draft.setPath([field], undefined)} />}</Row>;
}

function BasePicker({ data, selfId, value, onPick, label }: { data: CreatureData; selfId: string; value?: string; onPick: (id: string) => void; label: string }) {
  const exclude = useMemo(() => new Set([selfId, ...data.resolved.filter(entry => entry.variant).map(entry => entry.id)]), [data, selfId]);
  return <RecordPicker collection="creatureDefinitions" value={value} ctx={data.ctx} exclude={exclude} placeholder="Search base creatures…" onPick={onPick}
    trigger={<button type="button" className="button button-small" aria-label="Choose base creature"><Pencil size={12} /> {label}</button>} />;
}

/** A derived choice (behaviour, attack style): the same row as `Derived`, with a select instead of a number. */
function ChoiceDerived<T extends string>({ derivation, options, editable, onOverride, onOpenSource }: { derivation: Derivation<unknown>; options: readonly T[]; editable: boolean; onOverride: (value: T | undefined) => void; onOpenSource: () => void }) {
  const { value, computed, expression, overridden, source } = derivation;
  return <span className={`derived derived-choice${overridden ? " is-overridden" : ""}`}>
    {editable ? <Select value={value as T | undefined} onChange={next => onOverride(next === computed ? undefined : next)} options={options} width="num" ariaLabel="Override" /> : <strong className="derived-value">{String(value ?? "—")}</strong>}
    {overridden && <s className="derived-computed mono" title="Computed value">{String(computed ?? "—")}</s>}
    {overridden && editable && <button type="button" className="derived-clear" aria-label="Clear override" title="Use the computed value" onClick={() => onOverride(undefined)}><X size={11} /></button>}
    {expression && <span className="derived-expression mono">= {expression}</span>}
    {source.label && <button type="button" className="derived-source" onClick={onOpenSource}>{source.label}</button>}
  </span>;
}

/* ---------- Loot ---------- */

function LootSection({ data, working, base, editable, draft, navigate, selfId }: { data: CreatureData; working: Creature; base?: Creature; editable: boolean; draft: RecordDraft<Creature>; navigate: ViewProps["navigate"]; selfId: string }) {
  const own = working.loot;
  const loot: Loot | undefined = own ?? base?.loot;
  const shared = loot !== undefined && "tableId" in loot;
  const tableId = shared ? loot.tableId : undefined;
  const table = tableId ? data.lootById.get(tableId) : undefined;
  const drops = shared ? dropList(table?.drops) : dropList(loot?.drops);
  const others = tableId ? data.usersOfTable(tableId).filter(entry => entry.id !== selfId).length : 0;
  const editing = editable && own !== undefined;
  const switchTo = (mode: "shared" | "own") => {
    if (mode === "shared") draft.setPath(["loot"], { tableId: tableId ?? "" });
    else draft.setPath(["loot"], { drops: structuredClone(drops) });
  };
  const aside = <>
    {editable && own && base?.loot && <UseBase label="loot" onClick={() => draft.setPath(["loot"], undefined)} />}
    {editable && own && <div className="segmented" role="group" aria-label="Loot source">
      <button type="button" className={shared ? "is-active" : ""} onClick={() => !shared && switchTo("shared")}>Shared table</button>
      <button type="button" className={shared ? "" : "is-active"} onClick={() => shared && switchTo("own")}>Own drops</button>
    </div>}
  </>;
  return <Section title="Loot" aside={aside}>
    {!loot && <Row label="Drops">{editable ? <button type="button" className="filter-chip" onClick={() => switchTo("own")}><Plus size={11} /> Add drops</button> : <Static muted>None</Static>}</Row>}
    {loot && !own && base && <Row label="Source"><Static muted>{shared ? `Shared table` : "Own drops"}</Static><InheritMark from={rowName(base)} />{editable && <button type="button" className="button button-small" aria-label="Override loot" onClick={() => draft.setPath(["loot"], structuredClone(loot))}>Override</button>}</Row>}
    {loot && shared && <Row label="Table">
      {tableId ? <RefChip collection="lootTables" id={tableId} record={table} ctx={data.ctx} onOpen={(_collection, target) => navigate("lootTables", target)} missing={!table} /> : <Static muted>Choose a table</Static>}
      {editing && <RecordPicker collection="lootTables" value={tableId} ctx={data.ctx} onPick={target => draft.setPath(["loot"], { tableId: target })} trigger={<button type="button" className="button button-small" aria-label="Choose loot table"><Pencil size={12} /> {tableId ? "Change" : "Choose"}</button>} />}
      {tableId && <Static muted>{others ? `Shared with ${others} other ${others === 1 ? "creature" : "creatures"}` : "Only this creature uses it"}</Static>}
      {table && <button type="button" className="text-button" onClick={() => navigate("lootTables", table.id)}>Edit table <ArrowRight size={11} /></button>}
    </Row>}
    {loot && (shared || !editing) && <Row label="Drops" align="start"><DropGrid drops={drops} ctx={data.ctx} navigate={navigate} /></Row>}
    {loot && !shared && editing && <Row label="Drops" align="start" wide>
      <EditorContext.Provider value={{ collection: "creatureDefinitions", ctx: data.ctx, index: data.index, navigate }}>
        <LootDropsEditor path="loot.drops" value={loot.drops} onChange={value => draft.setPath(["loot", "drops"], value)} issues={[]} schema={DROPS_SCHEMA} />
      </EditorContext.Provider>
    </Row>}
  </Section>;
}

/* ---------- Presentation ---------- */

function PresentationSection({ data, working, base, editable, draft, navigate }: { data: CreatureData; working: Creature; base?: Creature; editable: boolean; draft: RecordDraft<Creature>; navigate: ViewProps["navigate"] }) {
  const own = working.presentation;
  const presentation: Presentation | undefined = own ?? base?.presentation;
  const editing = editable && own !== undefined;
  const regionOptions = useMemo(() => {
    const ids = new Set<string>([...REGION_IDS, ...data.regions.map(region => region.id)]);
    return [...ids].map(value => ({ value, label: data.regionName(value) }));
  }, [data]);
  const set = (key: keyof Presentation, value: unknown) => draft.setPath(["presentation", key], value);
  const aside = editable && own && base?.presentation ? <UseBase label="presentation" onClick={() => draft.setPath(["presentation"], undefined)} /> : undefined;
  if (!presentation) {
    return <Section title="Presentation">
      <Row label="Model">{editable
        ? <button type="button" className="filter-chip" onClick={() => draft.setPath(["presentation"], { kind: "basic", id: working.id, assetId: "", scale: 1, regionId: REGION_IDS[0], activity: ACTIVITIES[0], description: working.name ?? base?.name ?? working.id })}><Plus size={11} /> Add presentation</button>
        : <Static muted>None</Static>}</Row>
    </Section>;
  }
  const asset = presentation.assetId ? data.ctx.lookup("asset", presentation.assetId) : undefined;
  return <Section title="Presentation" aside={aside}>
    {!own && base && <Row label="Source"><Static muted>Base presentation</Static><InheritMark from={rowName(base)} />{editable && <button type="button" className="button button-small" aria-label="Override presentation" onClick={() => draft.setPath(["presentation"], structuredClone(presentation))}>Override</button>}</Row>}
    <Row label="Asset">
      {presentation.assetId && <Thumb spec={{ kind: "asset", assetId: presentation.assetId, icon: MapPin }} size="l" alt="" />}
      {presentation.assetId ? <RefChip collection="assets" id={presentation.assetId} record={asset} ctx={data.ctx} onOpen={(_collection, target) => navigate("assets", target)} missing={!asset} /> : <Static muted>No model chosen</Static>}
      {editing && <RecordPicker collection="assets" value={presentation.assetId} ctx={data.ctx} onPick={target => set("assetId", target)} placeholder="Search models…" trigger={<button type="button" className="button button-small" aria-label="Choose asset"><Pencil size={12} /> {presentation.assetId ? "Change" : "Choose"}</button>} />}
    </Row>
    <Row label="Scale">{editing ? <NumberInput value={presentation.scale} onChange={value => set("scale", value)} step={0.05} min={0.01} ariaLabel="Scale" /> : <Static mono>{presentation.scale}</Static>}</Row>
    <Row label="Region">{editing ? <Select value={presentation.regionId} onChange={value => set("regionId", value)} options={regionOptions} ariaLabel="Region" /> : <Static>{data.regionName(presentation.regionId)}</Static>}</Row>
    <Row label="Activity">{editing ? <Select value={presentation.activity} onChange={value => set("activity", value)} options={ACTIVITIES} width="num" ariaLabel="Activity" /> : <Static>{presentation.activity}</Static>}</Row>
    <Row label="Description" align="start">{editing ? <TextInput value={presentation.description ?? ""} onChange={value => set("description", value)} multiline ariaLabel="Description" /> : <Static>{presentation.description || "—"}</Static>}</Row>
    <Row label="Kind">
      {editing ? <Select value={presentation.kind} onChange={value => set("kind", value)} options={["basic", "rpg"]} width="num" ariaLabel="Presentation kind" /> : <Static>{presentation.kind}</Static>}
      {presentation.id !== working.id && <Static muted mono>as {presentation.id}</Static>}
    </Row>
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
