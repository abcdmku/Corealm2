/**
 * The Kilnhalt (tier 20) region gate, as an executable checklist.
 *
 * Modelled on tools/gate-check.ts and bound by the same two rules:
 *
 *  1. Every check is a REQUIRED STATE DELTA observed after playing, never "we called a tool".
 *  2. `window.__gameDebug` is SETUP ONLY — levels, item grants, teleports, time scale, advancing
 *     the clock. The thing being checked always happens through `window.corealm.agent`, the same
 *     surface an external agent gets.
 *
 * What it proves, in order:
 *   1. The southern border at z=200 is OPEN: five walked crossings (x -300..300) go from
 *      fallowmarch/vellenwood straight into kilnhalt, continuously, on real navmesh.
 *   2. Tier-20 gathering: emberite ore, kilnstone, cinderpine log, ashfin, fire essence.
 *   4. Production at Emberfast: smelt, smith, cook, craft, fletch, plus bank and shop sanity.
 *   5. Both tier-20 armour styles equip and fill their slots.
 *   6. Cinderwake dies to a real fight, drops the singleton Fire Orb, the Orb awakens the Fire
 *      altar, the altar crafts the Fire Staff, and Emberlash launches with fuel spent.
 *   7. The three older minibosses exist as rank "miniboss", die by playing, drop loot, schedule a
 *      ~180 s respawn, and come back.
 *   8. A full page reload keeps the player in Kilnhalt, the altar awakened, and tier-20 items.
 *
 * Usage: npx tsx tools/verify-kilnhalt-world.ts [--scale 20]
 * Prints ONE JSON report to stdout; progress goes to stderr. Non-zero exit on any failure.
 */
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startGameServer } from "./lib/server.js";
import { argValue } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import type {} from "./lib/debug-api.js";

export interface KilnhaltCheck {
  id: string;
  /** The claim from the amendment brief that this proves. */
  claim: string;
  passed: boolean;
  evidence: string;
  /** Present only when a failure traces to a game bug rather than this harness. */
  blockedBy?: string;
  error?: string;
}

export interface KilnhaltReport {
  startedAt: string;
  checks: KilnhaltCheck[];
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
 * The whole playthrough, run inside the page as one evaluate, for the same two reasons the gate
 * does it this way: every action genuinely goes through the in-page agent surface, and a single
 * long evaluate cannot be interleaved with harness calls that would distort timing.
 *
 * NO BACKTICKS AND NO ${} inside this string: it is the body of a template literal.
 */
function playthroughSource(): string {
  return `(async () => {
  const agent = window.corealm.agent;
  const dbg = window.__gameDebug;
  const out = [];
  let cursor = 0;

  const note = (id, passed, evidence) => out.push({ id, passed, evidence });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (types, ms) => {
    const r = await agent.call("corealm_events", { sinceSeq: cursor, types, timeoutMs: ms });
    cursor = r.nextSeq;
    return r.events || [];
  };
  /** Advances the event cursor past everything setup emitted, so a checked wait cannot match it. */
  const drain = async () => {
    const r = await agent.call("corealm_events", { sinceSeq: cursor, timeoutMs: 1 });
    cursor = r.nextSeq;
  };

  const travel = async (target, ms) => {
    const moved = await agent.call("corealm_move_to", target);
    if (moved.error) return "refused: " + moved.error;
    const seen = await waitFor(["navigation.completed", "navigation.failed"], ms || 60000);
    if (seen.some((e) => e.type === "navigation.completed")) return "arrived";
    return seen.length ? "failed" : "timeout";
  };

  /** Walks to an entity and performs an interaction, handling the walk-then-act round trip. */
  const doInteract = async (entityId, interaction, waitTypes, waitMs) => {
    let started = await agent.call("corealm_interact", { entityId, interaction });
    if (started.error) return started;
    if (String(started.started || "").startsWith("walking")) {
      await waitFor(["navigation.completed", "navigation.failed"], 45000);
      started = await agent.call("corealm_interact", { entityId, interaction });
      if (started.error) return started;
    }
    if (waitTypes) await waitFor(waitTypes, waitMs || 45000);
    return started;
  };

  /** How many of one item the pack holds, off the agent surface. */
  const count = async (itemId) => {
    const inv = await agent.call("corealm_inventory");
    let total = 0;
    for (const slot of (inv.slots || [])) if (slot && slot.itemId === itemId) total += slot.quantity;
    return total;
  };

  const equipSlots = async () => {
    const inv = await agent.call("corealm_inventory");
    return inv.equipment && inv.equipment.slots ? inv.equipment.slots : {};
  };

  // ================================================================ 1. OPEN SEAM
  // Five walked crossings of z=200. Teleport to the southern side is SETUP; the walk north is the
  // check. The sim runs at 4x here so a 50 ms wall poll samples about every 200 ms of game time.
  {
    dbg.setTimeScale(4);
    for (const x of [-300, -150, 0, 150, 300]) {
      const wantStart = x < -20 ? "fallowmarch" : "vellenwood";
      let evidence = "";
      let ok = false;
      for (const off of [0, 8, -8, 16, -16]) {
        const sx = x + off;
        dbg.teleport({ x: sx, y: 0, z: 185 });
        await sleep(350);
        const p0 = dbg.getPlayerPosition();
        if (Math.hypot(p0.x - sx, p0.z - 185) > 15) {
          evidence = "teleport near (" + sx + ",185) snapped " +
            Math.hypot(p0.x - sx, p0.z - 185).toFixed(0) + " m away; ";
          continue;
        }
        const startRegion = dbg.getState().regionId;
        await drain();
        const moved = await agent.call("corealm_move_to", { position: [sx, 0, 216] });
        if (moved.error) { evidence = "move_to refused at x=" + sx + ": " + moved.error + "; "; continue; }
        const regions = [startRegion];
        let last = p0;
        let lastSim = dbg.getState().clock.elapsedMs;
        let maxStep = 0;
        let maxSpeed = 0;
        let yBad = null;
        let still = 0;
        let samples = 1;
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
          await sleep(50);
          const p = dbg.getPlayerPosition();
          const sim = dbg.getState().clock.elapsedMs;
          const step = Math.hypot(p.x - last.x, p.z - last.z);
          const simDt = Math.max(1, sim - lastSim);
          // A wall-clock hiccup stretches one sample; judge the step against the sim time it
          // actually covered as well as the raw 3 m ceiling the brief asks for.
          if (simDt <= 400 && step > maxStep) maxStep = step;
          const speed = step / (simDt / 1000);
          if (speed > maxSpeed) maxSpeed = speed;
          if (!Number.isFinite(p.y) || p.y < -20 || p.y > 120) yBad = p.y;
          const r = dbg.getState().regionId;
          if (r !== regions[regions.length - 1]) regions.push(r);
          still = step < 0.01 ? still + 1 : 0;
          last = p; lastSim = sim; samples += 1;
          if (p.z >= 214) break;
          if (still > 24 && !dbg.getPlayer().moving) break;
        }
        await agent.call("corealm_stop");
        const crossed = last.z >= 210;
        const clean = regions.length === 2 && regions[0] === wantStart && regions[1] === "kilnhalt";
        ok = crossed && clean && maxStep <= 3 && maxSpeed <= 8 && yBad === null;
        evidence += "x=" + sx + (off !== 0 ? " (shifted " + off + " m)" : "")
          + ": z 185 -> " + last.z.toFixed(1)
          + ", regions [" + regions.join(" > ") + "]"
          + ", maxStep " + maxStep.toFixed(2) + " m, maxSpeed " + maxSpeed.toFixed(1) + " m/s"
          + ", " + samples + " samples"
          + (yBad !== null ? ", Y OUT OF BOUNDS " + yBad : "");
        if (ok) break;
        evidence += "; ";
      }
      note("seam@" + x, ok, evidence);
    }
  }

  // ============================================================ 2. TIER-20 GATHERING
  // Levels and tools are setup; every gather goes through corealm_interact and is proved by the
  // pack delta for that exact item.
  {
    dbg.setTimeScale(20);
    dbg.setSkillLevel("mining", 25);
    dbg.setSkillLevel("woodcutting", 25);
    dbg.setSkillLevel("fishing", 25);
    dbg.clearInventory();
    dbg.giveItem("emberite_pickaxe", 1);
    dbg.giveItem("emberite_hatchet", 1);
    dbg.giveItem("cinderpine_rod", 1);

    const gatherOne = async (checkId, locationId, prefix, verb, itemId) => {
      dbg.teleport({ locationId });
      await sleep(400);
      const before = await count(itemId);
      const trail = [];
      let ok = false;
      let after = before;
      for (let attempt = 0; attempt < 4 && !ok; attempt += 1) {
        const seen = await agent.call("corealm_observe", {
          archetypes: ["ore", "tree", "fishing_spot"], radius: 80, limit: 30,
        });
        const node = (seen || []).find((e) => String(e.id).startsWith(prefix) && e.state !== "depleted");
        if (!node) { trail.push("no " + prefix + "* visible"); await sleep(600); continue; }
        await drain();
        const started = await doInteract(node.id, verb,
          ["item.received", "activity.stopped", "resource.depleted"], 30000);
        if (started.error) { trail.push(node.id + " -> " + started.error + " " + (started.message || "")); continue; }
        await agent.call("corealm_stop");
        await sleep(300);
        after = await count(itemId);
        if (after > before) { ok = true; trail.push(node.id); }
      }
      note(checkId, ok, itemId + " " + before + " -> " + after + " :: " + trail.join(" | "));
    };

    await gatherOne("mine-emberite", "clinker_quarry", "clinker_emberite", "mine", "emberite_ore");
    await gatherOne("mine-kilnstone", "clinker_quarry", "clinker_kilnstone", "mine", "kilnstone");
    await gatherOne("chop-cinderpine", "cinderpine_stand", "cinderpine_stand_trees", "chop", "cinderpine_log");
    await gatherOne("fish-ashfin", "ashfin_springs", "ashfin_spring_spots", "fish", "ashfin");
    await gatherOne("mine-fire-essence", "kilnhalt_fire_cache", "kilnhalt_fire_essence_cache", "mine", "fire_essence");
  }

  // ============================================================ 4. PRODUCTION AT EMBERFAST
  // Raw materials are setup; every conversion is a corealm_produce at the named Emberfast station
  // and is proved by the output landing in the pack.
  {
    dbg.setSkillLevel("smithing", 25);
    dbg.setSkillLevel("cooking", 25);
    dbg.setSkillLevel("crafting", 25);
    dbg.setSkillLevel("fletching", 25);
    dbg.clearInventory();
    dbg.giveItem("emberite_ore", 6);
    dbg.giveItem("kilnstone", 4);
    dbg.giveItem("cinderpine_handle", 1);
    dbg.giveItem("ashfin", 3);
    dbg.giveItem("charhide", 3);
    dbg.giveItem("cinderpine_shaft", 3);
    dbg.teleport({ locationId: "emberfast_town" });
    await sleep(400);

    const produceCheck = async (checkId, stationId, recipeId, quantity, outputId, minOut) => {
      const before = await count(outputId);
      const went = await travel({ entityId: stationId }, 30000);
      await drain();
      const made = await agent.call("corealm_produce", { recipeId, quantity, stationId });
      let refused = "";
      if (made.error) refused = " refused: " + made.error + " " + (made.message || "");
      else {
        await waitFor(["production.completed", "activity.stopped"], 30000);
        for (let i = 0; i < 20; i += 1) {
          if ((await count(outputId)) - before >= minOut) break;
          await sleep(250);
        }
      }
      const after = await count(outputId);
      note(checkId, after - before >= minOut,
        outputId + " " + before + " -> " + after + " via " + recipeId + " at " + stationId
        + " (travel " + went + ")" + refused);
      return after - before;
    };

    await produceCheck("smelt-emberite-bar", "emberfast_furnace", "smelt_emberite_bar", 2, "emberite_bar", 2);
    await produceCheck("smith-emberite-sword", "emberfast_anvil", "smith_emberite_sword", 1, "emberite_sword", 1);
    await produceCheck("cook-seared-ashfin", "emberfast_range", "cook_seared_ashfin", 3, "seared_ashfin", 1);
    await produceCheck("craft-charhide-robe", "emberfast_crafting", "craft_charhide_robe", 1, "charhide_robe", 1);
    await produceCheck("fletch-cinderpine-staff", "emberfast_fletching", "fletch_cinderpine_staff", 1, "cinderpine_staff", 1);

    // Bank sanity: deposit one smelted bar at the Emberfast bank, through the agent surface.
    {
      dbg.giveItem("emberite_bar", 1); // guarantees something to deposit even if smelting failed
      const went = await travel({ entityId: "emberfast_bank_counter" }, 30000);
      const before = await count("emberite_bar");
      const dep = await agent.call("corealm_bank", { op: "deposit", itemId: "emberite_bar", quantity: 1 });
      const listing = await agent.call("corealm_bank", { op: "list", filter: "emberite" });
      const after = await count("emberite_bar");
      const inVault = JSON.stringify(listing || "").indexOf("emberite_bar") >= 0;
      note("bank-deposit", !dep.error && after === before - 1 && inVault,
        "emberite_bar in pack " + before + " -> " + after + ", vault shows it=" + inVault
        + " (travel " + went + ")" + (dep.error ? " deposit refused: " + dep.error + " " + (dep.message || "") : ""));
    }

    // Shop sanity: buy Fire Essence at Emberfast Provisioners. Gold is setup.
    {
      dbg.setCurrency(50000);
      const went = await travel({ entityId: "emberfast_general" }, 30000);
      const before = await count("fire_essence");
      const goldBefore = (await agent.call("corealm_inventory")).currency;
      const buy = await agent.call("corealm_shop",
        { op: "buy", shopId: "emberfast_general", itemId: "fire_essence", quantity: 5 });
      const after = await count("fire_essence");
      const goldAfter = (await agent.call("corealm_inventory")).currency;
      note("shop-buy-essence", !buy.error && after - before === 5 && goldAfter < goldBefore,
        "fire_essence " + before + " -> " + after + ", gold " + goldBefore + " -> " + goldAfter
        + " (travel " + went + ")" + (buy.error ? " buy refused: " + buy.error + " " + (buy.message || "") : ""));
    }
  }

  // ============================================================ 5. BOTH ARMOUR STYLES
  // Item grants and levels are setup; every equip goes through corealm_equip and the check reads
  // the equipment slots back off the agent surface. Magic first, so the run ends wearing the
  // melee kit the Cinderwake fight needs.
  {
    dbg.setSkillLevel("magic", 25);
    dbg.setSkillLevel("melee", 40);
    await sleep(400); // maxHealth recomputes on the next tick; see gate-check's note
    dbg.setHealth(999);
    dbg.clearInventory();

    const equipSet = async (pieces) => {
      const errors = [];
      for (const itemId of pieces) {
        dbg.giveItem(itemId, 1);
        const worn = await agent.call("corealm_equip", { itemId });
        if (worn.error) errors.push(itemId + ": " + worn.error + " " + (worn.message || ""));
      }
      return errors;
    };
    const showSlots = (slots, names) => names
      .map((slot) => slot + "=" + (slots[slot] ? slots[slot].itemId : "EMPTY")).join(", ");

    // Magic style: the five charhide pieces plus the two cinder accessories.
    {
      const errors = await equipSet([
        "charhide_hood", "charhide_robe", "charhide_leggings", "charhide_boots", "charhide_wraps",
        "cinder_ring", "cinder_charm",
      ]);
      const slots = await equipSlots();
      const hideSlots = ["head", "body", "legs", "feet", "hands"];
      const hideOk = hideSlots.every((slot) => slots[slot] && String(slots[slot].itemId).startsWith("charhide"));
      const accOk = !!(slots.accessory1 && slots.accessory2);
      note("armour-magic", errors.length === 0 && hideOk && accOk,
        showSlots(slots, hideSlots.concat(["accessory1", "accessory2"]))
        + (errors.length ? " :: " + errors.join(" | ") : ""));
    }

    // Melee style: the full melee_t20 kit, all nine slots.
    {
      const errors = await equipSet([
        "emberite_helm", "emberite_plate", "emberite_greaves", "emberite_boots", "emberite_gauntlets",
        "emberite_sword", "cinderpine_shield", "emberite_ring", "emberite_pendant",
      ]);
      const slots = await equipSlots();
      const all = ["head", "body", "legs", "feet", "hands", "mainHand", "offHand", "accessory1", "accessory2"];
      const filled = all.every((slot) => !!slots[slot]);
      const swordOn = !!(slots.mainHand && slots.mainHand.itemId === "emberite_sword");
      const emberite = ["head", "body", "legs", "feet", "hands"]
        .every((slot) => slots[slot] && String(slots[slot].itemId).startsWith("emberite"));
      const inv = await agent.call("corealm_inventory");
      const totals = inv.equipment && inv.equipment.totals ? inv.equipment.totals : {};
      note("armour-melee", errors.length === 0 && filled && swordOn && emberite,
        showSlots(slots, all) + " :: totals " + JSON.stringify(totals)
        + (errors.length ? " :: " + errors.join(" | ") : ""));
    }
  }

  // ==================================================== 6. CINDERWAKE AND FIRE PROGRESSION
  {
    dbg.clearInventory();
    dbg.setHealth(999);
    dbg.setTimeScale(20);
    dbg.teleport({ locationId: "kilnhalt_fire_cache" });
    await sleep(400);

    const bossBefore = dbg.getEntity("cinderwake");
    const startHp = bossBefore && bossBefore.combat ? bossBefore.combat.health : -1;
    const went = await travel({ entityId: "cinderwake" }, 60000);
    await drain();
    const opened = await agent.call("corealm_attack", { entityId: "cinderwake" });
    let trail = opened.error ? "attack refused: " + opened.error + " " + (opened.message || "") : "engaged";
    let killed = false;
    let deaths = 0;
    for (let i = 0; i < 300 && !killed; i += 1) {
      await sleep(200);
      const st = dbg.getState();
      if (st.health <= 0) {
        deaths += 1;
        await sleep(1200);
        dbg.teleport({ locationId: "cinderwake_arena" });
        await sleep(300);
        dbg.setHealth(999);
      } else if (st.health < st.maxHealth * 0.6) dbg.setHealth(999);
      const live = dbg.getEntity("cinderwake");
      if (!live || live.state === "dead" || (live.combat && live.combat.health <= 0)) { killed = true; break; }
      if (!dbg.getState().combatTargetId) await agent.call("corealm_attack", { entityId: "cinderwake" });
    }
    // Loot expires in 60 SIM seconds, which at 20x is three wall seconds: slow down immediately.
    dbg.setTimeScale(1);
    note("cinderwake-kill", killed,
      "cinderwake hp " + startHp + " -> " + (killed ? 0 : "still alive")
      + ", player deaths " + deaths + " (travel " + went + ") :: " + trail);

    /** Finds a loot pile by id prefix, opens it, and takes everything, all through the agent. */
    const lootPrefix = async (prefix) => {
      for (let i = 0; i < 12; i += 1) {
        const piles = await agent.call("corealm_observe", { archetypes: ["loot"], radius: 80, limit: 10 });
        const pile = (piles || []).find((p) => String(p.id).indexOf(prefix) === 0);
        if (pile) {
          await doInteract(pile.id, "loot", null, 0);
          const took = await agent.call("corealm_take_loot", { entityId: pile.id });
          return { pileId: pile.id, took };
        }
        await sleep(250);
      }
      return null;
    };

    // The singleton Fire Orb, taken through the loot surface.
    {
      const before = await count("fire_orb");
      const looted = await lootPrefix("loot_cinderwake");
      const after = await count("fire_orb");
      const takenIds = looted && looted.took && looted.took.taken
        ? looted.took.taken.map((s) => s.itemId + " x" + s.quantity).join(", ")
        : "nothing";
      note("fire-orb-loot", !!looted && after > before,
        (looted ? looted.pileId + " -> took [" + takenIds + "]" : "no cinderwake loot pile appeared")
        + ", fire_orb " + before + " -> " + after);
    }

    // Awaken the altar with the carried Orb. The interact is the check; the Orb was earned above.
    {
      dbg.setTimeScale(10);
      const wentAltar = await travel({ entityId: "kilnhalt_fire_altar" }, 30000);
      await drain();
      const woke = await doInteract("kilnhalt_fire_altar", "awaken", null, 0);
      const seen = await waitFor(["essence.altarAwakened"], 8000);
      const altar = dbg.getEntity("kilnhalt_fire_altar");
      const orbGone = (await count("fire_orb")) === 0;
      note("altar-awaken",
        !woke.error && seen.length > 0 && !!altar && altar.state === "awakened" && orbGone,
        "altar state=" + (altar ? altar.state : "MISSING")
        + ", essence.altarAwakened events=" + seen.length
        + ", orb consumed=" + orbGone + " (travel " + wentAltar + ")"
        + (woke.error ? " awaken refused: " + woke.error + " " + (woke.message || "") : ""));
    }

    // Craft the Fire Staff at the awakened altar. The cinderpine base is setup material.
    {
      if ((await count("cinderpine_staff")) === 0) dbg.giveItem("cinderpine_staff", 1);
      const before = await count("fire_staff");
      await drain();
      const made = await agent.call("corealm_produce",
        { recipeId: "craft_fire_staff", quantity: 1, stationId: "kilnhalt_fire_altar" });
      if (!made.error) {
        await waitFor(["production.completed", "activity.stopped"], 20000);
        for (let i = 0; i < 20; i += 1) {
          if ((await count("fire_staff")) > before) break;
          await sleep(250);
        }
      }
      const after = await count("fire_staff");
      note("craft-fire-staff", after > before,
        "fire_staff " + before + " -> " + after + " via craft_fire_staff at the awakened altar"
        + (made.error ? " refused: " + made.error + " " + (made.message || "") : ""));
    }

    // Equip the staff and cast Emberlash at a live enemy; the check is a spell.launched carrying
    // the fire spell plus fuel actually spent (a weapon charge or a carried Fire Essence).
    {
      await agent.call("corealm_equip", { unequipSlot: "offHand" }); // a staff is two-handed
      const worn = await agent.call("corealm_equip", { itemId: "fire_staff" });
      if ((await count("fire_essence")) < 5) dbg.giveItem("fire_essence", 50);
      const bookBefore = await agent.call("corealm_spellbook", { op: "read" });
      const chargesBefore = bookBefore.equippedWeapon ? bookBefore.equippedWeapon.charges : null;
      const essenceBefore = bookBefore.essence ? bookBefore.essence.fire : null;
      dbg.teleport({ x: 80, y: 0, z: 380 }); // the Cinder Boar ground; teleport is setup
      await sleep(400);
      dbg.setHealth(999);
      const enemies = await agent.call("corealm_observe", { archetypes: ["enemy"], radius: 120, limit: 20 });
      const target = (enemies || []).find((e) => e.state !== "dead");
      let evidence = worn.error ? "staff equip refused: " + worn.error + " " + (worn.message || "") : "";
      let launchedRow = null;
      if (target && !worn.error) {
        await travel({ entityId: target.id }, 30000);
        await drain();
        for (let i = 0; i < 4 && !launchedRow; i += 1) {
          const cast = await agent.call("corealm_attack", { entityId: target.id, spellId: "emberlash" });
          if (cast.error) { evidence = "cast refused: " + cast.error + " " + (cast.message || ""); break; }
          const seen = await waitFor(["spell.launched"], 8000);
          launchedRow = seen.find((e) => e.data && e.data.spellId === "emberlash") || null;
        }
        await agent.call("corealm_stop");
      } else if (!target) evidence = "no enemy near the Cinder Boar ground";
      const bookAfter = await agent.call("corealm_spellbook", { op: "read" });
      const chargesAfter = bookAfter.equippedWeapon ? bookAfter.equippedWeapon.charges : null;
      const essenceAfter = bookAfter.essence ? bookAfter.essence.fire : null;
      const fuelSpent = (typeof chargesBefore === "number" && typeof chargesAfter === "number" && chargesAfter < chargesBefore)
        || (typeof essenceBefore === "number" && typeof essenceAfter === "number" && essenceAfter < essenceBefore);
      note("emberlash-cast", !!launchedRow && fuelSpent,
        (launchedRow ? "spell.launched emberlash (element " + (launchedRow.data.element || "?") + ")" : "no emberlash launch seen")
        + ", charges " + chargesBefore + " -> " + chargesAfter
        + ", fire essence " + essenceBefore + " -> " + essenceAfter
        + (evidence ? " :: " + evidence : ""));
      // Back into the melee kit for the miniboss tour.
      await agent.call("corealm_equip", { itemId: "emberite_sword" });
      await agent.call("corealm_equip", { itemId: "cinderpine_shield" });
    }
  }

  // ================================================================ 7. MINIBOSS TOUR
  // Teleports are setup. Each boss must exist as archetype "boss" rank "miniboss", die to real
  // attacks, leave a loot pile, schedule a ~180 s respawn, and come back after the clock advances.
  {
    dbg.setSkillLevel("melee", 60);
    await sleep(400);
    dbg.setHealth(999);

    const lootPrefix = async (prefix) => {
      for (let i = 0; i < 12; i += 1) {
        const piles = await agent.call("corealm_observe", { archetypes: ["loot"], radius: 80, limit: 10 });
        const pile = (piles || []).find((p) => String(p.id).indexOf(prefix) === 0);
        if (pile) {
          await doInteract(pile.id, "loot", null, 0);
          const took = await agent.call("corealm_take_loot", { entityId: pile.id });
          return { pileId: pile.id, took };
        }
        await sleep(250);
      }
      return null;
    };

    const killOnce = async (id) => {
      const went = await travel({ entityId: id }, 40000);
      await agent.call("corealm_attack", { entityId: id });
      for (let i = 0; i < 150; i += 1) {
        await sleep(150);
        const st = dbg.getState();
        if (st.health < st.maxHealth * 0.5) dbg.setHealth(999);
        const live = dbg.getEntity(id);
        if (!live || live.state === "dead" || (live.combat && live.combat.health <= 0)) return { killed: true, went };
        if (!st.combatTargetId) await agent.call("corealm_attack", { entityId: id });
      }
      return { killed: false, went };
    };

    for (const [id, x, z] of [["galeskin", -300, 145], ["mossbound", 318, 72], ["tideworn", 18, -164]]) {
      dbg.setTimeScale(20);
      dbg.setHealth(999);
      dbg.teleport({ x, y: 0, z });
      await sleep(500);
      const ent = dbg.getEntity(id);
      const isBoss = !!ent && ent.archetype === "boss" && !!ent.meta && ent.meta.rank === "miniboss";
      let killed = false;
      let lootInfo = null;
      let respawnInMs = null;
      let respawned = false;
      let evidence = ent
        ? id + " archetype=" + ent.archetype + " rank=" + (ent.meta ? ent.meta.rank : "?") + " hp=" + (ent.combat ? ent.combat.health : "?")
        : id + " MISSING near (" + x + "," + z + ")";
      if (ent) {
        // Ordinary drops are independent chance rolls, so one kill can genuinely roll nothing
        // (about 12% for Galeskin). A second kill after an advanced respawn keeps the check about
        // the loot path rather than one unlucky roll.
        for (let round = 0; round < 2 && !lootInfo; round += 1) {
          const fight = await killOnce(id);
          killed = fight.killed;
          if (!killed) { evidence += ", fight round " + (round + 1) + " timed out (travel " + fight.went + ")"; break; }
          dbg.setTimeScale(1); // loot expires in 60 sim seconds
          try {
            const rec = JSON.parse(dbg.getSaveBlob()).world.enemies[id];
            const simNow = dbg.getState().clock.elapsedMs;
            if (rec && typeof rec.respawnAtMs === "number") respawnInMs = rec.respawnAtMs - simNow;
          } catch (ignored) { /* respawnInMs stays null and the check reports it */ }
          lootInfo = await lootPrefix("loot_" + id);
          if (!lootInfo && round === 0) {
            evidence += ", kill 1 rolled no items";
            dbg.setTimeScale(20);
            dbg.advanceGameTime(200);
            await sleep(900);
          }
        }
        if (killed) {
          dbg.setTimeScale(20);
          dbg.advanceGameTime(200);
          await sleep(1000);
          const back = dbg.getEntity(id);
          respawned = !!back && back.state === "alive" && !!back.combat && back.combat.health > 0;
        }
        evidence += ", killed=" + killed
          + ", respawn scheduled in " + (respawnInMs === null ? "UNKNOWN" : Math.round(respawnInMs / 1000) + " s")
          + ", loot=" + (lootInfo ? lootInfo.pileId : "none")
          + ", back alive after +200 s=" + respawned;
      }
      note(id + "-kill", isBoss && killed, evidence);
      note(id + "-loot", !!lootInfo,
        lootInfo
          ? lootInfo.pileId + " taken ["
            + (lootInfo.took && lootInfo.took.taken
              ? lootInfo.took.taken.map((s) => s.itemId + " x" + s.quantity).join(", ") : "?") + "]"
          : id + ": no loot pile in two kills");
      note(id + "-respawn",
        respawnInMs !== null && respawnInMs > 150000 && respawnInMs < 210000 && respawned,
        "scheduled " + (respawnInMs === null ? "UNKNOWN" : Math.round(respawnInMs / 1000) + " s")
        + " after death (want ~180 s), alive after advancing 200 s=" + respawned);
    }
  }

  // ======================================================== 8. PERSISTENCE (page half)
  // Stand in Kilnhalt with the altar awakened and a tier-20 item carried, and force a save. The
  // harness then reloads the page and reads the other half of this check.
  {
    dbg.setTimeScale(1);
    dbg.teleport({ locationId: "emberfast_town" });
    await sleep(500);
    if ((await count("fire_staff")) === 0 && (await count("emberite_bar")) === 0) dbg.giveItem("emberite_bar", 1);
    dbg.saveNow();
  }

  return { checks: out };
})()`;
}

/** The read-back after the reload. Everything here is observation, not action. */
function persistedStateSource(): string {
  return `(() => {
  const dbg = window.__gameDebug;
  const st = dbg.getState();
  const altar = dbg.getEntity("kilnhalt_fire_altar");
  let blob = {};
  try { blob = JSON.parse(dbg.getSaveBlob()); } catch (ignored) { blob = {}; }
  const items = ((blob.inventory && blob.inventory.slots) || []).filter(Boolean).map((s) => s.itemId);
  const pos = dbg.getPlayerPosition();
  return {
    regionId: st.regionId,
    position: pos,
    altarState: altar ? altar.state : "MISSING",
    awakenedFlag: !!(blob.magic && blob.magic.awakenedAltars && blob.magic.awakenedAltars.kilnhalt_fire_altar),
    orbConsumed: !!(blob.magic && blob.magic.consumedOrbs && blob.magic.consumedOrbs.fire_orb),
    items,
  };
})()`;
}

const TIER20_ITEM_PREFIXES = [
  "emberite_", "cinderpine_", "charhide", "kilnstone", "fire_staff", "fire_wand",
  "fire_opal", "fire_essence", "cinder_", "ashfin", "seared_ashfin", "cinderwake_",
];

const CLAIMS: Record<string, string> = {
  "seam@-300": "Open seam: walking north at x=-300 crosses z=200 continuously, fallowmarch -> kilnhalt",
  "seam@-150": "Open seam: walking north at x=-150 crosses z=200 continuously, fallowmarch -> kilnhalt",
  "seam@0": "Open seam: walking north at x=0 crosses z=200 continuously, vellenwood -> kilnhalt",
  "seam@150": "Open seam: walking north at x=150 crosses z=200 continuously, vellenwood -> kilnhalt",
  "seam@300": "Open seam: walking north at x=300 crosses z=200 continuously, vellenwood -> kilnhalt",
  "mine-emberite": "Mining an Emberite seam at the Clinker Quarry yields emberite_ore",
  "mine-kilnstone": "Mining a Kilnstone face at the Clinker Quarry yields kilnstone",
  "chop-cinderpine": "Chopping a Cinderpine at the stand yields cinderpine_log",
  "fish-ashfin": "Fishing an Ashfin Spring yields ashfin",
  "mine-fire-essence": "Mining the Fire Essence cache yields fire_essence",
  "smelt-emberite-bar": "The Emberfast furnace smelts emberite_bar from 3 ore + 2 kilnstone",
  "smith-emberite-sword": "The Emberfast anvil smiths emberite_sword from 2 bars + a cinderpine handle",
  "cook-seared-ashfin": "The Emberfast range cooks seared_ashfin",
  "craft-charhide-robe": "The Emberfast crafting table crafts charhide_robe from 3 charhide",
  "fletch-cinderpine-staff": "The Emberfast fletching bench fletches cinderpine_staff from 3 shafts",
  "bank-deposit": "The Emberfast bank accepts a deposit",
  "shop-buy-essence": "Emberfast Provisioners sells fire_essence for gold",
  "armour-magic": "The tier-20 magic style (charhide + cinder accessories) equips and fills its slots",
  "armour-melee": "The full melee_t20 kit equips and fills all nine slots",
  "cinderwake-kill": "Cinderwake (260 HP, territorial) dies to a real fight through the agent surface",
  "fire-orb-loot": "Cinderwake drops the singleton fire_orb at 100% and the loot surface hands it over",
  "altar-awaken": "Using the Fire Orb on the dormant altar emits essence.altarAwakened and awakens it",
  "craft-fire-staff": "The awakened altar crafts fire_staff from a cinderpine_staff base",
  "emberlash-cast": "Emberlash launches from the Fire Staff and consumes fuel",
  "galeskin-kill": "Galeskin exists in Fallowmarch as a rank-miniboss boss and dies by playing",
  "galeskin-loot": "Galeskin leaves a lootable pile of its ordinary drops",
  "galeskin-respawn": "Galeskin schedules a ~180 s respawn and comes back",
  "mossbound-kill": "Mossbound exists in Vellenwood as a rank-miniboss boss and dies by playing",
  "mossbound-loot": "Mossbound leaves a lootable pile of its ordinary drops",
  "mossbound-respawn": "Mossbound schedules a ~180 s respawn and comes back",
  "tideworn-kill": "Tideworn exists in Karrowmoor as a rank-miniboss boss and dies by playing",
  "tideworn-loot": "Tideworn leaves a lootable pile of its ordinary drops",
  "tideworn-respawn": "Tideworn schedules a ~180 s respawn and comes back",
  "persistence-reload": "A reload keeps the player in Kilnhalt, the altar awakened, and a tier-20 item",
};

export async function runKilnhaltVerification(timeScale: number): Promise<KilnhaltReport> {
  const server = await startGameServer();
  const report: KilnhaltReport = {
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
    // Same HMR-socket mock as gate-check: another worker saving a file must not reload this page.
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

    const result = (await page.evaluate(playthroughSource())) as {
      checks: { id: string; passed: boolean; evidence: string }[];
    };
    for (const check of result.checks) {
      report.checks.push({
        id: check.id,
        claim: CLAIMS[check.id] ?? check.id,
        passed: check.passed,
        evidence: check.evidence,
      });
    }

    // ---------------------------------------------- 8. PERSISTENCE (harness half)
    // A REAL reload: fresh document, boot from the localStorage save the page half wrote.
    await page.reload({ waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });
    const persisted = (await page.evaluate(persistedStateSource())) as {
      regionId: string;
      position: { x: number; y: number; z: number };
      altarState: string;
      awakenedFlag: boolean;
      orbConsumed: boolean;
      items: string[];
    };
    const tier20Kept = persisted.items.filter((id) =>
      TIER20_ITEM_PREFIXES.some((prefix) => id === prefix || id.startsWith(prefix)));
    report.checks.push({
      id: "persistence-reload",
      claim: CLAIMS["persistence-reload"] ?? "persistence-reload",
      passed: persisted.regionId === "kilnhalt"
        && persisted.altarState === "awakened"
        && persisted.awakenedFlag
        && persisted.orbConsumed
        && tier20Kept.length > 0,
      evidence: "after reload: region " + persisted.regionId
        + " at (" + persisted.position.x.toFixed(0) + "," + persisted.position.z.toFixed(0) + ")"
        + ", altar " + persisted.altarState
        + ", awakened flag " + persisted.awakenedFlag
        + ", orb consumed " + persisted.orbConsumed
        + ", tier-20 items kept [" + tier20Kept.join(", ") + "]",
    });
  } catch (error) {
    report.checks.push({
      id: "playthrough",
      claim: "The Kilnhalt verification playthrough runs to completion",
      passed: false,
      evidence: "",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    });
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }

  report.passedCount = report.checks.filter((check) => check.passed).length;
  report.totalCount = report.checks.length;
  report.passed = report.totalCount > 0 && report.passedCount === report.totalCount;
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scale = Number(argValue(args, "--scale") ?? 20);
  const report = await runKilnhaltVerification(Number.isFinite(scale) ? scale : 20);

  for (const check of report.checks) {
    const mark = check.passed ? "PASS" : "FAIL";
    console.error(`${mark} ${check.id.padEnd(22)} ${check.evidence}${check.error ? ` ERROR: ${check.error}` : ""}`);
  }
  console.error(`\n${report.passedCount}/${report.totalCount} kilnhalt checks passed`);

  // The one JSON report, on stdout, and nothing else on stdout.
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("kilnhalt verification", 290_000);
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
