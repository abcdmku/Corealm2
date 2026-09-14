import enemyWildernessSource from '../../../game/src/content/balance/enemyWildernessSources.ts?raw';
import enemyDescendantSource from '../../../game/src/content/balance/enemyDescendantSources.ts?raw';
import descendantLootSource from '../../../game/src/content/balance/descendantLoot.ts?raw';
import actorLootSource from '../../../game/src/content/balance/actorLoot.ts?raw';
import sourceLootSource from '../../../game/src/content/balance/sourceLoot.ts?raw';
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
import enemySourcesSource from "../../../game/src/content/balance/enemySources.ts?raw";
import enemyVariantsSource from "../../../game/src/content/balance/enemySourceVariants.ts?raw";
import enemyActorSourcesSource from "../../../game/src/content/balance/enemyActorSources.ts?raw";
import "./balance.css";

type Row = Record<string, unknown>;
interface RecomputeResponse { diffs: DerivationDiff[]; revisions: Record<string, string> }
interface RecomputeError { error?: string; diagnostics?: { path: string; message: string }[] }
interface Preview { kind: string; response: RecomputeResponse }
const sourceFiles: Record<string, string> = { descendantLoot: descendantLootSource, enemyWildernessSources: enemyWildernessSource, enemyDescendantSources: enemyDescendantSource, actorLoot: actorLootSource, sourceLoot: sourceLootSource, gear: gearSource, gearProgression: progressionSource, recipes: recipesSource, sets: setsSource, jewelry: jewelrySource, campfires: campfiresSource, itemFormula: itemFormulaSource, materialFood: materialFoodSource, enemies: enemiesSource, enemySources: enemySourcesSource, enemySourceVariants: enemyVariantsSource, enemyActorSources: enemyActorSourcesSource };
const modules: Record<string, { kinds: string[] }> = {
  gear: { kinds: ["gear", "itemFormula"] }, gearProgression: { kinds: ["gearProgression"] },
  recipes: { kinds: ["recipeXp", "jewelryRecipe", "campfireFuel", "gearProgression", "itemFormula", "materialFood"] },
  sets: { kinds: ["setThresholds"] }, jewelry: { kinds: ["jewelry", "jewelryRecipe"] },
  campfires: { kinds: ["campfireFuel"] }, itemFormula: { kinds: ["itemFormula"] },
  materialFood: { kinds: ["materialFood"] }, loot: { kinds: ["sourceLoot.v1", "materialFood"] },
  enemies: { kinds: ['legacyMarks.v1', 'legacyBossCombat.v1', 'sourceEnemy.v1', 'fantasyScale.v1'] },
};
const kinds: Record<string, { label: string; collection: string; source: string; params: string[]; collections?: string[] }> = {
  'sourceLoot.v1': { label: 'Original creature loot', collection: 'lootTables', source: 'sourceLoot', params: ['loot'], collections: ['craftingTiers'] },
  'sourceEnemy.v1': { label: 'Original creature sources', collection: 'enemies', source: 'enemySources', params: ['enemies'] },
  'fantasyScale.v1': { label: 'Fantasy tier scaling', collection: 'enemies', source: 'enemySourceVariants', params: ['enemies'] },
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
function parseExampleNumber(raw: string, options: { label: string; integer?: boolean; minimum: number; exclusiveMinimum?: boolean; maximum?: number; allowed?: readonly number[] }): { value?: number; error: string } {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) return { error: `Enter a finite ${options.label}.` };
  if (options.integer && !Number.isInteger(value)) return { error: `Enter a whole-number ${options.label}.` };
  if (options.exclusiveMinimum ? value <= options.minimum : value < options.minimum) {
    return { error: options.exclusiveMinimum ? `Enter a ${options.label} greater than ${options.minimum}.` : `Enter a ${options.label} of ${options.minimum} or higher.` };
  }
  if (options.maximum !== undefined && value > options.maximum) return { error: `Enter a ${options.label} no greater than ${options.maximum}.` };
  if (options.allowed && !options.allowed.includes(value)) return { error: `Choose a ${options.label} from ${options.allowed.join(", ")}.` };
  return { value, error: "" };
}
function finiteNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function findInput(parameters: unknown, key: string, id: unknown): Row | undefined {
  const entries = object(parameters)[key];
  if (!Array.isArray(entries)) return undefined;
  const found = entries.find(entry => object(entry).id === id);
  return found && typeof found === "object" && !Array.isArray(found) ? found as Row : undefined;
}
interface LootChanceTarget { path: string[]; value: number }
function lootChanceTarget(parameters: unknown, inputId: unknown): LootChanceTarget | undefined {
  const inputs = object(parameters).sourceInputs;
  if (!Array.isArray(inputs)) return undefined;
  const rows = new Map(inputs.flatMap(entry => { const row = object(entry); return typeof row.id === "string" ? [[row.id, row] as const] : []; }));
  const visit = (id: string, seen = new Set<string>()): LootChanceTarget | undefined => {
    if (seen.has(id)) return undefined;
    const input = rows.get(id);
    if (!input) return undefined;
    const nextSeen = new Set(seen).add(id);
    const kind = input.kind;
    if (kind === "inherit" && typeof input.sourceInputId === "string") return visit(input.sourceInputId, nextSeen);
    const actorLoot = object(object(parameters).actorLootParameters);
    if (kind === "fairy") return { path: ["actorLootParameters", "fairy", "earth", "roll", "chance"], value: finiteNumber(object(object(object(actorLoot.fairy).earth).roll).chance) ?? 0 };
    if (kind === "universalJewelry") return { path: ["actorLootParameters", "universalJewelry", "totalChance"], value: finiteNumber(object(actorLoot.universalJewelry).totalChance) ?? 0 };
    const sourceLoot = object(object(parameters).sourceLoot);
    if (kind === "starter") return { path: ["sourceLoot", "starter", "chance"], value: finiteNumber(object(sourceLoot.starter).chance) ?? 0 };
    if (kind === "rpg") {
      const role = input.role === "caster" ? "caster" : "other";
      return { path: ["sourceLoot", "rpg", "chance", role], value: finiteNumber(object(object(sourceLoot.rpg).chance)[role]) ?? 0 };
    }
    if (kind === "variantAppend") return { path: ["sourceLoot", "variantAppend", "chance"], value: finiteNumber(object(sourceLoot.variantAppend).chance) ?? 0 };
    if (kind === "redesignEssence" && typeof input.profile === "string") {
      return { path: ["sourceLoot", "redesignEssence", input.profile, "chance"], value: finiteNumber(object(object(sourceLoot.redesignEssence)[input.profile]).chance) ?? 0 };
    }
    return undefined;
  };
  return typeof inputId === "string" ? visit(inputId) : undefined;
}
function replacePath(root: Row, path: readonly string[], value: unknown): void {
  let cursor = root;
  path.forEach((key, index) => {
    if (index === path.length - 1) cursor[key] = value;
    else { cursor[key] = { ...object(cursor[key]) }; cursor = cursor[key] as Row; }
  });
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
  const [localNumber, setLocalNumber] = useState<number | undefined>();
  const [localNumberText, setLocalNumberText] = useState<string>();
  const [localNumberError, setLocalNumberError] = useState("");
  const [shape, setShape] = useState<string | undefined>();
  const config = kinds[kind]!;
  const records = useQuery(collectionQuery(config.collection));
  const params = useQueries({ queries: [...config.params.map(name => collectionQuery(`balance/${name}`)), ...(config.collections ?? []).map(name => collectionQuery(name))] });
  const examples = useMemo(() => records.data ? contentRows(records.data).filter(record => object(record.derivation).kind === kind) : [], [records.data, kind]);
  const idKey = records.data?.collection.idKey ?? "id";
  const selected = examples.find(record => rowId(record, idKey) === exampleId) ?? examples[0];
  const activeId = selected ? rowId(selected, idKey) : "";
  const sourceNames = [...new Set([moduleName, config.source, ...config.params, ...(kind === 'sourceEnemy.v1' ? ['enemySourceVariants', 'enemyActorSources', 'enemyWildernessSources', 'enemyDescendantSources'] : []), ...(kind === 'sourceLoot.v1' ? ['actorLoot', 'descendantLoot'] : [])])];
  const [sourceName, setSourceName] = useState(moduleName);
  const sourceFallback = sourceFiles[moduleName] ? moduleName : sourceNames.find(name => sourceFiles[name]) ?? moduleName;
  const currentSource = sourceFiles[sourceName] ? sourceName : sourceFallback;
  const enemyParameters = params[0]?.data?.data;
  const enemyInput = useMemo(() => {
    if (!selected || !["legacyMarks.v1", "legacyBossCombat.v1"].includes(kind)) return undefined;
    const inputTag = object(selected.derivation);
    const inputKey = kind === "legacyMarks.v1" ? "legacyMarksInputs" : "legacyBossInputs";
    return findInput(enemyParameters, inputKey, inputTag.inputId);
  }, [enemyParameters, kind, selected]);
  const enemyTarget = useMemo(() => {
    if (kind !== "legacyBossCombat.v1" || !enemyInput) return undefined;
    const targets = object(object(enemyParameters).regionalBossLevels);
    const target = targets[String(enemyInput.bossId)];
    return target && typeof target === "object" && !Array.isArray(target) ? target as Row : undefined;
  }, [enemyInput, enemyParameters, kind]);
  const sourceFormulaInput = useMemo(() => {
    if (!selected) return undefined;
    const inputTag = object(selected.derivation);
    if (kind === "sourceEnemy.v1" || kind === "fantasyScale.v1") return findInput(enemyParameters, "sourceInputs", kind === "fantasyScale.v1" ? inputTag.sourceInputId : inputTag.inputId);
    if (kind === "sourceLoot.v1") return findInput(enemyParameters, "sourceInputs", inputTag.inputId);
    return undefined;
  }, [enemyParameters, kind, selected]);
  const lootChance = useMemo(() => kind === "sourceLoot.v1" ? lootChanceTarget(enemyParameters, object(selected?.derivation).inputId) : undefined, [enemyParameters, kind, selected]);
  const example = useMemo(() => {
    if (!selected) return undefined;
    if (params.some(query => query.isPending)) return { loading: true };
    if (params.some(query => query.isError)) return { error: "The formula parameters could not be loaded. Retry to calculate this example." };
    if (tierError) return { error: tierError };
    if (bossMultiplierError) return { error: bossMultiplierError };
    if (localNumberError) return { error: localNumberError };
    const input = structuredClone(selected);
    const tag = object(input.derivation);
    let originalInput: Row | undefined;
    let originalTarget: Row | undefined;
    let exampleOverrides: Row | undefined;
    const parameterSnapshot = ["legacyMarks.v1", "legacyBossCombat.v1", "sourceEnemy.v1", "fantasyScale.v1", "sourceLoot.v1"].includes(kind) && enemyParameters !== undefined
      ? structuredClone(enemyParameters) : undefined;
    if (parameterSnapshot !== undefined) {
      const localParameters = object(parameterSnapshot);
      if (["legacyMarks.v1", "legacyBossCombat.v1"].includes(kind)) {
        const inputKey = kind === "legacyMarks.v1" ? "legacyMarksInputs" : "legacyBossInputs";
        const sourceInput = findInput(localParameters, inputKey, tag.inputId);
        if (sourceInput) {
          originalInput = structuredClone(sourceInput);
          if (kind === "legacyMarks.v1" && tier !== undefined) {
            const entries = localParameters[inputKey];
            if (Array.isArray(entries)) localParameters[inputKey] = entries.map(entry => object(entry).id === tag.inputId ? { ...object(entry), tier } : entry);
            exampleOverrides = { path: "input.tier", value: tier };
          }
          if (kind === "legacyBossCombat.v1") {
            const targetKey = String(originalInput.bossId);
            const targets = object(localParameters.regionalBossLevels);
            const sourceTarget = targets[targetKey];
            if (sourceTarget && typeof sourceTarget === "object" && !Array.isArray(sourceTarget)) {
              originalTarget = structuredClone(sourceTarget as Row);
              if (bossMultiplier !== undefined) {
                localParameters.regionalBossLevels = { ...targets, [targetKey]: { ...object(sourceTarget), multiplier: bossMultiplier } };
                exampleOverrides = { path: "target.multiplier", value: bossMultiplier };
              }
            }
          }
        }
      } else if (kind === "sourceEnemy.v1" || kind === "fantasyScale.v1") {
        const sourceInput = findInput(localParameters, "sourceInputs", kind === "fantasyScale.v1" ? tag.sourceInputId : tag.inputId);
        if (sourceInput) {
          originalInput = structuredClone(sourceInput);
          if (kind === "sourceEnemy.v1" && localNumber !== undefined) {
            const sourceKind = sourceInput.kind;
            if (sourceKind === "universal" || sourceKind === "fairy" || sourceKind === "garden") {
              const actorSourceParameters = object(localParameters.actorSourceParameters);
              const actorParameters = object(actorSourceParameters[sourceKind]);
              if (sourceKind === "universal") {
                localParameters.actorSourceParameters = { ...actorSourceParameters,
                  universal: { ...actorParameters, targetLevelMultiplier: localNumber } };
                exampleOverrides = { path: "actorSourceParameters.universal.targetLevelMultiplier", value: localNumber };
              } else {
                localParameters.actorSourceParameters = { ...actorSourceParameters,
                  [sourceKind]: { ...actorParameters, template: { ...object(actorParameters.template), maxHealth: localNumber } } };
                exampleOverrides = { path: `actorSourceParameters.${sourceKind}.template.maxHealth`, value: localNumber };
              }
            } else {
              const entries = localParameters.sourceInputs;
              if (Array.isArray(entries)) {
                localParameters.sourceInputs = entries.map(entry => {
                  const row = object(entry);
                  if (row.id !== tag.inputId) return entry;
                  if (sourceKind === "expansion") return { ...row, authored: { ...object(row.authored), maxHealth: localNumber } };
                  if (sourceKind === "rpg") return row;
                  return { ...row, health: localNumber };
                });
              }
              if (sourceKind === "expansion") exampleOverrides = { path: "input.authored.maxHealth", value: localNumber };
              else if (sourceKind === "rpg") {
                const sourceParameters = object(localParameters.sourceParameters);
                localParameters.sourceParameters = { ...sourceParameters, rpg: { ...object(sourceParameters.rpg), healthBase: localNumber } };
                exampleOverrides = { path: "sourceParameters.rpg.healthBase", value: localNumber };
              } else exampleOverrides = { path: "input.health", value: localNumber };
            }
          }
          if (kind === "fantasyScale.v1" && localNumber !== undefined) {
            tag.tier = localNumber;
            const family = typeof input.family === "string" ? input.family : String(input.id).replace(/_t\d+$/, "");
            input.id = `${family}_t${localNumber}`;
            exampleOverrides = { path: "derivation.tier", value: localNumber };
          }
        }
      } else if (kind === "sourceLoot.v1") {
        const sourceInput = findInput(localParameters, "sourceInputs", tag.inputId);
        if (sourceInput) originalInput = structuredClone(sourceInput);
        const chance = lootChanceTarget(localParameters, tag.inputId);
        if (chance && localNumber !== undefined) {
          replacePath(localParameters, chance.path, localNumber);
          exampleOverrides = { path: chance.path.join("."), value: localNumber };
        }
      }
    }
    if (tier !== undefined) { if (["jewelry", "jewelryRecipe"].includes(kind)) tag.tier = tier; else if (kind === "gearProgression") tag.ladderTier = tier; else if (!["legacyMarks.v1", "legacyBossCombat.v1", "sourceEnemy.v1", "fantasyScale.v1", "sourceLoot.v1"].includes(kind)) input.tier = tier; }
    if (shape !== undefined) tag.shape = shape;
    try {
      const tables = new Map(params.flatMap(query => query.data ? [[query.data.collection.name, query.data.data] as const] : []));
      if (parameterSnapshot !== undefined && config.params[0]) tables.set(`balance/${config.params[0]}`, parameterSnapshot);
      if (records.data) tables.set(config.collection, records.data.data);
      const output = deriveRecord(config.collection, input, tables);
      if (!output) return { error: "This record has no formula link." };
      return { input, output, changed: !sameValue(Object.fromEntries(Object.keys(output).map(key => [key, selected[key]])), output), originalInput, originalTarget, exampleOverrides };
    } catch (error) { return { error: error instanceof Error ? error.message : "This example could not be calculated." }; }
  }, [selected, params, tier, tierError, shape, kind, config.collection, enemyParameters, bossMultiplier, bossMultiplierError, localNumber, localNumberError, records.data]);
  const tag = object(selected?.derivation);
  const canAdjustTier = ["recipeXp", "setThresholds", "jewelry", "jewelryRecipe", "campfireFuel", "gearProgression"].includes(kind);
  const canAdjustLegacyMarksTier = kind === "legacyMarks.v1";
  const canAdjustBossMultiplier = kind === "legacyBossCombat.v1";
  const originalInputTier = typeof enemyInput?.tier === "number" && Number.isFinite(enemyInput.tier) ? enemyInput.tier : undefined;
  const shownTier = tier ?? (kind === "legacyMarks.v1" ? originalInputTier : Number(kind === "gearProgression" ? tag.ladderTier : ["jewelry", "jewelryRecipe"].includes(kind) ? tag.tier : selected?.tier ?? 1));
  const originalBossMultiplier = typeof enemyTarget?.multiplier === "number" && Number.isFinite(enemyTarget.multiplier) ? enemyTarget.multiplier : undefined;
  const shownBossMultiplier = bossMultiplier ?? originalBossMultiplier;
  const sourceInputKind = typeof sourceFormulaInput?.kind === "string" ? sourceFormulaInput.kind : undefined;
  const enemySourceParameters = object(object(enemyParameters).sourceParameters);
  const actorSourceParameters = object(object(enemyParameters).actorSourceParameters);
  const sourceHealth = sourceInputKind === "expansion" ? finiteNumber(object(sourceFormulaInput?.authored).maxHealth)
    : sourceInputKind === "rpg" ? finiteNumber(object(enemySourceParameters.rpg).healthBase)
    : finiteNumber(sourceFormulaInput?.health);
  const actorTargetLevelMultiplier = sourceInputKind === "universal" ? finiteNumber(object(actorSourceParameters.universal).targetLevelMultiplier) : undefined;
  const actorTemplateHealth = sourceInputKind === "fairy" || sourceInputKind === "garden"
    ? finiteNumber(object(object(actorSourceParameters[sourceInputKind]).template).maxHealth) : undefined;
  const fantasyBaseTier = finiteNumber(sourceFormulaInput?.tier);
  const fantasyTiers = useMemo(() => {
    const values = object(object(enemyParameters).fantasy).tiers;
    return Array.isArray(values) ? values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value !== fantasyBaseTier) : [];
  }, [enemyParameters, fantasyBaseTier]);
  const fantasyTargetTier = finiteNumber(tag.tier);
  const shownLocalNumber = localNumber ?? (kind === "sourceEnemy.v1" ? sourceHealth ?? actorTargetLevelMultiplier ?? actorTemplateHealth : kind === "fantasyScale.v1" ? fantasyTargetTier : kind === "sourceLoot.v1" ? lootChance?.value : undefined);
  const canAdjustSourceHealth = kind === "sourceEnemy.v1" && sourceHealth !== undefined;
  const canAdjustActorTargetMultiplier = kind === "sourceEnemy.v1" && sourceInputKind === "universal" && actorTargetLevelMultiplier !== undefined;
  const canAdjustActorTemplateHealth = kind === "sourceEnemy.v1" && (sourceInputKind === "fairy" || sourceInputKind === "garden") && actorTemplateHealth !== undefined;
  const canAdjustFantasyTier = kind === "fantasyScale.v1" && fantasyTiers.length > 0 && fantasyTargetTier !== undefined;
  const canAdjustLootChance = kind === "sourceLoot.v1" && lootChance !== undefined;
  const tierOptions = useMemo(() => {
    if (kind === "setThresholds") return (object(params[0]?.data?.data).byTier as Row[] | undefined)?.map(row => Number(row.tier));
    if (["jewelry", "jewelryRecipe"].includes(kind)) return (object(object(params[0]?.data?.data)[String(tag.variant ?? "crafted")]).profiles as Row[] | undefined)?.map(row => Number(row.tier));
    if (kind === "gearProgression") return tag.catalog === "REGIONAL_TIER_ITEMS" ? [30, 40, 60] : [50, 70];
    return undefined;
  }, [kind, params, tag.variant, tag.catalog]);
  useEffect(() => {
    setTier(undefined); setTierText(undefined); setTierError(""); setBossMultiplier(undefined); setBossMultiplierText(undefined); setBossMultiplierError(""); setLocalNumber(undefined); setLocalNumberText(undefined); setLocalNumberError(""); setShape(undefined);
  }, [activeId, kind]);
  const resetExample = () => { setTier(undefined); setTierText(undefined); setTierError(""); setBossMultiplier(undefined); setBossMultiplierText(undefined); setBossMultiplierError(""); setLocalNumber(undefined); setLocalNumberText(undefined); setLocalNumberError(""); setShape(undefined); };
  return <section className="balance-panel"><div className="balance-heading"><Sigma size={19}/><div><h2>Formula and affected records</h2><p>{recordId ? `Inspecting ${fieldTitle(recordId).toLowerCase()}. ` : ""}Examples use the saved parameters. Recompute previews changes before applying them.</p></div></div><div className="balance-selector"><label>Formula<select value={kind} onChange={event => { setKind(event.target.value); setExampleId(""); resetExample(); }}>{supportedKinds.map(key => <option key={key} value={key}>{kinds[key]!.label}</option>)}</select></label><span className="balance-source-label">{collection}</span></div><section className="balance-example"><div className="section-heading"><h3>Worked example</h3><span>Local calculation</span></div>{records.isPending ? <p role="status" className="balance-muted">Loading linked records…</p> : records.isError ? <p role="alert" className="balance-message">{records.error.message} <button type="button" className="text-button" onClick={() => void records.refetch()}>Retry</button></p> : !examples.length ? <p className="balance-muted">No records are currently linked to this formula. Source code is available below.</p> : <><div className="balance-example-controls"><label>Example record<select value={activeId} onChange={event => { setExampleId(event.target.value); resetExample(); }}>{examples.map(record => <option key={rowId(record, idKey)} value={rowId(record, idKey)}>{rowName(record, idKey)}</option>)}</select></label>{canAdjustLegacyMarksTier && <label>Example input tier<input aria-label="Example input tier" type="number" min={1} step={1} value={tierText ?? (shownTier !== undefined ? shownTier : "")} onChange={event => { const raw = event.currentTarget.value; setTierText(raw); const parsed = parseExampleNumber(raw, { label: "input tier", integer: true, minimum: 1 }); setTier(parsed.value); setTierError(parsed.error); }}/>{tierError && <span role="alert">{tierError}</span>}</label>}{canAdjustBossMultiplier && <label>Example boss target multiplier<input aria-label="Example boss target multiplier" type="number" min={0} step="any" value={bossMultiplierText ?? (shownBossMultiplier !== undefined ? shownBossMultiplier : "")} onChange={event => { const raw = event.currentTarget.value; setBossMultiplierText(raw); const parsed = parseExampleNumber(raw, { label: "target multiplier", minimum: 0, exclusiveMinimum: true }); setBossMultiplier(parsed.value); setBossMultiplierError(parsed.error); }}/>{bossMultiplierError && <span role="alert">{bossMultiplierError}</span>}</label>}{canAdjustSourceHealth && <label>Example source health<input aria-label="Example source health" type="number" min={1} step={sourceInputKind === "rpg" ? "any" : 1} value={localNumberText ?? (shownLocalNumber !== undefined ? shownLocalNumber : "")} onChange={event => { const raw = event.currentTarget.value; setLocalNumberText(raw); const parsed = parseExampleNumber(raw, { label: "source health", minimum: 1, integer: sourceInputKind !== "rpg" }); setLocalNumber(parsed.value); setLocalNumberError(parsed.error); }}/>{localNumberError && <span role="alert">{localNumberError}</span>}</label>}{canAdjustActorTargetMultiplier && <label>Example target level multiplier<input aria-label="Example target level multiplier" type="number" min={0} step="any" value={localNumberText ?? (shownLocalNumber !== undefined ? shownLocalNumber : "")} onChange={event => { const raw = event.currentTarget.value; setLocalNumberText(raw); const parsed = parseExampleNumber(raw, { label: "target level multiplier", minimum: 0, exclusiveMinimum: true }); setLocalNumber(parsed.value); setLocalNumberError(parsed.error); }}/>{localNumberError && <span role="alert">{localNumberError}</span>}</label>}{canAdjustActorTemplateHealth && <label>Example template health<input aria-label="Example template health" type="number" min={1} step={1} value={localNumberText ?? (shownLocalNumber !== undefined ? shownLocalNumber : "")} onChange={event => { const raw = event.currentTarget.value; setLocalNumberText(raw); const parsed = parseExampleNumber(raw, { label: "template health", integer: true, minimum: 1 }); setLocalNumber(parsed.value); setLocalNumberError(parsed.error); }}/>{localNumberError && <span role="alert">{localNumberError}</span>}</label>}{canAdjustFantasyTier && <label>Example target tier<input aria-label="Example target tier" type="number" min={1} step={1} value={localNumberText ?? (shownLocalNumber !== undefined ? shownLocalNumber : "")} onChange={event => { const raw = event.currentTarget.value; setLocalNumberText(raw); const parsed = parseExampleNumber(raw, { label: "target tier", integer: true, minimum: 1, allowed: fantasyTiers }); setLocalNumber(parsed.value); setLocalNumberError(parsed.error); }}/>{localNumberError && <span role="alert">{localNumberError}</span>}</label>}{canAdjustLootChance && <label>Example loot chance<input aria-label="Example loot chance" type="number" min={0} max={1} step="any" value={localNumberText ?? (shownLocalNumber !== undefined ? shownLocalNumber : "")} onChange={event => { const raw = event.currentTarget.value; setLocalNumberText(raw); const parsed = parseExampleNumber(raw, { label: "loot chance", minimum: 0, maximum: 1 }); setLocalNumber(parsed.value); setLocalNumberError(parsed.error); }}/>{localNumberError && <span role="alert">{localNumberError}</span>}</label>}{canAdjustTier && <label>Example tier{tierOptions ? <select value={shownTier} onChange={event => { setTier(Number(event.target.value)); setTierText(undefined); setTierError(""); }}>{tierOptions.map(value => <option key={value} value={value}>{value}</option>)}</select> : <><input aria-label="Example tier" type="number" min={1} step={1} value={tierText ?? (shownTier !== undefined ? shownTier : "")} onChange={event => { const raw = event.currentTarget.value; setTierText(raw); const parsed = parseExampleNumber(raw, { label: "tier", integer: true, minimum: 1 }); setTier(parsed.value); setTierError(parsed.error); }}/>{tierError && <span role="alert">{tierError}</span>}</>}</label>}{["jewelry", "jewelryRecipe"].includes(kind) && <label>Shape<select value={shape ?? String(tag.shape)} onChange={event => setShape(event.target.value)}><option value="ring">Ring</option><option value="earring">Earring</option></select></label>}{(tier !== undefined || bossMultiplier !== undefined || localNumber !== undefined || shape !== undefined || tierError || bossMultiplierError || localNumberError) && <button className="text-button" type="button" onClick={resetExample}>Reset inputs</button>}</div><p className="balance-example-note">Changing example inputs does not save or alter the recompute selection.</p>{example && "loading" in example ? <p role="status" className="balance-muted">Loading parameters…</p> : example && "error" in example ? <p role="alert" className="balance-message">{example.error} <button type="button" className="text-button" onClick={() => params.forEach(query => void query.refetch())}>Reload parameters</button></p> : example && "output" in example && <div className="balance-example-result"><div><h4>Formula input</h4><ValueRows value={{ record: activeId, ...object(example.input.derivation), ...(example.originalInput ? { input: example.originalInput } : {}), ...(example.originalTarget ? { target: example.originalTarget } : {}), ...(example.exampleOverrides ? { exampleOverrides: example.exampleOverrides } : {}), ...(["recipeXp", "campfireFuel", "setThresholds"].includes(kind) ? { tier: example.input.tier } : {}) }}/></div><div><h4>Calculated fields</h4><ValueRows value={example.output}/><p className="balance-example-note">{tier !== undefined || bossMultiplier !== undefined || localNumber !== undefined || shape !== undefined ? "Result for your example inputs." : example.changed ? "The saved record differs from these formula values. Preview recompute to inspect the changes." : "These values match the saved record."}</p></div></div>}</>}</section><RecomputeControls key={kind} kind={kind}/><section className="balance-source"><div className="section-heading"><h3><Code2 size={16}/> Formula source</h3><label className="sr-only" htmlFor={`source-${moduleName}`}>Source file</label><select id={`source-${moduleName}`} value={currentSource} onChange={event => setSourceName(event.target.value)}>{sourceNames.filter(name => sourceFiles[name]).map(name => <option key={name} value={name}>{name}.ts</option>)}</select></div><HighlightedSource source={sourceFiles[currentSource] ?? ""}/></section></section>;
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
