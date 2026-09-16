import { useMemo, useState, type KeyboardEvent } from "react";
import { ArrowRight, Search, X } from "lucide-react";
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
import "./items.css";

/* Recipes: inputs → output, with the station and the rates the template gives them. */

export default function RecipesView({ recordId, navigate }: ViewProps) {
  const data = useItemsData();
  if (data.error) return <ErrorState message={data.error} />;
  if (data.loading) return <div className="ws-page"><LoadingRows /></div>;
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
  return <div className="ws-page recipes-page">
    <div className="ws-heading">
      <h1>Recipes</h1>
      <span className="facts"><span>{shown === data.recipes.length ? `${data.recipes.length} recipes` : `${shown} of ${data.recipes.length}`}</span></span>
      <div className="ws-heading-actions">
        <label className="search-field"><Search size={13} /><input value={search} placeholder="Search recipes…" aria-label="Search recipes" onChange={event => setSearch(event.target.value)} />{search && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setSearch("")}><X size={12} /></button>}</label>
      </div>
    </div>
    <div className="matrix recipes-table"><table>
      <thead><tr><th>Recipe</th><th>Inputs</th><th /><th>Output</th><th>Kind</th><th>Skill</th><th>Station</th><th className="cell-num">Level</th><th className="cell-num">Duration</th><th className="cell-num">XP</th></tr></thead>
      <tbody>{groups.map(group => [
        <tr key={`tier-${group.tier}`} className="recipes-tier"><th scope="rowgroup" colSpan={10}>Tier {group.tier}<small>{group.recipes.length} recipes</small></th></tr>,
        ...group.recipes.map(recipe => <tr key={recipe.id} className="recipes-row" tabIndex={0} aria-label={recipe.name} onClick={() => open(recipe.id)} onKeyDown={rowKeys(recipe.id)}>
          <td>{recipe.name}</td>
          <td><span className="recipe-line">{(recipe.inputs ?? []).map((input, i) => <span key={i} className="recipe-part" title={data.item(input.itemId)?.name ?? input.itemId}><Thumb spec={{ kind: "item", id: input.itemId }} size="s" alt="" /><small className="mono">×{input.quantity}</small></span>)}</span></td>
          <td className="recipes-arrow"><ArrowRight size={12} className="muted" /></td>
          <td><span className="recipe-part">{recipe.output && <><Thumb spec={{ kind: "item", id: recipe.output.itemId }} size="s" alt="" /><span>{data.item(recipe.output.itemId)?.name ?? recipe.output.itemId}</span>{recipe.output.quantity !== 1 && <small className="mono">×{recipe.output.quantity}</small>}</>}</span></td>
          <td>{recipe.kind}</td>
          <td>{recipe.skill}</td>
          <td>{stationText(recipe.stations)}</td>
          <td className="cell-num">{recipe.reqLevel}</td>
          <td className="cell-num">{seconds(recipe.durationMs)}</td>
          <td className="cell-num">{recipe.xp}</td>
        </tr>),
      ])}</tbody>
    </table></div>
    {!shown && <p className="empty-inline">No recipes match "{search}".</p>}
  </div>;
}

function RecipePage({ id, data, navigate }: { id: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const source = useMemo(() => productionSource(id, data.tiers, data.templates), [id, data.tiers, data.templates]);
  if (!source) return <div className="ws-page"><p className="empty-inline">"{id}" is not a recipe. <button type="button" className="text-button" onClick={() => navigate("compiled-recipes")}>All recipes</button></p></div>;
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
  if (!tier || !entry || !template || !rates) return <div className="ws-page"><LoadingRows /></div>;

  const set = (path: Path, value: unknown) => draft.set(previous => pruneEntry(setPath(previous, ["production", entryIndex, ...path], value), entryIndex));
  const openTemplate = () => setTemplateDrawer(template.id);
  /** The template in a provenance line opens its curve beside the recipe; the tier row peeks. */
  const openRef = (ref: RecordRef) => ref.collection === "recipeTemplates" ? setTemplateDrawer(ref.id) : peek.open(ref);
  const duration = entrySpec("adjustments", "durationMs"), xp = entrySpec("adjustments", "xp"), reqLevel = entrySpec("adjustments", "reqLevel");

  return <div className="ws-page"><div className="record">
    <div className="record-main">
      <header className="record-head">
        <Thumb spec={{ kind: "item", id: entry.output.itemId }} size="l" alt="" />
        <div className="record-title"><h1>{entry.name}</h1><Facts items={[`Tier ${tier.tier}`, template.kind, template.skill, stationText(template.stations)]} /><code>{id}</code></div>
      </header>
      <Sheet>
        <Section title="Recipe">
          <Field label={entrySpec("name").label}><TextField value={entry.name} readOnly={readOnly} onChange={next => set(["name"], next)} /></Field>
          <ListField<Ingredient> label={INGREDIENTS.label} items={entry.inputs} readOnly={readOnly} emptyText="No ingredients" addLabel="Add ingredient" className="ingredients"
            onAdd={() => ({ itemId: "", quantity: 1 })} onChange={next => set(["inputs"], next)} removeLabel={(input, i) => `Remove ingredient ${i + 1}`}
            renderItem={(input, api) => <>
              <RefField kind="item" collection="compiled-items" label={`Ingredient ${api.index + 1}`} className="field-inline" value={input.itemId || undefined} readOnly={readOnly} onChange={next => api.update({ ...input, itemId: next ?? "" })} />
              <span className="field-unit">×</span>
              <NumberField value={input.quantity} integer min={QUANTITY.min} readOnly={readOnly} ariaLabel={`Ingredient ${api.index + 1} quantity`} onChange={next => api.update({ ...input, quantity: next ?? 1 })} />
            </>} />
          <Field label={OUTPUT.label} className="recipe-output">
            <RefField kind="item" collection="compiled-items" label="Output item" className="field-inline" value={entry.output.itemId || undefined} readOnly={readOnly} onChange={next => set(["output", "itemId"], next ?? "")} />
            <span className="field-unit">×</span>
            <NumberField value={entry.output.quantity} integer min={QUANTITY.min} readOnly={readOnly} ariaLabel="Output quantity" onChange={next => set(["output", "quantity"], next ?? 1)} />
          </Field>
          <RefField kind="item" collection="compiled-items" label={entrySpec("burntItemId").label} hint={specAt(RecipeSchema, ["burntItemId"]).hint} optional value={entry.burntItemId} readOnly={readOnly} onChange={next => set(["burntItemId"], next)} />
        </Section>
        <Section title="Rates" aside={<button type="button" className="text-button" onClick={openTemplate}>{template.name} curve</button>}>
          <DerivedNumber label={duration.label} unit={duration.unit} min={duration.min} integer={false} resolved={rates.durationMs.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "durationMs"], next)} onOpenRef={openRef} />
          <DerivedNumber label={xp.label} unit={xp.unit} min={xp.min} resolved={rates.xp.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "xp"], next)} onOpenRef={openRef} />
          <DerivedNumber label={reqLevel.label} min={reqLevel.min} resolved={rates.reqLevel.resolved} readOnly={readOnly} optional onChange={next => set(["adjustments", "reqLevel"], next)} onOpenRef={openRef} />
        </Section>
        <ReferencedBy collection="compiled-recipes" id={id} navigate={navigate} />
      </Sheet>
    </div>
    <aside className="record-rail"><EntitySummary collection="compiled-recipes" record={liveRecord ?? { id }} recordId={id} index={index} navigate={navigate} editing /></aside>
    {templateDrawer && <TemplateDrawer templateId={templateDrawer} data={data} onClose={() => setTemplateDrawer(undefined)} onOpenRecipe={recipeId => { setTemplateDrawer(undefined); navigate("compiled-recipes", recipeId); }} />}
  </div></div>;
}
