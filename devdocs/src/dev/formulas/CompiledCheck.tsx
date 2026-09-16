import { useState } from "react";
import { Play } from "lucide-react";
import type { FormulaImpact, FormulaPreviewResponse } from "../../../shared/formulas.js";
import { routePath } from "../../ui/workspaces.js";
import "./formulas.css";

/*
  The drawer derives its consequences in the browser from the same formula functions the compiler
  runs, which is instant and enough to scrub against. The server's preview endpoint does something
  the browser cannot: it recompiles the whole content build with the draft parameters substituted
  and reports every compiled record that comes out different, including knock-on records no client
  formula models. Two full compiles is too slow to run per keystroke, so it is an explicit check,
  driven by the drawer's draft rather than by a page of its own.
*/

const SHOWN = 8;

export default function CompiledCheck({ formulaId, profileId, parameters, tier, disabled }: {
  formulaId: string; profileId: string; parameters: unknown; tier: number; disabled?: boolean;
}) {
  const [impacts, setImpacts] = useState<readonly FormulaImpact[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setError(""); setImpacts(undefined);
    try {
      const response = await fetch("/__devdocs/formulas/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formulaId, input: { tier }, parameters, profileId }),
      });
      const body = await response.json() as FormulaPreviewResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Preview failed (${response.status})`);
      setImpacts(body.impacts ?? []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The compiled check failed.");
    } finally { setBusy(false); }
  }

  return <div className="compiled-check">
    <button type="button" className="button button-small" disabled={busy || disabled} onClick={() => void run()}>
      <Play size={12} />{busy ? "Recompiling…" : "Check the compiled build"}
    </button>
    <span className="compiled-check-hint">{disabled ? "Change a parameter first." : "Recompiles the catalog with this draft."}</span>
    {error && <p role="alert" className="formula-error">{error}</p>}
    {impacts && <div className="compiled-check-result" role="status">
      <strong>{impacts.length}</strong> compiled {impacts.length === 1 ? "record" : "records"} change
      {impacts.length > 0 && <ul className="compiled-check-list">
        {impacts.slice(0, SHOWN).map(impact => {
          const [collection, id] = impact.record.split(":");
          return <li key={impact.record}><a href={`#${routePath(collection ?? "", id)}`}><code>{impact.record}</code></a></li>;
        })}
        {impacts.length > SHOWN && <li className="muted">+{impacts.length - SHOWN} more</li>}
      </ul>}
    </div>}
  </div>;
}
