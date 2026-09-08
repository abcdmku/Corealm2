/**
 * The hunt board: the Hunts tab of the journal.
 *
 * Everything shown here is read from the production `HuntContractsSystem` on each refresh; the
 * board holds no progress or reward state of its own. One hunt at a time: while one is running
 * the board is that hunt and its two actions, otherwise it is the current offers.
 */
import type { HuntContractsSystem } from "../systems/huntContracts.js";

export function mountHuntContractsPanel(parent: HTMLElement, hunts: HuntContractsSystem): { refresh(): void; dispose(): void } {
  const panel = document.createElement("section");
  panel.className = "hunts";
  panel.setAttribute("aria-label", "Hunt contracts");

  const body = document.createElement("div");
  body.className = "hunts__body";

  const feedback = document.createElement("p");
  feedback.className = "hunts__feedback";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;

  panel.append(body, feedback);
  parent.append(panel);

  function button(label: string, className: string, action: () => { ok: boolean; error?: { message: string } }): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("click", () => {
      const result = action();
      feedback.textContent = result.ok ? "" : result.error?.message ?? "That action is unavailable.";
      feedback.hidden = result.ok;
      refresh();
    });
    return element;
  }

  function line(className: string, value: string): HTMLElement {
    const node = document.createElement("div");
    node.className = className;
    node.textContent = value;
    return node;
  }

  function refresh(): void {
    const state = hunts.snapshot();
    body.replaceChildren();
    const active = state.active;

    if (active && active.status !== "claimed") {
      const ready = active.status === "ready";
      const card = document.createElement("article");
      card.className = `hunts__card is-active${ready ? " is-ready" : ""}`;

      const head = document.createElement("header");
      head.className = "hunts__head";
      head.append(
        line("hunts__name", active.offer.targetName),
        line("hunts__count u-numeric", `${active.kills}/${active.offer.requiredKills}`),
      );

      const bar = document.createElement("div");
      bar.className = "bar bar--thin";
      const fill = document.createElement("div");
      fill.className = "bar__fill";
      fill.style.width = `${Math.round((active.kills / Math.max(1, active.offer.requiredKills)) * 100)}%`;
      bar.appendChild(fill);

      const actions = document.createElement("div");
      actions.className = "hunts__actions";
      if (ready) actions.append(button("Claim reward", "btn btn--primary", () => hunts.claim()));
      actions.append(button("Abandon", "btn btn--ghost", () => hunts.abandon()));

      card.append(
        head,
        line("hunts__place u-faint", `${active.offer.regionName} · Level ${active.offer.level}`),
        bar,
        line("hunts__reward", ready ? `${active.offer.rewardXp} Melee XP ready` : `${active.offer.rewardXp} Melee XP on completion`),
        actions,
      );
      body.append(card);
    } else {
      if (active?.status === "claimed") {
        body.append(line("hunts__note u-dim", `Claimed ${active.offer.rewardXp} Melee XP. Choose another hunt.`));
      }
      for (const offer of state.offers) {
        const card = document.createElement("article");
        card.className = "hunts__card";

        const head = document.createElement("header");
        head.className = "hunts__head";
        head.append(
          line("hunts__name", offer.targetName),
          line("hunts__count u-numeric", `×${offer.requiredKills}`),
        );

        card.append(
          head,
          line("hunts__place u-faint", `${offer.regionName} · Level ${offer.level}`),
          line("hunts__reward", `${offer.rewardXp} Melee XP`),
          button("Accept", "btn hunts__accept", () => hunts.accept(offer.id)),
        );
        body.append(card);
      }
      if (state.offers.length === 0) {
        body.append(line("hunts__note u-dim", "No reachable hunts at your level. Explore nearby, then look again."));
      }
      body.append(button("New offers", "btn btn--ghost hunts__refresh", () => hunts.refreshOffers()));
    }

    body.append(line("hunts__tally u-faint", `${state.completedCount} completed`));
  }

  refresh();
  return { refresh, dispose: () => panel.remove() };
}
