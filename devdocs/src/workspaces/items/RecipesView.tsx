import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Plus, Search, X } from "lucide-react";
import type { ProgressionTier } from "../../../../game/src/content/schema/progression.js";
import type { ContentRow } from "../../model/contracts.js";
import { deriveProductionEntry, fmt, productionSource } from "../../model/derive.js";
import { useRecordDraft, type Path } from "../../model/draft.js";
import { useReferenceIndex } from "../../model/refs.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { Derived, Facts, NumberInput, Row, SaveBar, Section, Sheet, Static, TextInput } from "../../ui/Sheet.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";
import { ItemPick } from "./ItemPick.js";
import { TemplateDrawer } from "./TemplateDrawer.js";
import { seconds, stationText, titleCase, useItemsData, useSaveShortcut, type ItemsData, type RecipeRecord } from "./data.js";
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
        ...group.recipes.map(recipe => <tr key={recipe.id} className="recipes-row" onClick={() => navigate("compiled-recipes", recipe.id)}>
          <td><button type="button" className="cell" onClick={event => { event.stopPropagation(); navigate("compiled-recipes", recipe.id); }}><span>{recipe.name}</span></button></td>
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

function RecipeEditor({ id, tierId, data, navigate }: { id: string; tierId: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const draft = useRecordDraft<ProgressionTier>("progression", tierId);
  const { index } = useReferenceIndex();
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const [templateDrawer, setTemplateDrawer] = useState<string>();
  const tier = draft.draft ?? data.tiers.find(row => row.id === tierId);
  const entryIndex = tier ? tier.production.findIndex(entry => entry.id === id) : -1;
  const entry = tier?.production[entryIndex];
  const template = entry ? data.templateById(entry.templateId) : undefined;
  const rates = tier && entry && template ? deriveProductionEntry(tier, entry, template) : undefined;
  const save = useCallback(() => { if (draft.dirty) void draft.save(); }, [draft]);
  useSaveShortcut(!readOnly && draft.dirty, save);
  const compiled = data.recipes.find(recipe => recipe.id === id);
  const liveRecord = useMemo<ContentRow | undefined>(() => {
    if (!tier || !entry || !template || !rates) return compiled;
    return { ...compiled, id, name: entry.name, kind: template.kind, skill: template.skill, stations: template.stations, tier: tier.tier, reqLevel: rates.reqLevel.value, inputs: entry.inputs, output: entry.output, durationMs: rates.durationMs.value, xp: rates.xp.value, ...(entry.burntItemId ? { burntItemId: entry.burntItemId } : {}) };
  }, [tier, entry, template, rates, compiled, id]);
  if (!tier || !entry || !template || !rates) return <div className="ws-page"><LoadingRows /></div>;

  const base: Path = ["production", entryIndex];
  const set = (path: Path, value: unknown) => draft.set(previous => {
    const next = setDeep(previous, [...base, ...path], value) as ProgressionTier;
    // Drop an empty adjustments block so the row saves clean.
    const row = next.production[entryIndex]!;
    if (row.adjustments && Object.keys(row.adjustments).length === 0) { const { adjustments: _drop, ...rest } = row; return { ...next, production: next.production.map((candidate, i) => i === entryIndex ? rest : candidate) } as ProgressionTier; }
    return next;
  });
  const openTemplate = () => setTemplateDrawer(template.id);

  return <div className="ws-page"><div className="record">
    <div className="record-main">
      <header className="record-head">
        <Thumb spec={{ kind: "item", id: entry.output.itemId }} size="l" alt="" />
        <div className="record-title"><h1>{entry.name}</h1><Facts items={[`Tier ${tier.tier}`, template.kind, template.skill, stationText(template.stations)]} /><code>{id}</code></div>
      </header>
      {!readOnly && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError} conflict={draft.conflict} onSave={save} onReset={draft.reset} />}
      <Sheet>
        <Section title="Recipe">
          <Row label="Name"><TextInput value={entry.name} disabled={readOnly} ariaLabel="Name" onChange={value => set(["name"], value)} /></Row>
        </Section>
        <Section title="Inputs">
          {entry.inputs.map((input, i) => <Row key={i} label={i === 0 ? "Ingredients" : ""}>
            <ItemPick value={input.itemId} data={data} disabled={readOnly} ariaLabel={`Input ${i + 1} item`} onPick={itemId => set(["inputs", i, "itemId"], itemId)} />
            <span className="muted">×</span>
            <NumberInput value={input.quantity} integer min={1} disabled={readOnly} ariaLabel={`Input ${i + 1} quantity`} onChange={value => set(["inputs", i, "quantity"], value ?? 1)} />
            {!readOnly && <button type="button" className="icon-button" aria-label={`Remove input ${i + 1}`} onClick={() => set(["inputs"], entry.inputs.filter((_, j) => j !== i))}><X size={12} /></button>}
          </Row>)}
          {!readOnly && <Row label={entry.inputs.length ? "" : "Ingredients"}><button type="button" className="button button-small" onClick={() => set(["inputs", entry.inputs.length], { itemId: entry.inputs[0]?.itemId ?? entry.output.itemId, quantity: 1 })}><Plus size={12} /> Add ingredient</button></Row>}
        </Section>
        <Section title="Output">
          <Row label="Makes">
            <ItemPick value={entry.output.itemId} data={data} disabled={readOnly} ariaLabel="Output item" onPick={itemId => set(["output", "itemId"], itemId)} />
            <span className="muted">×</span>
            <NumberInput value={entry.output.quantity} integer min={1} disabled={readOnly} ariaLabel="Output quantity" onChange={value => set(["output", "quantity"], value ?? 1)} />
            <button type="button" className="text-button" onClick={() => navigate("items/catalog", entry.output.itemId)}>Open item <ArrowRight size={11} /></button>
          </Row>
          <Row label="Burnt output" hint="Item produced when cooking fails">
            {entry.burntItemId || !readOnly
              ? <ItemPick value={entry.burntItemId} data={data} disabled={readOnly} ariaLabel="Burnt output item" placeholder="None" onPick={itemId => set(["burntItemId"], itemId)} />
              : <Static muted>None</Static>}
            {entry.burntItemId && !readOnly && <button type="button" className="icon-button" aria-label="Clear burnt output" onClick={() => set(["burntItemId"], undefined)}><X size={12} /></button>}
          </Row>
        </Section>
        <Section title="Rates">
          <Row label="Duration"><Derived derivation={rates.durationMs} unit="ms" readOnly={readOnly} onOverride={value => set(["adjustments", "durationMs"], value)} onOpenSource={openTemplate} /></Row>
          <Row label="XP"><Derived derivation={rates.xp} readOnly={readOnly} onOverride={value => set(["adjustments", "xp"], value)} onOpenSource={openTemplate} /></Row>
          <Row label="Required level"><Derived derivation={rates.reqLevel} readOnly={readOnly} onOverride={value => set(["adjustments", "reqLevel"], value)} /></Row>
          <Row label="Template"><Static><button type="button" className="derived-source" onClick={openTemplate}>{template.name}</button><span className="muted"> · {template.parameters.durationMs} ms · {fmt(template.parameters.xpBase)} + tier × {fmt(template.parameters.xpPerLevel)} xp</span></Static></Row>
          <Row label="Station"><Static>{titleCase(template.skill)} · {stationText(template.stations)}</Static></Row>
        </Section>
      </Sheet>
    </div>
    <aside className="record-rail"><EntitySummary collection="compiled-recipes" record={liveRecord ?? { id }} recordId={id} index={index} navigate={navigate} editing /></aside>
    {templateDrawer && <TemplateDrawer templateId={templateDrawer} data={data} onClose={() => setTemplateDrawer(undefined)} onOpenRecipe={recipeId => { setTemplateDrawer(undefined); navigate("compiled-recipes", recipeId); }} />}
  </div></div>;
}

function setDeep<T>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    if (rest.length === 0 && next === undefined) copy.splice(head as number, 1); else copy[head as number] = setDeep(copy[head as number], rest, next);
    return copy as T;
  }
  const container = (value !== null && typeof value === "object" ? value : typeof head === "number" ? [] : {}) as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...container };
  if (rest.length === 0 && next === undefined) delete copy[String(head)]; else copy[String(head)] = setDeep(copy[String(head)], rest, next);
  return copy as T;
}
