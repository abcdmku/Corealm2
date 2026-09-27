/*
  The art review frame: everything on one screen, nothing scrolls the page.

    ┌ list ┬──────── header ────────┬ inspector ┐
    │      │                        │           │
    │      │         stage          │           │
    │      │                        │           │
    │      ├──────── strip ─────────┤           │
    └──────┴────────────────────────┴───────────┘

  The list and the inspector scroll inside themselves when they must; the stage takes what is left.
  Narrow containers drop the list first, then fold the inspector under the stage.
*/
import { useEffect, type ReactNode } from "react";
import { Button, Kbd } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";
import { ART_VERDICT_LABEL, ART_VERDICT_TONE, ART_VERDICTS, type ArtVerdict } from "../model/artReview.js";

export interface FocusLayoutProps {
  list?: ReactNode;
  header: ReactNode;
  stage: ReactNode;
  /** One or two rows under the stage: states, variants, tiers. */
  strip?: ReactNode;
  inspector?: ReactNode;
  className?: string;
}

export function FocusLayout({ list, header, stage, strip, inspector, className }: FocusLayoutProps) {
  return <div className="@container flex h-full min-h-0 flex-1">
    <div className={cn("grid h-full min-h-0 w-full grid-cols-[15rem_minmax(0,1fr)_20rem] grid-rows-[auto_minmax(0,1fr)_auto]",
      "@max-[72rem]:grid-cols-[minmax(0,1fr)_18rem] @max-[52rem]:grid-cols-1 @max-[52rem]:grid-rows-[auto_minmax(18rem,1fr)_auto_auto] @max-[52rem]:overflow-y-auto", className)}>
      {list && <nav className="focus-list row-span-3 flex min-h-0 flex-col overflow-hidden border-r border-border-subtle @max-[72rem]:hidden" aria-label="Records">{list}</nav>}
      <header className="focus-header flex min-h-11 min-w-0 items-center gap-3 border-b border-border-subtle px-3 py-1.5">{header}</header>
      {inspector && <aside className="focus-inspector row-span-3 flex min-h-0 flex-col overflow-y-auto border-l border-border-subtle @max-[52rem]:row-span-1 @max-[52rem]:border-t @max-[52rem]:border-l-0">{inspector}</aside>}
      <section className="focus-stage relative min-h-0 min-w-0 bg-[#202821]" aria-label="Stage">{stage}</section>
      {strip && <div className="focus-strip flex min-w-0 flex-col gap-1.5 border-t border-border-subtle px-3 py-2">{strip}</div>}
    </div>
  </div>;
}

/** A labelled row inside the strip or inspector. */
export function StripRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 items-center gap-2", className)}>
    <span className="w-14 shrink-0 text-right text-[11px] text-faint">{label}</span>
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{children}</div>
  </div>;
}

export interface StateItem { name: string; label?: string; available: boolean; synthetic?: boolean; verdict?: ArtVerdict }

/**
 * The states or poses a model can play. Keys 1–9 pick the first nine while nothing editable has
 * focus. A verdict shows as a coloured dot; unavailable states stay visible, disabled,
 * so a missing death clip is as easy to spot as a bad one.
 */
export function StateStrip({ states, value, onChange, hotkeys = true }: { states: readonly StateItem[]; value: string | null; onChange: (name: string) => void; hotkeys?: boolean }) {
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      const index = Number(event.key) - 1;
      const state = Number.isInteger(index) && index >= 0 && index < 9 ? states[index] : undefined;
      if (state?.available) { event.preventDefault(); onChange(state.name); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, states, onChange]);
  return <div className="flex min-w-0 flex-wrap items-center gap-1" role="toolbar" aria-label="States">
    {states.map((state, index) => <Button key={state.name} variant="ghost" size="sm" className="state-chip gap-1.5"
      aria-pressed={state.name === value} disabled={!state.available} data-state={state.name}
      title={!state.available ? "No clip for this state" : state.synthetic ? "Synthesised by the game" : undefined}
      onClick={() => onChange(state.name)}>
      {hotkeys && index < 9 && <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">{index + 1}</Kbd>}
      <span className={cn(!state.available && "line-through")}>{state.label ?? humanize(state.name)}</span>
      {state.synthetic && <span className="text-faint">*</span>}
      {state.verdict && <VerdictDot verdict={state.verdict} />}
    </Button>)}
  </div>;
}

export function VerdictDot({ verdict }: { verdict: ArtVerdict }) {
  const tone = ART_VERDICT_TONE[verdict];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-destructive")}
    role="img" aria-label={ART_VERDICT_LABEL[verdict]} title={ART_VERDICT_LABEL[verdict]} />;
}

/**
 * Approve / needs polish / replace for one target. Clicking the current verdict clears it.
 * With `hotkeys`, A, P and R set the verdict while nothing editable has focus.
 */
export function VerdictBar({ value, onChange, hotkeys = false, disabled, size = "sm" }: { value: ArtVerdict | undefined; onChange: (verdict: ArtVerdict | "clear") => void; hotkeys?: boolean; disabled?: boolean; size?: "sm" | "xs" }) {
  useEffect(() => {
    if (!hotkeys || disabled) return;
    const keys: Record<string, ArtVerdict> = { a: "approved", p: "polish", r: "replace" };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      const verdict = keys[event.key.toLowerCase()];
      if (verdict) { event.preventDefault(); onChange(verdict === value ? "clear" : verdict); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, disabled, value, onChange]);
  return <div className="verdict-bar inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5" role="group" aria-label="Verdict">
    {ART_VERDICTS.map(verdict => {
      const tone = ART_VERDICT_TONE[verdict];
      return <Button key={verdict} variant="segment" size={size} disabled={disabled} aria-pressed={value === verdict} data-verdict={verdict}
        className={cn(value === verdict && (tone === "ok" ? "aria-[pressed=true]:bg-ok-soft aria-[pressed=true]:text-ok" : tone === "warn" ? "aria-[pressed=true]:bg-warn-soft aria-[pressed=true]:text-warn" : "aria-[pressed=true]:bg-destructive-soft aria-[pressed=true]:text-destructive"))}
        onClick={() => onChange(value === verdict ? "clear" : verdict)}>
        {hotkeys && <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">{verdict[0]!.toUpperCase()}</Kbd>}{ART_VERDICT_LABEL[verdict]}
      </Button>;
    })}
  </div>;
}

export function humanize(name: string): string {
  const spaced = name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}
