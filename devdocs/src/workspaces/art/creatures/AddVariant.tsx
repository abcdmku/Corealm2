import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreatureDefinitionSchema } from "../../../../../game/src/content/schema/creatureDefinitions.js";
import { collectionQuery } from "../../../api/client.js";
import { Button, Input, NativeSelect } from "../../../components/ui/index.js";
import type { CreatureLook } from "../../../model/creatureArt.js";
import { runTransaction } from "../../../model/draft.js";
import { fieldIssues } from "../../../model/fields.js";
import { Drawer } from "../../../ui/Drawer.js";
import { ChoiceField, NumberField } from "../../../ui/field/index.js";
import type { Creature, CreatureData } from "../../creatures/shared.js";
import { isCreatureId, variantIdFor, type BodyEntry, type Presentation } from "./model.js";
import { Note, Row, Rows, errorText } from "./parts.js";
import type { CreatureSkin } from "./skinApi.js";
import { LookSelect, useRegionOptions } from "./VariantPanel.js";

const AVAILABILITY = [{ value: "world", label: "World" }, { value: "lab", label: "Lab only" }] as const;

/**
 * A new look variant of a base on this body: a creature definition with `baseId`, its own level,
 * region, scale or skin. Written at once through a revision-checked transaction; the toast's Undo
 * deletes it again.
 */
export function AddVariantDrawer({ entry, selected, data, skins, onClose, onCreated, onNewSkin }: {
  entry: BodyEntry; selected: CreatureLook; data: CreatureData; skins: readonly CreatureSkin[];
  onClose: () => void; onCreated: (id: string) => void; onNewSkin: () => void;
}) {
  const queryClient = useQueryClient();
  const regionOptions = useRegionOptions(data);
  // Variants cannot inherit variants: the bases on offer are the root definitions this body's looks come from.
  const bases = useMemo(() => {
    const ids = new Set(entry.body.looks.map(look => look.baseId ?? look.creatureId));
    return [...ids].map(id => data.byId.get(id)).filter((row): row is Creature => Boolean(row && !row.baseId));
  }, [entry, data]);
  const [baseId, setBaseId] = useState(() => selected.baseId ?? selected.creatureId);
  const base = data.byId.get(baseId);
  // A base without a model borrows the look it is shown with on this body.
  const seed = (base?.presentation ?? selected.presentation) as Presentation | undefined;
  const [name, setName] = useState("");
  const [level, setLevel] = useState<number | undefined>(base?.level ?? selected.level);
  const [regionId, setRegionId] = useState<string | undefined>(seed?.regionId);
  const [availability, setAvailability] = useState<"world" | "lab">(base?.availability ?? "world");
  const [scale, setScale] = useState<number | undefined>(seed?.scale);
  const [skinId, setSkinId] = useState<string | undefined>(seed?.skinId);
  const [typedId, setTypedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const known = useMemo(() => new Set(data.creatures.map(row => row.id)), [data]);
  const baseName = base?.name ?? baseId;
  const id = typedId ?? variantIdFor(name.trim() || baseName, level, known);
  const idProblem = !isCreatureId(id) ? "Letters, digits, _ and -, starting with a letter." : known.has(id) ? "Another definition has this id." : "";

  function pickBase(next: string) {
    const row = data.byId.get(next);
    const look = (row?.presentation ?? selected.presentation) as Presentation | undefined;
    setBaseId(next); setLevel(row?.level); setRegionId(look?.regionId); setScale(look?.scale); setSkinId(look?.skinId); setAvailability(row?.availability ?? "world");
  }

  async function create() {
    if (!base || !seed || idProblem) return;
    const record: Creature = { id, baseId, availability } as Creature;
    if (name.trim() && name.trim() !== base.name) record.name = name.trim();
    if (level !== undefined && level !== base.level) record.level = level;
    const look = { ...structuredClone(seed), id, regionId: regionId ?? seed.regionId, scale: scale ?? seed.scale } as Presentation;
    if (skinId) look.skinId = skinId; else delete look.skinId;
    const ownLook = !base.presentation || JSON.stringify({ ...look, id: base.presentation.id }) !== JSON.stringify(base.presentation);
    if (ownLook) record.presentation = look;
    const issues = fieldIssues(CreatureDefinitionSchema, record).filter(issue => issue.severity === "error");
    if (issues.length) { setError(`${issues[0]!.path}: ${issues[0]!.message}`); return; }
    setBusy(true); setError("");
    try {
      const fresh = await queryClient.fetchQuery({ ...collectionQuery("creatureDefinitions"), staleTime: 0 });
      await runTransaction("save", { creatureDefinitions: fresh.revision }, [{ kind: "put", collection: "creatureDefinitions", id, record, create: true }]);
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureDefinitions").queryKey });
      toast.success(`Created ${id}`, { action: { label: "Undo", onClick: () => void undoCreate(id) } });
      onCreated(id);
    } catch (failure) {
      setError(errorText(failure));
    } finally { setBusy(false); }
  }

  async function undoCreate(created: string) {
    try {
      const fresh = await queryClient.fetchQuery({ ...collectionQuery("creatureDefinitions"), staleTime: 0 });
      await runTransaction("save", { creatureDefinitions: fresh.revision }, [{ kind: "delete", collection: "creatureDefinitions", id: created }]);
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureDefinitions").queryKey });
      toast.success(`Removed ${created}`);
    } catch (failure) { toast.error(errorText(failure)); }
  }

  return <Drawer title={`New variant of ${entry.name}`} onClose={onClose}>
    <form className="flex flex-col gap-3 text-xs" onSubmit={event => { event.preventDefault(); void create(); }}>
      <Note>A look variant is its own definition and encounter: another level, region, size or skin, inheriting everything else from its base. For a herd that should not look identical, use Variation on one definition instead.</Note>
      <Rows className="grid-cols-[6rem_minmax(0,1fr)]">
        <Row label="Base">
          <NativeSelect className="h-7 text-xs" wrapperClassName="min-w-0 flex-1" aria-label="Base" value={baseId} onChange={event => pickBase(event.target.value)}>
            {bases.map(row => <option key={row.id} value={row.id}>{row.name ?? row.id} · L{row.level ?? "?"} · {row.id}</option>)}
          </NativeSelect>
        </Row>
        <Row label="Name"><Input aria-label="Name" autoFocus value={name} placeholder={baseName} onChange={event => setName(event.target.value)} /></Row>
        <Row label="Id">
          <Input aria-label="Id" className="font-mono" value={id} aria-invalid={Boolean(idProblem)} onChange={event => setTypedId(event.target.value.trim())} />
          {typedId !== undefined && <Button variant="ghost" size="xs" onClick={() => setTypedId(undefined)}>Auto</Button>}
        </Row>
        {idProblem && <><span /><Note tone="error">{idProblem}</Note></>}
        <Row label="Level"><NumberField value={level} integer min={1} ariaLabel="Level" onChange={value => setLevel(value)} /><span className="text-[11px] text-faint">base L{base?.level ?? "?"}</span></Row>
        <Row label="Region"><ChoiceField value={regionId} options={regionOptions} display="select" width="full" ariaLabel="Region" onChange={value => setRegionId(value)} /></Row>
        <Row label="Available"><ChoiceField value={availability} options={AVAILABILITY} display="segments" ariaLabel="Availability" onChange={value => value && setAvailability(value)} /></Row>
        <Row label="Scale"><NumberField value={scale} min={0.05} step={0.05} ariaLabel="Scale" onChange={value => setScale(value)} /><span className="text-[11px] text-faint">base ×{seed?.scale !== undefined ? Number(seed.scale.toFixed(2)) : "?"}</span></Row>
        <Row label="Look">
          <LookSelect value={skinId} skins={skins} onChange={setSkinId} />
          <Button variant="secondary" size="xs" onClick={onNewSkin}>New skin…</Button>
        </Row>
      </Rows>
      {!seed && <Note tone="error">Neither this base nor the selected look has a presentation to copy.</Note>}
      {error && <Note tone="error">{error}</Note>}
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-2">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="default" size="sm" disabled={busy || !seed || Boolean(idProblem)}>{busy ? "Creating…" : `Create ${id}`}</Button>
      </div>
    </form>
  </Drawer>;
}
