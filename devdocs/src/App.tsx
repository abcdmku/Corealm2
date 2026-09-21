import { Suspense, useEffect, useState } from "react";
import { can } from "./api/backend.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, ChevronRight, Menu as MenuIcon, Moon, Search, Sun, X } from "lucide-react";
import { collectionsQuery } from "./api/client.js";
import type { AppProps } from "./model/contracts.js";
import { draftStore } from "./model/store.js";
import { CollectionPage } from "./pages/CollectionPage.js";
import { CommandPalette } from "./ui/CommandPalette.js";
import { PeekProvider } from "./ui/Peek.js";
import { RecordNav } from "./ui/RecordNav.js";
import { Kbd } from "./components/ui/index.js";
import { cn } from "./lib/utils.js";
import { RecordSetKey } from "./model/recordSetKey.js";
import { SessionFooter } from "./ui/SessionFooter.js";
import { ShellSaveBar, useDirtyByWorkspace } from "./ui/ShellSaveBar.js";
import { ErrorState, LoadingRows } from "./ui/States.js";
import { WORKSPACES, type Route } from "./ui/workspaces.js";
import { CRUMBS, REGISTRY } from "./workspaces/registry.js";
import { Button, Badge } from "./components/ui/index.js";
import { PANEL } from "./ui/layout.js";

function initialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem("corealm-codex-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* Storage can be disabled. */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const isEditing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

/**
 * Whether the browser's own text undo should win over the draft history. A field owns its edit
 * buffer, so it only matters while that buffer is open: once a value is committed the field keeps
 * focus, and Ctrl+Z there means "undo the change I just made". Controls outside the field model
 * (search boxes and the like) keep native undo.
 */
function textUndoWins(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest<HTMLElement>(".field[data-phase]");
  if (field) return field.dataset.phase === "editing";
  return isEditing(target);
}

function focusSearch(): void {
  document.querySelector<HTMLInputElement>('main input[aria-label^="Search"], main input[aria-label^="Find"]')?.focus();
}

const NAV_COLLECTION: Readonly<Record<string, string>> = { "items/catalog": "compiled-items" };

export default function App({ route, navigate }: { route: Route; navigate: AppProps["navigate"] }) {
  const query = useQuery(collectionsQuery());
  const queryClient = useQueryClient();
  const dirtyByWorkspace = useDirtyByWorkspace();
  const anythingDirty = dirtyByWorkspace.size > 0;
  const [theme, setTheme] = useState(initialTheme);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const { workspace, view, id } = route;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("corealm-codex-theme", theme); } catch { /* Theme still works without persistence. */ }
  }, [theme]);

  useEffect(() => { draftStore.configure({ queryClient, notify: { success: message => { toast.success(message); }, error: message => { toast.error(message); }, message: message => { toast.message(message); } } }); }, [queryClient]);

  // One guard for the whole editor: leaving with unsaved records or contributor drafts asks first.
  useEffect(() => {
    if (!anythingDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anythingDirty]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "k") { event.preventDefault(); setPalette(value => !value); }
      // Ctrl+S always saves everything; the browser's "save page" dialog is never wanted here.
      if (modifier && key === "s" && !event.shiftKey && !event.altKey) { event.preventDefault(); void draftStore.saveAll(); return; }
      // Undo and redo are global, except while a field's edit buffer is open.
      if (modifier && !event.altKey && !textUndoWins(event.target)) {
        if (key === "z" && !event.shiftKey) { event.preventDefault(); draftStore.undo(); return; }
        if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); draftStore.redo(); return; }
      }
      if (event.key === "Escape") setMobileNav(false);
      const target = event.target as HTMLElement;
      if (event.key === "/" && !isEditing(target)) {
        event.preventDefault();
        focusSearch();
        if (!document.activeElement || document.activeElement === document.body) setPalette(true);
      }
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  useEffect(() => {
    setMobileNav(false);
    if (!workspace.fullBleed) document.querySelector(".record-layout-main, .main-content")?.scrollTo({ top: 0 });
  }, [workspace, view, id]);

  const go: AppProps["navigate"] = (name, recordId) => { navigate(name, recordId); setMobileNav(false); };
  const collections = query.data ?? [];
  const Custom = REGISTRY[workspace.key]?.[view.key];
  const Crumb = CRUMBS[workspace.key];
  const tabs = workspace.views.filter(candidate => !candidate.hidden);
  const viewRoute = `${workspace.key}/${view.key}`;
  // A record page keeps its list beside it. The catalog's rail walks the compiled items so tier
  // gear is in the run; every other view walks the collection it browses.
  const navCollection = id !== undefined && id !== "$collection" && !workspace.fullBleed ? NAV_COLLECTION[viewRoute] ?? view.collection : undefined;

  const content = query.isPending ? <LoadingRows /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} />
    : Custom ? <Suspense fallback={<LoadingRows />}><Custom recordId={id} route={route} navigate={go} /></Suspense>
    : view.collection ? <CollectionPage key={view.collection} collection={view.collection} recordId={id} navigate={go} />
    : <ErrorState message={`No view registered for ${workspace.key}/${view.key}.`} />;

  return <PeekProvider navigate={go}><div className="app-shell grid h-dvh min-h-[420px] grid-cols-[10.75rem_minmax(0,1fr)] max-md:block" data-record={navCollection ? "true" : undefined}>
    <a className="fixed -top-16 left-5 z-[100] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:top-2" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    {mobileNav && <button className="fixed inset-0 z-[39] hidden bg-black/65 max-md:block" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={cn(
      "sidebar flex min-h-0 flex-col border-r border-border bg-sidebar",
      "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-56 max-md:transition-transform",
      !mobileNav && "max-md:-translate-x-full",
    )} aria-label="Corealm authoring navigation">
      <button className="flex w-full cursor-pointer items-center gap-2 px-3 pt-2.5 pb-1.5 text-left" onClick={() => go("home")}>
        <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground"><BookOpen size={15} /></span>
        <span className="leading-tight"><strong className="block text-[13px] font-semibold">Corealm</strong><small className="mt-px block text-[10px] tracking-[0.12em] text-faint">{__DEVDOCS_PLAYER__ ? "GUIDE" : "CODEX"}</small></span>
      </button>
      <button className={cn(PANEL, "mx-2 mt-0.5 mb-1.5 flex h-7 cursor-pointer items-center gap-1.5 px-2 text-left text-xs text-muted-foreground hover:text-foreground")} onClick={() => setPalette(true)}>
        <Search size={13} /><span>Search</span><Kbd className="ml-auto">Ctrl K</Kbd>
      </button>
      <nav className="flex min-h-0 flex-col gap-px overflow-y-auto p-1.5">
        {WORKSPACES.filter(candidate => !candidate.devOnly || !__DEVDOCS_PLAYER__).map(candidate => {
          const Icon = candidate.icon;
          const selected = candidate.key === workspace.key;
          const dirtyCount = dirtyByWorkspace.get(candidate.key) ?? 0;
          return <button key={candidate.key} className={cn(
            "nav-item flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground [&>svg]:size-[15px] [&>svg]:text-faint",
            selected && "bg-selected text-foreground [&>svg]:text-primary",
          )} aria-current={selected ? "page" : undefined} onClick={() => go(candidate.key)}>
            <Icon /><span className="min-w-0 flex-1 truncate">{candidate.label}</span>
            {dirtyCount > 0 && <Badge variant="accent" className="h-4 px-1" title={`${dirtyCount} unsaved`}>{dirtyCount}</Badge>}
            {candidate.key === "home" && anythingDirty && !dirtyCount && <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" aria-label="Unsaved changes" />}
          </button>;
        })}
      </nav>
      <div className="mt-auto flex items-center gap-2 border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        <SessionFooter />
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</Button>
      </div>
    </aside>
    <div className="min-w-0 flex flex-col overflow-hidden max-md:h-dvh">
      <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border-subtle bg-background px-3" aria-label={`${workspace.label} views`}>
        <Button variant="ghost" size="icon-sm" className="hidden max-md:inline-flex" aria-label={mobileNav ? "Close navigation" : "Open navigation"} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={18} /> : <MenuIcon size={18} />}</Button>
        <span className="mr-2 text-[13px] font-semibold text-foreground">{workspace.label}</span>
        {tabs.length > 1 && tabs.map(candidate => <button key={candidate.key} className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-selected aria-[current=page]:text-foreground" aria-current={candidate.key === view.key ? "page" : undefined} onClick={() => go(`${workspace.key}/${candidate.key}`)}>{candidate.label}</button>)}
        {id !== undefined && <span className="min-w-0 ml-1 inline-flex items-center gap-1 overflow-hidden text-xs text-faint"><ChevronRight size={12} />
          <code className="truncate text-[11px] text-muted-foreground">{Crumb ? <Suspense fallback={id}><Crumb id={id} /></Suspense> : id}</code>
        </span>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Search" onClick={() => setPalette(true)}><Search size={16} /></Button>
        </div>
      </header>
      <main className={cn("main-content @container flex min-h-0 flex-1 flex-col outline-none", !workspace.fullBleed && "min-[1400px]:[html[data-peek=open]_&]:pr-[clamp(420px,34vw,520px)]", workspace.fullBleed || navCollection ? "overflow-hidden" : "overflow-y-auto")} id="main-content" tabIndex={-1} data-full-bleed={workspace.fullBleed ? "true" : undefined} data-record={navCollection ? "true" : undefined}>
        <RecordSetKey.Provider value={viewRoute}>
          {navCollection && id !== undefined
            ? <div className="grid min-h-0 flex-1 grid-cols-[14.5rem_minmax(0,1fr)] max-lg:grid-cols-[12.25rem_minmax(0,1fr)] max-md:grid-cols-1">
              <RecordNav setKey={viewRoute} collection={navCollection} currentId={id} open={recordId => go(viewRoute, recordId)} />
              <div className="record-layout-main @container min-h-0 min-w-0 overflow-y-auto" data-record-id={id}>{content}</div>
            </div>
            : content}
        </RecordSetKey.Provider>
      </main>
      {can("write") && <ShellSaveBar navigate={go} />}
    </div>
    <CommandPalette open={palette} onOpenChange={setPalette} collections={collections} navigate={go} />
  </div></PeekProvider>;
}
