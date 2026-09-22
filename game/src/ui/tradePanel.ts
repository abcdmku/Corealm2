import type { GameApi, GameCommand, TradeView } from "../contracts.js";
import { content } from "../content/index.js";
import { CURRENCY_ITEM_ID } from "../content/items.js";
import "./styles/trade.css";

export class TradePanel {
  private readonly root = document.createElement("section");
  private signature = "";
  constructor(private readonly api: Pick<GameApi, "getInventory">, private readonly submit: (command: GameCommand) => Promise<unknown>) {
    this.root.className = "trade-window"; this.root.hidden = true;
    this.root.setAttribute("role", "dialog"); this.root.setAttribute("aria-label", "Player trade");
    this.root.addEventListener("pointerdown", event => event.stopPropagation());
    this.root.addEventListener("keydown", event => event.stopPropagation());
    (document.getElementById("ui-root") ?? document.body).append(this.root);
  }
  update(trade: TradeView | null, playerId: string): void {
    const signature = JSON.stringify(trade);
    if (signature === this.signature) return;
    this.signature = signature; this.root.hidden = !trade; this.root.replaceChildren();
    if (!trade) return;
    const me = trade.participants.find(member => member.id === playerId)!;
    const other = trade.participants.find(member => member.id !== playerId)!;
    const heading = document.createElement("h2"); heading.textContent = `Trade with ${other.name}`;
    const note = document.createElement("p"); note.textContent = "Review both offers. Changes clear both approvals. Stay within 5 metres. Trades expire after 2 minutes.";
    this.root.append(heading, note);
    const columns = document.createElement("div"); columns.className = "trade-window__offers";
    for (const member of [me, other]) {
      const column = document.createElement("div"), title = document.createElement("h3");
      title.textContent = `${member.id === playerId ? "You" : member.name}${member.accepted ? " - Accepted" : " - Reviewing"}`;
      column.append(title);
      for (const stack of member.items) {
        const row = document.createElement("p"); row.textContent = `${content.item(stack.itemId)?.name ?? stack.itemId} x ${stack.quantity}`;
        if (member.id === playerId) {
          const remove = document.createElement("button"); remove.textContent = "Remove";
          remove.setAttribute("aria-label", `Remove ${content.item(stack.itemId)?.name ?? stack.itemId}`);
          remove.onclick = () => void this.submit({ method: "trade", args: [{ kind: "offer", tradeId: trade.id, itemId: stack.itemId, quantity: 0 }] });
          row.append(remove);
        }
        column.append(row);
      }
      if (!member.items.length) { const empty = document.createElement("p"); empty.textContent = "No items offered"; column.append(empty); }
      columns.append(column);
    }
    this.root.append(columns);
    const form = document.createElement("form"), select = document.createElement("select"), amount = document.createElement("input"), add = document.createElement("button");
    select.setAttribute("aria-label", "Trade item");
    const ids = new Set(this.api.getInventory().slots.flatMap(slot => slot ? [slot.itemId] : [])); ids.add(CURRENCY_ITEM_ID);
    for (const id of ids) {
      const def = content.item(id); if (!def || def.orb || def.category === "quest" || def.magicWeapon?.charge) continue;
      const option = document.createElement("option"); option.value = id; option.textContent = def.name; select.append(option);
    }
    amount.type = "number"; amount.min = "1"; amount.max = "1000000"; amount.step = "1"; amount.value = "1"; amount.setAttribute("aria-label", "Trade quantity");
    add.textContent = "Set offer"; add.type = "submit";
    form.append(select, amount, add); form.onsubmit = event => { event.preventDefault(); void this.submit({ method: "trade", args: [{ kind: "offer", tradeId: trade.id, itemId: select.value, quantity: Number(amount.value) }] }); };
    this.root.append(form);
    const actions = document.createElement("div"), accept = document.createElement("button"), cancel = document.createElement("button");
    accept.textContent = me.accepted ? "Waiting for other player" : "Accept trade"; accept.disabled = me.accepted;
    accept.onclick = () => void this.submit({ method: "trade", args: [{ kind: "accept", tradeId: trade.id, revision: trade.revision }] });
    cancel.textContent = "Cancel trade"; cancel.onclick = () => void this.submit({ method: "trade", args: [{ kind: "cancel", tradeId: trade.id }] });
    actions.className = "trade-window__actions"; actions.append(accept, cancel); this.root.append(actions);
  }
}
