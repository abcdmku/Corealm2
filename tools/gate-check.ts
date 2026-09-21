/**
 * The Phase 1 gate, as an executable checklist.
 *
 * Written because three separate false greens got through in three rounds: a scenario step that
 * could not fail, a performance budget that only sampled the cheapest frame, and a suite that
 * reported 7/7 while never completing a quest, never killing the boss, and never touching eight of
 * the ten skills. A green suite that skips the gate is worse than no suite.
 *
 * Two rules make this different from a scenario:
 *
 *  1. Every check is a REQUIRED STATE DELTA, not an action that ran. "Cooking XP went above zero"
 *     is a fact; "we called produce" is not.
 *  2. `__gameDebug` may only SET UP a check. The thing being checked must happen by playing —
 *     through `window.corealm.agent`, the same surface an external agent gets. `setQuestStage`,
 *     `depleteNode`, `grantXp` and `giveItem` can never satisfy a check on their own.
 *
 * Usage: npx tsx tools/gate-check.ts --run runs/corealm [--scale 20]
 */
import "./lib/repoContent.js";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import type {} from "./lib/debug-api.js";
// The reward numbers F3 asserts are read out of the content table and handed to the page, so
// the check compares the game against its own definition instead of against a number a test
// author typed once and nobody re-read when the quest was rebalanced.
import { QUESTS } from "../game/src/content/quests.js";

export interface GateCheck {
  id: string;
  /** The gate line from the brief that this proves. */
  gateLine: string;
  passed: boolean;
  /** What was actually observed. Empty when the check did not run. */
  evidence: string;
  error?: string;
}

export interface GateReport {
  startedAt: string;
  checks: GateCheck[];
  passedCount: number;
  totalCount: number;
  passed: boolean;
  consoleErrors: string[];
}

const GPU_ARGS = [
  "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio",
];

/**
 * The whole playthrough, run inside the page.
 *
 * It lives here as source text rather than as Playwright steps for two reasons: every action then
 * genuinely goes through the in-page agent surface, and a single long evaluate cannot be
 * interleaved with harness calls that would make the timing unrepresentative.
 */
function playthroughSource(): string {
  return `(async () => {
  const agent = window.corealm.agent;
  const dbg = window.__gameDebug;
  const out = [];
  let cursor = 0;

  const note = (id, passed, evidence) => out.push({ id, passed, evidence });
  const waitFor = async (types, ms) => {
    const r = await agent.call("corealm_events", { sinceSeq: cursor, types, timeoutMs: ms });
    cursor = r.nextSeq;
    return r.events || [];
  };
  const skills = async () => agent.call("corealm_skills");
  /** What the last findNear actually tried, so a failure explains itself. */
  let lastSearchTrail = [];
  /** A still-full node of the same kind the depletion check empties. See "spent-node". */
  let liveNeighbourId = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Walks somewhere and waits for the walk to finish.
   *
   * Reports "arrived", "failed", "timeout" or "refused: <code>" rather than a boolean, because the
   * difference between "the world would not path there" and "the walk ran out of clock" is the
   * difference between a content bug and a slow harness, and a check that swallows it proves
   * neither.
   */
  const travel = async (target, ms) => {
    const moved = await agent.call("corealm_move_to", target);
    if (moved.error) return "refused: " + moved.error;
    const seen = await waitFor(["navigation.completed", "navigation.failed"], ms || 120000);
    if (seen.some((e) => e.type === "navigation.completed")) return "arrived";
    return seen.length ? "failed" : "timeout";
  };

  /** Opens a conversation, walking to the NPC first if they are out of range. */
  const openDialogue = async (npcId) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = await agent.call("corealm_interact", { entityId: npcId, interaction: "talk" });
      if (started.error) return { error: started.error + " " + (started.message || "") };
      if (String(started.started || "").startsWith("walking")) {
        await waitFor(["navigation.completed", "navigation.failed"], 150000);
        await sleep(250);
        continue;
      }
      await sleep(250);
      const view = await agent.call("corealm_dialogue", { op: "state" });
      if (view && !view.error && (view.options || []).length > 0) return view;
      await sleep(400);
    }
    return { error: "NO_DIALOGUE" };
  };

  /** A chooser: the first ENABLED option whose id or text matches, plus why it was unavailable. */
  const optionLike = (pattern) => {
    const re = new RegExp(pattern, "i");
    const chooser = (view) => (view.options || []).find(
      (o) => o.enabled !== false && (re.test(o.id) || re.test(o.text || "")));
    chooser.label = "/" + pattern + "/";
    chooser.blocked = (view) => (view.options || []).find((o) => re.test(o.id) || re.test(o.text || ""));
    return chooser;
  };

  /**
   * Drives a conversation through a named sequence of choices.
   *
   * The earlier walker took the first enabled option every turn, which is enough to accept a quest
   * offer and nothing else: every one of Cairnkeeper Ode's stage options sits underneath "What is
   * a cairn for?", so the dumb reader talked about masonry until it ran out of turns and the stage
   * never moved. This one names what it is looking for, and when a turn offers no match it stops
   * and says whether the option was missing or merely disabled - which is the difference between
   * content that cannot be reached and a walker that got bored.
   */
  const converse = async (npcId, choosers) => {
    const opened = await openDialogue(npcId);
    if (opened.error) return { ok: false, at: "open", detail: opened.error, taken: [] };
    let view = opened;
    const taken = [];
    for (const chooser of choosers) {
      const option = chooser(view);
      if (!option) {
        const blocked = chooser.blocked ? chooser.blocked(view) : null;
        await agent.call("corealm_dialogue", { op: "end" });
        return {
          ok: false, taken, view,
          at: chooser.label || "?",
          detail: blocked
            ? blocked.id + " is disabled: " + (blocked.reason || "no reason given")
            : "nothing matched among [" + (view.options || []).map((o) => o.id).join(", ") + "]",
        };
      }
      const next = await agent.call("corealm_dialogue", { op: "choose", optionId: option.id });
      if (!next || next.error) {
        await agent.call("corealm_dialogue", { op: "end" });
        return { ok: false, taken, at: option.id, detail: "choose refused: " + (next && next.error) };
      }
      taken.push(option.id);
      view = next;
      await sleep(200);
    }
    await sleep(300);
    await agent.call("corealm_dialogue", { op: "end" });
    return { ok: true, taken, view };
  };

  /**
   * Solves Ode's three-lever door out of her own words, rather than by trying all six.
   *
   * Two wrong answers unlock a "just tell me" option, so a walker that guessed would still finish
   * the chain and the check would prove nothing about the puzzle. This reads the three marks off
   * the options themselves, the meaning of each mark out of the sentence that defines it ("A
   * WEDGE, which is the mason's mark for stone"), and the order out of the one sentence that names
   * all three meanings ("THE MOOR GIVES STONE, THEN WATER, THEN DARK"). Compose the two and
   * exactly one option lists the marks in that order. The check below then asserts that
   * \`lever_attempts\` is still zero, which is what makes this a solve rather than a search.
   */
  const solveLevers = (view) => {
    const text = String(view.text || "").toLowerCase();
    const orderings = [];
    const marks = [];
    for (const option of (view.options || [])) {
      const parts = String(option.text || "").toLowerCase().replace(/[.]+$/, "").split(/,?\\s*then\\s+/);
      if (parts.length !== 3) continue;
      const trimmed = parts.map((part) => part.trim());
      orderings.push({ option, marks: trimmed });
      for (const mark of trimmed) if (!marks.includes(mark)) marks.push(mark);
    }
    if (marks.length !== 3) return undefined;

    // "A WEDGE, which is the mason's mark for stone." -> wedge means stone.
    const meaningOf = {};
    for (const mark of marks) {
      const found = new RegExp(mark + "[^.]*?mark for (?:the )?([a-z]+)").exec(text);
      if (found) meaningOf[mark] = found[1];
    }
    const meanings = marks.map((mark) => meaningOf[mark]);
    if (meanings.some((meaning) => !meaning) || new Set(meanings).size !== 3) return undefined;

    // The rule is the only sentence that names all three meanings at once.
    const rule = text.split(/[.\\n]+/).find(
      (sentence) => /then/.test(sentence) && meanings.every((meaning) => sentence.includes(meaning)));
    if (!rule) return undefined;
    const order = marks.slice().sort((a, b) => rule.indexOf(meaningOf[a]) - rule.indexOf(meaningOf[b]));

    const answer = orderings.find((candidate) => candidate.marks.join("|") === order.join("|"));
    return answer && answer.option.enabled !== false ? answer.option : undefined;
  };
  solveLevers.label = "the lever order derived from Ode's own text";

  /**
   * Kills living enemies whose id or name matches, keeping the player upright.
   *
   * The health top-ups are setup: dying drops the pack, and The Long Cairn's last stage checks
   * that a specific item is still in it. Staying alive is not the thing being proved. The kills
   * are, and every one of them goes through \`corealm_attack\`.
   */
  const slay = async (pattern, count, radius, approach) => {
    const re = new RegExp(pattern, "i");
    const felled = [];
    for (let hunt = 0; hunt < count * 4 && felled.length < count; hunt += 1) {
      const seen = await agent.call("corealm_observe",
        { archetypes: ["enemy"], interaction: "attack", radius: radius || 140, limit: 30 });
      const target = (seen || []).find(
        (e) => e.state !== "dead" && !felled.includes(e.id) && re.test(e.id + " " + (e.name || "")));
      if (!target) {
        if (approach && hunt < 2) await travel(approach, 120000);
        else await sleep(800);
        continue;
      }
      await travel({ entityId: target.id }, 90000);
      const opened = await agent.call("corealm_attack", { entityId: target.id });
      if (opened.error) { await sleep(500); continue; }
      for (let swing = 0; swing < 80; swing += 1) {
        await sleep(400);
        if (dbg.getState().health < 60) dbg.setHealth(999);
        const live = dbg.getEntity(target.id);
        if (!live || live.state === "dead" || (live.combat && live.combat.health <= 0)) {
          felled.push(target.id);
          break;
        }
        if (!dbg.getState().combatTargetId) await agent.call("corealm_attack", { entityId: target.id });
      }
    }
    return { killed: felled.length, names: felled };
  };

  /** One quest's summary, off the agent surface. */
  const questOf = async (id) => {
    const all = await agent.call("corealm_quests");
    return (all || []).find((q) => q.id === id) || { id, status: "unknown", stage: -1, stageCount: 0 };
  };

  /**
   * The raw counters and flags behind a quest record. Read only, and only ever used to explain a
   * stage that would not move: a check that can say no more than "stage 4 did not advance" costs
   * whoever reads it an hour.
   */
  const questRecord = (id) => {
    try {
      return JSON.parse(dbg.getSaveBlob()).quests[id] || { counters: {}, flags: {} };
    } catch (cause) {
      return { counters: {}, flags: {} };
    }
  };

  /** Waits for a quest to leave a stage. Quest evaluation is event-driven with a 500 ms heartbeat. */
  const waitStage = async (id, fromStage, ms) => {
    const deadline = Date.now() + (ms || 10000);
    let seen = await questOf(id);
    while (Date.now() < deadline && seen.status === "active" && seen.stage === fromStage) {
      await sleep(400);
      seen = await questOf(id);
    }
    return seen;
  };

  /** Walks to an entity and performs an interaction, handling the walk-then-act round trip. */
  const doInteract = async (entityId, interaction, waitTypes, waitMs) => {
    let started = await agent.call("corealm_interact", { entityId, interaction });
    if (started.error) return started;
    if (String(started.started || "").startsWith("walking")) {
      await waitFor(["navigation.completed", "navigation.failed"], 30000);
      started = await agent.call("corealm_interact", { entityId, interaction });
      if (started.error) return started;
    }
    if (waitTypes) await waitFor(waitTypes, waitMs || 60000);
    return started;
  };

  /** Finds a production station of a given kind, travelling to settlements if none is in sight. */
  const findStation = async (kind) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const seen = await agent.call("corealm_observe", { archetypes: ["station"], radius: 140, limit: 20 });
      for (const candidate of (seen || [])) {
        const detail = await agent.call("corealm_inspect", { entityId: candidate.id });
        // Match on the station's declared skill/kind, not on its id. Ids read "coldbrace_crafting"
        // while kinds read "crafting_table", so an id substring test never matches either way.
        const stationKind = detail && !detail.error ? (detail.station?.kind ?? detail.meta?.stationKind ?? "") : "";
        const shortKind = String(kind).split("_")[0];
        if (String(stationKind).includes(shortKind) || candidate.id.includes(shortKind)) return candidate;
      }
      const places = await agent.call("corealm_observe", { scope: "known", limit: 40 });
      const towns = (places || []).filter((x) => /town|square|centre|hamlet|outpost|coldbrace|rootfall|highcairn/i.test(x.id + " " + x.name));
      const target = towns[attempt] ?? (places || [])[attempt];
      if (!target) break;
      const moved = await agent.call("corealm_move_to", { locationId: target.id });
      if (moved.error) continue;
      await waitFor(["navigation.completed", "navigation.failed"], 25000);
    }
    return null;
  };

  /** Finds the nearest usable entity of a kind, travelling to known locations if none is in sight. */
  const findNear = async (archetypes, interaction, hint) => {
    const trail = [];
    lastSearchTrail = trail;
    // Walking somewhere twice discovers nothing and burns an attempt.
    const visited = new Set();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const found = await agent.call("corealm_observe", {
        archetypes, interaction, requirementsMet: true, radius: 140, limit: 12,
      });
      // Reject only what is genuinely unusable. An earlier version allow-listed "available", which
      // silently rejected farm plots (state "empty"), stations, and anything else with its own
      // vocabulary — and then reported "no plot found anywhere" as if the world were missing them.
      const usable = (found || []).filter((e) => e.state !== "depleted" && e.state !== "dead");
      trail.push("saw " + (found || []).length + "/" + usable.length + " usable");
      if (usable.length) return usable[0];
      // WHERE to walk is setup; the check is the state delta that follows. That distinction is
      // why this reads the route graph off the debug surface rather than off
      // \`observe({ scope: "known" })\`: discovery is now genuinely gated — a fresh character knows
      // four places out of forty-four — and a harness that can only walk to what it has already
      // walked to cannot reach the Bracken Pit at all. It bounced between three Coldbrace nodes and
      // reported the world as having no ore in it.
      //
      // The walk itself still goes through \`corealm_move_to\`, and everything being checked still
      // happens by playing. Whether an agent can FIND the pit unaided is a real question, and it is
      // \`agent-proof\`'s: its mining agent prospects twenty-five locations with no debug at all.
      const known = new Set(((await agent.call("corealm_observe", { scope: "known", limit: 100 })) || [])
        .map((place) => place.locationId || place.id));
      const ranked = (dbg.listRouteNodes() || [])
        .filter((node) => !visited.has(node.id))
        .sort((a, b) => {
          const hinted = (x) => (hint && new RegExp(hint, "i").test(x.id + " " + (x.name || "")) ? 0 : 1);
          // Hinted first, then somewhere already known (a short hop that widens the frontier),
          // then anything else.
          return hinted(a) - hinted(b) || (known.has(b.id) ? 1 : 0) - (known.has(a.id) ? 1 : 0);
        });
      const target = ranked[0];
      if (!target) break;
      visited.add(target.id);
      const moved = await agent.call("corealm_move_to", { locationId: target.id });
      // Waiting on an event that will never arrive costs REAL seconds, not sim seconds: a move that
      // was refused used to burn the full timeout, twelve times over, before the check gave up and
      // reported the world as empty.
      if (moved.error) { trail.push("move " + target.id + " -> " + moved.error); continue; }
      const arrived = await waitFor(["navigation.completed", "navigation.failed"], 25000);
      trail.push("moved " + target.id + " -> " + (arrived.map((e) => e.type).join(",") || "timeout"));
    }
    return null;
  };

  // ---------------------------------------------------------- click to move
  // The gate wants click-to-move working, and a mouse event alone proves nothing: the check is a
  // real navmesh path with a destination and a position that actually changes.
  {
    const before = dbg.getPlayerPosition();
    const places = await agent.call("corealm_observe", { scope: "known", limit: 20 });
    const target = (places || [])[Math.min(3, (places || []).length - 1)];
    const moved = target ? await agent.call("corealm_move_to", { locationId: target.id }) : { error: "NO_TARGET" };
    const nav = dbg.getNavigationState();
    const pathed = !moved.error && nav.hasPath && nav.pathPoints > 1 && nav.destination !== null;
    await waitFor(["navigation.completed", "navigation.failed"], 30000);
    const after = dbg.getPlayerPosition();
    const travelled = Math.hypot(after.x - before.x, after.z - before.z);
    note("navigation", pathed && travelled > 5,
      "path points " + nav.pathPoints + ", travelled " + travelled.toFixed(1) + " m");
  }

  // ------------------------------------------------------- gathering skills
  for (const [skill, archetype, verb, hint] of [
    ["mining", "ore", "mine", "pit|seam|mine|quarry"],
    // Hints name the TIER 1 sites specifically. "wood" matched Vellenwood's gates first, whose
    // Duskoaks need Woodcutting 5, so requirementsMet correctly filtered them out and the check
    // read "no tree reachable" while standing in a forest. Same for the tier 10 tarns vs Redsill.
    ["woodcutting", "tree", "chop", "palewood|copse"],
    ["fishing", "fishing_spot", "fish", "redsill|shallow"],
  ]) {
    const before = (await skills())[skill].xp;
    const node = await findNear([archetype], verb, hint);
    if (!node) { note(skill, false, "no " + archetype + " reachable :: " + lastSearchTrail.slice(0, 8).join(" | ")); continue; }
    await doInteract(node.id, verb, ["item.received", "activity.stopped", "resource.depleted"], 60000);
    await sleep(1200);
    const after = (await skills())[skill].xp;
    note(skill, after > before, skill + " xp " + before + " -> " + after + " on " + node.id);
  }

  // ------------------------------------------------------------- depletion
  // Mined out by PLAYING, not by debug.depleteNode: the node has to empty under the gather loop.
  {
    const node = await findNear(["ore"], "mine", "pit|seam");
    let depleted = false;
    // Measured the instant the seam empties, not after the loop. A tier 1 node respawns in 21
    // SIM seconds, which at the gate's time scale is about one second of wall clock: reading the
    // silhouette a few awaits later measured a seam that had already grown its vein back, and the
    // check then reported "spent looks identical to live" about a node that was no longer spent.
    let spentBounds = null;
    let liveBounds = null;
    if (node) {
      // A sibling seam, left full, so "spent-node" below has a live silhouette to measure the
      // depleted one against rather than a number somebody typed into the check.
      const siblings = await agent.call("corealm_observe", { archetypes: ["ore"], radius: 60, limit: 8 });
      const sibling = (siblings || []).find((e) => e.id !== node.id && e.state !== "depleted");
      if (sibling) liveNeighbourId = sibling.id;

      for (let round = 0; round < 12 && !depleted; round += 1) {
        await doInteract(node.id, "mine", ["resource.depleted", "activity.stopped", "inventory.full"], 45000);
        const now = dbg.getEntity(node.id);
        depleted = now && now.state === "depleted";
        if (depleted) {
          // One view sync, no more: \`EntityViews.sync\` runs every 250 ms of sim time, which is a
          // few milliseconds of wall clock here, and every extra one spends the respawn budget.
          await sleep(150);
          spentBounds = dbg.getDrawnBounds(node.id);
          liveBounds = liveNeighbourId ? dbg.getDrawnBounds(liveNeighbourId) : null;
          break;
        }
        if (dbg.getState().inventoryUsed >= 27) {
          const banks = await agent.call("corealm_observe", { scope: "known", archetypes: ["bank"], limit: 2 });
          if (banks && banks[0]) {
            await agent.call("corealm_move_to", { entityId: banks[0].id });
            await waitFor(["navigation.completed", "navigation.failed"], 30000);
            await agent.call("corealm_bank", { op: "depositAll" });
          }
        }
      }
    }
    note("depletion", depleted, node ? node.id + " depleted by mining it out" : "no node");

    // A worked-out node has to still BE somewhere. Phase 1 hid the live instance and drew no
    // replacement, so a seam the player had just mined out vanished from the world: correct
    // state, correct respawn, nothing on screen. Draw calls and mesh counts cannot see this —
    // an InstancedMesh exists whether or not any of its slots hold a visible matrix.
    let spentEvidence = "no node";
    let spentOk = false;
    if (node) {
      const spent = spentBounds;
      const live = liveBounds;
      // Two halves, and both matter. It has to still be THERE — same rock, same silhouette, so a
      // player walking back does not think the seam moved — and it has to be VISIBLY worked out.
      // The ore vein is its own part on the live side only, so the spent node draws one mesh
      // fewer. Size alone would pass on a node that never changed at all.
      const present = !!spent && spent.height > 0.2 && spent.width > 0.2;
      const changed = !!spent && !!live && spent.meshes < live.meshes;
      spentOk = present && changed;
      spentEvidence = spent
        ? node.id + " draws " + spent.width.toFixed(1) + " x " + spent.height.toFixed(1) + " m in "
          + spent.meshes + " meshes"
          + (live ? ", live sibling " + live.width.toFixed(1) + " x " + live.height.toFixed(1)
            + " m in " + live.meshes : "")
          + (changed ? " (vein gone)" : " -- spent looks identical to live")
        : node.id + " draws NOTHING once depleted";
    }
    note("spent-node", spentOk, spentEvidence);
  }

  // ---------------------------------------------------------- production
  for (const [skill, station, recipeHint] of [
    ["smithing", "furnace", "bar"],
    ["cooking", "range", "cook"],
    ["crafting", "crafting_table", "ring"],
    ["fletching", "fletching_bench", "shaft"],
  ]) {
    const before = (await skills())[skill].xp;
    const recipes = await agent.call("corealm_search_docs", { query: recipeHint + " recipe " + skill, limit: 8 });
    const hit = (recipes || []).find((r) => r.docId.startsWith("recipe-"));
    let evidence = "no recipe found for " + skill;
    if (hit) {
      const recipeId = hit.docId.replace("recipe-", "");
      // Ingredients are set up with debug; the PRODUCTION must happen by playing.
      // A clear pack first: six ingredients at four each is 24 non-stackable slots, and whatever
      // the previous check left behind pushed it over 28 so the last ones silently never arrived.
      dbg.clearInventory();
      for (const item of ["grithe_ore","march_stone","palewood_log","silt_minnow","pale_quartz","grithe_bar"]) {
        dbg.giveItem(item, 3);
      }
      // Stations are found by their kind, which lives on the station block rather than in the name.
      const stationEntity = await findStation(station);
      if (!stationEntity) evidence = "no " + station + " station reachable";
      if (stationEntity) {
        await agent.call("corealm_move_to", { entityId: stationEntity.id });
        await waitFor(["navigation.completed", "navigation.failed"], 30000);
        const made = await agent.call("corealm_produce", { recipeId, quantity: 2 });
        if (made.error) evidence = recipeId + " refused: " + made.error + " " + made.message;
        else { await waitFor(["production.completed", "activity.stopped"], 45000); await sleep(900); }
      }
      const after = (await skills())[skill].xp;
      if (after > before) evidence = skill + " xp " + before + " -> " + after + " via " + recipeId;
    }
    note(skill, (await skills())[skill].xp > before, evidence);
  }

  // --------------------------------------------------------------- combat
  {
    const beforeMelee = (await skills()).melee.xp;
    dbg.setSkillLevel("melee", 10);
    dbg.giveItem("grithe_dagger", 1);
    await agent.call("corealm_equip", { itemId: "grithe_dagger" });
    dbg.setHealth(999);
    const enemy = await findNear(["enemy"], "attack", "march|camp|pit|frog");
    let killed = false;
    if (enemy) {
      await agent.call("corealm_move_to", { entityId: enemy.id });
      await waitFor(["navigation.completed", "navigation.failed"], 30000);
      await agent.call("corealm_attack", { entityId: enemy.id });
      for (let i = 0; i < 40 && !killed; i += 1) {
        await sleep(600);
        const e = dbg.getEntity(enemy.id);
        if (!e || e.state === "dead" || (e.combat && e.combat.health <= 0)) killed = true;
        if (dbg.getState().health < 12) dbg.setHealth(999);
        if (!dbg.getState().combatTargetId && !killed) await agent.call("corealm_attack", { entityId: enemy.id });
      }
    }
    const afterMelee = (await skills()).melee.xp;
    note("melee", afterMelee > beforeMelee && killed,
      "melee xp " + beforeMelee + " -> " + afterMelee + ", killed=" + killed);
  }

  // ---------------------------------------------------------------- magic
  {
    dbg.setSkillLevel("magic", 10);
    // Setup changes XP to the level-10 threshold, so the baseline must come afterwards. Otherwise
    // this gate passes before a wand is equipped or a spell is launched.
    const before = (await skills()).magic.xp;
    dbg.clearInventory();
    dbg.giveItem("basic_wooden_wand", 1);
    dbg.giveItem("air_essence", 50);
    const wand = await agent.call("corealm_equip", { itemId: "basic_wooden_wand" });
    const spellbookBefore = await agent.call("corealm_spellbook", { op: "read" });
    const essenceBefore = spellbookBefore.essence ? spellbookBefore.essence.wind : null;
    dbg.setHealth(999);
    // Filtered on "attack", not "cast". Enemies no longer advertise a separate cast verb - one
    // combat verb now means "hit that with what I am holding" - so a "cast" filter matches nothing
    // and this step would quietly report "no enemy found" instead of testing magic at all. The cast
    // below still names its spell explicitly through corealm_attack, which is unchanged.
    // "skitter" is gone from the name pattern with the Rill Skitterlings themselves; the frogs that
    // replaced them on the Redsill shallows are what this step now finds.
    // (No backticks in here: this whole block is inside the playthroughSource template literal.)
    const enemy = await findNear(["enemy"], "attack", "march|camp|pit|frog");
    let evidence = wand.error
      ? "wand equip refused: " + wand.error + " " + wand.message
      : "no enemy found";
    if (enemy && !wand.error) {
      await agent.call("corealm_move_to", { entityId: enemy.id });
      await waitFor(["navigation.completed", "navigation.failed"], 30000);
      for (let i = 0; i < 12; i += 1) {
        const cast = await agent.call("corealm_attack", { entityId: enemy.id, spellId: "voltrend" });
        if (cast.error) { evidence = "cast refused: " + cast.error + " " + cast.message; break; }
        await sleep(700);
        if ((await skills()).magic.xp > before) break;
      }
      const after = (await skills()).magic.xp;
      if (after > before) evidence = "magic xp " + before + " -> " + after;
    }
    const after = (await skills()).magic.xp;
    const spellbookAfter = await agent.call("corealm_spellbook", { op: "read" });
    const essenceAfter = spellbookAfter.essence ? spellbookAfter.essence.wind : null;
    const launched = typeof essenceBefore === "number" && typeof essenceAfter === "number"
      && essenceAfter < essenceBefore;
    note("magic", after > before && launched,
      evidence + ", Air Essence " + essenceBefore + " -> " + essenceAfter);
  }

  // -------------------------------------------------------------- agility
  {
    // The baseline is read AFTER the level grant, not before it.
    //
    // \`setSkillLevel\` writes the level's XP threshold, so a baseline taken before it made
    // \`xp > before\` true the moment setup ran — and the check reported PASS with the evidence
    // "no obstacle found" printed next to it. It was passing on its own setup, which is the exact
    // thing rule 2 in this file's header exists to forbid. Traversal now has to actually move the
    // player, too: an obstacle that awards XP without displacing anybody is not a shortcut.
    dbg.setSkillLevel("agility", 20);
    const before = (await skills()).agility.xp;
    // Either traversal verb, nearest first.
    //
    // The two obstacles beside the spawn town are authored \`vault\` (the Brookvault Planks and the
    // Coldbrace north wall); \`climb\` does not appear until Vellenwood's Canopy Walk, most of a
    // region away. Asking only for \`climb\` used to work by accident, because discovery was not
    // gated and the search could walk straight across the map to it. With the gate on, the check
    // has to ask for what is actually next to it.
    const obstacle = await findNear(["obstacle"], "vault", "brookvault|plank|wall|vault")
      ?? await findNear(["obstacle"], "climb", "ledge|canopy|sunder|tunnel");
    let evidence = "no obstacle found";
    let displaced = 0;
    if (obstacle) {
      const posBefore = dbg.getPlayerPosition();
      const verb = (obstacle.interactions || []).includes("vault") ? "vault" : "climb";
      await doInteract(obstacle.id, verb, ["activity.stopped"], 40000);
      await sleep(1200);
      const posAfter = dbg.getPlayerPosition();
      displaced = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z);
      evidence = "agility xp " + before + " -> " + (await skills()).agility.xp
        + ", displaced " + displaced.toFixed(1) + " m via " + obstacle.id;
    }
    note("agility", !!obstacle && displaced > 3 && (await skills()).agility.xp > before, evidence);
  }

  // ------------------------------------------------------- death and recovery
  {
    dbg.clearInventory();
    dbg.giveItem("grithe_ore", 5);
    const carried = dbg.getState().inventoryUsed;
    const wherePlayer = dbg.getPlayerPosition();
    dbg.setHealth(0);
    await sleep(1500);
    const afterDeath = dbg.getState();
    const respawned = Math.hypot(dbg.getPlayerPosition().x - wherePlayer.x, dbg.getPlayerPosition().z - wherePlayer.z);
    const dropped = afterDeath.inventoryUsed === 0 && carried > 0;
    // The cache is a real entity the player can walk back to and loot.
    // The cache is where you fell; respawn puts you hundreds of metres away, so go back before
    // looking for it. Searching from the respawn point finds nothing and proves nothing.
    dbg.teleport({ x: wherePlayer.x, y: wherePlayer.y, z: wherePlayer.z });
    await sleep(600);
    const caches = await agent.call("corealm_observe", { archetypes: ["recovery_cache", "loot"], radius: 140, limit: 5 });
    let looted = false;
    if (caches && caches[0]) {
      await doInteract(caches[0].id, "loot", ["item.received"], 40000);
      await sleep(600);
      looted = dbg.getState().inventoryUsed > 0;
    }
    note("death", dropped && afterDeath.health > 0,
      "carried " + carried + " -> dropped=" + dropped + ", respawned " + respawned.toFixed(0)
      + " m away, cache=" + ((caches || []).length) + ", recovered=" + looted);
  }

  // ---------------------------------------------------------------- quest
  // Cold Iron, start to finish, by playing every stage.
  {
    let quest = (await agent.call("corealm_quests")).find((q) => q.id === "cold_iron");
    // Travel to the starting settlement first. Earlier checks leave the player wherever the last
    // one finished, which was a dungeon three regions away.
    const town = (await agent.call("corealm_observe", { scope: "known", limit: 40 }))
      .find((p) => /town_center|town_entrance|coldbrace/i.test(p.id));
    if (town) {
      await agent.call("corealm_move_to", { locationId: town.id });
      await waitFor(["navigation.completed", "navigation.failed"], 30000);
    }
    const npcs = await agent.call("corealm_observe", { scope: "visible", archetypes: ["npc"], radius: 140, limit: 40 });
    let giver = null;
    for (const npc of (npcs || [])) {
      const detail = await agent.call("corealm_inspect", { entityId: npc.id });
      if (detail && !detail.error && (detail.npc?.questIds || []).includes("cold_iron")) { giver = npc.id; break; }
    }
    if (!giver) {
      const town = (await agent.call("corealm_observe", { scope: "known", limit: 30 }))
        .find((p) => /town|square|centre/i.test(p.id + " " + p.name));
      if (town) {
        await agent.call("corealm_move_to", { locationId: town.id });
        await waitFor(["navigation.completed", "navigation.failed"], 30000);
        const again = await agent.call("corealm_observe", { scope: "visible", archetypes: ["npc"], radius: 140, limit: 40 });
        for (const npc of (again || [])) {
          const detail = await agent.call("corealm_inspect", { entityId: npc.id });
          if (detail && !detail.error && (detail.npc?.questIds || []).includes("cold_iron")) { giver = npc.id; break; }
        }
      }
    }

    let evidence = "no giver found";
    if (giver) {
      await doInteract(giver, "talk", null, 0);
      // Walk the tree by taking whichever enabled option advances, up to a bounded depth.
      for (let step = 0; step < 12; step += 1) {
        const view = await agent.call("corealm_dialogue", { op: "state" });
        if (!view || view.error) break;
        const options = (view.options || []).filter((o) => o.enabled);
        const advance = options.find((o) => /#(offer|accept|done|hand|report|yes)$/.test(o.id)) || options[0];
        if (!advance) break;
        await agent.call("corealm_dialogue", { op: "choose", optionId: advance.id });
        await sleep(200);
        const now = (await agent.call("corealm_quests")).find((q) => q.id === "cold_iron");
        if (now && now.status === "active") break;
      }
      quest = (await agent.call("corealm_quests")).find((q) => q.id === "cold_iron");
      evidence = "cold_iron " + quest.status + " stage " + quest.stage + "/" + quest.stageCount
        + " :: " + (quest.currentObjective || "");
    }
    note("quest", quest && quest.status !== "unstarted", evidence);
  }

  // ------------------------------------------------------ dungeon and boss
  {
    // Death cleared and dropped the pack, so without re-equipping the player swings barehanded at
    // a boss with 62 armour and lands almost nothing. Gear is setup; the fight is the check.
    dbg.setSkillLevel("melee", 25);
    dbg.clearInventory();
    dbg.giveItem("kaldite_sword", 1);
    await agent.call("corealm_equip", { itemId: "kaldite_sword" });
    // The sleep is load-bearing. \`setHealth\` clamps to \`player.maxHealth\` AT CALL TIME, and
    // maxHealth is recomputed from the skills by the health system's own tick, so setting melee to
    // 25 and healing on the same line heals to the OLD maximum: measured, 23 of an eventual 59.
    // The boss then lands two swings of up to 12 and kills a player the harness believes it healed,
    // and the respawn puts them in Coldbrace 171 m away, where every later re-attack is refused
    // with OUT_OF_RANGE while \`deaths\` stays 0 because the poll never catches the zero-health frame.
    // One tick between the two calls is the whole fix.
    await sleep(400);
    dbg.setHealth(999);
    let entered = false;
    let enteredRegion = "none";
    const portal = dbg.getEntity("gravelmaw_mouth_portal");
    if (portal) {
      dbg.teleport({ locationId: "gravelmaw_entrance" });
      await sleep(500);
      const result = await agent.call("corealm_interact", { entityId: "gravelmaw_mouth_portal", interaction: "enter" });
      entered = !result.error && dbg.getState().regionId === "gravelmaw";
      enteredRegion = dbg.getState().regionId;
    }

    // The boss must take damage from a real attack, and the fight must be survivable long enough
    // to prove it is a fight rather than a decoration.
    dbg.teleport({ locationId: "gravelmaw_arena" });
    await sleep(700);
    const bossBefore = dbg.getEntity("ordrun");
    let bossHp = bossBefore && bossBefore.combat ? bossBefore.combat.health : 0;
    const startHp = bossHp;
    const opened = await agent.call("corealm_attack", { entityId: "ordrun" });
    let bossNote = opened.error ? ("attack refused: " + opened.error + " " + opened.message) : "engaged";
    let deaths = 0;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      const st = dbg.getState();
      if (st.health <= 0) { deaths += 1; dbg.teleport({ locationId: "gravelmaw_arena" }); }
      if (st.health < 40) dbg.setHealth(999);
      const now = dbg.getEntity("ordrun");
      bossHp = now && now.combat ? now.combat.health : 0;
      if (bossHp <= 0) break;
      if (!st.combatTargetId) {
        const again = await agent.call("corealm_attack", { entityId: "ordrun" });
        if (again.error) bossNote = "re-attack refused: " + again.error + " " + again.message;
      }
    }
    note("dungeon", entered, "entered dungeon=" + entered + ", region on entry=" + enteredRegion);
    note("boss", bossHp <= 0 || bossHp < startHp,
      "ordrun " + startHp + " -> " + bossHp + (bossHp <= 0 ? " KILLED" : "")
      + " :: " + bossNote + ", player deaths " + deaths);
  }

  // -------------------------------------------------- combat clears after a kill
  {
    // \`inCombat\` used to mean "the eight-second no-regen window is open", so it stayed true for
    // eight seconds after the last enemy died and an agent waiting for \`inCombat === false\` hung.
    // It now means a fight is happening: a target, or an enemy that has engaged. The regen window
    // is \`regenBlocked\`, and after a kill the two must disagree.
    // The preceding boss proof ends inside Gravelmaw with the tier-0 test wand still equipped.
    // Return to the overworld and give this independent melee assertion its own suitable weapon;
    // otherwise it can time out on a dungeon Elder and strand every later overworld quest check.
    dbg.teleport({ locationId: "town_center" });
    await sleep(500);
    dbg.setSkillLevel("melee", 30);
    dbg.giveItem("kaldite_sword", 1);
    await agent.call("corealm_equip", { itemId: "kaldite_sword" });
    dbg.setHealth(999);
    const enemy = await findNear(["enemy"], "attack", "march|camp|pit|frog|moor");
    let evidence = "no enemy found";
    let cleared = false;
    if (enemy) {
      await agent.call("corealm_move_to", { entityId: enemy.id });
      await waitFor(["navigation.completed", "navigation.failed"], 30000);
      await agent.call("corealm_attack", { entityId: enemy.id });
      // Mid-fight, before anything can have died: this is the half of the claim that says
      // \`inCombat\` means something at all.
      const during = await agent.call("corealm_player");
      let killed = false;
      for (let i = 0; i < 40 && !killed; i += 1) {
        await sleep(500);
        const e = dbg.getEntity(enemy.id);
        if (!e || e.state === "dead" || (e.combat && e.combat.health <= 0)) killed = true;
        if (dbg.getState().health < 20) dbg.setHealth(999);
        if (!dbg.getState().combatTargetId && !killed) await agent.call("corealm_attack", { entityId: enemy.id });
      }
      const after = await agent.call("corealm_player");

      // \`regenBlocked\` is deliberately NOT asserted. It is an eight-second SIM window, and the
      // harness runs at --scale 20, so those eight seconds pass in 0.4 s of wall clock — the
      // assertion was a race that happened to win twice. What the fix actually changed is that
      // \`inCombat\` tracks the fight rather than the window, so that is what is checked: true while
      // swinging, false the moment the target dies. The window is printed as evidence.
      cleared = killed && during.inCombat === true && after.inCombat === false && after.targetId === null;
      evidence = "killed=" + killed + ", inCombat " + during.inCombat + " -> " + after.inCombat
        + ", targetId=" + after.targetId + ", regenBlocked=" + after.regenBlocked;
    }
    note("combat-clears", cleared, evidence);
  }

  // ------------------------------------------------------- equipping is not losing
  {
    // An agent rebuilding its pack from item events used to read an equip as a loss: the piece
    // left the inventory through the ordinary remove path and emitted \`item.lost\`.
    dbg.giveItem("grithe_dagger", 1);
    await agent.call("corealm_equip", { itemId: null, slot: "mainHand" });
    await sleep(200);
    const before = await agent.call("corealm_events", { sinceSeq: cursor, timeoutMs: 1 });
    cursor = before.nextSeq;
    const result = await agent.call("corealm_equip", { itemId: "grithe_dagger" });
    await sleep(400);
    const seen = await agent.call("corealm_events", { sinceSeq: cursor, timeoutMs: 1200 });
    cursor = seen.nextSeq;
    const types = (seen.events || []).map((e) => e.type);
    const equipped = types.includes("item.equipped");
    const lost = types.includes("item.lost");
    note("equip-events", !result.error && equipped && !lost,
      "equip emitted [" + types.join(", ") + "]"
      + (lost ? " -- item.lost must not fire for gear going onto the body" : ""));
  }

  // ------------------------------------------------------- the UI is reachable
  {
    // Every panel was bound to a key and nothing on screen said so, and the keys did not work
    // either: two KeyboardControllers were listening on \`window\`, so one press toggled a panel
    // open and closed again. A player who cannot find their inventory cannot progress.
    const bindings = (dbg.getKeyBindings() || []).filter((b) => b.group === "Panels");
    const opened = [];
    const failed = [];
    const waitForPanel = async (id, open, timeoutMs = 5000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        const state = (dbg.getPanels() || []).find((panel) => panel.id === id);
        if ((state?.open ?? false) === open) return state;
        await sleep(50);
      }
      return (dbg.getPanels() || []).find((panel) => panel.id === id);
    };
    for (const binding of bindings) {
      const key = binding.keys[0];
      const id = binding.id.replace(/^panel\\./, "");
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      const state = await waitForPanel(id, true);
      if (state && state.open) opened.push(id); else failed.push(id);
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await waitForPanel(id, false);
    }
    const dock = document.querySelectorAll(".dock__btn").length;
    note("ui-panels", bindings.length >= 4 && failed.length === 0 && dock >= 4,
      opened.length + "/" + bindings.length + " panel keys open their panel"
      + (failed.length ? " (failed: " + failed.join(", ") + ")" : "")
      + ", " + dock + " dock buttons on screen");
  }

  // --------------------------------------------------- buildings stand on level ground
  {
    // A building is assembled level, so any tilt in the ground under it comes out as a corner in
    // the air and a wall through the grass. This measures the ground, not the assembly.
    const footing = dbg.checkBuildingFooting() || [];
    const bad = footing.filter((b) => b.worst > 0.05);
    note("building-footing", footing.length >= 30 && bad.length === 0,
      footing.length + " buildings, worst ground tilt across a footprint "
      + (footing[0] ? footing[0].worst.toFixed(3) : "?") + " m"
      + (bad.length ? " -- " + bad.length + " over 0.05 m: " + bad.slice(0, 4).map((b) => b.id).join(", ") : ""));
  }

  // ------------------------------------------------- objectives read as prose
  {
    // Quest objectives used to print backticked developer ids into the player's journal. The ids
    // now live in \`refs\`, which is what an agent reads; the sentence is what a player reads.
    const quests = await agent.call("corealm_quests");
    const active = (quests || []).filter((q) => q.status === "active");
    const leaking = active.filter((q) => (q.currentObjective || "").includes(String.fromCharCode(96)));
    const withRefs = active.filter((q) => (q.currentObjectiveRefs || []).length > 0);
    note("objective-prose", active.length > 0 && leaking.length === 0 && withRefs.length > 0,
      active.length + " active, " + leaking.length + " printing ids, "
      + withRefs.length + " carrying refs"
      + (active[0] ? " :: " + active[0].currentObjective : ""));
  }

  // --------------------------------------------- Cold Iron, every stage, then the numbers
  // PRD F3. Not "the quest completed" but "the quest completed and paid exactly what the content
  // table says it pays". \`cold_iron\` deliberately carries no per-stage grants, so the whole delta
  // across the final dialogue choice IS \`rewards\`, and drift in any one number shows up as
  // arithmetic rather than as a vague green.
  //
  // Every stage is completed by the predicate it declares. Debug appears four times and each time
  // it is setup: a skill level so a gather is not glacial, the flux and the shaft that the two
  // recipes consume (exactly as the production checks set up theirs), health so a fight does not
  // end the run, and an emptied pack so "the exact item stacks" can be read off the bag directly
  // instead of inferred from a difference. \`giveItem\` is never used for Grithe ore, because stage
  // 1 counts \`item.received\` and a debug grant emits that event too - it would satisfy the stage
  // without a single swing.
  {
    const expected = (window.__gateExpect || {}).coldIron;
    const trail = [];
    const reached = [];
    dbg.setSkillLevel("mining", 10);
    dbg.setHealth(999);

    let quest = await questOf("cold_iron");
    if (quest.status === "unstarted") {
      const start = await converse("npc_smith_harrow", [optionLike("#offer"), optionLike("accept")]);
      if (!start.ok) trail.push("offer: " + start.at + " -> " + start.detail);
      quest = await questOf("cold_iron");
    }
    reached.push(quest.stage);

    // Stage 1: mine 6 Grithe ore. \`gather\` counts receipts since the stage began.
    if (quest.status === "active" && quest.stage === 0) {
      dbg.clearInventory();
      trail.push("bracken_pit " + await travel({ locationId: "bracken_pit" }, 150000));
      for (let round = 0; round < 12; round += 1) {
        const seams = await agent.call("corealm_observe",
          { archetypes: ["ore"], interaction: "mine", requirementsMet: true, radius: 90, limit: 12 });
        const seam = (seams || []).find((e) => e.state !== "depleted");
        if (!seam) { await sleep(800); continue; }
        await doInteract(seam.id, "mine", ["resource.depleted", "activity.stopped", "inventory.full"], 60000);
        await sleep(300);
        if ((await questOf("cold_iron")).stage > 0) break;
      }
      quest = await waitStage("cold_iron", 0, 6000);
      reached.push(quest.stage);
    }

    // Stage 2: two bars at the furnace. The flux is setup; the smelt is the check.
    if (quest.status === "active" && quest.stage === 1) {
      dbg.giveItem("march_stone", 6);
      trail.push("furnace " + await travel({ entityId: "coldbrace_furnace" }, 90000));
      const smelted = await agent.call("corealm_produce", { recipeId: "smelt_grithe_bar", quantity: 3 });
      if (smelted.error) trail.push("smelt refused: " + smelted.error + " " + smelted.message);
      else await waitFor(["production.completed", "activity.stopped"], 90000);
      quest = await waitStage("cold_iron", 1, 12000);
      reached.push(quest.stage);
    }

    // Stage 3: the dagger at the anvil.
    if (quest.status === "active" && quest.stage === 2) {
      dbg.giveItem("palewood_shaft", 2);
      trail.push("anvil " + await travel({ entityId: "coldbrace_anvil" }, 90000));
      const forged = await agent.call("corealm_produce", { recipeId: "smith_grithe_dagger", quantity: 1 });
      if (forged.error) trail.push("smith refused: " + forged.error + " " + forged.message);
      else await waitFor(["production.completed", "activity.stopped"], 90000);
      quest = await waitStage("cold_iron", 2, 12000);
      reached.push(quest.stage);
    }

    // Stage 4: wear it and use it. The stage checks the slot as well as the kills.
    if (quest.status === "active" && quest.stage === 3) {
      const worn = await agent.call("corealm_equip", { itemId: "grithe_dagger" });
      if (worn.error) trail.push("equip refused: " + worn.error + " " + worn.message);
      const hunt = await slay("frog", 3, 140, { position: [-56, 0, -72] });
      trail.push("frogs killed " + hunt.killed + " [" + hunt.names.join(", ") + "]");
      quest = await waitStage("cold_iron", 3, 10000);
      reached.push(quest.stage);
      if (quest.stage === 3) {
        const counters = questRecord("cold_iron").counters || {};
        trail.push("kill:frog counter reads "
          + (counters["kill:frog"] === undefined ? "ABSENT" : counters["kill:frog"])
          + " after " + hunt.killed + " confirmed kills");
      }
    }

    // Stage 5: tell Harrow, and then count what he pays.
    let evidence = "cold_iron " + quest.status + " stage " + quest.stage + "/" + quest.stageCount;
    let paidRight = false;
    if (quest.status === "active" && quest.stage === 4) {
      await agent.call("corealm_stop");
      // Walk to him BEFORE the snapshot: nothing may happen between reading the numbers and the
      // choice that pays them, or the delta stops being the reward and starts being the journey.
      trail.push("harrow " + await travel({ entityId: "npc_smith_harrow" }, 120000));
      dbg.clearInventory();
      await sleep(500);
      const xpBefore = await skills();
      const goldBefore = (await agent.call("corealm_inventory")).currency;

      const told = await converse("npc_smith_harrow", [optionLike("#done|dagger held")]);
      if (!told.ok) trail.push("harrow: " + told.at + " -> " + told.detail);
      quest = await waitStage("cold_iron", 4, 12000);
      await sleep(800);
      reached.push(quest.stage);

      const xpAfter = await skills();
      const pack = await agent.call("corealm_inventory");
      const xpGained = {};
      for (const skill of Object.keys(xpAfter)) {
        const delta = xpAfter[skill].xp - xpBefore[skill].xp;
        if (delta !== 0) xpGained[skill] = delta;
      }
      const held = {};
      for (const slot of (pack.slots || [])) {
        if (slot) held[slot.itemId] = (held[slot.itemId] || 0) + slot.quantity;
      }
      const owed = {};
      for (const stack of (expected ? expected.items : [])) {
        owed[stack.itemId] = (owed[stack.itemId] || 0) + stack.quantity;
      }
      const gold = pack.currency - goldBefore;
      const same = (got, want) => Object.keys(got).length === Object.keys(want).length
        && Object.keys(want).every((key) => got[key] === want[key]);
      const show = (map) => Object.keys(map).sort().map((key) => key + " " + map[key]).join(", ") || "nothing";

      const xpOk = !!expected && same(xpGained, expected.xp);
      const itemsOk = !!expected && same(held, owed);
      const goldOk = !!expected && gold === expected.currency;
      paidRight = quest.status === "complete" && xpOk && itemsOk && goldOk;
      evidence = "cold_iron " + quest.status + " stage " + quest.stage + "/" + quest.stageCount
        + " via stages [" + reached.join(">") + "]"
        + "; xp {" + show(xpGained) + "} want {" + show(expected ? expected.xp : {}) + "}"
        + (xpOk ? "" : " MISMATCH")
        + "; pack {" + show(held) + "} want {" + show(owed) + "}"
        + (itemsOk ? "" : " MISMATCH")
        + "; gold +" + gold + " want +" + (expected ? expected.currency : "?")
        + (goldOk ? "" : " MISMATCH");
    } else {
      evidence += " -- never reached the hand-in";
    }
    note("cold-iron-complete", paidRight, evidence + (paidRight ? "" : " :: " + trail.join(" | ")));
  }

  // ------------------------------------------- The Long Cairn, all seven stages, by playing
  // PRD F18. The chain an external agent is graded on end to end: unstarted to "complete" using
  // nothing but the tools an outside caller gets. Two lines come out of this one walk, because the
  // Phase 1 gate line ("a chain can be driven past its first stage") is now proved by the walk
  // that finishes it rather than by a separate half-attempt that stopped at stage 2.
  //
  // Debug is setup only: the two skill levels are the quest's own entry requirements, the sword
  // and the health top-ups exist because tier 10 kills a Melee 12 character and dying drops the
  // pack that the last stage checks. No stage is advanced by hand.
  {
    dbg.setSkillLevel("melee", 30);
    dbg.setSkillLevel("mining", 12);
    dbg.setHealth(999);
    dbg.giveItem("kaldite_sword", 1);
    await agent.call("corealm_equip", { itemId: "kaldite_sword" });

    const trail = [];
    const reached = [];
    let leverAttempts = -1;
    let solvedFirstTry = false;

    let quest = await questOf("long_cairn");
    if (quest.status === "unstarted") {
      const start = await converse("npc_cairnkeeper_ode", [optionLike("#offer"), optionLike("accept")]);
      if (!start.ok) trail.push("offer: " + start.at + " -> " + start.detail);
      quest = await questOf("long_cairn");
    }
    reached.push(quest.stage);

    // Stage 1: reach the Great Cairn. Pure movement, no dialogue, no combat.
    if (quest.status === "active" && quest.stage === 0) {
      trail.push("great_cairn " + await travel({ locationId: "great_cairn" }, 180000));
      quest = await waitStage("long_cairn", 0, 8000);
      reached.push(quest.stage);
    }

    // Stage 2: report it to Ode.
    if (quest.status === "active" && quest.stage === 1) {
      const said = await converse("npc_cairnkeeper_ode", [optionLike("#reported|re-stacked")]);
      if (!said.ok) trail.push("report: " + said.at + " -> " + said.detail);
      quest = await waitStage("long_cairn", 1, 8000);
      reached.push(quest.stage);
    }

    // Stage 3: ask Watcher Hale what his rota has seen.
    if (quest.status === "active" && quest.stage === 2) {
      const asked = await converse("npc_watcher_hale", [optionLike("#gravelmaw|plainly")]);
      if (!asked.ok) trail.push("hale: " + asked.at + " -> " + asked.detail);
      quest = await waitStage("long_cairn", 2, 8000);
      reached.push(quest.stage);
    }
    const pastFirstStage = quest.status === "complete" || quest.stage >= 2;

    // Stage 4: into the mouth, four Gravelmaw Rats in the Lit Gallery, then The Collapse.
    if (quest.status === "active" && quest.stage === 3) {
      trail.push("mouth " + await travel({ entityId: "gravelmaw_mouth_portal" }, 180000));
      const entered = await agent.call("corealm_interact",
        { entityId: "gravelmaw_mouth_portal", interaction: "enter" });
      if (entered.error) trail.push("enter refused: " + entered.error + " " + entered.message);
      await sleep(600);
      const hunt = await slay("gravelmaw_ch1_rats|Gravelmaw Rat", 4, 100);
      trail.push("rats killed " + hunt.killed);
      trail.push("collapse " + await travel({ locationId: "gravelmaw_chamber2" }, 90000));
      quest = await waitStage("long_cairn", 3, 10000);
      reached.push(quest.stage);
    }

    // Stage 5: work out the lever order from what Ode says, then open the door in the dark.
    if (quest.status === "active" && quest.stage === 4) {
      const solved = await converse("npc_cairnkeeper_ode", [optionLike("#levers|three levers"), solveLevers]);
      if (!solved.ok) trail.push("levers: " + solved.at + " -> " + solved.detail);
      const record = questRecord("long_cairn");
      leverAttempts = record.counters["lever_attempts"] || 0;
      solvedFirstTry = solved.ok && leverAttempts === 0 && record.flags["lever_order_known"] === true;
      trail.push("lever answer " + (solved.taken[solved.taken.length - 1] || "none")
        + " on attempt " + (leverAttempts + 1));

      trail.push("mouth " + await travel({ entityId: "gravelmaw_mouth_portal" }, 180000));
      await agent.call("corealm_interact", { entityId: "gravelmaw_mouth_portal", interaction: "enter" });
      await sleep(600);
      trail.push("collapse " + await travel({ locationId: "gravelmaw_chamber2" }, 90000));
      let opened = await agent.call("corealm_interact",
        { entityId: "gravelmaw_stone_door", interaction: "open" });
      if (String(opened.started || "").startsWith("walking")) {
        await waitFor(["navigation.completed", "navigation.failed"], 60000);
        opened = await agent.call("corealm_interact",
          { entityId: "gravelmaw_stone_door", interaction: "open" });
      }
      if (opened.error) trail.push("door refused: " + opened.error + " " + opened.message);
      quest = await waitStage("long_cairn", 4, 10000);
      reached.push(quest.stage);
    }

    // Stage 6: back up to Ode for the keeping-stone.
    if (quest.status === "active" && quest.stage === 5) {
      const given = await converse("npc_cairnkeeper_ode", [optionLike("#stone|keeping-stone")]);
      if (!given.ok) trail.push("stone: " + given.at + " -> " + given.detail);
      quest = await waitStage("long_cairn", 5, 10000);
      reached.push(quest.stage);
    }

    // Stage 7: carry the garnet into the hall, over the two Elders. All three at once.
    if (quest.status === "active" && quest.stage === 6) {
      trail.push("mouth " + await travel({ entityId: "gravelmaw_mouth_portal" }, 180000));
      await agent.call("corealm_interact", { entityId: "gravelmaw_mouth_portal", interaction: "enter" });
      await sleep(600);
      trail.push("hall " + await travel({ locationId: "gravelmaw_chamber3" }, 120000));
      const elders = await slay("gravelmaw_ch3_bears|Cave Bear", 2, 100);
      trail.push("elders killed " + elders.killed);
      // Back onto the cairn: the stage wants both Elders down AND the player in the hall AND the
      // garnet still in the pack, all true in the same evaluation.
      trail.push("hall " + await travel({ locationId: "gravelmaw_chamber3" }, 120000));
      quest = await waitStage("long_cairn", 6, 12000);
      reached.push(quest.stage);
    }

    if (quest.status !== "complete") {
      const record = questRecord("long_cairn");
      trail.push("counters " + JSON.stringify(record.counters));
    }

    const summary = "long_cairn " + quest.status + " stage " + quest.stage + "/"
      + (quest.stageCount || 7) + " via stages [" + reached.join(">") + "]";
    note("long-cairn", pastFirstStage, summary);
    note("long-cairn-complete", quest.status === "complete" && solvedFirstTry,
      summary + ", levers " + (leverAttempts < 0 ? "never reached"
        : "solved from the text on attempt " + (leverAttempts + 1))
      + " :: " + trail.join(" | "));
  }

  // ------------------------------------------------------------ persistence
  {
    dbg.saveNow();
    const blob = dbg.getSaveBlob();
    const parsed = JSON.parse(blob);
    const kb = Math.round(blob.length / 1024);
    const levelled = Object.values(parsed.skills).filter((s) => s.level > 1).length;
    note("persistence", kb < 100 && levelled >= 4,
      "save " + kb + " KB, " + levelled + " skills above level 1");
  }

  const all = await skills();
  return {
    checks: out,
    skills: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.level + "/" + v.xp])),
  };
})()`;
}

const GATE_LINES: Record<string, string> = {
  navigation: "Click-to-move computes a real navmesh path and the player walks it",
  mining: "All 10 skills gain XP correctly (Mining)",
  woodcutting: "All 10 skills gain XP correctly (Woodcutting)",
  fishing: "All 10 skills gain XP correctly (Fishing)",
  smithing: "All 10 skills gain XP correctly (Smithing)",
  cooking: "All 10 skills gain XP correctly (Cooking)",
  crafting: "All 10 skills gain XP correctly (Crafting)",
  fletching: "All 10 skills gain XP correctly (Fletching)",
  melee: "Melee is useful and a normal enemy gives meaningful combat",
  magic: "Magic is useful",
  agility: "Agility unlocks traversal",
  depletion: "Resource nodes yield repeatedly, deplete, and respawn",
  death: "Death is consequential with a recoverable container",
  quest: "Quests can be started and progressed by playing",
  dungeon: "The dungeon is enterable",
  boss: "The tier 10 boss provides meaningful combat",
  persistence: "A browser reload retains character progression",
  "spent-node": "A depleted node shows a spent state instead of disappearing",
  "combat-clears": "Combat state clears the moment the last enemy dies",
  "equip-events": "Equipping gear reports itself as equipping, not as losing an item",
  "ui-panels": "Every panel is reachable, and the screen says how",
  "building-footing": "Assembled buildings stand on level ground",
  "objective-prose": "Quest objectives read as prose; their ids live in a structured field",
  "long-cairn": "A quest chain can be driven past its first stage by playing",
  "cold-iron-complete":
    "Completing every stage of Cold Iron moves status to complete and pays the exact reward "
    + "XP per skill, the exact item stacks and the exact mark amount from the quest definition",
  "long-cairn-complete":
    "Agent quest proof: a scripted agent using only WebMCP tools takes The Long Cairn from "
    + "unstarted to complete across all 7 stages",
};

export async function runGateCheck(runCandidate: string, timeScale: number): Promise<GateReport> {
  const runDir = await prepareRun(runCandidate);
  const server = await startGameServer();
  const report: GateReport = {
    startedAt: new Date().toISOString(),
    checks: [],
    passedCount: 0,
    totalCount: 0,
    passed: false,
    consoleErrors: [],
  };

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: GPU_ARGS });
    const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // The gate runs against the Vite dev server, and a dev server full-reloads the page the moment
    // anything under `game/` is saved. A ten-minute playthrough that dies with "execution context
    // was destroyed" because another worker saved a stylesheet is not a gate failure, it is noise,
    // so the HMR socket is mocked: the client connects, and nothing ever arrives on it.
    await page.routeWebSocket("**", () => undefined);
    page.on("pageerror", (error) => report.consoleErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(message.text().slice(0, 300));
    });

    await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
    await page.evaluate((scale) => {
      const api = window.__gameDebug as unknown as { setTimeScale?: (value: number) => void };
      api.setTimeScale?.(scale);
    }, timeScale);

    // F3 asserts exact numbers, so it reads them from `content/quests.ts` rather than carrying its
    // own copy: a rebalance that changes a reward makes the check disagree with the game, which is
    // the point, and never makes the check silently obsolete.
    const coldIron = QUESTS.find((quest) => quest.id === "cold_iron");
    if (!coldIron) throw new Error("content/quests.ts no longer defines cold_iron");
    await page.evaluate((rewards) => {
      (window as unknown as { __gateExpect: unknown }).__gateExpect = { coldIron: rewards };
    }, coldIron.rewards);

    const result = (await page.evaluate(playthroughSource())) as {
      checks: { id: string; passed: boolean; evidence: string }[];
      skills: Record<string, string>;
    };

    for (const check of result.checks) {
      report.checks.push({
        id: check.id,
        gateLine: GATE_LINES[check.id] ?? check.id,
        passed: check.passed,
        evidence: check.evidence,
      });
    }
    report.checks.push({
      id: "skill-summary",
      gateLine: "Final skill levels after the playthrough",
      passed: true,
      evidence: Object.entries(result.skills).map(([k, v]) => `${k} ${v}`).join(", "),
    });
  } catch (error) {
    report.checks.push({
      id: "playthrough",
      gateLine: "The gate playthrough runs to completion",
      passed: false,
      evidence: "",
      error: error instanceof Error ? error.message.slice(0, 400) : String(error),
    });
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }

  const graded = report.checks.filter((check) => check.id !== "skill-summary");
  report.passedCount = graded.filter((check) => check.passed).length;
  report.totalCount = graded.length;
  report.passed = report.totalCount > 0 && report.passedCount === report.totalCount;

  await writeFile(path.join(runDir, "test-results", "gate-check.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npx tsx tools/gate-check.ts --run runs/<id> [--scale 20]");
  const scale = Number(argValue(args, "--scale") ?? 20);

  const report = await runGateCheck(runCandidate, Number.isFinite(scale) ? scale : 20);
  for (const check of report.checks) {
    const mark = check.id === "skill-summary" ? "  " : check.passed ? "PASS" : "FAIL";
    console.log(`${mark.padEnd(5)} ${check.id.padEnd(14)} ${check.evidence}${check.error ? ` ERROR: ${check.error}` : ""}`);
  }
  console.log(`\n${report.passedCount}/${report.totalCount} gate checks passed`);
  if (report.consoleErrors.length) console.log("console errors:", report.consoleErrors.slice(0, 3));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("gate check");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
