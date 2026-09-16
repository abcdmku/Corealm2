import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import type { RecordRef } from "../model/origin.js";
import { findRecord, summaryContext, useReferenceIndex } from "../model/refs.js";
import { summarize } from "../model/summaries.js";
import { REGISTRY } from "../workspaces/registry.js";
import { lazyComponent, preloadView } from "../workspaces/lazyView.js";
import { LoadingRows } from "./States.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";
import { parseRoute, routePath } from "./workspaces.js";
import { Button } from "../components/ui/index.js";
import { EMPTY } from "./layout.js";

/*
  A peek is the target record's own page in a right-side sheet (docs/devdocs-inputs.md §3.4):
  click a reference chip and fix the loot table without leaving the creature. The page inside is
  the same component the router would mount for `navigate(collection, id)`, resolved through the
  same `routePath` → `parseRoute` → `REGISTRY` mapping, so its draft goes through the shared store
  and shows in the shell save bar like any other edit. Peeks are one deep: opening a second
  replaces the first. Escape closes; "Open" navigates for real.
*/

export interface PeekTarget { collection: string; id: string }

interface PeekContextValue {
  mounted: boolean;
  current?: PeekTarget;
  open: (ref: RecordRef | PeekTarget) => void;
  close: () => void;
  navigate?: AppProps["navigate"];
}

const PeekContext = createContext<PeekContextValue>({ mounted: false, open: () => undefined, close: () => undefined });

/** `open` shows a record in the peek sheet; `close` hides it. Without a provider both are no-ops. */
export function usePeek(): Pick<PeekContextValue, "open" | "close" | "current" | "navigate"> {
  const { open, close, current, navigate } = useContext(PeekContext);
  return { open, close, current, navigate };
}

/**
 * Mount once in the app shell around the workspace content. Nested providers defer to the outer
 * one, so a page can mount its own for a self-contained demo without doubling the sheet.
 */
export function PeekProvider({ navigate, children }: { navigate: AppProps["navigate"]; children: ReactNode }) {
  const parent = useContext(PeekContext);
  const [current, setCurrent] = useState<PeekTarget>();
  // Load the target's page module before the sheet mounts. Suspending inside a record that is
  // animating its model viewer can restart the render every frame, so the peek would otherwise sit
  // on its skeleton forever. Showing it anyway on a failed load lets Suspense report the error.
  const open = useCallback((ref: RecordRef | PeekTarget) => {
    const target = { collection: ref.collection, id: ref.id };
    const route = parseRoute(routePath(target.collection, target.id).split("/").filter(Boolean).map(decodeURIComponent));
    const view = REGISTRY[route.workspace.key]?.[route.view.key];
    const pending = preloadView(view) ?? (route.view.collection ? CollectionPage.preload() : undefined);
    if (pending) void pending.then(() => setCurrent(target), () => setCurrent(target));
    else setCurrent(target);
  }, []);
  const close = useCallback(() => setCurrent(undefined), []);
  // The shell reserves room for the sheet so it never sits on top of the record that opened it.
  useEffect(() => {
    if (parent.mounted) return;
    if (current) document.documentElement.dataset.peek = "open"; else delete document.documentElement.dataset.peek;
    return () => { delete document.documentElement.dataset.peek; };
  }, [current, parent.mounted]);
  const value = useMemo<PeekContextValue>(() => ({ mounted: true, current, open, close, navigate }), [current, open, close, navigate]);
  if (parent.mounted) return <>{children}</>;
  return <PeekContext.Provider value={value}>
    {children}
    {current && <Peek target={current} navigate={navigate} onOpen={open} onClose={close} />}
  </PeekContext.Provider>;
}

// The browser fallback is loaded the same way as a workspace view: a suspending tree beside an
// animating model viewer can be restarted every frame and never commit.
const CollectionPage = lazyComponent(() => import("../pages/CollectionPage.js").then(module => ({ default: module.CollectionPage })));

/** The sheet itself. `PeekProvider` renders it; pages do not mount this directly. */
export function Peek({ target, navigate, onOpen, onClose }: { target: PeekTarget; navigate: AppProps["navigate"]; onOpen: (ref: PeekTarget) => void; onClose: () => void }) {
  const sheet = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const record = findRecord(index, target.collection, target.id);
  const summary = record ? summarize(target.collection, record, ctx) : undefined;
  const route = useMemo(() => parseRoute(routePath(target.collection, target.id).split("/").filter(Boolean).map(decodeURIComponent)), [target]);
  const Custom = REGISTRY[route.workspace.key]?.[route.view.key];

  // A page inside the peek that opens another record stays in the peek; leaving for a list navigates for real.
  const innerNavigate: AppProps["navigate"] = useCallback((name, recordId) => {
    if (name && recordId !== undefined) { onOpen({ collection: name, id: recordId }); return; }
    onClose();
    navigate(name, recordId);
  }, [navigate, onOpen, onClose]);

  useEffect(() => {
    returnTo.current = document.activeElement;
    sheet.current?.focus({ preventScroll: true });
    return () => { if (returnTo.current instanceof HTMLElement) returnTo.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    // Popovers and editing fields claim Escape first and mark it handled; only an unclaimed Escape closes the peek.
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [onClose]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [target]);

  const title = summary?.title ?? target.id;
  return <aside ref={sheet} className="fixed inset-y-0 right-0 z-42 flex w-[clamp(420px,34vw,520px)] max-w-[92vw] flex-col border-l border-border bg-card shadow-[-12px_0_40px_var(--shadow)] outline-none" role="dialog" aria-modal="false" aria-label={`Peek: ${title}`} tabIndex={-1} data-collection={target.collection} data-id={target.id}>
    <header className="flex min-h-11 flex-none items-center gap-2 border-b border-border-subtle py-1.5 pr-2.5 pl-3">
      <Thumb spec={summary?.thumb ?? { kind: "glyph", icon: ArrowUpRight, letter: target.id.slice(0, 2).toUpperCase() }} size="m" />
      <div className="flex min-w-0 flex-1 flex-col leading-tight"><strong className="truncate text-[13px] font-semibold">{title}</strong><small className="truncate text-[11px] text-faint">{labelFor(target.collection)} · <code className="font-mono">{target.id}</code></small></div>
      <Button variant="secondary" size="sm" onClick={() => { onClose(); navigate(target.collection, target.id); }} title="Open this record in the workspace"><ArrowUpRight size={12} /> Open</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close peek" title="Close (Esc)" onClick={onClose}><X size={15} /></Button>
    </header>
    {/* A record page stacks in the sheet: one column, the rail below the sheet and static, no page width cap. */}
    <div ref={body} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:thin] [&_.grid:has(>aside)]:max-w-none [&_.grid:has(>aside)]:grid-cols-1 [&_.grid:has(>aside)]:gap-4 [&_.grid>aside]:static">
      <Suspense fallback={<LoadingRows />}>
        {Custom
          ? <Custom key={`${target.collection}:${target.id}`} recordId={route.id} route={route} navigate={innerNavigate} />
          : route.view.collection
            ? <CollectionPage key={`${target.collection}:${target.id}`} collection={route.view.collection} recordId={route.id} navigate={innerNavigate} />
            : <p className={EMPTY}>No page is registered for {labelFor(target.collection).toLowerCase()}.</p>}
      </Suspense>
    </div>
  </aside>;
}
