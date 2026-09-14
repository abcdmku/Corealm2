import type { ComponentType, LazyExoticComponent } from "react";
import type { AppProps } from "../model/contracts.js";
import type { Route } from "../ui/workspaces.js";

/** Props every purpose-built view receives. `recordId` is the third route segment, if any. */
export interface ViewProps {
  recordId?: string;
  route: Route;
  /** Open a collection or workspace, optionally at a record. Old collection names are accepted. */
  navigate: AppProps["navigate"];
}

export type ViewComponent = ComponentType<ViewProps> | LazyExoticComponent<ComponentType<ViewProps>>;

/** A workspace folder exports one of these: view key → component. Missing keys fall back to the collection browser. */
export type ViewRegistry = Readonly<Partial<Record<string, ViewComponent>>>;
