import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Code2, RefreshCw, Sigma } from "lucide-react";
import { toast } from "sonner";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { fieldTitle } from "../model/fields.js";
import { deriveRecord, sameValue, type DerivationDiff } from "../../../game/src/content/balance/derivations.js";
import gearSource from "../../../game/src/content/balance/gear.ts?raw";
import progressionSource from "../../../game/src/content/balance/gearProgression.ts?raw";
import recipesSource from "../../../game/src/content/balance/recipes.ts?raw";
import setsSource from "../../../game/src/content/balance/sets.ts?raw";
import jewelrySource from "../../../game/src/content/balance/jewelry.ts?raw";
import campfiresSource from "../../../game/src/content/balance/campfires.ts?raw";
import itemFormulaSource from "../../../game/src/content/balance/itemFormula.ts?raw";
import materialFoodSource from "../../../game/src/content/balance/materialFood.ts?raw";
import enemiesSource from "../../../game/src/content/balance/enemies.ts?raw";
import "./balance.css";

type Row = Record<string, unknown>;
interface RecomputeResponse { diffs: DerivationDiff[]; revisions: Record<string, string> }
interface RecomputeError { error?: string; diagnostics?: { path: string; message: string }[] }
interface Preview { kind: string; response: RecomputeResponse }
const sourceFiles: Record<string, string> = { gear: gearSource, gearProgression: progressionSource, recipes: recipesSource, sets: setsSource, jewelry: jewelrySource, campfires: campfiresSource, itemFormula: itemFormulaSource, materialFood: materialFoodSource, enemies: enemiesSource };
const modules: Record<string, { kinds: string[] }> = {
  gear: { kinds: ["gear", "itemFormula"] }, gearProgression: { kinds: ["gearProgression"] },
  recipes: { kinds: ["recipeXp", "jewelryRecipe", "campfireFuel", "gearProgression", "itemFormula", "materialFood"] },
  sets: { kinds: ["setThresholds"] }, jewelry: { kinds: ["jewelry", "jewelryRecipe"] },
  campfires: { kinds: ["campfireFuel"] }, itemFormula: { kinds: ["itemFormula"] },
  materialFood: { kinds: ["materialFood"] }, loot: { kinds: ["materialFood"] },
  enemies: { kinds: ['legacyMarks.v1', 'legacyBossCombat.v1'] },
};
const kinds: Record<string, { label: string; collection: string; source: string; params: string[] }> = {
  'legacyMarks.v1': { label: 'Legacy mark rewards', collection: 'enemies', source: 'enemies', params: ['enemies'] },
  'legacyBossCombat.v1': { label: 'Legacy boss combat', collection: 'enemies', source: 'enemies', params: ['enemies'] },
  gear: { label: "Base and rare gear", collection: "items", source: "gear", params: ["gear"] },
  gearProgression: { label: "Regional and wilderness gear", collection: "items", source: "gearProgression", params: ["gearProgression", "recipes"] },
  recipeXp: { label: "Recipe XP and duration", collection: "recipes", source: "recipes", params: ["recipes"] },
  setThresholds: { label: "Armor set bonuses", collection: "equipmentSets", source: "sets", params: ["sets"] },
  jewelry: { label: "Jewelry stats", collection: "items", source: "jewelry", params: ["jewelry"] },
  jewelryRecipe: { label: "Jewelry recipes", collection: "recipes", source: "jewelry", params: ["jewelry", "recipes"] },
  campfireFuel: { label: "Campfire fuel", collection: "campfireFuels", source: "campfires", params: ["campfires", "recipes"] },
  itemFormula: { label: "Tools, boss armor and elemental weapons", collection: "items", source: "itemFormula", params: ["itemFormula", "recipes", "gear"] },
  materialFood: { label: "Food and material values", collection: "items", source: "materialFood", params: ["materialFood", "recipes", "loot"] },
};
function object(value: unknown): Row { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function leaves(value: unknown, prefix = ""): Map<string, unknown> {
  if (value !== null && typeof value === "object" && Object.keys(value).length) return new Map(Object.entries(value).flatMap(([key, entry]) => [...leaves(entry, prefix ? `${prefix}.${key}` : key)]));
  return new Map([[prefix, value]]);
}
function display(value: unknown): string { if (value === undefined) return "Not present"; if (value === null) return "No value"; if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 7 }); if (typeof value === "boolean") return value ? "Yes" : "No"; if (Array.isArray(value)) return value.length ? `${value.length} entries` : "No entries"; if (typeof value === "object") return "No fields"; return String(value); }
function parseExampleNumber(raw: string, options: { label: string; integer?: boolean; minimum: number; exclusiveMinimum?: boolean }): { value?: number; error: string } {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) return { error: `Enter a finite ${options.label}.` };
  if (options.integer && !Number.isInteger(value)) return { error: `Enter a whole-number ${options.label}.` };
  if (options.exclusiveMinimum ? value <= options.minimum : value < options.minimum) {
    return { error: options.exclusiveMinimum ? `Enter a ${options.label} greater than ${options.minimum}.` : `Enter a ${options.label} of ${options.minimum} or higher.` };
  }
  return { value, error: "" };
}

export default function BalancePanel({ collection, recordId }: { collection: string; recordId?: string }) {
  const name = collection.replace(/^balance\//, "");
  const module = modules[name];
  if (!module) return <section className="balance-panel"><div className="balance-heading"><Sigma size={19}/><div><h2>{fieldTitle(name)} parameters</h2><p>No standalone formula module is registered for this parameter file. Its saved values are available in Overview and Edit.</p></div></div></section>;
  return <SupportedPanel key={collection} collection={collection} moduleName={name} recordId={recordId} supportedKinds={module.kinds}/>;
}

function SupportedPanel({ collection, moduleName, recordId, supportedKinds }: { collection: string; moduleName: string; recordId?: string; supportedKinds: string[] }) {
  const [kind, setKind] = useState(supportedKinds[0]!);
  const [exampleId, setExampleId] = useState("");
  const [tier, setTier] = useState<number | undefined>();
  const [tierText, setTierText] = useState<string>();
  const [tierError, setTierError] = useState("");
  const [bossMultiplier, setBossMultiplier] = useState<number | undefined>();
  const [bossMultiplierText, setBossMultiplierText] = useState<string>();
  const [bossMultiplierError, setBossMultiplierError] = useState("");
  const [shape, setShape] = useState<string | undefined>();
  const config = kinds[kind]!;
  const records = useQuery(collectionQuery(config.collection));
  const params = useQueries({ queries: config.params.map(name => collectionQuery(`balance/${name}`)) });
  const examples = useMemo(() => records.data ? contentRows(records.data).filter(record => object(record.derivation).kind === kind) : [], [records.data, kind]);
  const idKey = records.data?.collection.idKey ?? "id";
  const selected = examples.find(record => rowId(record, idKey) === exampleId) ?? examples[0];
  const activeId = selected ? rowId(selected, idKey) : "";
  const sourceNames = [...new Set([moduleName, config.source, ...config.params])];
  const [sourceName, setSourceName] = useState(moduleName);
  const currentSource = sourceNames.includes(sourceName) ? sourceName : moduleName;
  const enemyParameters = params[0]?.data?.data;
  const enemyInput = useMemo(() => {
    if (!selected || !["legacyMarks.v1", "legacyBossCombat.v1"].includes(kind)) return undefined;
    const inputTag = object(selected.derivation);
    const inputKey = kind === "legacyMarks.v1" ? "legacyMarksInputs" : "legacyBossInputs";
    const entries = object(enemyParameters)[inputKey];
    if (!Array.isArray(entries)) return undefined;
    const found = entries.find(entry => object(entry).id === inputTag.inputId);
    return found && typeof found === "object" && !Array.isArray(found) ? found as Row : undefined;
  }, [enemyParameters, kind, selected]);
  const enemyTarget = useMemo(() => {
    if (kind !== "legacyBossCombat.v1" || !enemyInput) return undefined;
    const targets = object(object(enemyParameters).regionalBossLevels);
    const target = targets[String(enemyInput.bossId)];
    return target && typeof target === "object" && !Array.isArray(target) ? target as Row : undefined;
  }, [enemyInput, enemyParameters, kind]);
  const example = useMemo(() => {
    if (!selected) return undefined;
    if (params.some(query => query.isPending)) return { loading: true };
    if (params.some(query => query.isError)) return { error: "The formula parameters could not be loaded. Retry to calculate this example." };
    if (tierError) return { error: tierError };
    if (bossMultiplierError) return { error: bossMultiplierError };
    const input = structuredClone(selected);
    const tag = object(input.derivation);
    let originalInput: Row | undefined;
    let originalTarget: Row | undefined;
    const parameterSnapshot = ["legacyMarks.v1", "legacyBossCombat.v1"].includes(kind) && enemyParameters !== undefined
      ? structuredClone(enemyParameters) : undefined;
    if (parameterSnapshot !== undefined) {
      const enemyBalance = object(parameterSnapshot);
      const inputKey = kind === "legacyMarks.v1" ? "legacyMarksInputs" : "legacyBossInputs";
      const entries = enemyBalance[inputKey];
      if (Array.isArray(entries)) {
        const sourceInput = entries.find(entry => object(entry).id === tag.inputId);
        if (sourceInput && typeof sourceInput === "object" && !Array.isArray(sourceInput)) {
          originalInput = structuredClone(sourceInput as Row);
          if (kind === "legacyMarks.v1" && tier !== undefined) {
            enemyBalance.legacyMarksInputs = entries.map(entry => object(entry).id === tag.inputId ? { ...object(entry), tier } : entry);
          }
          if (kind === "legacyBossCombat.v1") {
            const targetKey = String(originalInput.bossId);
            const targets = object(enemyBalance.regionalBossLevels);
            const sourceTarget = targets[targetKey];
            if (sourceTarget && typeof sourceTarget === "object" && !Array.isArray(sourceTarget)) {
              originalTarget = structuredClone(sourceTarget as Row);
              if (bossMultiplier !== undefined) {
                enemyBalance.regionalBossLevels = { ...targets, [targetKey]: { ...object(sourceTarget), multiplier: bossMultiplier } };
              }
            }
          }
        }
      }
    }
    if (tier !== undefined) { if (["jewelry", "jewelryRecipe"].includes(kind)) tag.tier = tier; else if (kind === "gearProgression") tag.ladderTier = tier; else if (!["legacyMarks.v1", "legacyBossCombat.v1"].includes(kind)) input.tier = tier; }
    if (shape !== undefined) tag.shape = shape;
    try {
      const tables = new Map(params.flatMap(query => query.data ? [[query.data.collection.name, query.data.data] as const] : []));
      if (parameterSnapshot !== undefined) tables.set("balance/enemies", parameterSnapshot);
      if (records.data) tables.set(config.collection, records.data.data);
      const output = deriveRecord(config.collection, input, tables);
      if (!output) return { error: "This record has no formula link." };
      return { input, output, changed: !sameValue(Object.fromEntries(Object.keys(output).map(key => [key, selected[key]])), output), originalInput, originalTarget };
    } catch (error) { return { error: error instanceof Error ? error.message : "This example could not be calculated." }; }
  }, [selected, params, tier, tierError, shape, kind, config.collection, enemyParameters, bossMultiplier, bossMultiplierError, records.data]);
  const tag = object(selected?.derivation);
  const canAdjustTier = ["recipeXp", "setThresholds", "jewelry", "jewelryRecipe", "campfireFuel", "gearProgression"].includes(kind);
  const canAdjustLegacyMarksTier = kind === "legacyMarks.v1";
  const canAdjustBossMultiplier = kind === "legacyBossCombat.v1";
  const originalInputTier = typeof enemyInput?.tier === "number" && Number.isFinite(enemyInput.tier) ? enemyInput.tier : undefined;
  const shownTier = tier ?? (kind === "legacyMarks.v1" ? originalInputTier : Number(kind === "gearProgression" ? tag.ladderTier : ["jewelry", "jewelryRecipe"].includes(kind) ? tag.tier : selected?.tier ?? 1));
  const originalBossMultiplier = typeof enemyTarget?.multiplier === "number" && Number.isFinite(enemyTarget.multiplier) ? enemyTarget.multiplier : undefined;
  const shownBossMultiplier = bossMultiplier ?? originalBossMultiplier;
  const tierOptions = useMemo(() => {
    if (kind === "setThresholds") return (object(params[0]?.data?.data).byTier as Row[] | undefined)?.map(row => Number(row.tier));
    if (["jewelry", "jewelryRecipe"].includes(kind)) return (object(object(params[0]?.data?.data)[String(tag.variant ?? "crafted")]).profiles as Row[] | undefined)?.map(row => Number(row.tier));
    if (kind === "gearProgression") return tag.catalog === "REGIONAL_TIER_ITEMS" ? [30, 40, 60] : [50, 70];
    return undefined;
  }, [kind, params, tag.variant, tag.catalog]);
  useEffect(() => {
    setTier(undefined); setTierText(undefined); setTierError(""); setBossMultiplier(undefined); setBossMultiplierText(undefined); setBossMultiplierError(""); setShape(undefined);
  }, [activeId, kind]);
  const resetExample = () => { setTier(undefined); setTierText(undefined); setTierError(""); setBossMultiplier(undefined); setBossMultiplierText(undefined); setBossMultiplierError(""); setShape(undefined); };
  return <section className="balance-panel"><div className="balance-heading"><Sigma size={19}/><div><h2>Formula and affected records</h2><p>{recordId ? `Inspecting ${fieldTitle(recordId).toLowerCase()}. ` : ""}Examples use the saved parameters. Recompute previews changes before applying them.</p></div></div><div className="balance-selector"><label>Formula<select value={kind} onChange={event => { setKind(event.target.value); setExampleId(""); resetExample(); }}>{supportedKinds.map(key => <option key={key} value={key}>{kinds[key]!.label}</option>)}</select></label><span className="balance-source-label">{collection}</span></div><section className="balance-example"><div className="section-heading"><h3>Worked example</h3><span>Local calculation</span></div>{records.isPending ? <p role="status" className="balance-muted">Loading linked records…</p> : records.isError ? <p role="alert" className="balance-message">{records.error.message} <button type="button" className="text-button" onClick={() => void records.refetch()}>Retry</button></p> : !examples.length ? <p className="balance-muted">No records are currently linked to this formula. Source code is available below.</p> : <><div className="balance-example-controls"><label>Example record<select value={activeId} onChange={event => { setExampleId(event.target.value); resetExample(); }}>{examples.map(record => <option key={rowId(record, idKey)} value={rowId(record, idKey)}>{rowName(record, idKey)}</option>)}</select></label>{canAdjustLegacyMarksTier && <label>Example input tier<input aria-label="Example input tier" type="number" min={1} step={1} value={tierText ?? (shownTier !== undefined ? shownTier : "")} onChange={event => { const raw = event.currentTarget.value; setTierText(raw); const parsed = parseExampleNumber(raw, { label: "input tier", integer: true, minimum: 1 }); setTier(parsed.value); setTierError(parsed.error); }}/>{tierError && <span role="alert">{tierError}</span>}</label>}{canAdjustBossMultiplier && <label>Example boss target multiplier<input aria-label="Example boss target multiplier" type="number" min={0} step="any" value={bossMultiplierText ?? (shownBossMultiplier !== undefined ? shownBossMultiplier : "")} onChange={event => { const raw = event.currentTarget.value; setBossMultiplierText(raw); const parsed = parseExampleNumber(raw, { label: "target multiplier", minimum: 0, exclusiveMinimum: true }); setBossMultiplier(parsed.value); setBossMultiplierError(parsed.error); }}/>{bossMultiplierError && <span role="alert">{bossMultiplierError}</span>}</label>}{canAdjustTier && <label>Example tier{tierOptions ? <select value={shownTier} onChange={event => { setTier(Number(event.target.value)); setTierText(undefined); setTierError(""); }}>{tierOptions.map(value => <option key={value} value={value}>{value}</option>)}</select> : <><input aria-label="Example tier" type="number" min={1} step={1} value={tierText ?? (shownTier !== undefined ? shownTier : "")} onChange={event => { const raw = event.currentTarget.value; setTierText(raw); const parsed = parseExampleNumber(raw, { label: "tier", integer: true, minimum: 1 }); setTier(parsed.value); setTierError(parsed.error); }}/>{tierError && <span role="alert">{tierError}</span>}</>}</label>}{["jewelry", "jewelryRecipe"].includes(kind) && <label>Shape<select value={shape ?? String(tag.shape)} onChange={event => setShape(event.target.value)}><option value="ring">Ring</option><option value="earring">Earring</option></select></label>}{(tier !== undefined || bossMultiplier !== undefined || shape !== undefined || tierError || bossMultiplierError) && <button className="text-button" type="button" onClick={resetExample}>Reset inputs</button>}</div><p className="balance-example-note">Changing example inputs does not save or alter the recompute selection.</p>{example && "loading" in example ? <p role="status" className="balance-muted">Loading parameters…</p> : example && "error" in example ? <p role="alert" className="balance-message">{example.error} <button type="button" className="text-button" onClick={() => params.forEach(query => void query.refetch())}>Reload parameters</button></p> : example && "output" in example && <div className="balance-example-result"><div><h4>Formula input</h4><ValueRows value={{ record: activeId, ...object(example.input.derivation), ...(example.originalInput ? { input: example.originalInput } : {}), ...(example.originalTarget ? { target: example.originalTarget } : {}), ...(["recipeXp", "campfireFuel", "setThresholds"].includes(kind) ? { tier: example.input.tier } : {}) }}/></div><div><h4>Calculated fields</h4><ValueRows value={example.output}/><p className="balance-example-note">{tier !== undefined || bossMultiplier !== undefined || shape !== undefined ? "Result for your example inputs." : example.changed ? "The saved record differs from these formula values. Preview recompute to inspect the changes." : "These values match the saved record."}</p></div></div>}</>}</section><RecomputeControls key={kind} kind={kind}/><section className="balance-source"><div className="section-heading"><h3><Code2 size={16}/> Formula source</h3><label className="sr-only" htmlFor={`source-${moduleName}`}>Source file</label><select id={`source-${moduleName}`} value={currentSource} onChange={event => setSourceName(event.target.value)}>{sourceNames.filter(name => sourceFiles[name]).map(name => <option key={name} value={name}>{name}.ts</option>)}</select></div><HighlightedSource source={sourceFiles[currentSource] ?? ""}/></section></section>;
}

function ValueRows({ value }: { value: unknown }) { return <dl className="balance-values">{[...leaves(value)].map(([key, entry]) => <div key={key}><dt>{key}</dt><dd>{display(entry)}</dd></div>)}</dl>; }

function RecomputeControls({ kind }: { kind: string }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<number>();
  const [visible, setVisible] = useState(30);
  async function request(operation: "preview" | "apply") {
    if (busy || (operation === "apply" && (!preview || stale || !preview.response.diffs.length))) return;
    setBusy(operation); setError("");
    try {
      const response = await fetch("/__devdocs/recompute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operation === "preview" ? { operation, kind } : { operation, kind: preview!.kind, revisions: preview!.response.revisions }) });
      const body = await response.json() as RecomputeResponse & RecomputeError;
      if (!response.ok) {
        setStale(true);
        const diagnostics = body.diagnostics?.map(issue => `${issue.path}: ${issue.message}`).join("; ");
        setError(response.status === 409 ? "Content changed after this preview. The preview is kept for comparison. Refresh it before applying changes." : [body.error ?? "Recompute failed.", diagnostics].filter(Boolean).join(" "));
        return;
      }
      if (!Array.isArray(body.diffs) || !body.revisions) throw new Error("The server returned an incomplete preview. Refresh before applying changes.");
      if (operation === "preview") { setPreview({ kind, response: body }); setStale(false); setApplied(undefined); setVisible(30); }
      else {
        setApplied(body.diffs.length); setStale(true);
        await Promise.all([...new Set(body.diffs.map(diff => diff.collection))].map(collection => queryClient.invalidateQueries({ queryKey: collectionQuery(collection).queryKey })));
        toast.success(`Updated ${body.diffs.length} record${body.diffs.length === 1 ? "" : "s"}`);
      }
    } catch (failure) { setStale(true); setError(failure instanceof Error ? failure.message : "The recompute request failed. Your preview has been kept."); }
    finally { setBusy(undefined); }
  }
  const diffs = preview?.response.diffs ?? [];
  return <section className="balance-recompute"><div className="section-heading"><div><h3>Recompute linked records</h3><p className="balance-muted">Applies saved parameters to {kinds[kind]?.label.toLowerCase() ?? kind}. Authored fields outside the formula stay unchanged.</p></div><button className="button" type="button" disabled={Boolean(busy)} onClick={() => void request("preview")}><RefreshCw size={14}/>{busy === "preview" ? "Calculating…" : preview ? "Refresh preview" : "Preview changes"}</button></div>{error && <p role="alert" className="balance-message">{error}</p>}{applied !== undefined && <p className="balance-applied" role="status"><Check size={15}/>Applied changes to {applied} records. Refresh the preview to check for remaining differences.</p>}{!preview && !error && <p className="balance-muted">No preview yet. Calculating a preview does not write any content.</p>}{preview && !diffs.length && <p className="balance-empty" role="status"><Check size={17}/>No differences. Records linked to this formula already match the saved parameters.</p>}{preview && diffs.length > 0 && <><div className="balance-preview-summary"><p><strong>{diffs.length}</strong> record{diffs.length === 1 ? "" : "s"} in <strong>{new Set(diffs.map(diff => diff.collection)).size}</strong> collection{new Set(diffs.map(diff => diff.collection)).size === 1 ? "" : "s"}</p><span>Before <ArrowRight size={13}/> After</span></div><div className="balance-diffs">{diffs.slice(0, visible).map(diff => <DiffRecord key={`${diff.collection}:${diff.recordId}`} diff={diff}/>)}</div>{visible < diffs.length && <button type="button" className="text-button balance-show-more" onClick={() => setVisible(current => current + 30)}>Show {Math.min(30, diffs.length - visible)} more records</button>}<div className="balance-apply"><p>Apply the reviewed changes to all {diffs.length} records listed in this preview.</p><button type="button" className="button balance-apply-button" disabled={Boolean(busy) || stale} onClick={() => void request("apply")}>{busy === "apply" ? "Applying…" : `Apply changes to ${diffs.length} records`}</button></div></>}</section>;
}

function DiffRecord({ diff }: { diff: DerivationDiff }) {
  const before = leaves(diff.before);
  const after = leaves(diff.after);
  const changes = [...new Set([...before.keys(), ...after.keys()])].filter(key => !sameValue(before.get(key), after.get(key)));
  return <details className="balance-diff" open><summary><span><code>{diff.recordId}</code><small>{diff.collection}{diff.inputIds?.length ? ` - Input IDs: ${diff.inputIds.join(", ")}` : ""}</small></span><span>{changes.length} field{changes.length === 1 ? "" : "s"}</span></summary><div className="balance-diff-scroll"><table><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>{changes.map(key => <tr key={key}><th scope="row">{key}</th><td>{display(before.get(key))}</td><td>{display(after.get(key))}</td></tr>)}</tbody></table></div></details>;
}

function HighlightedSource({ source }: { source: string }) {
  const [html, setHtml] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; setHtml(""); setFailed(false);
    void import("./highlightFormula.js").then(module => module.highlightFormula(source)).then(result => { if (active) setHtml(result); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [source]);
  return <div className="balance-code">{html ? <div dangerouslySetInnerHTML={{ __html: html }}/> : <><p className="balance-source-status">{failed ? "Syntax highlighting is unavailable. Source text is shown below." : "Highlighting source…"}</p><pre><code>{source}</code></pre></>}</div>;
}
