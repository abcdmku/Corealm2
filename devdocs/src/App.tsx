import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { BookOpen, ChevronDown, ChevronRight, ClipboardList, Menu as MenuIcon, Moon, Search, Sun, X } from "lucide-react";
import { apiGet, collectionsQuery } from "./api/client.js";
import type { AppProps } from "./model/contracts.js";
import { CollectionPage } from "./pages/CollectionPage.js";
import { HomePage } from "./pages/HomePage.js";
import { CommandPalette } from "./ui/CommandPalette.js";
import { ErrorState, LoadingRows } from "./ui/States.js";
import { groupFor, iconFor, labelFor, navigationGroups } from "./ui/library.js";

const KitsPage = lazy(() => import("./pages/KitsPage.js"));
const FormulasPage = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("./pages/FormulasPage.js"));
const WorldPage = lazy(() => import("./pages/WorldPage.js").then(module => ({ default: module.WorldPage })));
const WorkQueuePage = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("./pages/WorkQueuePage.js"));
const COLLAPSED_KEY = "corealm-codex-collapsed-groups";

function initialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem("corealm-codex-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* Storage can be disabled. */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readCollapsed(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {};
  } catch { return {}; }
}

function focusSearch(): void {
  document.querySelector<HTMLInputElement>(".search-field input, .kits-search input, .requests-search input, .work-queue-search input")?.focus();
}

export default function App({ collection, recordId, navigate }: AppProps) {
  const query = useQuery(collectionsQuery());
  const requests = useQuery({ queryKey: ["requests"], queryFn: () => apiGet<{ requests?: unknown[] }>("requests"), enabled: !__DEVDOCS_PLAYER__, staleTime: 15_000, refetchOnWindowFocus: false, retry: false });
  const [theme, setTheme] = useState(initialTheme);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("corealm-codex-theme", theme); } catch { /* Theme still works without persistence. */ }
  }, [theme]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(value => !value); }
      if (event.key === "Escape") setMobileNav(false);
      const target = event.target as HTMLElement;
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !target.isContentEditable) {
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
    document.querySelector(".main-content")?.scrollTo({ top: 0 });
    document.querySelector(".sidebar .nav-item[aria-current=page]")?.scrollIntoView({ block: "nearest" });
  }, [collection, recordId]);

  const go: AppProps["navigate"] = (name, id) => { navigate(name, id); setMobileNav(false); };
  const collections = query.data ?? [];
  const groups = navigationGroups(collections);
  const isWorkQueue = collection === "work-queue" || collection === "requests" || collection === "review";
  const openRequests = Array.isArray(requests.data?.requests) ? requests.data.requests.length : 0;
  const group = collection ? groupFor(collection) : undefined;
  // Quiet groups start collapsed; any explicit toggle is remembered per group.
  const groupIsOpen = (label: string, quiet?: boolean) => collapsed[label] ?? !quiet;
  function toggleGroup(label: string, quiet?: boolean) {
    setCollapsed(previous => {
      const next = { ...previous, [label]: !(previous[label] ?? !quiet) };
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar${mobileNav ? " sidebar-open" : ""}`} aria-label="Corealm authoring navigation">
      <button className="brand" onClick={() => go()}>
        <span className="brand-mark"><BookOpen size={17} /></span>
        <span><strong>Corealm</strong><small>{__DEVDOCS_PLAYER__ ? "GUIDE" : "CODEX"}</small></span>
      </button>
      <button className="sidebar-search" onClick={() => setPalette(true)}><Search size={14} /><span>Search</span><kbd>Ctrl K</kbd></button>
      <nav>
        <button className={`nav-item${!collection ? " selected" : ""}`} aria-current={!collection ? "page" : undefined} onClick={() => go()}><BookOpen size={15} /><span>Home</span></button>
        {!__DEVDOCS_PLAYER__ && <button className={`nav-item${isWorkQueue ? " selected" : ""}`} aria-current={isWorkQueue ? "page" : undefined} onClick={() => go("work-queue")}><ClipboardList size={15} /><span>Work queue</span>{openRequests > 0 && <span className="badge" data-tone="warn">{openRequests}</span>}</button>}
        {groups.map(grp => {
          const open = groupIsOpen(grp.label, grp.quiet) || grp.label === group;
          return <div className={`nav-group${open ? "" : " is-collapsed"}`} key={grp.label}>
            <button type="button" className="nav-group-head" aria-expanded={open} onClick={() => toggleGroup(grp.label, grp.quiet)}><ChevronDown size={12} />{grp.label}</button>
            {grp.entries.map(entry => {
              const Icon = iconFor(entry.name);
              const selected = collection === entry.name || entry.sources.includes(collection ?? "");
              return <button key={entry.name} className={`nav-item${selected ? " selected" : ""}`} aria-label={entry.label} aria-current={selected ? "page" : undefined} onClick={() => go(entry.name)} title={entry.generated ? `${entry.label} (generated, read only)` : entry.label}>
                <Icon size={15} /><span>{entry.label}</span>{entry.count > 0 && <small>{entry.count}</small>}
              </button>;
            })}
          </div>;
        })}
      </nav>
      <div className="sidebar-footer"><span>{collections.reduce((sum, item) => sum + item.count, 0).toLocaleString()} records</span><button className="icon-button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={18} /> : <MenuIcon size={18} />}</button>
        <div className="breadcrumbs">
          <button onClick={() => go()}>Home</button>
          {group && <><ChevronRight size={12} /><span>{group}</span></>}
          {collection && <><ChevronRight size={12} /><button onClick={() => go(collection)}>{labelFor(collection)}</button></>}
          {recordId !== undefined && <><ChevronRight size={12} /><span className="mono">{recordId}</span></>}
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Search" onClick={() => setPalette(true)}><Search size={16} /></button>
        </div>
      </header>
      <main className="main-content" id="main-content" tabIndex={-1}>
        <motion.div key={`${collection ?? "home"}:${recordId ?? ""}`} className="page-transition" initial={reduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .14 }}>
          {query.isPending ? <LoadingRows /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            : collection === "kits" ? <Suspense fallback={<LoadingRows />}><KitsPage navigate={go} /></Suspense>
            : collection === "world" && recordId === undefined ? <Suspense fallback={<LoadingRows />}><WorldPage navigate={go} /></Suspense>
            : collection === "formulas" && FormulasPage ? <Suspense fallback={<LoadingRows />}><FormulasPage /></Suspense>
            : isWorkQueue && WorkQueuePage ? <Suspense fallback={<LoadingRows />}><WorkQueuePage navigate={go} /></Suspense>
            : collection ? <CollectionPage collection={collection} recordId={recordId} navigate={go} />
            : <HomePage collections={collections} navigate={go} />}
        </motion.div>
      </main>
    </div>
    <CommandPalette open={palette} onOpenChange={setPalette} collections={collections} navigate={go} />
  </div>;
}
