import type { FormulasResponse } from "../../../shared/formulas.js";

/*
  The registry, its compiled consumers and the watcher's build status. Polled, because a save is
  gated on a valid build: `tools/devdocs-smoke.ts` waits for `build.state === "valid"` before it
  writes, and the Formulas index in Tuning shows the same status and its diagnostics.
*/
export const formulasQuery = {
  queryKey: ["formulas"],
  queryFn: async (): Promise<FormulasResponse> => {
    const response = await fetch("/__devdocs/formulas");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load formulas");
    return body as FormulasResponse;
  },
  refetchInterval: 3000,
};
