import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SpeciesFields } from "../../../../../game/src/content/schema/creatures.js";
import { collectionQuery } from "../../../api/client.js";
import { Button, NativeSelect } from "../../../components/ui/index.js";
import type { useArtReview } from "../../../model/artReview.js";
import type { RecordDraft } from "../../../model/draft.js";
import { runTransaction } from "../../../model/draft.js";
import { ChoiceField, NumberField, TextField, fieldFromSchema } from "../../../ui/field/index.js";
import { VerdictBar } from "../../../ui/FocusLayout.js";
import type { ViewProps } from "../../types.js";
import type { Creature, CreatureData } from "../../creatures/shared.js";
import { presentationOf, withPresentation } from "./model.js";
import { Note, Row, Rows, Section, errorText } from "./parts.js";
import type { CreatureSkin } from "./skinApi.js";
import { metaBlock } from "../gates.js";

const AVAILABILITY = [{ value: "world", label: "World" }, { value: "lab", label: "Lab only" }] as const;

export function useRegionOptions(data: CreatureData) {
  return useMemo(() => {
    const ids = new Set<string>([...(fieldFromSchema(SpeciesFields.regionId, "regionId").choices ?? []), ...data.regions.map(region => region.id)]);
    return [...ids].map(value => ({ value, label: data.regionName(value) }));
  }, [data]);
}

/** The skin picker: the model's own maps, or one of this model's skins. */
export function LookSelect({ value, skins, onChange, disabled, label = "Look" }: { value: string | undefined; skins: readonly CreatureSkin[]; onChange: (skinId: string | undefined) => void; disabled?: boolean; label?: string }) {
  const known = !value || skins.some(skin => skin.id === value);
  return <NativeSelect className="h-7 text-xs" wrapperClassName="min-w-0 flex-1" aria-label={label} value={value ?? ""} disabled={disabled} onChange={event => onChange(event.target.value || undefined)}>
    <option value="">Model's own maps</option>
    {skins.map(skin => <option key={skin.id} value={skin.id}>{skin.name} ({skin.kind})</option>)}
    {!known && <option value={value}>{value} (missing)</option>}
  </NativeSelect>;
}

type Review = ReturnType<typeof useArtReview>;

/** The selected definition's look fields, edited through its record draft. */
export function VariantPanel({ draft, data, skins, review, navigate, onNewSkin, onDeleted }: {
  draft: RecordDraft<Creature>; data: CreatureData; skins: readonly CreatureSkin[]; review: Review;
  navigate: ViewProps["navigate"]; onNewSkin: () => void; onDeleted: (id: string) => void;
}) {
  const working = draft.draft ?? draft.record;
  const base = working?.baseId ? data.byId.get(working.baseId) : undefined;
  const regionOptions = useRegionOptions(data);
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!working) return <Section title="Variant"><Note>{draft.loading ? "Loading…" : draft.error ?? "This definition is not in the collection."}</Note></Section>;
  const presentation = presentationOf(working, base);
  const readOnly = !draft.editable;
  const setLook = (patch: Record<string, unknown>) => draft.set(current => withPresentation(current, base, patch));
  const users = data.variantsOf(working.id).length;

  async function remove() {
    const id = working!.id;
    try {
      const fresh = await queryClient.fetchQuery({ ...collectionQuery("creatureDefinitions"), staleTime: 0 });
      await runTransaction("save", { creatureDefinitions: fresh.revision }, [{ kind: "delete", collection: "creatureDefinitions", id }]);
      draft.reset();
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureDefinitions").queryKey });
      toast.success(`Deleted ${id}`);
      onDeleted(id);
    } catch (error) { toast.error(errorText(error)); }
    setConfirmDelete(false);
  }

  return <Section title={working.baseId ? "Look variant" : "Base definition"} aside={<Button variant="link" size="xs" onClick={() => navigate("creatures/bestiary", working.id)}>Edit stats</Button>}>
    <div className="flex min-w-0 flex-col">
      <code className="truncate font-mono text-[11px] text-faint">{working.id}</code>
      <span className="truncate text-[11px] text-muted-foreground">{base ? `Variant of ${base.name ?? base.id}: unset fields come from it.` : users ? `Base of ${users} ${users === 1 ? "variant" : "variants"}.` : "No variants yet."}</span>
    </div>
    <Rows>
      <Row label="Name"><TextField value={working.name ?? ""} width="full" placeholder={base?.name ?? working.id} readOnly={readOnly} ariaLabel="Name" onChange={value => draft.setPath(["name"], value.trim() || undefined)} /></Row>
      <Row label="Level"><NumberField value={working.level ?? base?.level} integer min={1} optional={Boolean(base)} placeholder={base?.level ? String(base.level) : undefined} readOnly={readOnly} ariaLabel="Level" onChange={value => draft.setPath(["level"], value)} />
        {base && working.level === undefined && <span className="text-[11px] text-faint">from base</span>}</Row>
      <Row label="Region">{presentation
        ? <ChoiceField value={presentation.regionId} options={regionOptions} display="select" width="full" readOnly={readOnly} ariaLabel="Region" onChange={value => value && setLook({ regionId: value })} />
        : <span className="text-[11px] text-faint">No presentation</span>}</Row>
      <Row label="Available"><ChoiceField value={working.availability} options={AVAILABILITY} display="segments" readOnly={readOnly} ariaLabel="Availability" onChange={value => value && draft.setPath(["availability"], value)} /></Row>
      {presentation && <>
        <Row label="Scale"><NumberField value={presentation.scale} min={0.05} step={0.05} readOnly={readOnly} ariaLabel="Scale" onChange={value => value !== undefined && setLook({ scale: value })} /><span className="text-[11px] text-faint">× model size</span></Row>
        <Row label="Look"><LookSelect value={presentation.skinId} skins={skins} disabled={readOnly} onChange={skinId => setLook({ skinId })} />
          <Button variant="secondary" size="xs" disabled={readOnly} onClick={onNewSkin}>New skin…</Button></Row>
      </>}
    </Rows>
    {working.baseId && !working.presentation && <Note>Wears its base's presentation. Changing region, scale or look gives it its own copy.</Note>}
    <DraftBar draft={draft} />
    <div className="flex flex-wrap items-center gap-2">
      <VerdictBar size="xs" value={review.verdict()} disabled={review.isPending || Boolean(metaBlock())} onChange={verdict => review.review({ verdict })} />
      {metaBlock() && <span className="text-[11px] text-faint" data-blocked="">Verdicts read only here</span>}
      {working.baseId && !readOnly && (confirmDelete
        ? <span className="ml-auto flex items-center gap-1"><Button variant="destructive" size="xs" onClick={() => void remove()}>Delete {working.id}</Button><Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
        : <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setConfirmDelete(true)}>Delete…</Button>)}
    </div>
  </Section>;
}

/** Unsaved state of one record draft, with its own save and discard (the shell's save bar saves it too). */
export function DraftBar({ draft }: { draft: Pick<RecordDraft, "conflict" | "saveError" | "diagnostics" | "dirty" | "saving" | "reset" | "save"> }) {
  if (draft.conflict) return <Note tone="error">{draft.saveError || "Changed on disk. Discard to load the current file."} <Button variant="link" size="inline" onClick={draft.reset}>Discard</Button></Note>;
  const issues = draft.diagnostics.map(diagnostic => diagnostic.message).join("; ");
  if (!draft.dirty) return draft.saveError || issues ? <Note tone="error">{draft.saveError || issues}</Note> : null;
  return <div className="flex items-center gap-2 rounded-md bg-warn-soft px-2 py-1">
    <span className="min-w-0 flex-1 truncate text-[11px] text-warn">{draft.saveError || issues || "Unsaved: previewing on the stage"}</span>
    <Button variant="ghost" size="xs" disabled={draft.saving} onClick={draft.reset}>Discard</Button>
    <Button variant="default" size="xs" disabled={draft.saving} onClick={() => void draft.save()}>{draft.saving ? "Saving…" : "Save"}</Button>
  </div>;
}
