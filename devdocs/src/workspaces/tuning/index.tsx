import { lazy } from "react";
import type { ViewRegistry } from "../types.js";

export const views: ViewRegistry = __DEVDOCS_PLAYER__ ? {} : {
  formulas: lazy(() => import("./FormulasView.js")),
  fields: lazy(() => import("./FieldGallery.js")),
};
