import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { BookOpen, ChevronRight, Menu, Moon, Search, Shield, SlidersHorizontal, Sun, X } from "lucide-react";
import { collectionsQuery } from "./api/client.js";
import type { AppProps } from "./model/contracts.js";
import { CollectionPage } from "./pages/CollectionPage.js";
import { HomePage } from "./pages/HomePage.js";
import { CommandPalette } from "./ui/CommandPalette.js";
import { ErrorState, LoadingRows } from "./ui/States.js";
import { iconFor, labelFor, navigationGroups } from "./ui/library.js";

const KitsPage = lazy(() => import("./pages/KitsPage.js"));
const ProgressionPage = lazy(() => import("./pages/ProgressionPage.js"));
const FormulasPage = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("./pages/FormulasPage.js"));
const WorldPage = lazy(() => import("./pages/WorldPage.js").then(module => ({ default: module.WorldPage })));
const WorkQueuePage = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("./pages/WorkQueuePage.js"));

function initialTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem("corealm-codex-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* Storage can be disabled. */ }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>(".search-field input, .kits-search input, .requests-search input, .work-queue-search input");
  if (input) input.focus();
}

export default function App({ collection, recordId, navigate }: AppProps) {
  const query = useQuery(collectionsQuery());
  const [theme, setTheme] = useState(initialTheme);
  const [palette, setPalette] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("corealm-codex-theme", theme); } catch { /* Theme still works without persistence. */ }
  }, [theme]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(value => !value);
      }
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

  const go: AppProps["navigate"] = (name, id) => {
    navigate(name, id);
    setMobileNav(false);
  };
  const collections = query.data ?? [];
  const groups = navigationGroups(collections);
  const isWorkQueue = collection === "work-queue" || collection === "requests" || collection === "review";

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar${mobileNav ? " sidebar-open" : ""}`} aria-label="Corealm authoring navigation">
      <button className="brand" onClick={() => go()}>
        <span className="brand-mark"><BookOpen size={23} /></span>
        <span><strong>Corealm</strong><small>CODEX</small></span>
      </button>
      <button className="sidebar-search" onClick={() => setPalette(true)}><Search size={16} /><span>Search the codex</span><kbd>Ctrl K</kbd></button>
      <nav>
        <button className={`nav-item nav-home${!collection ? " selected" : ""}`} aria-current={!collection ? "page" : undefined} onClick={() => go()}><BookOpen size={17} /><span>Overview</span></button>
        {!__DEVDOCS_PLAYER__ && <button className={`nav-item${isWorkQueue ? " selected" : ""}`} aria-current={isWorkQueue ? "page" : undefined} onClick={() => go("work-queue")}><BookOpen size={16} /><span>Work queue</span></button>}
        {groups.map(group => <div className="nav-group" key={group.label}>
          <h2>{group.label}</h2>
          {group.entries.map(entry => {
            const Icon = iconFor(entry.name);
            const selected = collection === entry.name || entry.sources.includes(collection ?? "");
            return <button key={entry.name} aria-label={entry.label} className={`nav-item${selected ? " selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => go(entry.name)}><Icon size={16} /><span>{entry.label}</span><small>{entry.count}</small></button>;
          })}
        </div>)}
        <div className="nav-group nav-group-tools">
          <h2>Tools</h2>
          <button className={`nav-item${collection === "kits" ? " selected" : ""}`} aria-current={collection === "kits" ? "page" : undefined} onClick={() => go("kits")}><Shield size={16} /><span>Kits</span></button>
          {!__DEVDOCS_PLAYER__ && <button className={`nav-item${collection === "formulas" ? " selected" : ""}`} aria-current={collection === "formulas" ? "page" : undefined} onClick={() => go("formulas")}><SlidersHorizontal size={16} /><span>Formulas</span></button>}
        </div>
      </nav>
      <div className="sidebar-footer"><span>Corealm library</span><button className="icon-button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="breadcrumbs"><button onClick={() => go()}>Codex</button>{collection && <><ChevronRight size={13} /><button onClick={() => go(collection)}>{labelFor(collection)}</button></>}{recordId !== undefined && <><ChevronRight size={13} /><span>{recordId}</span></>}</div>
        <button className="topbar-search icon-button" aria-label="Search the codex" onClick={() => setPalette(true)}><Search size={18} /></button>
      </header>
      <main className="main-content" id="main-content" tabIndex={-1}>
        <motion.div key={`${collection ?? "home"}:${recordId ?? ""}`} className="page-transition" initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .16 }}>
          {query.isPending ? <LoadingRows /> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} />
            : collection === "kits" ? <Suspense fallback={<LoadingRows />}><KitsPage navigate={go} /></Suspense>
            : collection === "progression" && recordId === undefined ? <Suspense fallback={<LoadingRows />}><ProgressionPage navigate={go} /></Suspense>
            : collection === "world" && recordId === undefined ? <Suspense fallback={<LoadingRows />}><WorldPage /></Suspense>
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
