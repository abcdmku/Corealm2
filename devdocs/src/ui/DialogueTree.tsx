import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CornerDownRight, CornerUpLeft, MessageSquare, Square } from "lucide-react";
import type { ContentRow } from "../model/contracts.js";
import type { SummaryContext } from "../model/summaries.js";
import { Badge, Button } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";

/*
  A conversation as a tree you can read top to bottom.

    ▾ 💬 Cairnkeeper Ode  You will forgive me. I am counting…                     2 variants
      ├ ↳ Nineteen wrong. Show me one.        quest unstarted · Melee 10 · starts Long Cairn
      │   ▸ 💬 The Great Cairn on terrace four…                                      3 replies
      └ ↳ That is all for now.                                                           ends

  An NPC line is a row with its speaker and text (two lines, full text on hover). Each player reply
  hangs under it on a real tree guide, with what gates it and what it does as badges, and ends in
  one of: the next line (nested), "back to <line>" when it loops, or "ends". Lines with replies
  fold; the first two levels start open. Clicking a line or a reply opens that dialogue record.
*/

const OPEN_DEPTH = 2;
const MAX_DEPTH = 12;

export interface DialogueTreeProps {
  rootId: string;
  nodes: ReadonlyMap<string, ContentRow>;
  ctx: SummaryContext;
  open: (nodeId: string) => void;
}

const rows = (value: unknown): ContentRow[] => Array.isArray(value) ? value.filter((entry): entry is ContentRow => entry !== null && typeof entry === "object") : [];
const str = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const titleCase = (value: string): string => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, first => first.toUpperCase());

export function DialogueTree({ rootId, nodes, ctx, open }: DialogueTreeProps) {
  const [expandAll, setExpandAll] = useState<boolean | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const name = (kind: string, id: unknown) => { const key = str(id); if (!key) return "?"; const record = ctx.lookup(kind, key); return record ? String(record.name ?? key) : key; };
  const describe = useMemo(() => conditionText(name), [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const describeEffect = useMemo(() => effectText(name), [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const setAll = (value: boolean) => { setExpandAll(value); setGeneration(count => count + 1); };

  return <div className="flex w-full min-w-0 flex-col gap-1">
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="xs" onClick={() => setAll(true)}>Expand all</Button>
      <Button variant="ghost" size="xs" onClick={() => setAll(false)}>Collapse all</Button>
    </div>
    <ul role="tree" className="m-0 flex list-none flex-col p-0 text-xs" key={generation}>
      <Line id={rootId} nodes={nodes} depth={0} ancestors={new Set()} expandAll={expandAll} open={open} describe={describe} describeEffect={describeEffect} name={name} />
    </ul>
  </div>;
}

interface LineProps {
  id: string; nodes: ReadonlyMap<string, ContentRow>; depth: number; ancestors: ReadonlySet<string>; expandAll: boolean | undefined;
  open: (nodeId: string) => void; describe: (condition: ContentRow) => string; describeEffect: (effect: ContentRow) => string;
  name: (kind: string, id: unknown) => string; speakerAbove?: string;
}

/** One NPC line and the replies under it. */
function Line({ id, nodes, depth, ancestors, expandAll, open, describe, describeEffect, name, speakerAbove }: LineProps) {
  const node = nodes.get(id);
  const options = rows(node?.options);
  const [expanded, setExpanded] = useState(expandAll ?? depth < OPEN_DEPTH);
  if (!node) {
    return <li role="treeitem" className="flex min-h-7 items-center gap-2 text-destructive"><Square className="size-3" /> <span className="font-mono">{id}</span> is missing</li>;
  }
  const speaker = str(node.speaker);
  const variants = rows(node.variants).length;
  const branch = new Set(ancestors).add(id);
  const text = str(node.text) ?? "";

  return <li role="treeitem" aria-expanded={options.length ? expanded : undefined} className="flex min-w-0 flex-col">
    <div className="group flex min-h-7 min-w-0 items-start gap-1.5 rounded-md py-1 pr-2 hover:bg-accent">
      {options.length
        ? <Button variant="ghost" size="icon-xs" className="mt-px" aria-label={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded(!expanded)}><ChevronRight className={cn("transition-transform", expanded && "rotate-90")} /></Button>
        : <span className="size-5 shrink-0" />}
      <MessageSquare className="mt-1 size-3.5 shrink-0 text-faint" aria-hidden />
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left" title={`${id}\n\n${text}`} onClick={() => open(id)}>
        {speaker && speaker !== speakerAbove && <span className="shrink-0 font-semibold text-foreground">{speaker}</span>}
        <span className="line-clamp-2 min-w-0 text-muted-foreground group-hover:text-foreground">{text}</span>
      </button>
      <span className="flex shrink-0 items-center gap-1 pt-0.5">
        {variants > 0 && <Badge variant="outline" title="Alternative texts shown by quest state">{variants} {variants === 1 ? "variant" : "variants"}</Badge>}
        {!expanded && options.length > 0 && <Badge>{options.length} {options.length === 1 ? "reply" : "replies"}</Badge>}
        <span className="hidden font-mono text-[10px] text-faint group-hover:inline">{id}</span>
      </span>
    </div>
    {expanded && options.length > 0 && <ul role="group" className="m-0 ml-[1.625rem] flex list-none flex-col p-0">
      {options.map((option, index) => <Reply key={str(option.id) ?? index} option={option} last={index === options.length - 1} parentId={id} nodes={nodes} depth={depth}
        ancestors={branch} expandAll={expandAll} open={open} describe={describe} describeEffect={describeEffect} name={name} speaker={speaker} />)}
    </ul>}
  </li>;
}

/** A player reply: its text, what gates it, what it does, and where it goes. */
function Reply({ option, last, parentId, nodes, depth, ancestors, expandAll, open, describe, describeEffect, name, speaker }: Omit<LineProps, "id" | "speakerAbove"> & { option: ContentRow; last: boolean; parentId: string; speaker?: string }) {
  const next = str(option.next);
  const loops = next !== undefined && ancestors.has(next);
  const tooDeep = depth + 1 >= MAX_DEPTH;
  const gates = [...rows(option.showIf), ...rows(option.requires)].map(describe);
  const effects = rows(option.effects).map(describeEffect);
  const target = next ? nodes.get(next) : undefined;
  const outcome: ReactNode = next === undefined
    ? <Badge variant="outline">ends</Badge>
    : loops || tooDeep
      ? <Badge variant="info" className="cursor-pointer" title={str(target?.text)} onClick={() => open(next)}><CornerUpLeft />back to {clipText(str(target?.text) ?? next, 28)}</Badge>
      : undefined;

  return <li role="treeitem" className={cn(
    "relative flex min-w-0 flex-col pl-4",
    // Tree guides: a vertical rule down the siblings (stopping at the last one) and a tick into each row.
    "before:absolute before:top-0 before:left-0 before:border-l before:border-border before:content-['']",
    last ? "before:h-3.5" : "before:bottom-0",
    "after:absolute after:top-3.5 after:left-0 after:w-3 after:border-t after:border-border after:content-['']",
  )}>
    <div className="group flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-0.5 pr-2 pl-1 hover:bg-accent">
      <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-link hover:underline" title={str(option.id)} onClick={() => open(next ?? parentId)}>
        <CornerDownRight className="size-3.5 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0">{str(option.text) ?? "(no text)"}</span>
      </button>
      {gates.map((gate, index) => <Badge key={`g${index}`} variant="warn" title="Shown or allowed only when">{gate}</Badge>)}
      {effects.map((effect, index) => <Badge key={`e${index}`} variant="accent" title="Happens when chosen">{effect}</Badge>)}
      {outcome}
    </div>
    {next !== undefined && !loops && !tooDeep && <ul role="group" className="m-0 flex list-none flex-col p-0">
      <Line id={next} nodes={nodes} depth={depth + 1} ancestors={ancestors} expandAll={expandAll} open={open} describe={describe} describeEffect={describeEffect} name={name} speakerAbove={speaker} />
    </ul>}
  </li>;
}

const clipText = (value: string, length: number): string => value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;

function conditionText(name: (kind: string, id: unknown) => string) {
  return (condition: ContentRow): string => {
    switch (condition.kind) {
      case "questStatus": return `${name("quest", condition.questId)} ${String(condition.status)}`;
      case "questStage": return `${name("quest", condition.questId)} stage ${condition.min ?? "0"}–${condition.max ?? "end"}`;
      case "questFlag": return `${String(condition.flag)}${condition.value === false ? " unset" : ""}`;
      case "questCounter": return `${String(condition.counter)} ≥ ${condition.min ?? 0}`;
      case "questOffer": return `offers ${name("quest", condition.questId)}`;
      case "skill": return `${titleCase(String(condition.skill))} ${String(condition.level)}`;
      case "item": return `has ${condition.quantity ?? 1} ${name("item", condition.itemId)}`;
      case "lacksItem": return `lacks ${name("item", condition.itemId)}`;
      case "currency": return `${String(condition.amount)} marks`;
      default: return titleCase(String(condition.kind ?? "condition"));
    }
  };
}

function effectText(name: (kind: string, id: unknown) => string) {
  return (effect: ContentRow): string => {
    switch (effect.kind) {
      case "startQuest": return `starts ${name("quest", effect.questId)}`;
      case "setFlag": return `sets ${String(effect.flag)}`;
      case "bumpCounter": return `${String(effect.counter)} +${effect.by ?? 1}`;
      case "giveItem": return `gives ${effect.quantity ?? 1} ${name("item", effect.itemId)}`;
      case "takeItem": return `takes ${effect.quantity ?? 1} ${name("item", effect.itemId)}`;
      case "grantXp": return `+${String(effect.amount)} ${titleCase(String(effect.skill))} xp`;
      case "grantCurrency": return `+${String(effect.amount)} marks`;
      default: return titleCase(String(effect.kind ?? "effect"));
    }
  };
}
