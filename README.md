# Corealm

A persistent 3D browser RPG in the classic-MMO tradition: gather, craft, fight, quest, bank, unlock the next tier. The twist is that an AI agent can play the same character through the same actions a human uses, exposed to the browser through [WebMCP](https://webmachinelearning.github.io/webmcp/). There is no scripting backdoor. If a human can do something, an agent can; if a human can't, neither can the agent.

Play it at **https://abcdmku.github.io/Corealm2/**. The generated player guide (skills, recipes, regions, quests, XP table) lives at **https://abcdmku.github.io/Corealm2/docs**.

Built with TypeScript, Vite, Three.js, and recast-navigation. Model sources and licenses are recorded in the asset manifest. All 300 item icons use reviewed generated artwork with source records.

## The game

- **Ten skills, 1–99 each.** Melee and Magic for combat; Mining, Woodcutting, and Fishing for gathering; Smithing, Crafting, Cooking, and Fletching for production; Agility for shortcuts and alternate routes. Gathering feeds production, production feeds combat, combat and exploration reward both.
- **One connected world, with content through tier 70.** Farmland starts at Millfield, followed by Woodlands and Oakwood, Highlands and Hillcrest, the Stone Cavern dungeon, and Ashlands and Ashford. The northern Wilderness adds tier 50 and 70 encounters, dragons, gathering sites, equipment, and bosses. Borders are open; difficulty is the gate.
- **Click-to-move over a real navmesh** plus keyboard movement, an elevated third-person camera, hover and selection feedback, and contextual actions.
- **Continuing activities.** One click on an ore node starts mining and keeps yielding until the node depletes, your pack fills, you move, or you cancel. Nodes visibly deplete and respawn on timers.
- **28-slot inventory, banks as geographic anchors, one currency, shops.** Capacity and bank distance drive real route decisions.
- **Melee and Magic combat** with readable MMO pacing, enemy families that get more interesting by tier, and bosses with telegraphs and phases. Magic runs on wands and staffs fuelled by elemental Essence; boss-dropped Orbs awaken regional altars that charge elemental weapons.
- **Quests** are the most authored content, including multi-stage chains an external agent can complete end to end.
- **Death** keeps progression but drops carried items into a recoverable container.
- **Persistence** is browser-local: skills, inventory, equipment, bank, quests, discovered locations, and settings survive a reload.
- **Route planning.** Compare time spent gathering, travelling, and banking to choose a site. Agility shortcuts can change which routes are worth taking. The agent can inspect live locations and requirements to make that choice.

Everything in the world is a semantic entity (id, archetype, tier, region, state, requirements, interactions) that the renderer merely draws. Gameplay, UI, quests, persistence, tests, and the agent surface all read the same state.

## Playing it with an agent over WebMCP

WebMCP is a W3C-track browser API that lets a page publish structured tools to an AI agent instead of having the agent scrape the DOM. Corealm registers 34 tools with `document.modelContext` (falling back to the older `navigator.modelContext` spelling) at boot. Each tool has a title, a description, a strict JSON Schema, and a `readOnlyHint`, and returns MCP content blocks whose text is the tool's JSON result.

### What you need

- A browser with WebMCP enabled. As of September 2026 that means a Chromium build with the feature on (`--enable-features=WebMachineLearningModelContext,WebMCP,AIModelContext`, or the Early Preview flag in `chrome://flags`) and a WebMCP-capable agent extension or client attached to it. The page must be a secure context; `localhost` counts.
- Corealm open in that browser, either the deployed site or `npm run dev` locally.

Open the in-game agent panel to see whether the browser bound. It reports the container it found, or says no WebMCP was available. You can also ask from the console:

```js
window.corealm.agent.webmcp();
// { binding: "document.modelContext", native: true, method: "registerTool", toolCount: 34 }
```

`binding: "none"` means the browser has no WebMCP. The game does not install a polyfill; a page that fills the gap itself can never tell you the gap exists.

### The same tools without WebMCP

`window.corealm.agent` is present in every browser and drives the identical handlers, validation, and session rules. It is how the Playwright proofs, the internal assistant, and a quick console session reach the game:

```js
const agent = window.corealm.agent;
await agent.listTools();                           // name, title, description, schema, access
await agent.call("corealm_context");               // the whole situation, one atomic snapshot
await agent.call("corealm_manual", { topic: "overview" });
```

`call` never throws. Failures come back as data with an `error` code (`NOT_FOUND`, `OUT_OF_RANGE`, `REQUIREMENTS_NOT_MET`, `INVENTORY_FULL`, `NOT_PERMITTED`, `APPROVAL_REQUIRED`, and so on) and a human-readable `message`.

### How a session works

The player decides how much the agent may do, and the agent panel shows it:

| Mode | The agent may |
| --- | --- |
| `guide` | read state, answer, explain, recommend |
| `assist` | also draw markers, routes, and highlights, and propose step-by-step plans |
| `play` | also act, while it holds control and is not paused |

An agent starts in guide mode. `corealm_session {op:"request_control", objective}` asks for play mode; the panel shows the request with Allow and Deny, and the player can Pause, Stop, or Take control at any time. Shop trades in play mode ask for per-call approval unless the player pre-approves them.

Agents are meant to be event-driven, not polling. `corealm_events` long-polls a monotonic event stream (`activity.stopped`, `inventory.full`, `resource.depleted`, `level.gained`, `combat.ended`, `quest.updated`, ...), and `corealm_wait` blocks on a condition. Bounded operations such as `corealm_navigate`, `corealm_gather`, `corealm_fight`, and `corealm_craft` each replace a dozen primitive calls and return when done.

A whole Mining 1→10 climb, including bank trips, is about a dozen tool calls:

```js
const agent = window.corealm.agent;
const asked = await agent.call("corealm_session", {
  op: "request_control", objective: "Train Mining to 10 at the Bracken Pit", timeoutMs: 25000,
});
if (asked.status !== "granted") return;

while ((await agent.call("corealm_skills")).mining.level < 10) {
  await agent.call("corealm_navigate", { locationId: "bracken_pit" });
  const free = (await agent.call("corealm_inventory")).freeSlots;
  const mined = await agent.call("corealm_gather", { interaction: "mine", quantity: free });
  if (mined.error === "CANCELLED") return;            // the player stopped us
  await agent.call("corealm_navigate", { entityId: "coldbrace_bank" });
  await agent.call("corealm_bank", { op: "depositAll" });
}

await agent.call("corealm_session", { op: "release_control" });
```

### Information parity

The agent discovers the world the way a player does. `corealm_observe` returns what is visible now or the places the character has actually found; `corealm_inspect` on something never seen is `NOT_FOUND`; `corealm_quests` shows only what a journal would; `corealm_search_docs` returns public documentation and never quest solutions.

### Read next

- [docs/agent-api.md](./docs/agent-api.md) — the full tool list, event types, error codes, session rules, and efficiency notes. Written so that someone who has never seen Corealm can build a working autonomous player from it alone.
- `corealm_manual` in-game — the same material, by topic, from the running build.
- [docs/webmcp-audit.md](./docs/webmcp-audit.md) — the ten end-to-end scenarios that exercise the surface through `document.modelContext.getTools()` / `executeTool()` exactly as a browser agent would.

## Running it locally

Node 24 is required (other majors are rejected).

```bash
node --version      # v24.x
npm ci
npx playwright install chromium   # only for the browser checks below
npm run dev
```

Useful commands:

```bash
npm run check                # typecheck, unit tests, game and guide production builds
npm run test:watch
npm run lab:preview          # the feature lab, a compact deterministic scene
npm run lab:test
npm run smoke -- --run runs/corealm
npm run agent-proof -- --run runs/corealm    # the Mining 1→10 and quest proofs through the agent surface
npm run webmcp:audit -- --run runs/corealm --scale 100
npm run play -- --run runs/corealm --scenario tools/scenarios/<name>.json
npm run screenshot -- --run runs/corealm --name checkpoint
npm run docs:dev             # the player guide, regenerated from canonical content
```

Playwright's Chromium ships no WebMCP, so the audit and proofs inject a test stand-in before the page loads (`tools/lib/webmcp-polyfill.ts`). The game recognises it and reports `binding: "polyfill", native: false`, and the audit refuses to run if the adapter ever mistakes the stand-in for a real browser.

Development builds also expose `window.__gameDebug` (`teleport`, `setSkillLevel`, `giveItem`, `advanceGameTime`, `reset`, ...) for setting up deterministic tests. It is for setup only; nothing reachable through WebMCP or `window.corealm.agent` can bypass the session gate.

## Repository shape

```text
game/            the Vite app: src/agent is the tool surface and WebMCP adapter, src/content the canonical data
docs/            agent API, feature-lab and world-authoring workflow, generated player guide (docs/game)
docs-site/       the Starlight site that publishes the guide
tools/           browser driver, smoke, proofs, audit, asset and docs generators
tests/           vitest unit and integration tests
runs/corealm/    brief, PRD, architecture, reports, critique, and test evidence
skills/          builder and critic role instructions for the agent-driven workflow
```

The game never imports the build harness at runtime. Generated icons, world maps, and guide captures are committed; refresh text with `npm run docs:refresh` and visuals with `npm run docs:refresh:visuals` only when they should change. Pushes to `main` build the game and guide and publish them to GitHub Pages.

Normal guide builds use committed media. `npm run gen-docs` refreshes text only. Run `npm run docs:refresh:media` explicitly to regenerate WebP item icons, capture thumbnails, cropped armour views, and the world map from their source images. `npm run docs:refresh:visuals` also refreshes the source world map and gameplay captures. Pages reference media through URL-relative `<img>` paths, and `tools/prepare-docs-site.ts` stages it into `docs-site/public`. If you add an oversized source by hand, `npm run docs:optimize-media` re-encodes it in place.

## How it was built

Corealm was built by coding agents following [AGENTS.md](./AGENTS.md): a fresh-context PRD, a frozen set of shared contracts, a production-backed feature lab where every isolatable feature is accepted from browser state and screenshots before it is wired into the world, and read-only critic passes between rounds. The run directory under `runs/corealm/` holds the brief, PRD, architecture decisions, phase reports, and evidence. See [docs/feature-lab.md](./docs/feature-lab.md) and [docs/world-authoring.md](./docs/world-authoring.md) for the workflow.

## License

The code, content data, and documentation are [MIT licensed](./LICENSE).

Not everything under `game/public/assets/` is. The 222 Quaternius models are CC0-1.0. The magic, altar, and miniboss GLBs listed in [game/public/assets/UNITY_ASSET_SOURCES.md](./game/public/assets/UNITY_ASSET_SOURCES.md) were converted from free Unity Asset Store packages and remain under the Unity Asset Store EULA; they are here so the game runs, not as a redistributable asset pack. `game/public/assets/manifest.json` records the source and license of every pack.
