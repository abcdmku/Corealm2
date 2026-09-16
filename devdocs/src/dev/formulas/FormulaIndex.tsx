import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Code2, Search } from "lucide-react";
import type { FormulaDescription, FormulasResponse } from "../../../shared/formulas.js";
import { routePath } from "../../ui/workspaces.js";
import { formulasQuery } from "./query.js";
import "./formulas.css";

/*
  The formula registry, not a scratchpad. Every curve is now edited where its consequences are
  visible — the role drawer on a creature, the family drawer on the ladder, the template drawer on
  a recipe — so this page answers the two questions the drawers cannot: which formulas exist and
  what compiles them, and whether the watcher's last build is valid.
*/

type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;

const buildTone = (state: FormulasResponse["build"]["state"]): Tone =>
  state === "valid" ? "ok" : state === "invalid" ? "danger" : state === "checking" ? "info" : undefined;

export function FormulaIndex() {
  const query = useQuery(formulasQuery);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  if (query.isPending) return <p className="empty-inline">Loading formulas…</p>;
  if (query.isError) return <p role="alert" className="formula-error">{query.error.message}</p>;
  const formulas = query.data.formulas.filter(formula => `${formula.id} ${formula.title}`.toLowerCase().includes(search.toLowerCase()));
  const active = formulas.find(formula => formula.id === selected) ?? formulas[0];
  const build = query.data.build;
  return <section className="formula-workspace">
    <div className="formula-build">
      <p role="status" className="formula-build-status">
        <span className="badge" data-tone={buildTone(build.state)}>Build: {build.state}</span>
        {build.revision && <code>{build.revision.slice(0, 12)}</code>}
        {build.state === "invalid" && <span className="formula-build-hint">Last valid catalog stays active until the diagnostics are fixed.</span>}
      </p>
      {build.diagnostics.map((issue, index) => <p role="alert" className="formula-error" key={index}><code>{issue.path}</code> {issue.message}</p>)}
    </div>
    <div className="formula-layout">
      <aside className="panel formula-index">
        <div className="panel-header formula-index-header">
          <label className="search-field formula-search"><Search size={14} /><input aria-label="Find a formula" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a formula…" /></label>
        </div>
        <nav aria-label="Formula index" className="formula-nav">
          {formulas.map(formula => <button type="button" key={formula.id} aria-current={active?.id === formula.id} className={active?.id === formula.id ? "is-active" : ""} onClick={() => setSelected(formula.id)}>
            <span className="formula-nav-title">{formula.title}</span><small>{formula.id}</small><ChevronRight size={12} className="formula-nav-chevron" />
          </button>)}
          {!formulas.length && <p className="empty-inline" style={{ padding: "8px 10px" }}>No formulas match.</p>}
        </nav>
      </aside>
      {active ? <FormulaCard key={active.id} formula={active} /> : <p className="empty-inline">No formula is registered.</p>}
    </div>
  </section>;
}

interface CurveRow { id: string; name: string; records: number; first?: string }

/** The curves that feed one formula, with how many compiled records each produces. */
function curveRows(formula: FormulaDescription, names: ReadonlyMap<string, string>): CurveRow[] {
  const byProfile = new Map<string, CurveRow>();
  for (const consumer of formula.consumers) {
    const id = consumer.profile ?? "";
    const row = byProfile.get(id) ?? { id, name: names.get(id) ?? id, records: 0, first: consumer.record };
    row.records += 1;
    byProfile.set(id, row);
  }
  return [...byProfile.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const recordHref = (record: string): string => { const [collection, ...rest] = record.split(":"); return `#${routePath(collection ?? "", rest.join(":"))}`; };

function FormulaCard({ formula }: { formula: FormulaDescription }) {
  const profiles = useQuery({
    queryKey: ["formula-profiles", formula.profilesCollection],
    queryFn: async () => {
      const response = await fetch(`/__devdocs/collections/${encodeURIComponent(formula.profilesCollection)}`);
      if (!response.ok) throw new Error("Unable to load the curves this formula reads");
      return response.json() as Promise<{ data: { id: string; name?: string }[] }>;
    },
  });
  const names = new Map((profiles.data?.data ?? []).map(row => [row.id, row.name ?? row.id]));
  const rows = curveRows(formula, names);
  const collectionHref = `#${routePath(formula.profilesCollection)}`;
  return <article className="panel formula-inspector">
    <header className="panel-header formula-inspector-header">
      <h2 className="formula-inspector-title" title={formula.id}>{formula.title}</h2>
      <code className="formula-source" title={`${formula.source.file}:${formula.source.line}`}>{formula.source.file.split("/").at(-1)}:{formula.source.line}</code>
      <div className="panel-header-actions"><a className="button button-small" href={formula.source.url}><Code2 size={13} />{formula.source.symbol}</a></div>
    </header>
    <div className="panel-body formula-inspector-body">
      {formula.description && <p className="formula-description">{formula.description}</p>}
      <p className="formula-description">
        Its parameters are edited in the drawer on a record that uses them, where every consumer's
        before and after is on screen before you save. Open one below, or browse them all in <a className="reference-link" href={collectionHref}>{formula.profilesCollection}</a>.
      </p>
      <section className="formula-section">
        <div className="section-heading"><h3>Curves</h3><span>{rows.length} reading {formula.consumers.length} compiled {formula.consumers.length === 1 ? "record" : "records"}</span></div>
        {rows.length
          ? <div className="matrix formula-curves">
            <table>
              <thead><tr><th>Curve</th><th className="cell-num">Records</th><th>Open where it lands</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}>
                <td>{row.name}{row.name !== row.id && <> <code>{row.id}</code></>}</td>
                <td className="cell-num">{row.records}</td>
                <td>{row.first ? <a className="reference-link" href={recordHref(row.first)}>{row.first}<ArrowRight size={11} /></a> : <span className="muted">no compiled record</span>}</td>
              </tr>)}</tbody>
            </table>
          </div>
          : <p className="empty-inline">{profiles.isPending ? "Loading curves…" : "Nothing in the catalog is compiled from this formula yet."}</p>}
      </section>
    </div>
  </article>;
}

export default FormulaIndex;
