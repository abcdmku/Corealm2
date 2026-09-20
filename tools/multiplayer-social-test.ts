import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_PROTOCOL_VERSION, type SocialView, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { resolveEnemyDef } from "../game/src/systems/combat.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { content } from "../game/src/content/index.js";
import { createInitialState } from "../game/src/state/store.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startAuthoredTestHost } from "./lib/authoredTestHost.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const authored = process.argv.includes("--authored"), budget = authored ? 120_000 : 60_000;
const clearDeadline = installTestDeadline("multiplayer social", budget), started = Date.now();
const out = `test-results/multiplayer-social${authored ? "-authored" : ""}`; await mkdir(out, { recursive: true });
const world: WorldDescriptor = { providerId: "reference", worldId: authored ? "authored" : "social", name: "Party yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: authored ? "authored" : "lab",
  seed: 1337, capacity: 1000, population: 0, availability: "available" };
const local = authored ? null : await startReferenceServer({ worlds: [world], storage: new SqliteWorldStorage(":memory:"), build: async () => {
  const ports = await createMultiplayerLabWorld(); content.register({ enemies: ENEMIES });
  const frog = ports.entities.find(entity => entity.id === "multiplayer:frog")!;
  const def = resolveEnemyDef(frog); frog.meta = { ...frog.meta, enemyId: "party_fixture" };
  ports.enemies = [{ ...def, id: "party_fixture", lootRolls: ["grithe_ore", "palewood_log", "grithe_ore"].map((itemId, index) => ({ id: `items_${index}`, name: "Items", count: 1, drops: [{ itemId, chance: 1, quantity: [1, 1] as [number, number] }] })), gold: [0, 0] }];
  return ports;
}, authentication: { authenticate: async token => ({ playerId: token.replace("guest:", ""), name: token.replace("guest:", "") }) } });
const host = local ?? await startAuthoredTestHost();
const game = await startGameServer();
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const checks: Record<string, boolean> = {}, errors: string[] = [], pages: Page[] = [];
const check = (name: string, value: boolean) => { checks[name] = value; if (!value) throw new Error(name); };
const logText = (page: Page, channel: string) => page.locator(`.msglog__line--${channel}`).allTextContents();
/** Other players are pickable by right-click only, so right-click around the view until one opens their menu. */
async function rightClickPlayer(page: Page, name: string): Promise<boolean> {
  const box = (await page.locator("#viewport").boundingBox())!;
  const points = Array.from({ length: 13 }, (_, row) => Array.from({ length: 17 }, (_, column) => [column / 16 * .5 + .25, row / 12 * .5 + .25] as const)).flat()
    .sort((p, q) => Math.hypot(p[0] - .5, p[1] - .5) - Math.hypot(q[0] - .5, q[1] - .5));
  for (const [u, v] of points) {
    await page.mouse.click(box.x + box.width * u, box.y + box.height * v, { button: "right" });
    const title = await page.evaluate(() => document.querySelector(".ctx-menu")?.getAttribute("aria-label") ?? "");
    if (title === name) return true;
    if (title) await page.keyboard.press("Escape");
  }
  return false;
}
const observe = (page: Page) => page.evaluate(() => window.__multiplayerLab!.observe() as {
  social: SocialView; player: { position: number[] }; skills: { melee: { xp: number } }; inventory: { slots: ({ itemId: string; quantity: number } | null)[] };
  entities: { id: string; loot?: unknown[] }[];
});
const openWorlds = async (page: Page) => {
  const panel = page.locator("#multiplayer-selector");
  if (await panel.isVisible().catch(() => false)) return;
  const title = page.getByRole("dialog", { name: "Corealm", exact: true });
  if (!await title.isVisible().catch(() => false)) await page.getByRole("button", { name: "Open menu", exact: true }).click();
  if (await panel.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Worlds", exact: true }).click();
};
try {
  const created = await Promise.all(["alice", "bob"].map(async name => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(({ descriptor, save }) => {
      window.__COREALM_MULTIPLAYER__ = descriptor; window.__COREALM_DEVELOPMENT_GUESTS__ = true;
      if (save) localStorage.setItem("corealm.save.v1", JSON.stringify(save));
      localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: .7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 }));
    }, { descriptor: { ...world, endpoint: `ws://127.0.0.1:${host.port}/` }, save: authored ? createInitialState(1337, 0) : null });
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${game.url}/index.html${authored ? "" : "?mode=combat&multiplayer=1"}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__multiplayerLab, null, { timeout: authored ? 60_000 : 25_000 });
    await openWorlds(page);
    await page.getByRole("textbox", { name: "Development guest name" }).fill(name);
    await page.locator(".worlds__row--world input").first().check(); await page.getByRole("button", { name: "Join world", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected");
    if (authored) await page.getByRole("dialog", { name: "Corealm", exact: true }).waitFor({ state: "hidden", timeout: 5000 });
    else await page.getByRole("button", { name: "Close Feature lab", exact: true }).click();
    return page;
  }));
  const [a, b] = created as [Page, Page];
  const chat = (page: Page) => page.getByRole("textbox", { name: "Chat message", exact: true });
  const waitParty = (page: Page, size: number) => page.waitForFunction(n => ((window.__multiplayerLab!.observe() as { social: SocialView }).social.party?.members.length ?? 0) === n, size);
  const cardShowing = (page: Page) => page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".quest-tracker");
    return !!card && !card.hidden && card.getBoundingClientRect().height > 0;
  });
  // With no party and nothing tracked there must be no card at all, not an empty sliver of one.
  check("noCardWithoutParty", !await cardShowing(a));
  // The gear menu creates a party with only the player in it.
  await a.getByRole("button", { name: "Chat settings", exact: true }).click();
  await a.getByRole("menuitem", { name: "Create party" }).click();
  await waitParty(a, 1);
  await a.locator(".party-member").first().waitFor();
  check("gearCreatesParty", await a.locator(".party-member").count() === 1);
  // The + lists online players by name and level only.
  await a.getByRole("button", { name: "Invite online players", exact: true }).click();
  const rosterEntry = a.getByRole("menuitem", { name: /^bob\s*Lvl \d+$/ });
  await rosterEntry.waitFor();
  check("rosterShowsNameAndLevel", await a.locator(".ctx-menu .ctx-menu__item").count() === 1);
  await a.screenshot({ path: `${out}/invite-roster.png`, timeout: 5000 });
  await rosterEntry.click();
  await b.getByRole("button", { name: "Join alice's party", exact: true }).click();
  await waitParty(a, 2);
  await waitParty(b, 2);
  check("consentAndRoster", (await observe(b)).social.party?.members.length === 2);
  await a.locator(".party-member").nth(1).waitFor();
  check("trackerShowsMembers", (await a.locator(".party-member__name").allTextContents()).join("|").includes("bob")
    && await a.locator(".party-member .bar__fill").count() === 2
    && (await a.locator(".party-member .quest-tracker__stage").allTextContents()).every(text => /^Lvl \d+$/.test(text)));
  // Enter opens chat; typing does not move; Enter sends into the shared message log.
  const beforeTyping = (await observe(a)).player.position;
  await a.keyboard.press("Enter");
  check("enterFocusesChat", await chat(a).evaluate(input => document.activeElement === input));
  await chat(a).pressSequentially("wasd");
  await chat(a).fill("wasd nearby <b>hello</b>");
  await chat(a).press("Enter");
  await b.locator(".msglog__line--nearby", { hasText: "wasd nearby <b>hello</b>" }).waitFor();
  check("plainTextChat", await b.locator(".msglog b").count() === 0);
  check("typingDoesNotMove", Math.hypot(...(await observe(a)).player.position.map((v, i) => v - beforeTyping[i]!)) < .05);
  check("sendClosesChat", await chat(a).evaluate(input => document.activeElement !== input));
  // Party chat and whispers through slash commands.
  await b.waitForTimeout(1100);
  await b.keyboard.press("Enter"); await chat(b).fill("/p party-only line"); await chat(b).press("Enter");
  await a.locator(".msglog__line--party", { hasText: "party-only line" }).waitFor();
  await a.waitForTimeout(1100);
  await a.keyboard.press("Enter"); await chat(a).fill("/w bob secret-line"); await chat(a).press("Enter");
  await b.locator(".msglog__line--whisper", { hasText: "secret-line" }).waitFor();
  check("whisperSpeaker", (await logText(b, "whisper")).some(text => text.startsWith("alice whispers: secret-line")));
  check("whisperOutgoing", (await logText(a, "whisper")).some(text => text.startsWith("To bob: secret-line")));
  // The gear hides a channel and brings it back.
  await a.getByRole("button", { name: "Chat settings", exact: true }).click();
  await a.getByRole("menuitem", { name: /^Party chat/ }).click();
  check("filterHidesParty", await a.locator(".msglog__line--party").count() === 0);
  await a.getByRole("menuitem", { name: /^Party chat/ }).click();
  await a.keyboard.press("Escape");
  check("filterRestoresParty", await a.locator(".msglog__line--party", { hasText: "party-only line" }).count() === 1);
  await a.keyboard.press("Enter");
  await a.screenshot({ path: `${out}/chat-party.png`, timeout: 5000 });
  await a.keyboard.press("Escape");
  if (local) {
    const runtime = [...local.worlds.values()][0]!.runtime, alice = runtime.players.get("alice")!, bob = runtime.players.get("bob")!;
    bob.api.stop(); bob.store.get().player.position = [80, 0, 80];
    await b.waitForFunction(() => (window.__multiplayerLab!.observe() as { player: { position: number[] } }).player.position[0]! > 70);
    await a.waitForFunction(() => {
      const view = window.__multiplayerLab!.observe() as { tick: number; social: SocialView };
      return view.tick * 100 - view.social.messages.at(-1)!.atMs >= 1000;
    });
    await a.keyboard.press("Enter"); await chat(a).fill("/s outside-radius-message"); await chat(a).press("Enter");
    await a.locator(".msglog__line--nearby", { hasText: "outside-radius-message" }).waitFor();
    check("chatRadius", !(await observe(b)).social.messages.some(message => message.text === "outside-radius-message"));
    const frog = runtime.entities.get("multiplayer:frog")!;
    alice.api.stop(); alice.store.get().player.position = [frog.position[0] - .7, 0, frog.position[2]];
    bob.store.get().player.position = [frog.position[0] + .7, 0, frog.position[2]];
    alice.store.get().skills.melee.level = 99; alice.store.get().equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
    alice.random.get("combat").setState(0); alice.combat.runtimeFor(alice.store.get(), frog).health = 1;
    const xpBefore = bob.store.get().skills.melee.xp;
    await a.getByRole("button", { name: "Attack fixture frog", exact: true }).click();
    await b.waitForFunction(xp => (window.__multiplayerLab!.observe() as { skills: { melee: { xp: number } } }).skills.melee.xp > xp, xpBefore);
    check("reducedKillXp", bob.store.get().skills.melee.xp - xpBefore === Math.floor(frog.combat!.maxHealth));
    const lootId = Object.keys(runtime.shared.lootPiles).find(id => id.startsWith("loot_"))!;
    for (const page of [a, b]) await page.waitForFunction(id => (window.__multiplayerLab!.observe() as { entities: { id: string }[] }).entities.some(entity => entity.id === id), lootId);
    check("everyoneSeesPile", !!lootId);
    const count = (id: string, item: string) => runtime.players.get(id)!.store.get().inventory.slots.reduce((sum, stack) => sum + (stack?.itemId === item ? stack.quantity : 0), 0);
    const aliceOre = count("alice", "grithe_ore"), bobOre = count("bob", "grithe_ore"), bobLog = count("bob", "palewood_log");
    for (const page of [a, b]) { await page.getByRole("button", { name: "Open combat loot", exact: true }).click(); await page.locator(".loot-reveal").waitFor({ state: "visible" }); }
    await b.locator(".loot-reveal button").first().click();
    await a.waitForFunction(before => (window.__multiplayerLab!.observe() as { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } }).inventory.slots.reduce((sum, stack) => sum + (stack?.itemId === "grithe_ore" ? stack.quantity : 0), 0) > before, aliceOre);
    check("pickupRoutesToOtherMember", count("alice", "grithe_ore") === aliceOre + 1 && count("bob", "grithe_ore") === bobOre);
    await a.locator(".loot-reveal button").first().click();
    await b.waitForFunction(before => (window.__multiplayerLab!.observe() as { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } }).inventory.slots.reduce((sum, stack) => sum + (stack?.itemId === "palewood_log" ? stack.quantity : 0), 0) > before, bobLog);
    check("roundRobinSecondItem", count("bob", "palewood_log") === bobLog + 1);
    check("livePileContents", runtime.shared.lootPiles[lootId]!.items.length === 1);
    await b.screenshot({ path: `${out}/shared-loot.png`, timeout: 5000 });
  }
  await b.getByRole("button", { name: "Chat settings", exact: true }).click();
  await b.getByRole("menuitem", { name: "Leave party" }).click();
  await waitParty(a, 1);
  check("leaveUpdatesRoster", (await observe(b)).social.party === null);
  await b.waitForFunction(() => !document.querySelector(".party-member"));
  check("cardClearsOnLeave", !await cardShowing(b));
  if (local) {
    // Bring bob back into view, then invite him the player's way: right-click his character.
    const runtime = [...local.worlds.values()][0]!.runtime, alice = runtime.players.get("alice")!.store.get().player;
    runtime.players.get("bob")!.store.get().player.position = [alice.position[0] + 1.5, alice.position[1], alice.position[2]];
    await a.waitForFunction(() => (window.__multiplayerLab!.observe() as { visiblePlayerIds: string[] }).visiblePlayerIds.includes("bob"));
    await a.keyboard.press("Escape");
    await a.locator(".loot-reveal").waitFor({ state: "hidden" });
    await a.waitForTimeout(400);
    check("rightClickFindsPlayer", await rightClickPlayer(a, "bob"));
    await a.screenshot({ path: `${out}/player-menu.png`, timeout: 5000 });
    await a.getByRole("menuitem", { name: /^Invite bob to party/ }).click();
    await b.locator(".party__invite").waitFor();
    await b.screenshot({ path: `${out}/invitation.png`, timeout: 5000 });
    await b.getByRole("button", { name: "Join alice's party", exact: true }).click();
    await waitParty(a, 2);
    check("rightClickInvite", true);
    const bobState = runtime.players.get("bob")!.store.get().player; bobState.health = Math.ceil(bobState.maxHealth * .4);
    await a.waitForFunction(() => document.querySelectorAll(".party-member__health").length === 2
      && [...document.querySelectorAll<HTMLElement>(".party-member__health .bar__fill")].some(fill => parseFloat(fill.style.width) < 50));
    await a.locator(".quest-tracker").screenshot({ path: `${out}/party-card.png`, timeout: 5000 });
    await a.keyboard.press("Enter");
    await a.locator(".msglog").screenshot({ path: `${out}/chat-open.png`, timeout: 5000 });
    await a.keyboard.press("Escape");
  }
  check("noRuntimeErrors", errors.length === 0); check("withinBudget", Date.now() - started < budget);
  const report = { passed: true, checks, errors, durationMs: Date.now() - started };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  for (let i = 0; i < pages.length; i++) await pages[i]!.screenshot({ path: `${out}/failure-${i}.png`, timeout: 3000 }).catch(() => {});
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: String(error), checks, errors, observations: await Promise.all(pages.map(page => observe(page).catch(() => null))) }, null, 2)); throw error;
} finally { await browser.close(); await game.close(); await host.close(); clearDeadline(); }
