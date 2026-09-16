import { useEffect, useReducer, type ComponentType } from "react";
import { LoadingRows } from "../ui/States.js";
import type { ViewProps } from "./types.js";

/*
  Code-split pages that never suspend.

  `React.lazy` inside the peek sheet could sit on its skeleton forever: the record behind the peek
  animates its model viewer, so a suspended tree is restarted before React can commit the retry.
  Loading the module into a plain variable and rendering it once it is there removes the suspension,
  so a preloaded page mounts on its first render. `preload()` is what the peek awaits before it
  opens; it is idempotent and shared with the navigation path.
*/

type Module<P> = { default: ComponentType<P> };
export type Preloadable<P> = ComponentType<P> & { preload: () => Promise<Module<P>> };
export type PreloadableView = Preloadable<ViewProps>;

export function lazyComponent<P extends object>(loader: () => Promise<Module<P>>): Preloadable<P> {
  let loaded: Module<P> | undefined;
  let pending: Promise<Module<P>> | undefined;
  const load = () => (pending ??= loader().then(module => (loaded = module)));

  function Lazy(props: P) {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    useEffect(() => { if (!loaded) void load().then(() => rerender()); }, []);
    if (!loaded) return <LoadingRows />;
    const Component = loaded.default;
    return <Component {...props} />;
  }
  Lazy.displayName = "LazyComponent";
  Lazy.preload = load;
  return Lazy as Preloadable<P>;
}

/** The workspace-view flavour: every registry entry is one of these. */
export const lazyView = (loader: () => Promise<Module<ViewProps>>): PreloadableView => lazyComponent<ViewProps>(loader);

/** The loader behind a registry entry, when it has one. */
export const preloadView = (view: unknown): Promise<unknown> | undefined =>
  typeof view === "function" && "preload" in view ? (view as PreloadableView).preload() : undefined;
