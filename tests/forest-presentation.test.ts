import { describe, expect, it } from "vitest";
import { ForestPresentation } from "../game/src/render/forestPresentation.js";

describe("forest render handoff", () => {
  it("keeps exactly one tree through delayed promotion, demotion and re-entry", () => {
    const presentation = new ForestPresentation();
    let scatter = true, view = false;
    presentation.register("oak", value => { scatter = value; });
    const frame = () => {
      presentation.reconcile(() => view);
      expect(Number(scatter) + Number(view)).toBe(1);
    };
    presentation.activate("oak", false);
    for (let i = 0; i < 30; i++) frame(); // Slow replacement asset or throttled structural sync.
    view = true; frame();
    presentation.deactivate("oak");
    for (let i = 0; i < 15; i++) frame();
    view = false; frame();
    presentation.activate("oak", false); frame();
    view = true; frame();
    // A render tile rebuilt under an already-resident semantic tree must be suppressed too.
    scatter = true;
    presentation.register("oak", value => { scatter = value; });
    frame();
  });

  it("does not regrow a saved depleted tree while the stump loads, then restores on respawn", () => {
    const presentation = new ForestPresentation();
    let scatter = true;
    presentation.register("oak", value => { scatter = value; });
    presentation.activate("oak", true);
    expect(scatter).toBe(false);
    presentation.reconcile(() => false);
    expect(scatter).toBe(false);
    presentation.activate("oak", false);
    presentation.reconcile(() => false);
    expect(scatter).toBe(true);
  });
});
