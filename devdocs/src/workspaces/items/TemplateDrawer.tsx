import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyComponent } from "../lazyView.js";
import { ProgressionTierSchema, RecipeTemplateSchema, type RecipeTemplate } from "../../../../game/src/content/schema/progression.js";
import { ConsequenceCell, ConsequenceNote, movesWith, rowMovement, tally } from "../../dev/formulas/consequences.js";
import { deriveProductionEntry, type Derivation } from "../../model/derive.js";
import { setPath, useRecordDraft } from "../../model/draft.js";
import { Facts, Field, Fields, NumberField, ReferencedBy, Section, Sheet } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "../../ui/Drawer.js";
import { Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../components/ui/index.js";
import { specAt, stationText, templateEntries, type ItemsData } from "./data.js";
import { EMPTY } from "../../ui/layout.js";

const CONSEQUENCE_CELL = "h-[26px] px-2 py-0.5";
const UNIT = "shrink-0 text-[11px] text-faint";
/** A curve field holds two numbers (`base + tier x per level`), so its cell is wider than a lone value's. */
const PAIRS = "grid-cols-[repeat(2,minmax(0,14rem))]";

/*
  The production curve behind a recipe: duration and xp parameters, and every entry that uses it,
  recomputed from the draft and live through an Alt+drag scrub. An entry with its own adjustment
  keeps its number and wears the brass override dot: the curve moves, the recipe does not.
*/

const CompiledCheck = __DEVDOCS_PLAYER__ ? undefined : lazyComponent(() => import("../../dev/formulas/CompiledCheck.js"), null);

type ParamKey = keyof RecipeTemplate["parameters"];
const param = (key: ParamKey) => specAt(RecipeTemplateSchema, ["parameters", key]);
const DURATION = specAt(ProgressionTierSchema, ["production", 0, "adjustments", "durationMs"]);
const XP = specAt(ProgressionTierSchema, ["production", 0, "adjustments", "xp"]);

const consequence = (before: Derivation, after: Derivation) =>
  ({ before: before.computed, after: after.computed, own: after.overridden ? after.value : undefined, ...movesWith(before.computed, after.computed, after.overridden) });

export function TemplateDrawer({ templateId, data, onClose, onOpenRecipe, stacked }: { templateId: string; data: Pick<ItemsData, "tiers">; onClose: () => void; onOpenRecipe?: (id: string) => void; stacked?: boolean }) {
  const draft = useRecordDraft<RecipeTemplate>("recipeTemplates", templateId);
  const committed = draft.draft;
  const saved = draft.record;
  const [scrub, setScrub] = useState<RecipeTemplate>();
  useEffect(() => setScrub(undefined), [committed]);
  const template = scrub ?? committed;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const entries = useMemo(() => templateEntries(data.tiers, templateId), [data.tiers, templateId]);
  const rows = useMemo(() => !template ? [] : entries.map(({ tier, entry }) => {
    const after = deriveProductionEntry(tier, entry, template);
    const before = deriveProductionEntry(tier, entry, saved ?? template);
    const durationMs = consequence(before.durationMs, after.durationMs);
    const xp = consequence(before.xp, after.xp);
    return { tier, entry, durationMs, xp, ...rowMovement([durationMs, xp]) };
  }), [entries, template, saved]);
  const counts = useMemo(() => tally(rows), [rows]);

  const dirtyAt = (...keys: ParamKey[]) => draft.dirty && keys.some(key => committed?.parameters[key] !== saved?.parameters[key]);
  const number = (key: ParamKey, label: string, unit?: string) => {
    const spec = param(key);
    return <NumberField value={template?.parameters[key]} min={spec.min ?? 0} step={spec.step} unit={unit} readOnly={readOnly} ariaLabel={label}
      onPreview={next => { if (committed) setScrub(setPath(committed, ["parameters", key], next)); }}
      onChange={next => draft.setPath(["parameters", key], next ?? 0)} />;
  };

  return <Drawer title={template ? template.name : "Template"} onClose={onClose} stacked={stacked}>
    {draft.loading && <p className={EMPTY}>Loading…</p>}
    {draft.error && <p className={EMPTY}>{draft.error}</p>}
    {template && <>
      <Sheet compact>
        <Section title="Curve" aside={<code>{template.id}</code>}>
          <Facts items={[template.kind, template.skill, stationText(template.stations)]} />
          <Fields columns={2} className={PAIRS}>
            <Field compact label={DURATION.label} dirty={dirtyAt("durationMs")}>{number("durationMs", DURATION.label, DURATION.unit)}</Field>
            <Field compact label={XP.label} dirty={dirtyAt("xpBase", "xpPerLevel")}>
              {number("xpBase", `${XP.label} base`)}
              <span className={UNIT}>+ tier ×</span>
              {number("xpPerLevel", `${XP.label} per level`)}
            </Field>
          </Fields>
        </Section>
        <Section title="Recipes" aside={<ConsequenceNote tally={counts} noun="recipes" idle={<span>{entries.length} across {new Set(entries.map(entry => entry.tier.tier)).size} tiers</span>} />}>
          <TableFrame className="mt-0.5 max-h-[46vh] w-full">
            <Table>
              <TableHeader><TableRow><TableHead numeric className={CONSEQUENCE_CELL}>Tier</TableHead><TableHead className={CONSEQUENCE_CELL}>Recipe</TableHead><TableHead numeric className={CONSEQUENCE_CELL}>{DURATION.label}</TableHead><TableHead numeric className={CONSEQUENCE_CELL}>{XP.label}</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map(({ tier, entry, durationMs, xp, pinned }) => <TableRow key={entry.id} data-unmoved={pinned || undefined} className="data-unmoved:text-muted-foreground" title={pinned ? `${entry.name} keeps its own adjustment, so this change does not reach it` : undefined}>
                <TableCell numeric className={CONSEQUENCE_CELL}>{tier.tier}</TableCell>
                <TableCell className={CONSEQUENCE_CELL}><TableLink onClick={() => onOpenRecipe?.(entry.id)}><Thumb spec={{ kind: "item", id: entry.output.itemId }} size="s" /><span>{entry.name}</span></TableLink></TableCell>
                <TableCell numeric className={CONSEQUENCE_CELL}><ConsequenceCell {...durationMs} unit=" ms" label={DURATION.label} /></TableCell>
                <TableCell numeric className={CONSEQUENCE_CELL}><ConsequenceCell {...xp} label={XP.label} /></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableFrame>
          {CompiledCheck && <Suspense fallback={null}><CompiledCheck formulaId="production.linear" profileId={templateId} parameters={template.parameters} tier={entries[0]?.tier.tier ?? 1} disabled={!draft.dirty} /></Suspense>}
        </Section>
        <ReferencedBy collection="recipeTemplates" id={templateId} />
      </Sheet>
    </>}
  </Drawer>;
}
