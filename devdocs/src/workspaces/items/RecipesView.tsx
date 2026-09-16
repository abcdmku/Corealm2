import { useMemo, useState, type KeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";
import { ProgressionTierSchema, type ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import { RecipeSchema } from "../../../../game/src/content/schema/recipes.js";
import type { ContentRow } from "../../model/contracts.js";
import { deriveProductionEntry, productionSource, type ProductionEntry } from "../../model/derive.js";
import { setPath, useRecordDraft } from "../../model/draft.js";
import type { Path, RecordRef } from "../../model/origin.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { DerivedNumber, Facts, Field, ListField, NumberField, RefField, ReferencedBy, Section, Sheet, TextField, usePeek } from "../../ui/field/index.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { TemplateDrawer } from "./TemplateDrawer.js";
import { seconds, specAt, stationText, useItemsData, type ItemsData, type RecipeRecord } from "./data.js";
import { Button, SearchInput, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { EMPTY, FACTS, PAGE, PAGE_ACTIONS, PAGE_HEADING, RECORD, RECORD_HEAD, RECORD_RAIL, RECORD_TITLE } from "../../ui/layout.js";

const PART = "inline-flex items-center gap-[5px] text-xs [&_small]:text-[11px] [&_small]:text-faint";
const UNIT = "shrink-0 text-[11px] text-faint";
/** A reference beside a quantity: a fixed item cell lines the quantities up. */
const REF_CELL = "flex-[0_0_12.5rem]";

/* Recipes: inputs → output, with the station and the rates the template gives them. */

export default function RecipesView({ recordId, navigate }: ViewProps) {
  const data = useItemsData();
  if (data.error) return <ErrorState message={data.error} />;
  if (data.loading) return <div className={PAGE}><LoadingRows /></div>;
  if (recordId) return <RecipePage key={recordId} id={recordId} data={data} navigate={navigate} />;
  return <RecipeList data={data} navigate={navigate} />;
}

function RecipeList({ data, navigate }: { data: ItemsData; navigate: ViewProps["navigate"] }) {
  const [search, setSearch] = useState("");
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = (recipe: RecipeRecord) => !needle || [recipe.name, recipe.id, recipe.kind, recipe.skill, ...(recipe.stations ?? []), ...(recipe.inputs ?? []).map(input => data.item(input.itemId)?.name ?? input.itemId), data.item(recipe.output?.itemId ?? "")?.name ?? ""].some(text => text?.toLowerCase().includes(needle));
    const byTier = new Map<number, RecipeRecord[]>();
    for (const recipe of data.recipes) { if (!matches(recipe)) continue; const list = byTier.get(recipe.tier ?? 0) ?? []; list.push(recipe); byTier.set(recipe.tier ?? 0, list); }
    return [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([tier, recipes]) => ({ tier, recipes }));
  }, [data, search]);
  const shown = groups.reduce((sum, group) => sum + group.recipes.length, 0);
  const open = (id: string) => navigate("compiled-recipes", id);
  const rowKeys = (id: string) => (event: KeyboardEvent<HTMLTableRowElement>) => { if (event.key === "Enter" && event.target === event.currentTarget) open(id); };
  /** The focused row outlines each of its cells: a row cannot draw an outline across a sticky table. */
  const cell = "h-7 group-focus-visible/tr:shadow-[inset_0_0_0_1px_var(--color-ring)]";
  return <div className={PAGE}>
    <div className={PAGE_HEADING}>
      <h1>Recipes</h1>
      <span className={FACTS}><span>{shown === data.recipes.length ? `${data.recipes.length} recipes` : `${shown} of ${data.recipes.length}`}</span></span>
      <div className={PAGE_ACTIONS}>
        <SearchInput label="Search recipes" placeholder="Search recipes…" value={search} onChange={setSearch} onEnter={() => { const first = groups[0]?.recipes[0]; if (first) open(first.id); }} />
      </div>
    </div>
    <TableFrame className="max-h-[calc(100dvh-110px)] w-full"><Table>
      <TableHeader><TableRow><TableHead>Recipe</TableHead><TableHead>Inputs</TableHead><TableHead className="w-5 px-0.5" /><TableHead>Output</TableHead><TableHead>Kind</TableHead><TableHead>Skill</TableHead><TableHead>Station</TableHead><TableHead numeric>Level</TableHead><TableHead numeric>Duration</TableHead><TableHead numeric>XP</TableHead></TableRow></TableHeader>
      <TableBody>{groups.map(group => [
        <TableRow key={`tier-${group.tier}`}><TableHead scope="rowgroup" colSpan={10} className="h-6 tracking-[.04em] text-faint uppercase">Tier {group.tier}<small className="ml-2 font-normal tracking-normal normal-case">{group.recipes.length} recipes</small></TableHead></TableRow>,
        ...group.recipes.map(recipe => <TableRow key={recipe.id} className="cursor-pointer outline-none" tabIndex={0} aria-label={recipe.name} onClick={() => open(recipe.id)} onKeyDown={rowKeys(recipe.id)}>
          <TableCell className={cn(cell, "font-medium")}>{recipe.name}</TableCell>
          <TableCell className={cell}><span className="inline-flex items-center gap-x-2">{(recipe.inputs ?? []).map((input, i) => <span key={i} className={PART} title={data.item(input.itemId)?.name ?? input.itemId}><Thumb spec={{ kind: "item", id: input.itemId }} size="s" alt="" /><small className="font-mono">×{input.quantity}</small></span>)}</span></TableCell>
          <TableCell className={cn(cell, "w-5 px-0.5")}><ArrowRight size={12} className="text-faint" /></TableCell>
          <TableCell className={cell}><span className={PART}>{recipe.output && <><Thumb spec={{ kind: "item", id: recipe.output.itemId }} size="s" alt="" /><span>{data.item(recipe.output.itemId)?.name ?? recipe.output.itemId}</span>{recipe.output.quantity !== 1 && <small className="font-mono">×{recipe.output.quantity}</small>}</>}</span></TableCell>
          <TableCell className={cell}>{recipe.kind}</TableCell>
          <TableCell className={cell}>{recipe.skill}</TableCell>
          <TableCell className={cell}>{stationText(recipe.stations)}</TableCell>
          <TableCell numeric className={cell}>{recipe.reqLevel}</TableCell>
          <TableCell numeric className={cell}>{seconds(recipe.durationMs)}</TableCell>
          <TableCell numeric className={cell}>{recipe.xp}</TableCell>
        </TableRow>),
      ])}</TableBody>
    </Table></TableFrame>
    {!shown && <p className={EMPTY}>No recipes match "{search}".</p>}
  </div>;
}

function RecipePage({ id, data, navigate }: { id: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const source = useMemo(() => productionSource(id, data.tiers, data.templates), [id, data.tiers, data.templates]);
  if (!source) return <div className={PAGE}><p className={EMPTY}>"{id}" is not a recipe. <Button variant="link" size="inline" onClick={() => navigate("compiled-recipes")}>All recipes</Button></p></div>;
  return <RecipeEditor id={id} tierId={source.tier.id} data={data} navigate={navigate} />;
}

type Ingredient = ProductionEntry["inputs"][number];
const entrySpec = (...path: Path[number][]) => specAt(ProgressionTierSchema, ["production", 0, ...path]);
const INGREDIENTS = specAt(RecipeSchema, ["inputs"]);
const QUANTITY = specAt(RecipeSchema, ["inputs", 0, "quantity"]);
const OUTPUT = specAt(RecipeSchema, ["output"]);

/** Drop an empty adjustments block so the row saves clean. */
function pruneEntry(tier: ProgressionTier, index: number): ProgressionTier {
  const row = tier.production[index];
  if (!row?.adjustments || Object.keys(row.adjustments).length) return tier;
  const { adjustments: _drop, ...rest } = row;
  return { ...tier, production: tier.production.map((candidate, i) => i === index ? rest : candidate) };
}

function RecipeEditor({ id, tierId, data, navigate }: { id: string; tierId: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const draft = useRecordDraft<ProgressionTier>("progression", tierId);
  const { index } = useReferenceIndex();
  const peek = usePeek();
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const [templateDrawer, setTemplateDrawer] = useState<string>();
  const tier = draft.draft ?? data.tiers.find(row => row.id === tierId);
  const entryIndex = tier ? tier.production.findIndex(entry => entry.id === id) : -1;
  const entry = tier?.production[entryIndex];
  const template = entry ? data.templateById(entry.templateId) : undefined;
  const rates = tier && entry && template ? deriveProductionEntry(tier, entry, template) : undefined;
  const compiled = data.recipes.find(recipe => recipe.id === id);
  const liveRecord = useMemo<ContentRow | undefined>(() => {
    if (!tier || !entry || !template || !rates) return compiled;
    return { ...compiled, id, name: entry.name, kind: template.kind, skill: template.skill, stations: template.stations, tier: tier.tier, reqLevel: rates.reqLevel.value, inputs: entry.inputs, output: entry.output, durationMs: rates.durationMs.value, xp: rates.xp.value, ...(entry.burntItemId ? { burntItemId: entry.burntItemId } : {}) };
  }, [tier, entry, template, rates, compiled, id]);
  if (!tier || !entry || !template || !rates) return <div className={PAGE}><LoadingRows /></div>;

  const set = (path: Path, value: unknown) => draft.set(previous => pruneEntry(setPath(previous, ["production", entryIndex, ...path], value), entryIndex));
  const openTemplate = () => setTemplateDrawer(template.id);
  /** The template in a provenance line opens its curve beside the recipe; the tier row peeks. */
  const openRef = (ref: RecordRef) => ref.collection === "recipeTemplates" ? setTemplateDrawer(ref.id) : peek.open(ref);
  const duration = entrySpec("adjustments", "durationMs"), xp = entrySpec("adjustments", "xp"), reqLevel = entrySpec("adjustments", "reqLevel");

  return <div className={PAGE}><div className={RECORD}>
    <div className="min-w-0">
      <header className={RECORD_HEAD}>
        <Thumb spec={{ kind: "item", id: entry.output.itemId }} size="l" alt="" />
        <div className={RECORD_TITLE}><h1>{entry.name}</h1><Facts items={[`Tier ${tier.tier}`, template.kind, template.skill, stationText(template.stations)]} /><code>{id}</code></div>
      </header>
      <Sheet>
        <Section title="Recipe">
          <Field label={entrySpec("name").label}><TextField value={entry.name} readOnly={readOnly} onChange={next => set(["name"], next)} /></Field>
          <ListField<Ingredient> label={INGREDIENTS.label} items={entry.inputs} readOnly={readOnly} emptyText="No ingredients" addLabel="Add ingredient" contentClassName="flex-nowrap"
            onAdd={() => ({ itemId: "", quantity: 1 })} onChange={next => set(["inputs"], next)} removeLabel={(input, i) => `Remove ingredient ${i + 1}`}
            renderItem={(input, api) => <>
              <RefField kind="item" collection="compiled-items" label={`Ingredient ${api.index + 1}`} bare className={REF_CELL} value={input.itemId || undefined} readOnly={readOnly} onChange={next => api.update({ ...input, itemId: next ?? "" })} />
              <span className={UNIT}>×</span>
              <NumberField value={input.quantity} integer min={QUANTITY.min} readOnly={readOnly} ariaLabel={`Ingredient ${api.index + 1} quantity`} onChange={next => api.update({ ...input, quantity: next ?? 1 })} />
            </>} />
          <Field label={OUTPUT.label} className="group/row">
            <RefField kind="item" collection="compiled-items" label="Output item" bare className={REF_CELL} value={entry.output.itemId || undefined} readOnly={readOnly} onChange={next => set(["output", "itemId"], next ?? "")} />
            <span className={UNIT}>×</span>
            <NumberField value={entry.output.quantity} integer min={QUANTITY.min} readOnly={readOnly} ariaLabel="Output quantity" onChange={next => set(["output", "quantity"], next ?? 1)} />
          </Field>
          <RefField kind="item" collection="compiled-items" label={entrySpec("burntItemId").label} hint={specAt(RecipeSchema, ["burntItemId"]).hint} optional value={entry.burntItemId} readOnly={readOnly} onChange={next => set(["burntItemId"], next)} />
        </Section>
        <Section title="Rates" aside={<Button variant="link" size="inline" onClick={openTemplate}>{template.name} curve</Button>}>
          <DerivedNumber label={duration.label} unit={duration.unit} min={duration.min} integer={false} resolved={rates.durationMs.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "durationMs"], next)} onOpenRef={openRef} />
          <DerivedNumber label={xp.label} unit={xp.unit} min={xp.min} resolved={rates.xp.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "xp"], next)} onOpenRef={openRef} />
          <DerivedNumber label={reqLevel.label} min={reqLevel.min} resolved={rates.reqLevel.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "reqLevel"], next)} onOpenRef={openRef} />
        </Section>
        <ReferencedBy collection="compiled-recipes" id={id} navigate={navigate} />
      </Sheet>
    </div>
    <aside className={RECORD_RAIL}><EntitySummary collection="compiled-recipes" record={liveRecord ?? { id }} recordId={id} index={index} navigate={navigate} editing bare /></aside>
    {templateDrawer && <TemplateDrawer templateId={templateDrawer} data={data} onClose={() => setTemplateDrawer(undefined)} onOpenRecipe={recipeId => { setTemplateDrawer(undefined); navigate("compiled-recipes", recipeId); }} />}
  </div></div>;
}
