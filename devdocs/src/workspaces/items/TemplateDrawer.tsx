import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { ProgressionTierSchema, RecipeTemplateSchema, type RecipeTemplate } from "../../../../game/src/content/schema/progression.js";
import { deriveProductionEntry, fmt } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { Facts, Field, Fields, NumberField, ReferencedBy, Section, Sheet } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "./Drawer.js";
import { specAt, stationText, templateEntries, type ItemsData } from "./data.js";

/* The production curve behind a recipe: duration and xp parameters, and every entry that uses it, recomputed live. */

function Change({ before, after, unit }: { before: number; after: number; unit?: string }) {
  if (before === after) return <span className="mono">{fmt(after)}{unit}</span>;
  return <span className="mono change"><s>{fmt(before)}{unit}</s><ArrowRight size={10} /><strong>{fmt(after)}{unit}</strong></span>;
}

type ParamKey = keyof RecipeTemplate["parameters"];
const param = (key: ParamKey) => specAt(RecipeTemplateSchema, ["parameters", key]);
const DURATION = specAt(ProgressionTierSchema, ["production", 0, "adjustments", "durationMs"]);
const XP = specAt(ProgressionTierSchema, ["production", 0, "adjustments", "xp"]);

export function TemplateDrawer({ templateId, data, onClose, onOpenRecipe, stacked }: { templateId: string; data: Pick<ItemsData, "tiers">; onClose: () => void; onOpenRecipe?: (id: string) => void; stacked?: boolean }) {
  const draft = useRecordDraft<RecipeTemplate>("recipeTemplates", templateId);
  const template = draft.draft;
  const saved = draft.record;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  const entries = useMemo(() => templateEntries(data.tiers, templateId), [data.tiers, templateId]);
  const number = (key: ParamKey, label: string, unit?: string) => {
    const spec = param(key);
    return <NumberField value={template?.parameters[key]} min={spec.min ?? 0} step={spec.step} unit={unit} readOnly={readOnly} ariaLabel={label} onChange={next => draft.setPath(["parameters", key], next ?? 0)} />;
  };

  return <Drawer title={template ? template.name : "Template"} onClose={onClose} stacked={stacked}>
    {draft.loading && <p className="empty-inline">Loading…</p>}
    {draft.error && <p className="empty-inline">{draft.error}</p>}
    {template && <>
      <Sheet compact>
        <Section title="Curve" aside={<code>{template.id}</code>}>
          <Facts className="kv-facts" items={[template.kind, template.skill, stationText(template.stations)]} />
          <Fields columns={2}>
            <Field compact label={DURATION.label}>{number("durationMs", DURATION.label, DURATION.unit)}</Field>
            <Field compact label={XP.label}>
              {number("xpBase", `${XP.label} base`)}
              <span className="field-unit">+ tier ×</span>
              {number("xpPerLevel", `${XP.label} per level`)}
            </Field>
          </Fields>
        </Section>
        <Section title="Recipes" aside={<span>{entries.length} across {new Set(entries.map(entry => entry.tier.tier)).size} tiers</span>}>
          <div className="matrix members-table">
            <table>
              <thead><tr><th>Tier</th><th>Recipe</th><th className="cell-num">Duration</th><th className="cell-num">XP</th></tr></thead>
              <tbody>{entries.map(({ tier, entry }) => {
                const after = deriveProductionEntry(tier, entry, template);
                const before = saved ? deriveProductionEntry(tier, entry, saved) : after;
                return <tr key={entry.id}>
                  <td className="cell-num">{tier.tier}</td>
                  <td><button type="button" className="cell" onClick={() => onOpenRecipe?.(entry.id)}><Thumb spec={{ kind: "item", id: entry.output.itemId }} size="s" /><span>{entry.name}</span></button></td>
                  <td className="cell-num"><Change before={before.durationMs.value} after={after.durationMs.value} unit=" ms" /></td>
                  <td className="cell-num"><Change before={before.xp.value} after={after.xp.value} /></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Section>
        <ReferencedBy collection="recipeTemplates" id={templateId} />
      </Sheet>
    </>}
  </Drawer>;
}
