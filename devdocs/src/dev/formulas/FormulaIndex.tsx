import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Code2 } from "lucide-react";
import type { FormulaDescription, FormulasResponse } from "../../../shared/formulas.js";
import { routePath } from "../../ui/workspaces.js";
import { formulasQuery } from "./query.js";
import { buttonVariants, Badge, SearchInput, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { toneVariant } from "../../components/ui/badge.js";
import { cn } from "../../lib/utils.js";
import { EMPTY, PANEL, PANEL_HEADER } from "../../ui/layout.js";

/*
  The formula registry, not a scratchpad. Every curve is now edited where its consequences are
  visible — the role drawer on a creature, the family drawer on the ladder, the template drawer on
  a recipe — so this page answers the two questions the drawers cannot: which formulas exist and
  what compiles them, and whether the watcher's last build is valid.
*/

type Tone = "accent" | "ok" | "warn" | "danger" | "info" | undefined;

/** A build or load failure: the message in a red box, the path in red mono. */
const FORMULA_ERROR = "rounded-md border border-destructive bg-destructive-soft px-2.5 py-1.5 font-sans text-xs whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] [&_code]:font-mono [&_code]:text-destructive";
const LINK = "inline-flex cursor-pointer items-center gap-[3px] text-left text-link [overflow-wrap:anywhere] hover:underline";

const buildTone = (state: FormulasResponse["build"]["state"]): Tone =>
  state === "valid" ? "ok" : state === "invalid" ? "danger" : state === "checking" ? "info" : undefined;

export function FormulaIndex() {
  const query = useQuery(formulasQuery);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  if (query.isPending) return <p className={EMPTY}>Loading formulas…</p>;
  if (query.isError) return <p role="alert" className={FORMULA_ERROR}>{query.error.message}</p>;
  const needle = search.toLowerCase();
  const formulas = query.data.formulas.filter(formula => `${formula.id} ${formula.title}`.toLowerCase().includes(needle));
  const active = formulas.find(formula => formula.id === selected) ?? formulas[0];
  const build = query.data.build;
  return <section className="flex min-w-0 flex-col gap-2.5">
    <div className="flex flex-col gap-1">
      <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={toneVariant(buildTone(build.state))}>Build: {build.state}</Badge>
        {build.revision && <code className="font-mono text-[11px] text-faint">{build.revision.slice(0, 12)}</code>}
        {build.state === "invalid" && <span className="text-muted-foreground">Last valid catalog stays active until the diagnostics are fixed.</span>}
      </p>
      {build.diagnostics.map((issue, index) => <p role="alert" className={FORMULA_ERROR} key={index}><code>{issue.path}</code> {issue.message}</p>)}
    </div>
    <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-2.5 max-[900px]:grid-cols-1">
      <aside className={cn(PANEL, "sticky top-2 min-w-0 overflow-hidden max-[900px]:static")}>
        <div className={cn(PANEL_HEADER, "p-1.5")}>
          <SearchInput className="w-full" label="Find a formula" placeholder="Find a formula…" value={search} onChange={setSearch} onEnter={() => formulas[0] && setSelected(formulas[0].id)} />
        </div>
        <nav aria-label="Formula index" className="flex max-h-[calc(100dvh-200px)] flex-col gap-px overflow-y-auto p-1 [scrollbar-width:thin] max-[900px]:max-h-50">
          {formulas.map(formula => <button type="button" key={formula.id} aria-current={active?.id === formula.id} onClick={() => setSelected(formula.id)}
            className="group/nav grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_12px] items-center gap-x-1.5 rounded-md px-2 py-[5px] text-left text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=true]:bg-selected aria-[current=true]:text-foreground">
            <span className="truncate text-xs font-medium">{formula.title}</span>
            <ChevronRight size={12} className="row-span-2 text-faint opacity-0 group-hover/nav:opacity-100 group-aria-[current=true]/nav:text-primary group-aria-[current=true]/nav:opacity-100" />
            <small className="truncate font-mono text-[11px] text-faint">{formula.id}</small>
          </button>)}
          {!formulas.length && <p className={cn(EMPTY, "px-2.5 py-2")}>No formulas match.</p>}
        </nav>
      </aside>
      {active ? <FormulaCard key={active.id} formula={active} /> : <p className={EMPTY}>No formula is registered.</p>}
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
  return <article className={cn(PANEL, "min-w-0")}>
    <header className={cn(PANEL_HEADER, "min-w-0")}>
      <h2 className="min-w-0 truncate" title={formula.id}>{formula.title}</h2>
      <code className="font-mono text-[11px] whitespace-nowrap text-faint" title={`${formula.source.file}:${formula.source.line}`}>{formula.source.file.split("/").at(-1)}:{formula.source.line}</code>
      <div className="ml-auto flex items-center gap-1"><a className={buttonVariants({ variant: "secondary", size: "sm" })} href={formula.source.url}><Code2 size={13} />{formula.source.symbol}</a></div>
    </header>
    <div className="flex flex-col gap-3.5 px-2.5 py-2">
      {formula.description && <p className={DESCRIPTION}>{formula.description}</p>}
      <p className={DESCRIPTION}>
        Its parameters are edited in the drawer on a record that uses them, where every consumer's
        before and after is on screen before you save. Open one below, or browse them all in <a className={LINK} href={collectionHref}>{formula.profilesCollection}</a>.
      </p>
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2.5"><h3 className="text-xs font-semibold">Curves</h3><span className="font-mono text-[11px] text-faint">{rows.length} reading {formula.consumers.length} compiled {formula.consumers.length === 1 ? "record" : "records"}</span></div>
        {rows.length
          ? <TableFrame className="max-h-[50vh]">
            <Table>
              <TableHeader><TableRow><TableHead>Curve</TableHead><TableHead numeric>Records</TableHead><TableHead>Open where it lands</TableHead></TableRow></TableHeader>
              <TableBody>{rows.map(row => <TableRow key={row.id}>
                <TableCell className="h-7">{row.name}{row.name !== row.id && <> <code className="font-mono text-[11px] text-faint">{row.id}</code></>}</TableCell>
                <TableCell numeric>{row.records}</TableCell>
                <TableCell>{row.first ? <a className={LINK} href={recordHref(row.first)}>{row.first}<ArrowRight size={11} /></a> : <span className="text-faint">no compiled record</span>}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableFrame>
          : <p className={EMPTY}>{profiles.isPending ? "Loading curves…" : "Nothing in the catalog is compiled from this formula yet."}</p>}
      </section>
    </div>
  </article>;
}

const DESCRIPTION = "text-xs leading-normal text-muted-foreground [&_code]:text-[11px]";

export default FormulaIndex;
