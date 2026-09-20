import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { auditQuery, type AuditEntry, type AuditFilter } from "../api/adminData.js";
import { Badge, Button, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow, type BadgeTone } from "../components/ui/index.js";
import { itemName, useCatalogItems, type CatalogItem } from "../model/adminNames.js";
import { moment, since } from "../model/format.js";
import { cn } from "../lib/utils.js";
import { EmptyNote, ErrorState, LoadingRows } from "./States.js";
import { Thumb } from "./Thumb.js";

/**
 * The audit log, as a reader rather than a dump.
 *
 * Every admin write lands here, so the two questions it has to answer at a glance are "who did
 * what" and "to whom". The action becomes a sentence, the target resolves to a name where the page
 * knows one, and the `before`/`after` the API records open under the row, with item ids drawn as
 * the items they are. The same component backs the server-wide view and a player's own tab; only
 * the filter differs.
 */

const TONE: Readonly<Record<string, BadgeTone>> = {
  "player.edit": "info", "player.kick": "warn", "ban.set": "danger", "ban.remove": "ok",
  "role.set": "accent", "role.revoke": "warn", "owner.setup": "accent",
  "token.create": "accent", "token.revoke": "warn",
  "content.publish": "ok", "content.rollback": "warn", "settings.set": "info",
  "session.create": "default", "session.revoke": "default",
};

const ACTION_WORDS: Readonly<Record<string, string>> = {
  "player.edit": "edited a player", "player.kick": "kicked a player",
  "ban.set": "banned an account", "ban.remove": "lifted a ban",
  "role.set": "granted a role", "role.revoke": "removed a role",
  "owner.setup": "claimed this server", "token.create": "created an API token", "token.revoke": "revoked an API token",
  "content.publish": "published a catalog", "content.rollback": "rolled the catalog back",
  "settings.set": "changed settings", "session.create": "signed in", "session.revoke": "signed out",
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isStack = (value: unknown): value is { itemId: string; quantity: number } => isRecord(value) && typeof value.itemId === "string" && typeof value.quantity === "number";

/** What a row says in one line, beside its action badge. */
function summarise(entry: AuditEntry, nameOf: (accountId: string) => string | undefined): string {
  const after = isRecord(entry.after) ? entry.after : {};
  switch (entry.action) {
    case "player.edit": return `${Object.keys(after).filter(key => key !== "applied" && key !== "world").join(", ") || "no change"} · ${String(after.applied ?? "stored")}`;
    case "player.kick": return typeof after.reason === "string" ? after.reason : "no reason given";
    case "ban.set": return typeof after.reason === "string" ? after.reason : "";
    case "content.publish": case "content.rollback": {
      const collections = Array.isArray(after.changedCollections) ? after.changedCollections.join(", ") : "";
      return [collections, typeof after.note === "string" ? after.note : ""].filter(Boolean).join(" · ");
    }
    case "settings.set": return Object.keys(after).join(", ");
    case "token.create": return typeof after.label === "string" ? after.label : "";
    case "role.set": return typeof after.role === "string" ? after.role : "";
    default: return entry.target ? nameOf(entry.target) ?? "" : "";
  }
}

/** A value from `before`/`after`, drawn as what it is: an item stack gets its icon and its name. */
function Value({ value, items }: { value: unknown; items: ReadonlyMap<string, CatalogItem> }) {
  if (value === null || value === undefined) return <span className="text-faint">empty</span>;
  if (isStack(value)) return <span className="inline-flex items-center gap-1" title={value.itemId}>
    <Thumb spec={{ kind: "item", id: value.itemId }} size="s" alt="" /><span className="truncate">{itemName(items, value.itemId)}</span>
    <small className="tabular-nums text-faint">×{value.quantity.toLocaleString()}</small>
  </span>;
  if (typeof value === "string") return <code className="font-mono text-[11px] [overflow-wrap:anywhere]">{/^[a-f0-9]{64}$/.test(value) ? value.slice(0, 12) : value}</code>;
  if (typeof value === "number") return <span className="font-mono tabular-nums">{value.toLocaleString()}</span>;
  if (typeof value === "boolean") return <span className="font-mono">{String(value)}</span>;
  if (isRecord(value) && typeof value.xp === "number") return <span className="font-mono tabular-nums">{Number(value.xp).toLocaleString()} xp{typeof value.level === "number" ? ` · level ${value.level}` : ""}</span>;
  return <code className="font-mono text-[11px] [overflow-wrap:anywhere]">{JSON.stringify(value)}</code>;
}

/** Fields that say how the write landed rather than what it changed; the row's summary has them. */
const METADATA = new Set(["applied", "world"]);

/** The keys that moved, before beside after. Nested slot maps are flattened to `inventory 3`. */
function Detail({ entry, items }: { entry: AuditEntry; items: ReadonlyMap<string, CatalogItem> }) {
  const before = isRecord(entry.before) ? entry.before : {};
  const after = isRecord(entry.after) ? entry.after : {};
  const rows: { key: string; before: unknown; after: unknown }[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
    if (METADATA.has(key)) continue;
    const left = before[key], right = after[key];
    if (isRecord(left) || isRecord(right)) {
      const inner = isRecord(left) ? left : {}, outer = isRecord(right) ? right : {};
      const keys = [...new Set([...Object.keys(inner), ...Object.keys(outer)])];
      // A flat object of scalars reads better as one line than as a row per key.
      if (keys.length && keys.every(name => !isRecord(inner[name]) || isStack(inner[name]) || isStack(outer[name]))) {
        for (const name of keys) rows.push({ key: `${key} ${name}`, before: inner[name] ?? null, after: outer[name] ?? null });
        continue;
      }
    }
    rows.push({ key, before: left ?? null, after: right ?? null });
  }
  if (!rows.length) return <EmptyNote>This action recorded no before and after.</EmptyNote>;
  // Four tracks that hug their content, so the arrow sits between the two values instead of a gulf.
  return <dl className="m-0 grid w-fit max-w-full grid-cols-[fit-content(10rem)_fit-content(20rem)_1.25rem_fit-content(20rem)] items-center gap-x-2 gap-y-0.5 text-xs">
    {rows.map(row => <Fragment key={row.key}>
      <dt className="truncate text-[11px] text-muted-foreground">{row.key}</dt>
      <dd className="m-0 min-w-0 text-faint"><Value value={row.before} items={items} /></dd>
      <dd className="m-0 text-center text-faint" aria-label="becomes">→</dd>
      <dd className="m-0 min-w-0 text-foreground"><Value value={row.after} items={items} /></dd>
    </Fragment>)}
  </dl>;
}

export interface AuditListProps {
  filter: AuditFilter;
  /** Resolve an account id to a display name, where the page has one to hand. */
  nameOf?: (accountId: string) => string | undefined;
  /** Leave the target column out where every row shares one (a player's own tab). */
  showTarget?: boolean;
  emptyNote?: string;
}

export function AuditList({ filter, nameOf = () => undefined, showTarget = true, emptyNote = "Nothing here yet." }: AuditListProps) {
  const items = useCatalogItems();
  const [pages, setPages] = useState<number[]>([]);
  const before = pages.at(-1);
  const query = useQuery(auditQuery({ ...filter, ...(before === undefined ? {} : { before }) }));
  const [open, setOpen] = useState<number>();
  const entries = query.data?.entries ?? [];
  const limit = filter.limit ?? 50;
  const columns = showTarget ? 6 : 5;
  const rows = useMemo(() => entries.map(entry => ({ entry, summary: summarise(entry, nameOf) })), [entries, nameOf]);

  if (query.isPending) return <LoadingRows />;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (!rows.length) return <EmptyNote>{pages.length ? "No more entries." : emptyNote}</EmptyNote>;

  return <div className="flex flex-col items-start gap-2">
    <TableFrame className="max-h-[70dvh] w-full">
      <Table>
        <TableHeader><TableRow>
          <TableHead className="w-6" aria-label="Expand" />
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>By</TableHead>
          {showTarget && <TableHead>Target</TableHead>}
          <TableHead className="w-full">Detail</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map(({ entry, summary }) => <Fragment key={entry.id}>
            <TableRow>
              <TableCell className="pr-0">
                <Button variant="ghost" size="icon-xs" aria-expanded={open === entry.id} aria-label={open === entry.id ? "Hide what changed" : "Show what changed"}
                  onClick={() => setOpen(open === entry.id ? undefined : entry.id)}>
                  <ChevronDown className={cn("transition-transform", open !== entry.id && "-rotate-90")} />
                </Button>
              </TableCell>
              <TableCell title={moment(entry.at)}>{since(entry.at)}</TableCell>
              <TableCell><Badge variant={TONE[entry.action] ?? "default"} title={entry.action}>{ACTION_WORDS[entry.action] ?? entry.action}</Badge></TableCell>
              <TableCell title={`${entry.accountId ?? "no account"} · ${entry.credential}`}>
                {entry.accountId ? nameOf(entry.accountId) ?? entry.accountId : entry.credential}
                {entry.credential !== "session" && <small className="ml-1 text-faint">{entry.credential}</small>}
              </TableCell>
              {showTarget && <TableCell title={entry.target ?? undefined}>{entry.target ? nameOf(entry.target) ?? (/^[a-f0-9]{64}$/.test(entry.target) ? entry.target.slice(0, 12) : entry.target) : <span className="text-faint">—</span>}</TableCell>}
              <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={summary}>{summary}</TableCell>
            </TableRow>
            {open === entry.id && <TableRow><TableCell colSpan={columns} className="bg-secondary/50 whitespace-normal"><Detail entry={entry} items={items.byId} /></TableCell></TableRow>}
          </Fragment>)}
        </TableBody>
      </Table>
    </TableFrame>
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Button variant="secondary" size="sm" disabled={!pages.length} onClick={() => setPages(pages.slice(0, -1))}>Newer</Button>
      <Button variant="secondary" size="sm" disabled={rows.length < limit} onClick={() => setPages([...pages, rows.at(-1)!.entry.id])}>Older</Button>
      <span>{pages.length ? `Page ${pages.length + 1}` : `Newest ${rows.length}`}</span>
    </div>
  </div>;
}
