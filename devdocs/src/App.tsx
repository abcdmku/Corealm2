import { Suspense, useEffect, useState } from "react";
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
import { RecordSetKey } from "./model/recordSetKey.js";
import { ShellSaveBar, useDirtyByWorkspace } from "./ui/ShellSaveBar.js";
import { ErrorState, LoadingRows } from "./ui/States.js";
import { WORKSPACES, type Route } from "./ui/workspaces.js";
import { REGISTRY } from "./workspaces/registry.js";
import "./styles/workspace.css";

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
  document.querySelector<HTMLInputElement>(".search-field input, .kits-search input, .requests-search input, .work-queue-search input, .ws-search input")?.focus();
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
  const tabs = workspace.views.filter(candidate => !candidate.hidden);
  const viewRoute = `${workspace.key}/${view.key}`;
  // A record page keeps its list beside it. The catalog's rail walks the compiled items so tier
  // gear is in the run; every other view walks the collection it browses.
  const navCollection = id !== undefined && id !== "$collection" && !workspace.fullBleed ? NAV_COLLECTION[viewRoute] ?? view.collection : undefined;

  const content = query.isPending ? <LoadingRows /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} />
    : Custom ? <Suspense fallback={<LoadingRows />}><Custom recordId={id} route={route} navigate={go} /></Suspense>
    : view.collection ? <CollectionPage key={view.collection} collection={view.collection} recordId={id} navigate={go} />
    : <ErrorState message={`No view registered for ${workspace.key}/${view.key}.`} />;

  return <PeekProvider navigate={go}><div className="app-shell" data-record={navCollection ? "true" : undefined}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar${mobileNav ? " sidebar-open" : ""}`} aria-label="Corealm authoring navigation">
      <button className="brand" onClick={() => go("home")}>
        <span className="brand-mark"><BookOpen size={17} /></span>
        <span><strong>Corealm</strong><small>{__DEVDOCS_PLAYER__ ? "GUIDE" : "CODEX"}</small></span>
      </button>
      <button className="sidebar-search" onClick={() => setPalette(true)}><Search size={14} /><span>Search</span><kbd>Ctrl K</kbd></button>
      <nav className="ws-nav">
        {WORKSPACES.filter(candidate => !candidate.devOnly || !__DEVDOCS_PLAYER__).map(candidate => {
          const Icon = candidate.icon;
          const selected = candidate.key === workspace.key;
          const dirtyCount = dirtyByWorkspace.get(candidate.key) ?? 0;
          return <button key={candidate.key} className={`nav-item${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => go(candidate.key)}>
            <Icon /><span>{candidate.label}</span>
            {dirtyCount > 0 && <span className="badge nav-dirty" data-tone="accent" title={`${dirtyCount} unsaved`}>{dirtyCount}</span>}
            {candidate.key === "home" && anythingDirty && !dirtyCount && <span className="nav-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
          </button>;
        })}
      </nav>
      <div className="sidebar-footer">
        <span>{__DEVDOCS_PLAYER__ ? "Player guide" : "Local editor"}</span>
        <button className="icon-button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
      </div>
    </aside>
    <div className="workspace">
      <header className="ws-tabs" aria-label={`${workspace.label} views`}>
        <button className="icon-button mobile-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={18} /> : <MenuIcon size={18} />}</button>
        <span className="ws-tabs-title">{workspace.label}</span>
        {tabs.length > 1 && tabs.map(candidate => <button key={candidate.key} aria-current={candidate.key === view.key ? "page" : undefined} onClick={() => go(`${workspace.key}/${candidate.key}`)}>{candidate.label}</button>)}
        {id !== undefined && <span className="ws-tabs-crumb"><ChevronRight size={12} /><code>{id}</code></span>}
        <div className="ws-tabs-actions">
          <button className="icon-button" aria-label="Search" onClick={() => setPalette(true)}><Search size={16} /></button>
        </div>
      </header>
      <main className="main-content ws-body" id="main-content" tabIndex={-1} data-full-bleed={workspace.fullBleed ? "true" : undefined} data-record={navCollection ? "true" : undefined}>
        <RecordSetKey.Provider value={viewRoute}>
          {navCollection && id !== undefined
            ? <div className="record-layout">
              <RecordNav setKey={viewRoute} collection={navCollection} currentId={id} open={recordId => go(viewRoute, recordId)} />
              <div className="record-layout-main" data-record-id={id}>{content}</div>
            </div>
            : content}
        </RecordSetKey.Provider>
      </main>
      {!__DEVDOCS_PLAYER__ && <ShellSaveBar navigate={go} />}
    </div>
    <CommandPalette open={palette} onOpenChange={setPalette} collections={collections} navigate={go} />
  </div></PeekProvider>;
}
