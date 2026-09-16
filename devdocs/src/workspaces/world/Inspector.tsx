import { memo, type ReactNode } from "react";
import { ArrowUpRight, Crosshair } from "lucide-react";
import { ArraySchema, ObjectSchema, TupleSchema, type Schema } from "../../../../game/src/content/schema/core.js";
import { EncounterDefinitionSchema, ResourcePlacementSchema, WorldPlacementSchema, type EncounterDefinition, type ResourcePlacement, type WorldPlacement } from "../../../../game/src/content/schema/encounters.js";
import { WorldRegionSchema } from "../../../../game/src/content/schema/worldRegions.js";
import type { ApiDiagnostic } from "../../../shared/contracts.js";
import type { SummaryContext } from "../../model/summaries.js";
import { fieldCore } from "../../model/fields.js";
import { rowName } from "../../model/rows.js";
import {
  ChoiceField, Facts, Field, ListField, NumberField, RefField, ReferencedBy, Row, Section, Sheet, Static, TextField, ToggleField, WeightedList,
  fieldFromSchema, type SchemaFieldSpec,
} from "../../ui/field/index.js";
import { GLYPH_DISC, glyphColor, glyphIcon } from "./glyphs.js";
import {
  authoredOffsets, detachEncounter, findOwned, patchEncounter, patchOwned, patchPlacement, patchResource, patchRegion, regionBounds, regionById, removeSelection, round, safeAnchors, titleCase,
  type Bank, type Bounds, type Building, type Draft, type Feature, type Gate, type Landmark, type Location, type NpcStand, type Obstacle, type Point, type Selection, type Shop, type Station,
} from "./model.js";
import { Button, Input } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";

/*
  The right rail: one inspector per kind of thing, built from the one field model. Every label,
  unit, help line, step and choice list comes from the schema through `at(...)`; every edit goes
  through `update(draft => draft)` so the map, the list and the change count follow immediately.
*/

export interface InspectorProps {
  draft: Draft;
  selection: Selection | undefined;
  feature: Feature | undefined;
  editable: boolean;
  ctx: SummaryContext;
  encounterUses: ReadonlyMap<string, number>;
  diagnostics: readonly ApiDiagnostic[];
  update: (change: (draft: Draft) => Draft) => void;
  navigate: (collection?: string, id?: string) => void;
  onFit: (bounds: Bounds) => void;
  onSelect: (selection: Selection | undefined) => void;
}

const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const creatureName = (ctx: SummaryContext, id: string): string => { const row = ctx.lookup("enemy", id); return row ? rowName(row) : id; };
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

// ---------------------------------------------------------------- schema specs

/** One step down a schema: an object key, or an array/tuple entry. */
function child(schema: Schema, key: string | number): Schema {
  const core = fieldCore(schema);
  if (typeof key === "number") return core instanceof ArraySchema ? core.item : core instanceof TupleSchema ? (core.items as readonly Schema[])[key] ?? core : core;
  return core instanceof ObjectSchema ? (core.fields as Record<string, Schema>)[key] ?? core : core;
}

/**
 * The described field at a path: `at(WorldPlacementSchema, "formation", "kind")`. `fieldFromSchema`
 * wants the object that owns the field, so the path walks to the owner and it describes the last step.
 */
function at(schema: Schema, ...path: (string | number)[]): SchemaFieldSpec {
  const last = path[path.length - 1]!;
  let owner = schema;
  for (const key of path.slice(0, -1)) owner = child(owner, key);
  return typeof last === "string" ? fieldFromSchema(owner, last) : fieldFromSchema(child(owner, last), String(last));
}

// ---------------------------------------------------------------- field shapes

/** A number from the schema: label, help, unit, step, integer and range all come from `spec`. */
function NumberRow({ spec, value, onChange, disabled, unit, optional, placeholder, min }: {
  spec: SchemaFieldSpec; value: number | undefined; onChange: (value: number | undefined) => void; disabled: boolean; unit?: string; optional?: boolean; placeholder?: string; min?: number;
}) {
  const shown = unit ?? spec.unit;
  return <Field label={spec.label} hint={spec.hint} unit={shown} disabled={disabled}>
    <NumberField value={value} unit={shown} integer={spec.integer} min={min ?? spec.min} max={spec.max} step={spec.step} optional={optional ?? spec.optional} placeholder={placeholder} disabled={disabled} onChange={onChange} />
  </Field>;
}

function TextRow({ spec, value, onChange, disabled, mono, width }: {
  spec: SchemaFieldSpec; value: string; onChange: (value: string) => void; disabled: boolean; mono?: boolean; width?: "short" | "id" | "text" | "full";
}) {
  return <Field label={spec.label} hint={spec.hint} disabled={disabled}>
    <TextField value={value} multiline={spec.multiline} mono={mono} width={width ?? (spec.multiline ? "full" : "text")} disabled={disabled} onChange={onChange} />
  </Field>;
}

/** An enum, a union of literals, or any closed list the schema carries. */
function ChoiceRow({ spec, value, onChange, disabled, allowEmpty }: {
  spec: SchemaFieldSpec; value: string | undefined; onChange: (value: string | undefined) => void; disabled: boolean; allowEmpty?: string;
}) {
  return <Field label={spec.label} hint={spec.hint} disabled={disabled}>
    <ChoiceField value={value} options={spec.choices ?? []} allowEmpty={allowEmpty} width="full" disabled={disabled} onChange={onChange} />
  </Field>;
}

function ToggleRow({ spec, value, onChange, disabled }: { spec: SchemaFieldSpec; value: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return <Field label={spec.label} hint={spec.hint} disabled={disabled}>
    <ToggleField value={value} disabled={disabled} onChange={onChange} />
  </Field>;
}

/** `[x, z]` metres on one row: the pair reads as one place, not as two rows. */
function PointFields({ label, unit = "m", value, onChange, disabled }: { label: string; unit?: string; value: readonly number[]; onChange: (point: Point) => void; disabled: boolean }) {
  const axis = (name: "x" | "z", index: 0 | 1) => <span className="flex min-w-0 items-center gap-1">
    <span className="w-2 shrink-0 text-[11px] text-faint" aria-hidden>{name}</span>
    <NumberField width="full" className="min-w-0" value={num(value[index])} unit={unit} disabled={disabled} ariaLabel={`${label} ${name}`}
      onChange={next => onChange(index === 0 ? [next ?? 0, value[1] ?? 0] : [value[0] ?? 0, next ?? 0])} />
  </span>;
  return <Field label={label} disabled={disabled}>
    <span className="grid min-w-0 flex-1 grid-cols-2 gap-1.5" role="group" aria-label={label}>{axis("x", 0)}{axis("z", 1)}</span>
  </Field>;
}

/** The sheet in a 320px rail: a shorter label column than a record page's. */
const RAIL_SHEET = "grid-cols-[fit-content(6.5rem)_minmax(0,1fr)]";
/** Anchor offsets in fixed cells so x and z read as two straight columns down the list. */
const ANCHOR_CELL = "w-[5.25rem] shrink-0";
const ACTIONS = "mt-1 flex gap-1 border-t border-border-subtle pt-3";
/** Several links stacked in a row's value (quests, recipes). */
const LINKS = "flex flex-col items-start gap-0.5 py-1";

export const Inspector = memo(function Inspector(props: InspectorProps) {
  const { selection, feature, diagnostics, draft } = props;
  return <aside className="min-h-0 min-w-0 overflow-y-auto border-l border-border bg-card p-3 text-xs [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]" aria-label="Inspector">
    {diagnostics.length > 0 && <section className="mb-3 rounded-md border border-warn bg-warn-soft px-2.5 py-2 text-xs" role={diagnostics.some(row => row.severity === "error") ? "alert" : undefined}>
      <h3 className="mb-1 text-[11px] font-semibold tracking-[.04em] text-warn uppercase">{diagnostics.length === 1 ? "1 diagnostic" : `${diagnostics.length} diagnostics`}</h3>
      {diagnostics.slice(0, 40).map((row, index) => <p key={index} className={cn("my-0.5 leading-snug", row.severity === "error" && "text-destructive")}><code className="text-[11px] text-muted-foreground">{row.path}</code> {row.message}</p>)}
    </section>}
    {!selection || !feature ? <p className="px-3 py-6 text-center text-xs text-faint">Click something on the map or in the list.</p> : <Body {...props} selection={selection} feature={feature} draft={draft} />}
  </aside>;
});

function Body(props: InspectorProps & { selection: Selection; feature: Feature }) {
  switch (props.selection.kind) {
    case "placement": return <PlacementSheet {...props} />;
    case "resource": return <ResourceSheet {...props} />;
    case "region": return <RegionSheet {...props} />;
    case "location": return <LocationSheet {...props} />;
    case "landmark": return <LandmarkSheet {...props} />;
    case "gate": return <GateSheet {...props} />;
    case "obstacle": return <ObstacleSheet {...props} />;
    case "npc": return <NpcSheet {...props} />;
    default: return <PieceSheet {...props} />;
  }
}

// ---------------------------------------------------------------- shared pieces

function Head({ feature, title, facts, aside }: { feature: Feature; title: ReactNode; facts: readonly (ReactNode | undefined | false)[]; aside?: ReactNode }) {
  const Icon = glyphIcon(feature);
  return <header className="mb-2 flex items-start gap-2">
    <span className={cn(GLYPH_DISC, "mt-px")} style={{ background: glyphColor(feature, 40) }}><Icon size={12} /></span>
    <div className="flex min-w-0 flex-1 flex-col gap-px">
      <h2 className="truncate text-[13px] leading-tight font-semibold">{title}</h2>
      <Facts items={facts} className="text-xs" />
      <code className="truncate text-[11px] text-faint">{feature.key}</code>
    </div>
    {aside}
  </header>;
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <Button variant="link" size="inline" onClick={onClick}>{children}<ArrowUpRight size={11} /></Button>;
}

/** Location ids outside one region, so a `location` ref picker only offers that region's nodes. */
function locationsElsewhere(draft: Draft, regionId: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const region of draft.worldRegions) {
    if (region.id === regionId) continue;
    for (const location of region.locations) out.add(location.id);
    for (const location of region.dungeon?.locations ?? []) out.add(location.id);
  }
  return out;
}

// ---------------------------------------------------------------- spawn

type Member = EncounterDefinition["members"][number];
/** A member row in a 320px rail: the creature and its remove button on one line, its share of the group under it. */
const MEMBER_ROW = "grid-cols-[minmax(0,1fr)_auto] gap-y-0.5 pb-0.5 [&>:nth-child(2)]:col-span-full [&>:nth-child(2)]:row-start-2 [&>:nth-child(3)]:col-start-2 [&>:nth-child(3)]:row-start-1";

function PlacementSheet({ draft, selection, feature, editable, ctx, encounterUses, update, navigate, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const placement = draft.placements.find(row => row.id === selection.id);
  if (!placement) return null;
  const encounter = draft.encounters.find(row => row.id === placement.encounterId);
  const region = regionById(draft, placement.regionId);
  const uses = encounterUses.get(placement.encounterId) ?? 1;
  const disabled = !editable;
  const set = (patch: Partial<WorldPlacement>) => update(current => patchPlacement(current, placement.id, patch));
  const setEncounter = (patch: Partial<EncounterDefinition>) => encounter && update(current => patchEncounter(current, encounter.id, patch));
  const members = encounter?.members ?? [];
  const anchors = safeAnchors(placement);
  const adjustments = new Map(placement.anchorAdjustments?.map(row => [row.index, row.offset]));
  const anchorRows = anchors.map((anchor, index) => {
    const raw = adjustments.get(index);
    const offset: Point = raw ? [round(raw[0]), round(raw[1])] : [round(anchor[0] - placement.centre[0]), round(anchor[1] - placement.centre[1])];
    return { index, offset, adjusted: adjustments.has(index) };
  });
  const setAnchors = (rows: typeof anchorRows) => set({ anchorAdjustments: rows.filter(row => row.adjusted).map(row => ({ index: row.index, offset: [round(row.offset[0]), round(row.offset[1])] as Point })) });
  const setCount = (next: number | undefined) => {
    const count = Math.max(1, Math.min(64, Math.round(next ?? 1)));
    let anchorAdjustments = (placement.anchorAdjustments ?? []).filter(row => row.index < count);
    if (placement.formation.kind === "authored" && count > placement.count) {
      const generated = authoredOffsets({ ...placement, count, formation: { ...placement.formation, kind: "grid" } });
      anchorAdjustments = [...anchorAdjustments, ...generated.filter(row => row.index >= placement.count)];
    }
    set({ count, anchorAdjustments });
  };
  const setFormation = (kind: string | undefined) => {
    const next = (kind ?? placement.formation.kind) as WorldPlacement["formation"]["kind"];
    if (next === placement.formation.kind) return;
    set({ formation: { ...placement.formation, kind: next }, anchorAdjustments: next === "authored" ? authoredOffsets(placement) : [] });
  };
  const resetAnchors = () => set({ anchorAdjustments: placement.formation.kind === "authored" ? authoredOffsets({ ...placement, formation: { ...placement.formation, kind: "grid" } }) : [] });
  const addMember = (creatureId: string | undefined) => {
    if (!creatureId || !encounter) return;
    setEncounter({ members: [...encounter.members, { creatureId, weight: 1 }] });
  };

  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={editable ? <Input className="h-auto w-full rounded-none border-0 border-b border-transparent bg-transparent p-0 [font:inherit] text-inherit shadow-none hover:border-border focus-visible:border-primary focus-visible:ring-0" value={encounter?.name ?? placement.encounterId} aria-label="Spawn name" onChange={event => setEncounter({ name: event.target.value })} /> : encounter?.name ?? placement.encounterId}
      facts={[region?.name ?? placement.regionId, encounter?.activity, `${placement.count} ${placement.count === 1 ? "actor" : "actors"}`, placement.rank && titleCase(placement.rank)]} />
    <Section title="Creatures">
      {encounter
        ? <WeightedList<Member> rowClassName={MEMBER_ROW} items={members} weightKey="weight" min={1} readOnly={disabled} emptyText="No creatures."
          keyOf={(member, index) => member.creatureId || index}
          onChange={next => setEncounter({ members: next })}
          removeLabel={member => `Remove ${creatureName(ctx, member.creatureId)}`}
          renderItem={(member, api) => <RefField kind="enemy" label="Creature" bare value={member.creatureId} readOnly={disabled}
            exclude={new Set(members.filter((_, index) => index !== api.index).map(row => row.creatureId))}
            onChange={id => {
              if (!id) return;
              const next = members.map((row, index) => index === api.index ? { ...row, creatureId: id } : row);
              // A one-creature encounter has no name of its own worth keeping: it follows the creature.
              const record = members.length === 1 ? ctx.lookup("enemy", id) : undefined;
              setEncounter(record ? { members: next, name: rowName(record) } : { members: next });
            }} />}
          addControl={editable ? <RefField kind="enemy" className="mt-1" compact label="Add creature" value={undefined} exclude={new Set(members.map(row => row.creatureId))} onChange={addMember} /> : undefined} />
        : <Row label="Encounter"><Static muted>Encounter {placement.encounterId} is missing.</Static></Row>}
      {uses > 1 && <Row label="Shared">
        <Static>Shared with {uses - 1} other {uses - 1 === 1 ? "spawn" : "spawns"}</Static>
        {editable && <Button variant="secondary" size="sm" onClick={() => update(current => detachEncounter(current, placement.id))}>Detach</Button>}
      </Row>}
    </Section>
    <Section title="Population">
      <ChoiceRow spec={at(EncounterDefinitionSchema, "activity")} value={encounter?.activity} disabled={disabled || !encounter} onChange={activity => activity && setEncounter({ activity: activity as EncounterDefinition["activity"] })} />
      <NumberRow spec={at(WorldPlacementSchema, "count")} value={placement.count} disabled={disabled} onChange={setCount} />
      <NumberRow spec={at(WorldPlacementSchema, "radius")} value={placement.radius} disabled={disabled} onChange={radius => set({ radius: radius ?? placement.radius })} />
      <ChoiceRow spec={at(WorldPlacementSchema, "rank")} value={placement.rank} disabled={disabled} allowEmpty="None" onChange={rank => set({ rank: rank as WorldPlacement["rank"] })} />
      <NumberRow spec={at(WorldPlacementSchema, "level")} value={placement.level} disabled={disabled} placeholder="auto" onChange={level => set({ level })} />
    </Section>
    <Section title="Formation">
      <ChoiceRow spec={at(WorldPlacementSchema, "formation", "kind")} value={placement.formation.kind} disabled={disabled} onChange={setFormation} />
      {placement.formation.kind !== "authored" && <>
        <NumberRow spec={at(WorldPlacementSchema, "formation", "spacing")} value={placement.formation.spacing} disabled={disabled} onChange={spacing => set({ formation: { ...placement.formation, spacing: spacing ?? placement.formation.spacing } })} />
        <NumberRow spec={at(WorldPlacementSchema, "formation", "rotation")} value={placement.formation.rotation} disabled={disabled} onChange={rotation => set({ formation: { ...placement.formation, rotation: rotation ?? 0 } })} />
      </>}
      <ListField contentClassName="flex-nowrap" compact label="Anchors" items={anchorRows} min={anchorRows.length} readOnly={disabled} emptyText="No anchors." keyOf={row => row.index}
        onChange={setAnchors}
        addControl={editable ? <Button variant="ghost" size="sm" className="-ml-1.5" onClick={resetAnchors}>Reset to formation</Button> : undefined}
        renderItem={(row, api) => <span className="flex min-w-0 items-center gap-1" data-adjusted={row.adjusted || undefined}>
          <span className={cn("w-[18px] shrink-0 text-right font-mono text-[11px]", row.adjusted ? "text-primary" : "text-faint")} title={row.adjusted ? "Moved by hand" : undefined}>{row.index + 1}</span>
          <NumberField width="full" className={ANCHOR_CELL} value={row.offset[0]} unit="m" disabled={disabled} ariaLabel={`Anchor ${row.index + 1} x`} onChange={x => api.update({ ...row, offset: [x ?? 0, row.offset[1]], adjusted: true })} />
          <NumberField width="full" className={ANCHOR_CELL} value={row.offset[1]} unit="m" disabled={disabled} ariaLabel={`Anchor ${row.index + 1} z`} onChange={z => api.update({ ...row, offset: [row.offset[0], z ?? 0], adjusted: true })} />
        </span>} />
    </Section>
    <Section title="Placement">
      <RefField kind="region" label={at(WorldPlacementSchema, "regionId").label} hint={at(WorldPlacementSchema, "regionId").hint} value={placement.regionId} readOnly={disabled} onChange={regionId => regionId && set({ regionId })} />
      <PointFields label={at(WorldPlacementSchema, "centre").label} unit={at(WorldPlacementSchema, "centre").unit} value={placement.centre} disabled={disabled} onChange={centre => set({ centre })} />
      {placement.habitatId && <Row label={at(WorldPlacementSchema, "habitatId").label}><Static mono>{placement.habitatId}</Static></Row>}
      <Row label={at(WorldPlacementSchema, "dressing").label}>{placement.dressing.length ? <Static mono muted>{placement.dressing.map(row => row.assetId).join(", ")}</Static> : <Static muted>None</Static>}</Row>
    </Section>
    {editable && <div className={ACTIONS}>
      <Button variant="destructive" size="sm" aria-label="Remove spawn" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove spawn</Button>
    </div>}
    <ReferencedBy collection="placements" id={placement.id} navigate={navigate} cap={10} />
    {encounter && <ReferencedBy collection="encounters" id={encounter.id} navigate={navigate} cap={10} title="Referenced by · encounter" />}
  </Sheet>;
}

// ---------------------------------------------------------------- resource node

function ResourceSheet({ draft, selection, feature, editable, ctx, update, navigate, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const node = draft.resourcePlacements.find(row => row.id === selection.id);
  if (!node) return null;
  const region = regionById(draft, node.regionId);
  const resource = ctx.lookup("resource", node.resourceId);
  const disabled = !editable;
  const set = (patch: Partial<ResourcePlacement>) => update(current => patchResource(current, node.id, patch));
  const elsewhere = locationsElsewhere(draft, node.regionId);
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={resource ? rowName(resource) : node.resourceId} facts={[region?.name ?? node.regionId, text(resource?.archetype) && titleCase(text(resource?.archetype)), `${node.count} nodes`]} />
    <Section title="Resource">
      <RefField kind="resource" label={at(ResourcePlacementSchema, "resourceId").label} hint={at(ResourcePlacementSchema, "resourceId").hint} value={node.resourceId} readOnly={disabled} onChange={resourceId => resourceId && set({ resourceId })} />
      <NumberRow spec={at(ResourcePlacementSchema, "count")} value={node.count} disabled={disabled} onChange={count => set({ count: Math.max(1, Math.round(count ?? 1)) })} />
      <NumberRow spec={at(ResourcePlacementSchema, "radius")} value={node.radius} disabled={disabled} unit="m" onChange={radius => set({ radius: radius ?? node.radius })} />
      {node.ringRadius !== undefined && <NumberRow spec={at(ResourcePlacementSchema, "ringRadius")} value={node.ringRadius} disabled={disabled} unit="m" onChange={ringRadius => set({ ringRadius })} />}
    </Section>
    <Section title="Placement">
      <RefField kind="region" label={at(ResourcePlacementSchema, "regionId").label} value={node.regionId} readOnly={disabled} onChange={regionId => regionId && set({ regionId })} />
      <RefField kind="location" label={at(ResourcePlacementSchema, "locationId").label} hint={at(ResourcePlacementSchema, "locationId").hint} value={node.locationId} readOnly={disabled} exclude={elsewhere} onChange={locationId => locationId && set({ locationId })} />
      <PointFields label={at(ResourcePlacementSchema, "centre").label} unit={at(ResourcePlacementSchema, "centre").unit} value={node.centre} disabled={disabled} onChange={centre => set({ centre })} />
    </Section>
    {editable && <div className={ACTIONS}><Button variant="destructive" size="sm" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove node</Button></div>}
    <ReferencedBy collection="resourcePlacements" id={node.id} navigate={navigate} cap={10} />
  </Sheet>;
}

// ---------------------------------------------------------------- region

function RegionSheet({ draft, selection, feature, editable, update, navigate, onFit }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.id);
  if (!region) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchRegion(current, region.id, path, value));
  const spawns = draft.placements.filter(row => row.regionId === region.id).length;
  const nodes = draft.resourcePlacements.filter(row => row.regionId === region.id).length;
  const npcs = region.settlement?.npcs.length ?? 0;
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={region.name} facts={[`Tier ${region.tier}`, `${region.locations.length} locations`, `${spawns} spawns`, `${nodes} nodes`, `${npcs} NPCs`]}
      aside={<Button variant="secondary" size="sm" onClick={() => onFit(regionBounds(region))}><Crosshair size={12} /> Fit</Button>} />
    <Section title="Region">
      <TextRow spec={at(WorldRegionSchema, "name")} value={region.name} disabled={disabled} onChange={name => set(["name"], name)} />
      <NumberRow spec={at(WorldRegionSchema, "tier")} value={region.tier} disabled={disabled} min={1} onChange={tier => set(["tier"], tier ?? region.tier)} />
      <PointFields label={`${at(WorldRegionSchema, "bounds").label} min`} value={region.bounds.min} disabled={disabled} onChange={point => set(["bounds", "min"], point)} />
      <PointFields label={`${at(WorldRegionSchema, "bounds").label} max`} value={region.bounds.max} disabled={disabled} onChange={point => set(["bounds", "max"], point)} />
      <PointFields label={at(WorldRegionSchema, "spawnPoint").label} value={region.spawnPoint} disabled={disabled} onChange={point => set(["spawnPoint"], point)} />
      {/* `respawnPointId` is declared ref('location') but every region stores a settlement id, so a location picker would flag all eight. Read-only until the schema and the data agree. */}
      <Row label={at(WorldRegionSchema, "respawnPointId").label}><Static mono>{region.respawnPointId}</Static></Row>
      {region.settlement && <Row label={at(WorldRegionSchema, "settlement").label}><Static>{region.settlement.name}</Static></Row>}
    </Section>
    <Section title="Lore"><TextRow spec={at(WorldRegionSchema, "lore")} value={region.lore} disabled={disabled} onChange={lore => set(["lore"], lore)} /></Section>
    <ReferencedBy collection="worldRegions" id={region.id} navigate={navigate} cap={6} />
  </Sheet>;
}

// ---------------------------------------------------------------- location

const LOCATION = (key: string) => at(WorldRegionSchema, "locations", 0, key);

function LocationSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const location = region && findOwned(region, "location", selection.id) as Location | undefined;
  if (!region || !location) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const roads = region.roads.filter(road => road.from === location.id || road.to === location.id).map(road => { const otherId = road.from === location.id ? road.to : road.from; return { id: otherId, name: region.locations.find(row => row.id === otherId)?.name ?? otherId, meters: road.meters }; });
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={location.name} facts={[titleCase(location.kind), region.name, location.routeNode && "Route node"]} />
    <Section title="Location">
      <TextRow spec={LOCATION("name")} value={location.name} disabled={disabled} onChange={name => set(["name"], name)} />
      <ChoiceRow spec={LOCATION("kind")} value={location.kind} disabled={disabled} onChange={kind => kind && set(["kind"], kind)} />
      <PointFields label={LOCATION("position").label} value={location.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <ToggleRow spec={LOCATION("routeNode")} value={location.routeNode} disabled={disabled} onChange={value => set(["routeNode"], value)} />
      <TextRow spec={LOCATION("blurb")} value={location.blurb ?? ""} disabled={disabled} onChange={blurb => set(["blurb"], blurb || undefined)} />
    </Section>
    <Section title="Roads">
      {roads.length ? roads.map(road => <Row key={road.id} label={road.name}><Link onClick={() => onSelect({ kind: "location", id: road.id, regionId: region.id })}>{road.meters ? `${road.meters} m` : "open"}</Link></Row>) : <Static muted>No roads touch this location.</Static>}
    </Section>
    {editable && <div className={ACTIONS}><Button variant="destructive" size="sm" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove location</Button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- landmark

const LANDMARK = (key: string) => at(WorldRegionSchema, "landmarks", 0, key);

function LandmarkSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const landmark = region && findOwned(region, "landmark", selection.id) as Landmark | undefined;
  if (!region || !landmark) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={landmark.name} facts={[region.name, landmark.assetId, landmark.solid && "Solid"]} />
    <Section title="Landmark">
      <TextRow spec={LANDMARK("name")} value={landmark.name} disabled={disabled} onChange={name => set(["name"], name)} />
      <RefField kind="asset" label={LANDMARK("assetId").label} hint={LANDMARK("assetId").hint} value={landmark.assetId} readOnly={disabled} onChange={id => id && set(["assetId"], id)} />
      <NumberRow spec={LANDMARK("scale")} value={landmark.scale} disabled={disabled} onChange={scale => set(["scale"], scale)} />
      <NumberRow spec={LANDMARK("rotationY")} value={landmark.rotationY} disabled={disabled} unit={LANDMARK("rotationY").unit ?? "rad"} onChange={rotation => set(["rotationY"], rotation)} />
      <ToggleRow spec={LANDMARK("solid")} value={landmark.solid ?? false} disabled={disabled} onChange={value => set(["solid"], value || undefined)} />
      <PointFields label={LANDMARK("position").label} value={landmark.position} disabled={disabled} onChange={point => set(["position"], point)} />
      {landmark.composition && <Row label={LANDMARK("composition").label}><Static mono>{landmark.composition}</Static></Row>}
      <TextRow spec={LANDMARK("blurb")} value={landmark.blurb} disabled={disabled} onChange={blurb => set(["blurb"], blurb)} />
    </Section>
    {editable && <div className={ACTIONS}><Button variant="destructive" size="sm" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove landmark</Button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- gate

const GATE = (key: string) => at(WorldRegionSchema, "gates", 0, key);

function GateSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const gate = region && findOwned(region, "gate", selection.id) as Gate | undefined;
  if (!region || !gate) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const target = regionById(draft, gate.toRegionId);
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={gate.name} facts={[region.name, `to ${target?.name ?? gate.toRegionId}`]} />
    <Section title="Gate">
      <TextRow spec={GATE("name")} value={gate.name} disabled={disabled} onChange={name => set(["name"], name)} />
      <RefField kind="region" label={GATE("toRegionId").label} hint={GATE("toRegionId").hint} value={gate.toRegionId} readOnly={disabled} onChange={id => id && set(["toRegionId"], id)} />
      <RefField kind="location" label={GATE("toLocationId").label} hint={GATE("toLocationId").hint} value={gate.toLocationId} readOnly={disabled} exclude={locationsElsewhere(draft, gate.toRegionId)} onChange={id => id && set(["toLocationId"], id)} />
      {target && target.locations.some(row => row.id === gate.toLocationId) && <Row label="">
        <Link onClick={() => onSelect({ kind: "location", id: gate.toLocationId, regionId: target.id })}>Show on the map</Link>
      </Row>}
      <PointFields label={GATE("position").label} value={gate.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <NumberRow spec={GATE("rotationY")} value={gate.rotationY} disabled={disabled} unit={GATE("rotationY").unit ?? "rad"} onChange={rotation => set(["rotationY"], rotation)} />
      <RefField kind="asset" label={GATE("assetId").label} hint={GATE("assetId").hint} value={gate.assetId} readOnly={disabled} onChange={id => id && set(["assetId"], id)} />
    </Section>
    {editable && <div className={ACTIONS}><Button variant="destructive" size="sm" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove gate</Button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- obstacle

const OBSTACLE = (key: string) => at(WorldRegionSchema, "obstacles", 0, key);

function ObstacleSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const obstacle = region && findOwned(region, "obstacle", selection.id) as Obstacle | undefined;
  if (!region || !obstacle) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const locationName = (id: string) => region.locations.find(row => row.id === id)?.name ?? id;
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={obstacle.name} facts={[titleCase(obstacle.interaction), `level ${obstacle.reqLevel}`, region.name]} />
    <Section title="Obstacle">
      <TextRow spec={OBSTACLE("name")} value={obstacle.name} disabled={disabled} onChange={name => set(["name"], name)} />
      <ChoiceRow spec={OBSTACLE("interaction")} value={obstacle.interaction} disabled={disabled} onChange={value => value && set(["interaction"], value)} />
      <NumberRow spec={OBSTACLE("reqLevel")} value={obstacle.reqLevel} disabled={disabled} min={1} onChange={level => set(["reqLevel"], level ?? 1)} />
      <NumberRow spec={OBSTACLE("durationMs")} value={obstacle.durationMs} disabled={disabled} min={0} onChange={value => set(["durationMs"], value ?? 0)} />
      <NumberRow spec={OBSTACLE("savesMeters")} value={obstacle.savesMeters} disabled={disabled} min={0} onChange={value => set(["savesMeters"], value ?? 0)} />
      <ToggleRow spec={OBSTACLE("oneWay")} value={obstacle.oneWay ?? false} disabled={disabled} onChange={value => set(["oneWay"], value || undefined)} />
      <PointFields label={OBSTACLE("position").label} value={obstacle.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <PointFields label={OBSTACLE("exitPosition").label} value={obstacle.exitPosition} disabled={disabled} onChange={point => set(["exitPosition"], point)} />
      <Row label={OBSTACLE("fromLocationId").label}><Link onClick={() => onSelect({ kind: "location", id: obstacle.fromLocationId, regionId: region.id })}>{locationName(obstacle.fromLocationId)}</Link></Row>
      <Row label={OBSTACLE("toLocationId").label}><Link onClick={() => onSelect({ kind: "location", id: obstacle.toLocationId, regionId: region.id })}>{locationName(obstacle.toLocationId)}</Link></Row>
      <Row label={OBSTACLE("assetId").label}><Static mono>{obstacle.assetId}</Static></Row>
    </Section>
    {editable && <div className={ACTIONS}><Button variant="destructive" size="sm" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove obstacle</Button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- npc stand

const STAND = (key: string) => at(WorldRegionSchema, "settlement", "npcs", 0, key);

function NpcSheet({ draft, selection, feature, editable, ctx, update, navigate }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const stand = region && findOwned(region, "npc", selection.id) as NpcStand | undefined;
  if (!region || !stand) return null;
  const npc = ctx.lookup("npc", stand.id);
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const quests = [...new Set([...stand.questIds, ...strings(npc?.questIds)])];
  const dialogueRootId = stand.dialogueRootId || text(npc?.dialogueRootId);
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={npc ? rowName(npc) : stand.name} facts={[region.settlement?.name, quests.length ? `${quests.length} ${quests.length === 1 ? "quest" : "quests"}` : undefined]} />
    <Section title="NPC">
      <TextRow spec={STAND("name")} value={stand.name} disabled={disabled} onChange={name => set(["name"], name)} />
      {npc && <Row label="Role"><Static>{text(npc.role)}</Static></Row>}
      <PointFields label={STAND("position").label} value={stand.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <NumberRow spec={STAND("facingRad")} value={stand.facingRad} disabled={disabled} onChange={value => set(["facingRad"], value ?? 0)} />
      <RefField kind="asset" label={STAND("assetId").label} hint={STAND("assetId").hint} value={stand.assetId} readOnly={disabled} onChange={id => id && set(["assetId"], id)} />
    </Section>
    <Section title="Story">
      <Row label="Record">{npc ? <Link onClick={() => navigate("npcs", stand.id)}>Open NPC</Link> : <Static muted>No npcs.json record for {stand.id}</Static>}</Row>
      <Row label={STAND("dialogueRootId").label}>{dialogueRootId ? <Link onClick={() => navigate("dialogue", dialogueRootId)}>{dialogueRootId}</Link> : <Static muted>None</Static>}</Row>
      <Row label={STAND("questIds").label}>{quests.length ? <span className={LINKS}>{quests.map(id => <Link key={id} onClick={() => navigate("quests", id)}>{id}</Link>)}</span> : <Static muted>None</Static>}</Row>
    </Section>
    <ReferencedBy collection="npcs" id={stand.id} navigate={navigate} cap={10} />
  </Sheet>;
}

// ---------------------------------------------------------------- building / station / shop / bank

const PIECE: Record<string, (key: string) => SchemaFieldSpec> = {
  building: key => at(WorldRegionSchema, "settlement", "buildings", 0, key),
  station: key => at(WorldRegionSchema, "stations", 0, key),
  shop: key => at(WorldRegionSchema, "settlement", "shops", 0, key),
  bank: key => at(WorldRegionSchema, "settlement", "bank", key),
};

function PieceSheet({ draft, selection, feature, editable, ctx, update, navigate }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const piece = region && findOwned(region, selection.kind, selection.id) as (Building | Station | Shop | Bank) | undefined;
  if (!region || !piece) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const spec = PIECE[selection.kind] ?? PIECE.station!;
  const building = selection.kind === "building" ? piece as Building : undefined;
  const station = selection.kind === "station" ? piece as Station : undefined;
  const shop = selection.kind === "shop" ? piece as Shop : undefined;
  const shopRecord = shop ? ctx.lookup("shop", shop.id) : undefined;
  const kind = building ? titleCase(building.prefab) : station ? `${titleCase(station.kind)} · ${station.skill}` : shop ? `${titleCase(shop.shopKind)} shop` : "Bank";
  return <Sheet compact className={RAIL_SHEET}>
    <Head feature={feature} title={piece.name} facts={[kind, region.settlement?.name ?? region.name]} />
    <Section title={titleCase(selection.kind)}>
      <TextRow spec={spec("name")} value={piece.name} disabled={disabled} onChange={name => set(["name"], name)} />
      {building && <TextRow spec={spec("prefab")} value={building.prefab} disabled={disabled} mono width="id" onChange={value => set(["prefab"], value)} />}
      {station && <Row label={spec("kind").label}><Static>{titleCase(station.kind)} · {station.skill}</Static></Row>}
      {station?.essenceElement && <Row label={spec("essenceElement").label}><Static>{titleCase(station.essenceElement)}</Static></Row>}
      {shop && <Row label="Shop">{shopRecord ? <Link onClick={() => navigate("shops", shop.id)}>{rowName(shopRecord)}</Link> : <Static muted>No shops.json record for {shop.id}</Static>}</Row>}
      <PointFields label={spec("position").label} value={piece.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <NumberRow spec={spec("rotationY")} value={piece.rotationY} disabled={disabled} unit={spec("rotationY").unit ?? "rad"} onChange={value => set(["rotationY"], value ?? 0)} />
      {building && <PointFields label={spec("footprint").label} value={building.footprint} disabled={disabled} onChange={value => set(["footprint"], value)} />}
      {!building && "assetId" in piece && <RefField kind="asset" label={spec("assetId").label} hint={spec("assetId").hint} value={piece.assetId} readOnly={disabled} onChange={id => id && set(["assetId"], id)} />}
      {"attachedTo" in piece && piece.attachedTo && <Row label={spec("attachedTo").label}><Link onClick={() => navigate("world/map", `buildings:${region.id}/${piece.attachedTo!}`)}>{region.settlement?.buildings.find(row => row.id === piece.attachedTo)?.name ?? piece.attachedTo}</Link></Row>}
      {station && <Row label={spec("recipeIds").label}>{station.recipeIds.length ? <span className={LINKS}>{station.recipeIds.map(id => <Link key={id} onClick={() => navigate("recipes", id)}>{id}</Link>)}</span> : <Static muted>None</Static>}</Row>}
      {station?.scale !== undefined && <NumberRow spec={spec("scale")} value={num(station.scale)} disabled={disabled} onChange={value => set(["scale"], value)} />}
    </Section>
  </Sheet>;
}
