import { useEffect, useReducer, type ComponentType } from "react";
import { LoadingRows } from "../ui/States.js";
import type { ViewProps } from "./types.js";

/*
  Code-split workspace views that never suspend.

  `React.lazy` inside the peek sheet could sit on its skeleton forever: the record behind the peek
  animates its model viewer, so a suspended tree is restarted before React can commit the retry.
  Loading the module into a plain variable and rendering it once it is there removes the suspension,
  so a preloaded view mounts on its first render. `preload()` is what the peek awaits before it
  opens; it is idempotent and shared with the navigation path.
*/

type ViewModule = { default: ComponentType<ViewProps> };
export type PreloadableView = ComponentType<ViewProps> & { preload: () => Promise<ViewModule> };

export function lazyView(loader: () => Promise<ViewModule>): PreloadableView {
  let loaded: ViewModule | undefined;
  let pending: Promise<ViewModule> | undefined;
  const load = () => (pending ??= loader().then(module => (loaded = module)));

  function View(props: ViewProps) {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => { if (!loaded) void load().then(() => rerender()); }, []);
    if (!loaded) return <LoadingRows />;
    const Component = loaded.default;
    return <Component {...props} />;
  }
  View.displayName = "LazyView";
  View.preload = load;
  return View as PreloadableView;
}

/** The loader behind a registry entry, when it has one. */
export const preloadView = (view: unknown): Promise<unknown> | undefined =>
  typeof view === "function" && "preload" in view ? (view as PreloadableView).preload() : undefined;
