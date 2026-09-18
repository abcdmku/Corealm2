import type { GameCommand } from "../contracts.js";
import { ALL_SPELLS } from "../content/spells.js";

/** Real commands sent through the same session as ordinary UI and input. No state writes. */
export function multiplayerActionControls(panel: HTMLElement, submit: (command: GameCommand) => void): void {
  const commands: [string, GameCommand][] = [
    ["Stop", { method: "stop", args: [] }],
    ["Equip sword", { method: "equipItem", args: ["worn_sword"] }],
    ["Equip wand", { method: "equipItem", args: ["basic_wooden_wand"] }],
    ["Unequip weapon", { method: "unequipItem", args: ["mainHand"] }],
    ["Mine", { method: "interact", args: ["multiplayer:ore", "mine"] }],
    ["Chop", { method: "interact", args: ["multiplayer:tree", "chop"] }],
    ["Fish", { method: "interact", args: ["multiplayer:fish", "fish"] }],
    ["Cook", { method: "produceAt", args: ["multiplayer:range", "cook_seared_minnow", 1] }],
    ["Eat", { method: "useItem", args: ["seared_minnow"] }],
    ["Build campfire", { method: "buildCampfire", args: ["palewood_log"] }],
    ["Open bank", { method: "interact", args: ["feature-lab:bank", "bank"] }],
    ["Deposit ore", { method: "bank", args: ["deposit", {itemId:"grithe_ore",quantity:1}] }],
    ["Withdraw ore", { method: "bank", args: ["withdraw", {itemId:"grithe_ore",quantity:1}] }],
    ["Climb", { method: "interact", args: ["multiplayer:climb", "climb"] }],
    ["Vault", { method: "interact", args: ["multiplayer:vault", "vault"] }],
    ["Balance", { method: "interact", args: ["multiplayer:balance", "climb"] }],
    ["Slide", { method: "interact", args: ["multiplayer:slide", "climb"] }],
    ["Open shop", { method: "interact", args: ["multiplayer:shop", "trade"] }],
    ["Buy essence", { method: "shop", args: ["buy", {shopId:"multiplayer:shop",itemId:"air_essence",quantity:1}] }],
    ["Sell essence", { method: "shop", args: ["sell", {shopId:"multiplayer:shop",itemId:"air_essence",quantity:1}] }],
    ["Talk", { method: "interact", args: ["multiplayer:npc", "talk"] }],
    ["Choose dialogue", { method: "dialogue", args: ["choose", "ilse_root#who"] }],
    ["End dialogue", { method: "dialogue", args: ["end"] }],
    ["Enter portal", { method: "interact", args: ["multiplayer:portal", "enter"] }],
    ["Cross passage", { method: "interact", args: ["multiplayer:passage", "enter"] }],
    ["Attack caster", { method: "attack", args: ["multiplayer:caster"] }],
  ];
  for (const spell of ALL_SPELLS) commands.push([`Cast ${spell.id}`, spell.aoe
    ? { method: "castArea", args: [spell.id, [12, 0, 0]] }
    : { method: "cast", args: [spell.id, "multiplayer:frog"] }]);
  const select = document.createElement("select"); select.setAttribute("aria-label", "Multiplayer action");
  for (const [index, [label]] of commands.entries()) { const option=document.createElement("option"); option.value=String(index); option.textContent=label; select.append(option); }
  const button=document.createElement("button"); button.type="button"; button.textContent="Perform action";
  button.addEventListener("click",()=>{const command=commands[Number(select.value)]?.[1]; if(command)submit(command);});
  panel.append(select, button);
}
