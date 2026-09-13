/**
 * Generated game documentation and its search index.
 *
 * Documentation is a game feature, not a README. Everything here is derived from the same canonical
 * content the runtime uses, so the docs cannot drift from the game: if a recipe changes, its doc
 * entry changes with it.
 *
 * This backs `GameApi.searchDocs` and therefore the agent's `corealm_search_docs` tool. It is
 * strictly *public* knowledge — XP tables, recipes, item stats, region descriptions. Hidden quest
 * state never appears here, because information parity is a design pillar: an agent discovers the
 * world the way a player does.
 *
 * FROZEN. Only the root edits this file.
 */
import type { DocHit, SkillId } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../content/xp.js";
import {
  content, enemyCombatLevel, gatherXp, healAmount, respawnSeconds, sellPrice, toolBonus, yieldRange,
} from "../content/index.js";
import { REGIONS } from "../content/regions.js";
import { RESOURCE_ARCHETYPES, resourceDef } from "../content/resources.js";
import { GATHERING_PRODUCTION_TIERS } from "../content/gatheringProductionTiers.js";

export interface DocEntry {
  id: string;
  title: string;
  section: string;
  /** Plain text. The search index tokenises this. */
  body: string;
  /** Extra terms that should match this entry without cluttering the body. */
  keywords?: string[];
}

/** Builds the whole documentation set from canonical content. Call after `content.register`. */
export function buildDocs(): DocEntry[] {
  const entries: DocEntry[] = [];

  // ------------------------------------------------------------ progression
  const table = xpTable();
  const checkpoints = TIERS.map((tier) => `level ${tier}: ${totalXpAt(tier).toLocaleString()} XP`).join(", ");
  entries.push({
    id: "xp-curve",
    title: "Experience and levels",
    section: "Progression",
    body:
      `Every skill runs from level 1 to level ${MAX_LEVEL}. Reaching level ${MAX_LEVEL} in one skill `
      + `costs ${totalXpAt(MAX_LEVEL).toLocaleString()} experience in total. The curve is exponential: `
      + `${checkpoints}. Level 92 is roughly the halfway point of the total, so the second half of a `
      + `skill costs about as much as the first 92 levels combined. New gathering materials unlock at levels `
      + `${GATHERING_PRODUCTION_TIERS.map(row => row.reqLevel).join(", ")}.`,
    keywords: ["xp", "experience", "level", "curve", "table", "99"],
  });

  entries.push({
    id: "xp-table",
    title: "Full experience table",
    section: "Progression",
    body: table
      .map((xp, level) => (level === 0 ? "" : `Level ${level}: ${xp.toLocaleString()} total XP`))
      .filter(Boolean)
      .join(". "),
    keywords: ["xp table", "experience table", "how much xp"],
  });

  // ----------------------------------------------------------------- skills
  for (const skill of Object.values(SKILLS)) {
    entries.push({
      id: `skill-${skill.id}`,
      title: skill.name,
      section: "Skills",
      body: `${skill.name} is a ${skill.group} skill. ${skill.blurb}`,
      keywords: [skill.id, skill.group],
    });
  }

  entries.push({
    id: "gathering-rates",
    title: "How gathering works",
    section: "Skills",
    body:
      "Mining, Woodcutting and Fishing share one model. A gather attempt happens every 1.8 seconds. "
      + "At the node's own required level the success chance is exactly 30%, which is one yield every "
      + "6 seconds; the chance rises by 1.6 percentage points per level above the requirement and caps "
      + "at 95%. Experience per yield depends on the material: "
      + `${GATHERING_PRODUCTION_TIERS.map(row => `${row.metalName} gives ${gatherXp(row.tier)} XP`).join(", ")}. `
      + "A better tool raises your effective level but never lets you gather a node you do not meet "
      + `the base requirement for: ${GATHERING_PRODUCTION_TIERS.map(row => `${row.metalName} tools add +${toolBonus(row.tier)} effective levels`).join(", ")}. `
      + `Nodes give a limited number of yields before depleting: ${GATHERING_PRODUCTION_TIERS.map(row => {
        const [low, high] = yieldRange(row.tier);
        return `${row.metalName} deposits give ${low} to ${high} and respawn after ${respawnSeconds(row.tier)} seconds`;
      }).join(", ")}. Essence caches are authored exceptions. Each one holds 40 to 90 successful `
      + "mining yields and returns 30 seconds after depletion.",
    keywords: ["mining", "woodcutting", "fishing", "gather", "xp per hour", "respawn", "depleted"],
  });

  for (const resource of RESOURCE_ARCHETYPES) {
    const [low, high] = resource.yieldRange ?? yieldRange(resource.tier);
    const cooldown = resource.respawnSeconds ?? respawnSeconds(resource.tier);
    const item = content.item(resource.itemId);
    entries.push({
      id: `resource-${resource.id}`,
      title: resource.name,
      section: "Resources",
      body:
        `${resource.name} needs ${SKILLS[resource.skill]?.name ?? resource.skill} ${resource.reqLevel}. `
        + `It yields ${item?.name ?? resource.itemId}, gives ${gatherXp(resource.tier)} XP per `
        + `successful gather, holds ${low} to ${high} yields, and respawns after ${cooldown} seconds.`,
      keywords: [resource.id, resource.itemId, resource.skill, "resource", "node", "respawn"],
    });
  }

  entries.push({
    id: "combat-formulas",
    title: "How combat works",
    section: "Combat",
    body:
      "Melee attacks resolve on a 600 ms combat tick. Magic launches and bolt arrivals resolve on "
      + "the 100 ms simulation tick, which preserves the exact 2.2 second wand and 3.0 second staff "
      + "cadences. Your chance to hit is attackRoll / (attackRoll + defenceRoll), clamped between 5% "
      + "and 95%, where attackRoll is (attackLevel + 9) scaled by your accuracy bonus and defenceRoll "
      + "is (defenceLevel + 9) scaled by the target's armour. Melee damage rolls between 1 and "
      + "floor(2 + (Melee level + gear power) / 4.2). Magic is 15% more accurate and rolls up to "
      + "floor(spell base + (Magic level + magic power) / spell divisor). Each cast consumes one "
      + "matching elemental-weapon charge, then falls back to one carried Essence. Attacking uses whatever is in your main "
      + "hand: a wand casts every 2.2 seconds for lower power, a two-handed staff casts every 3.0 "
      + "seconds for higher power, and a blade swings at 1.6 m. Both magic weapons reach fifteen metres. "
      + "A spell does not hurt anything until its bolt arrives, which takes about 0.3 to 1.3 seconds "
      + "depending on the spell and the range, so the target's health moves after the cast rather "
      + "than with it. "
      + "Magic beats high-armour, low-magic-armour targets; melee "
      + "beats the reverse. You gain 4 experience per point of damage dealt, plus twice the target's "
      + "maximum health when it dies. Health is derived: 20 + 3 * floor((Melee + Magic) / 2) plus any "
      + "health from equipment. Out of combat you regain 1 health every 6 seconds.",
    keywords: ["melee", "magic", "damage", "accuracy", "max hit", "health", "hp", "spell"],
  });

  entries.push({
    id: "magic-agent-controls",
    title: "Reading spells and recharging elemental weapons",
    section: "Combat",
    body:
      "corealm_spellbook with op read returns every spell, the selected and active spell ids, the "
      + "equipped charged weapon, carried Essence, and released elements. Each spell row includes castMs, "
      + "requiredElement, fuelCost, castable, and blockedBy. The equippedWeapon row includes "
      + "itemId, element, charges, capacity, rechargeItemId, and rechargeCost. To refill it, equip a "
      + "charged elemental wand or staff and call corealm_interact with interaction recharge on its "
      + "awakened Essence Altar. A dormant altar first needs interaction awaken while its matching boss "
      + "Orb is carried. Awakening consumes that Orb once and emits essence.altarAwakened. A successful "
      + "refill emits essence.recharged with altarId, weaponItemId, element, "
      + "before, after, essenceItemId, and essenceSpent. spell.launched reports whether weapon charge or "
      + "carried Essence paid for the cast.",
    keywords: [
      "corealm_spellbook", "corealm_interact", "recharge", "essence.recharged", "spell.launched",
      "weapon charge", "equippedWeapon", "remainingCharges",
    ],
  });

  entries.push({
    id: "death",
    title: "Death and recovery",
    section: "Combat",
    body:
      "Dying never costs skill experience or levels. Worn equipment stays equipped. Everything in "
      + "your inventory drops into a recovery cache where you fell, which you can walk back to and "
      + "loot before it expires.",
    keywords: ["death", "die", "recovery", "cache", "lost items"],
  });

  entries.push({
    id: "inventory-banking",
    title: "Inventory and banking",
    section: "Economy",
    body:
      "You carry 28 inventory slots. Currency and a few small components stack; ore, logs, fish and "
      + "equipment each take a whole slot, which is why a gathering trip is limited by pack space "
      + "rather than by time. Banks hold far more and everything stacks there. Because banks are "
      + "fixed places, how far a resource sits from the nearest bank changes its real experience per "
      + "hour. An easier resource beside a bank often beats a valuable one far from it.",
    keywords: ["inventory", "28", "bank", "deposit", "withdraw", "slots", "full"],
  });

  entries.push({
    id: "agility-shortcuts",
    title: "Agility and shortcuts",
    section: "Skills",
    body:
      "Agility opens climbs, vaults and tunnels that shorten routes. A shortcut has a required "
      + "Agility level; succeeding moves you to the far side, failing costs 2 to 6 health and leaves "
      + "you where you started. Shortcuts matter because they change which training spot is actually "
      + "the most efficient. A distant resource can become a better choice when its shortcut opens.",
    keywords: ["agility", "shortcut", "climb", "vault", "route", "efficiency"],
  });

  // ------------------------------------------------------------------ items
  for (const item of content.allItems()) {
    const parts = [`${item.name} is a ${item.category} item.`, item.description];
    if (item.equip) {
      const requires = Object.entries(item.equip.requires)
        .map(([skill, level]) => `${SKILLS[skill as SkillId]?.name ?? skill} ${level}`)
        .join(", ");
      parts.push(`Equips to the ${item.equip.slot} slot.`);
      if (requires) parts.push(`Requires ${requires}.`);
      const bonuses = Object.entries(item.equip.bonuses)
        .filter(([, value]) => value !== 0)
        .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
        .join(", ");
      if (bonuses) parts.push(`Bonuses: ${bonuses}.`);
    }
    if (item.magicWeapon) {
      parts.push(
        `${item.magicWeapon.kind === "wand" ? "One-handed wand" : "Two-handed staff"}; `
        + `casts every ${((item.equip?.attackSpeedMs ?? 0) / 1000).toFixed(1)} seconds.`,
      );
      if (item.magicWeapon.charge) {
        const charge = item.magicWeapon.charge;
        const rechargeItem = content.item(charge.rechargeItemId)?.name ?? charge.rechargeItemId;
        parts.push(
          `Holds ${charge.capacity} ${charge.element} charges. An Essence Altar refills it for `
          + `${charge.rechargeCost} ${rechargeItem}.`,
        );
      }
    }
    if (item.orb) {
      const element = item.orb.element === "wind"
        ? "Air"
        : `${item.orb.element[0]!.toUpperCase()}${item.orb.element.slice(1)}`;
      const craftedCharge = content.allItems()
        .find((candidate) => candidate.magicWeapon?.charge?.orbItemId === item.id)
        ?.magicWeapon?.charge;
      parts.push(
        `Boss key that permanently awakens the ${element} Essence Altar. That altar makes both `
        + `${element} wands and staffs with ${craftedCharge?.initialCharges ?? 1000} stored charges. `
        + `${item.orb.released ? "This orb is released." : "This orb is future content and cannot be obtained yet."}`,
      );
    }
    if (item.food) parts.push(`Eating it restores ${item.food.healAmount} health.`);
    if (item.tool) parts.push(`Used for ${item.tool.skill}, adding ${item.tool.gatherBonus} effective levels.`);
    parts.push(`Worth ${item.value} marks in a shop, sells for about ${sellPrice(item.value)}.`);
    entries.push({
      id: `item-${item.id}`,
      title: item.name,
      section: "Items",
      body: parts.join(" "),
      keywords: [item.id, item.category],
    });
  }

  // ---------------------------------------------------------------- recipes
  for (const recipe of content.allRecipes()) {
    const inputs = recipe.inputs
      .map((input) => `${input.quantity}x ${content.item(input.itemId)?.name ?? input.itemId}`)
      .join(" and ");
    const output = content.item(recipe.output.itemId)?.name ?? recipe.output.itemId;
    entries.push({
      id: `recipe-${recipe.id}`,
      title: `${recipe.name} (recipe)`,
      section: "Recipes",
      body:
        `Making ${output} needs ${SKILLS[recipe.skill]?.name ?? recipe.skill} level ${recipe.reqLevel}`
        + `${recipe.stations ? ` at ${recipe.stations.map((kind) => kind.replace(/_/g, " ")).join(" or ")}` : ""}. `
        + `It consumes ${inputs}, produces ${recipe.output.quantity}x ${output}, takes `
        + `${(recipe.durationMs / 1000).toFixed(1)} seconds, and gives ${recipe.xp} experience.`,
      keywords: [recipe.id, recipe.kind, recipe.skill, output.toLowerCase()],
    });
  }

  // ---------------------------------------------------------------- enemies
  for (const enemy of content.allEnemies()) {
    entries.push({
      id: `enemy-${enemy.id}`,
      title: enemy.name,
      section: "Enemies",
      body:
        `${enemy.name} is level ${enemyCombatLevel(enemy)} with ${enemy.maxHealth} health. `
        + `It hits for up to ${enemy.maxHit}, attacks every ${(enemy.attackSpeedMs / 1000).toFixed(1)} `
        + `seconds, and has ${enemy.armour} armour and ${enemy.magicArmour} magic armour. `
        + `It is ${enemy.behaviour}${enemy.behaviour === "aggressive" ? ` and attacks on sight within ${enemy.aggroRadius} metres` : ""}.`,
      keywords: [enemy.id, enemy.family, `level ${enemyCombatLevel(enemy)}`],
    });
  }

  // ---------------------------------------------------------------- spells
  for (const spell of content.allSpells()) {
    entries.push({
      id: `spell-${spell.id}`,
      title: spell.name,
      section: "Combat",
      body:
        `${spell.name} is a ${spell.element} ${spell.rung} spell and needs Magic ${spell.reqLevel}. `
        + `${spell.description} `
        + `Maximum damage is ${spell.baseMax} plus (Magic level + magic power) / ${spell.divisor}. `
        + `Cast cadence comes from the equipped weapon (wands are faster; staffs are stronger), `
        + `gives ${spell.baseXp} Magic experience hit or miss, and consumes ${spell.cost.charges} `
        + `${spell.cost.element === "wind" ? "Air" : spell.cost.element} weapon charge or Essence. `
        + (spell.rank
          ? `It is a rank ${spell.rank} invocation cast once from the action bar, which also spends `
            + (spell.cost.runes ?? []).map((rune) => `${rune.quantity} ${content.item(rune.itemId)?.name ?? rune.itemId}`).join(" and ")
            + (spell.aoe ? ", and strikes every enemy in its area. " : ". ")
          : "")
        + "All four elements deal the same kind of damage; they differ in when they unlock, so the "
        + "released Essence and elemental weapons gate which element can be cast.",
      // Element and rung are keywords because "what wind spells do I have" is the question a player
      // or an agent actually asks, and neither word appears in a spell's own name.
      keywords: [spell.id, spell.element, spell.rung, "spell", "magic"],
    });
  }

  // --------------------------------------------------------------- regions
  for (const region of REGIONS) {
    const resources = region.clusters
      .map((cluster) => {
        const resource = resourceDef(cluster.resourceId);
        return `${resource.name} (${SKILLS[resource.skill].name} ${resource.reqLevel})`;
      })
      .join(", ");
    entries.push({
      id: `region-${region.id}`,
      title: region.name,
      section: "Regions",
      body:
        `${region.name}. ${region.lore ?? ""} `
        + `${region.settlement ? `Its settlement is ${region.settlement.name}. ` : ""}`
        + `${resources ? `Resources here: ${resources}.` : ""}`,
      keywords: [region.id, "region", "area", "where"],
    });
  }

  // ------------------------------------------------------------------ places
  //
  // One entry per named place, and the ONE reason it exists is that the id is in the body.
  //
  // Discovery is gated: a fresh character knows four places out of forty-four, and
  // `observe({ scope: "known" })` only ever answers with what has already been walked to. So an
  // agent that has never left the spawn square has no way to name anywhere else — it cannot ask to
  // go to the Bracken Pit, because nothing has told it that "bracken_pit" is a string. Without this
  // section the only route to the rest of the world is wandering, and the mining proof demonstrated
  // exactly that: 1,606 tool calls, Mining still 1.
  //
  // Geography is public knowledge — the generated `docs/game/regions.md` has always published this
  // same list, so the in-game index was simply missing a section its file-based twin already had.
  // What must NOT leak is an unstarted quest's later stages (PRD F13), and none of that is here.
  for (const region of REGIONS) {
    for (const location of region.locations) {
      const clusters = region.clusters
        .filter((cluster) => cluster.locationId === location.id)
        .map((cluster) => {
          const resource = resourceDef(cluster.resourceId);
          return `${resource.name} (${SKILLS[resource.skill].name} ${resource.reqLevel})`;
        });
      entries.push({
        id: `place-${location.id}`,
        title: location.name,
        section: "Places",
        body:
          `${location.name} is a ${location.kind} in ${region.name}. `
          + `Travel there with moveTo({ locationId: "${location.id}" }). `
          + `${clusters.length ? `You can gather here: ${clusters.join(", ")}.` : ""}`,
        keywords: [
          location.id, location.kind, region.id, "place", "location", "where", "travel",
          ...clusters.map((text) => text.toLowerCase()),
        ],
      });
    }
  }

  return entries;
}

// ------------------------------------------------------------ search index

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "is", "it", "for", "on", "at", "by", "with",
  "how", "do", "i", "what", "where", "does", "can", "you", "my",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * A small inverted index with TF-IDF-ish scoring. Deliberately not a dependency: the corpus is a
 * few hundred short entries generated from local content, and a real search library would be more
 * bytes than the corpus it searches.
 */
export class DocSearch {
  private entries: DocEntry[] = [];
  private postings = new Map<string, Map<number, number>>();
  private documentFrequency = new Map<string, number>();

  build(entries: DocEntry[]): void {
    this.entries = entries;
    this.postings.clear();
    this.documentFrequency.clear();

    for (const [index, entry] of entries.entries()) {
      const tokens = [
        ...tokenise(entry.title),
        ...tokenise(entry.title), // title matches count double
        ...tokenise(entry.section),
        ...tokenise(entry.body),
        ...(entry.keywords ?? []).flatMap(tokenise),
        ...(entry.keywords ?? []).flatMap(tokenise), // keywords count double too
      ];
      const seen = new Set<string>();
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) {
          posting = new Map();
          this.postings.set(token, posting);
        }
        posting.set(index, (posting.get(index) ?? 0) + 1);
        seen.add(token);
      }
      for (const token of seen) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  search(query: string, limit = 5): DocHit[] {
    if (this.entries.length === 0) return [];
    const tokens = tokenise(query);
    if (tokens.length === 0) return [];

    const scores = new Map<number, number>();
    const total = this.entries.length;

    for (const token of tokens) {
      // Prefix matching, so "mine" finds "mining" and "recip" finds "recipe".
      for (const [indexed, posting] of this.postings) {
        if (indexed !== token && !indexed.startsWith(token) && !token.startsWith(indexed)) continue;
        const exact = indexed === token ? 1 : 0.55;
        const idf = Math.log(1 + total / (this.documentFrequency.get(indexed) ?? 1));
        for (const [docIndex, count] of posting) {
          scores.set(docIndex, (scores.get(docIndex) ?? 0) + count * idf * exact);
        }
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, Math.min(limit, 25)))
      .map(([index, score]) => {
        const entry = this.entries[index]!;
        return {
          docId: entry.id,
          title: entry.title,
          section: entry.section,
          snippet: snippetFor(entry.body, tokens),
          score: Math.round(score * 100) / 100,
        };
      });
  }

  size(): number {
    return this.entries.length;
  }

  entry(docId: string): DocEntry | undefined {
    return this.entries.find((candidate) => candidate.id === docId);
  }

  all(): readonly DocEntry[] {
    return this.entries;
  }
}

/** A window of the body around the first query hit, so an agent gets the relevant sentence. */
function snippetFor(body: string, tokens: string[]): string {
  const lower = body.toLowerCase();
  let best = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found >= 0 && (best < 0 || found < best)) best = found;
  }
  if (best < 0) return body.slice(0, 220);
  const start = Math.max(0, best - 70);
  const end = Math.min(body.length, start + 260);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}
