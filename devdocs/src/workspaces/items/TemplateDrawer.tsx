import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { RecipeTemplate } from "../../../../game/src/content/schema/progression.js";
import { deriveProductionEntry, fmt } from "../../model/derive.js";
import { useRecordDraft } from "../../model/draft.js";
import { NumberInput, Row, SaveBar, Section, Sheet, Static } from "../../ui/Sheet.js";
import { Thumb } from "../../ui/Thumb.js";
import { Drawer } from "./Drawer.js";
import { stationText, templateEntries, useSaveShortcut, type ItemsData } from "./data.js";

/* The production curve behind a recipe: duration and xp parameters, and every entry that uses it, recomputed live. */

function Change({ before, after, unit }: { before: number; after: number; unit?: string }) {
  if (before === after) return <span className="mono">{fmt(after)}{unit}</span>;
  return <span className="mono change"><s>{fmt(before)}{unit}</s><ArrowRight size={10} /><strong>{fmt(after)}{unit}</strong></span>;
}

export function TemplateDrawer({ templateId, data, onClose, onOpenRecipe, stacked }: { templateId: string; data: Pick<ItemsData, "tiers">; onClose: () => void; onOpenRecipe?: (id: string) => void; stacked?: boolean }) {
  const draft = useRecordDraft<RecipeTemplate>("recipeTemplates", templateId);
  const template = draft.draft;
  const saved = draft.record;
  const readOnly = __DEVDOCS_PLAYER__ || !draft.editable;
  useSaveShortcut(draft.dirty && !readOnly, () => void draft.save());
  const entries = useMemo(() => templateEntries(data.tiers, templateId), [data.tiers, templateId]);
  const param = (key: "durationMs" | "xpBase" | "xpPerLevel", unit?: string) => <NumberInput value={template?.parameters[key]} min={0} disabled={readOnly} unit={unit} ariaLabel={`parameters.${key}`} onChange={next => draft.setPath(["parameters", key], next ?? 0)} />;

  return <Drawer title={template ? template.name : "Template"} onClose={onClose} stacked={stacked}>
    {draft.loading && <p className="empty-inline">Loading…</p>}
    {draft.error && <p className="empty-inline">{draft.error}</p>}
    {template && <>
      {!readOnly && <SaveBar dirty={draft.dirty} saving={draft.saving} error={draft.saveError} conflict={draft.conflict} onSave={() => void draft.save()} onReset={draft.reset} label="Save template" />}
      <Sheet compact>
        <Section title="Curve" aside={<code>{template.id}</code>}>
          <Row label="Kind"><Static>{template.kind} · {template.skill} · {stationText(template.stations)}</Static></Row>
          <Row label="Duration">{param("durationMs", "ms")}</Row>
          <Row label="XP"><span className="param-pair">{param("xpBase")}<span className="muted">+ tier ×</span>{param("xpPerLevel")}</span></Row>
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
      </Sheet>
    </>}
  </Drawer>;
}
