import type { ViewRegistry } from "../types.js";
import { lazyView } from "../lazyView.js";

export const views: ViewRegistry = __DEVDOCS_PLAYER__ ? {} : {
  formulas: lazyView(() => import("./FormulasView.js")),
  fields: lazyView(() => import("./FieldGallery.js")),
};
