import type { EntityId, InteractionId, MoveTarget, Result } from "../contracts.js";
import type { AgilityWorkbenchApi } from "./agility.js";

/** Realtime fixture controls. All movement and traversals use the ordinary GameApi commands. */
export function mountAgilityWorkbench(workbench: AgilityWorkbenchApi, ports: {
  interact(id: EntityId, interaction: InteractionId): Result<unknown>;
  moveTo(destination: MoveTarget): Result<unknown>;
  stop(): Result<unknown>;
}): () => void {
  const panel = document.createElement("details");
  panel.className = "agility-workbench";
  panel.style.cssText = "position:fixed;left:14px;bottom:18px;z-index:4000;padding:10px;background:#17201fee;color:#e5e0cd;border:1px solid #667264;border-radius:6px;max-width:290px;font:13px system-ui;";
  const summary = document.createElement("summary");
  summary.textContent = "Traversal fixtures";
  panel.append(summary);
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Traversal fixture");
  for (const lane of workbench.getState().lanes) {
    const option = document.createElement("option");
    option.value = lane.id;
    option.textContent = lane.name ?? (lane.contact ? `${lane.contact.kind} contact` : lane.id === "root_tunnel" ? "Root Tunnel" : "Broken Ledge");
    select.append(option);
  }
  panel.append(select);
  const result = document.createElement("p");
  result.setAttribute("role", "status");
  const stats = document.createElement("p");
  const button = (label: string, run: () => unknown): void => {
    const element = document.createElement("button");
    element.textContent = label;
    element.style.margin = "5px 4px 0 0";
    element.addEventListener("click", () => {
      try {
        const value = run() as Result<unknown> | undefined;
        result.textContent = value && "ok" in value && !value.ok ? value.error.message : label;
      } catch (error) { result.textContent = error instanceof Error ? error.message : String(error); }
    });
    panel.append(element);
  };
  const lane = () => workbench.getState().lanes.find((candidate) => candidate.id === select.value)!;
  button("Prepare level 8", () => workbench.prepare());
  button("Set level 10", () => workbench.setLevel(10));
  button("Set required level", () => workbench.setLevel(lane().reqLevel));
  button("Set guaranteed level", () => workbench.setLevel(Math.min(99, lane().reqLevel + 20)));
  button("Walk to entrance", () => ports.moveTo({ position: lane().entry }));
  button("Traverse", () => ports.interact(lane().id, lane().contact?.kind === "vault" ? "vault" : lane().id === "root_tunnel" ? "enter" : "climb"));
  button("Walk to exit", () => ports.moveTo({ position: lane().exit }));
  button("Stop", () => ports.stop());
  panel.append(result, stats);
  document.body.append(panel);
  const timer = setInterval(() => {
    if (!panel.open) return;
    const state = workbench.getState();
    const traversal = state.traversal;
    stats.textContent = `Agility ${state.agility.level} · ${state.agility.xp} XP · ${state.health} health`
      + (traversal ? ` · ${traversal.phase} ${Math.round(traversal.progress * 100)}%` : " · ready");
  }, 250);
  return () => { clearInterval(timer); panel.remove(); };
}
