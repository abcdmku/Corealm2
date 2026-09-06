import type { HuntContractsSystem } from "../systems/huntContracts.js";

/** Journal board uses the production system; no UI-only progress or reward state. */
export function mountHuntContractsPanel(parent: HTMLElement, hunts: HuntContractsSystem): { refresh(): void; dispose(): void } {
  const panel = document.createElement("section");
  panel.className = "hunt-contracts";
  panel.setAttribute("aria-label", "Hunt contracts");
  panel.style.cssText = "color:#eee8d5;background:#20241feF;border:1px solid #8c805b;border-radius:6px;padding:8px;max-width:none;font:inherit;line-height:1.4;pointer-events:auto";
  const heading = document.createElement("h2");
  heading.textContent = "Hunt contracts";
  heading.style.cssText = "font-size:14px;margin:0 0 6px";
  const body = document.createElement("div");
  const feedback = document.createElement("p");
  feedback.setAttribute("role", "status");
  feedback.style.margin = "8px 0 0";
  panel.append(heading, body, feedback);
  parent.append(panel);
  function button(label: string, action: () => { ok: boolean; error?: { message: string } }): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.style.cssText = "min-height:30px;padding:4px 8px;margin:4px 6px 4px 0;background:#d7c697;color:#171d18;border:1px solid #9f936e;border-radius:3px;cursor:pointer;font:inherit";
    element.onclick = () => { const result = action(); feedback.textContent = result.ok ? "" : result.error?.message ?? "That action is unavailable."; refresh(); };
    return element;
  }
  function text(value: string): HTMLParagraphElement {
    const p = document.createElement("p"); p.textContent = value; p.style.margin = "4px 0"; return p;
  }
  function refresh(): void {
    const state = hunts.snapshot();
    body.replaceChildren();
    const active = state.active;
    if (active && active.status !== "claimed") {
      body.append(text(`${active.offer.targetName} · ${active.offer.regionName} · Level ${active.offer.level}`),
        text(`${active.kills} / ${active.offer.requiredKills} defeated`), text(`Reward: ${active.offer.rewardXp} Melee XP`));
      const progress = document.createElement("progress");
      progress.max = active.offer.requiredKills; progress.value = active.kills;
      progress.setAttribute("aria-label", "Hunt kills"); body.append(progress, document.createElement("br"));
      if (active.status === "ready") body.append(button("Claim XP", () => hunts.claim()));
      body.append(button("Abandon hunt", () => hunts.abandon()));
    } else {
      if (active?.status === "claimed") body.append(text(`Claimed ${active.offer.rewardXp} Melee XP. Choose another hunt.`));
      for (const offer of state.offers) {
        const card = document.createElement("article");
        card.style.cssText = "padding:8px 0;border-top:1px solid #555a49";
        card.append(text(`${offer.targetName} · Level ${offer.level}`), text(`${offer.regionName} · Defeat ${offer.requiredKills}`),
          text(`${offer.rewardXp} Melee XP`), button("Accept hunt", () => hunts.accept(offer.id)));
        body.append(card);
      }
      if (state.offers.length === 0) body.append(text("No reachable hunts at your level. Explore nearby areas, then refresh."));
      body.append(button("Refresh offers", () => hunts.refreshOffers()));
    }
    body.append(text(`Hunts completed: ${state.completedCount}`));
  }
  refresh();
  return { refresh, dispose: () => panel.remove() };
}

