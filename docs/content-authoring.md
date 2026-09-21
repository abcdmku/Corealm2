# Content authoring

Corealm content has one authored source and one compiler. Source records live under
`game/content/data/`. Devdocs edits those records, validates the proposed transaction, and writes the
resolved catalog to `game/content/compiled/catalog.json`. The player build reads resolved content. It
does not contain the authoring service.

Use `npm run devdocs` to open the local editor. The same editor also runs against a live game server,
where a save publishes instead of writing files; see
[two places to edit](#two-places-to-edit-the-repository-and-a-live-server). Run `npm run content:check`
when reviewing a change from the command line. The checker parses every registered collection, compiles progression and
creatures, and reports broken references or invalid values. It checks asset ids against
`game/public/assets/manifest.json` with the same pools devdocs saves with, so an id that names no
shipped asset fails the check. A missing model on a creature whose `availability` is `lab` is a
warning, because lab creatures may be staged before their model is promoted.

## Two catalogs, one revision

The compiler is `compileCatalog(sources, { formulaRevision, pools })` in
`game/src/content/compiler/catalog.ts`. It reads no file, so the repo tools, devdocs and a running
server all call the same function. It returns two catalogs.

The server catalog holds every resolved table and the authoring inputs. The game server simulates
from it. `game/content/compiled/catalog.json` is the server catalog compiled from the repo.

The client catalog is `clientCatalog(serverCatalog)` in `game/src/content/clientCatalog.ts`. It is an
allowlist: a table or field you add to the server catalog stays on the server until you name it
there. It has two readers. The game page installs the build's copy, `generated/client-catalog-<hash>.json`,
as its only catalog before it imports the app, so every content module the page evaluates runs on it.
A game server serves its own at `GET /catalog/<revision>`, and a connected client lays it over the
installed one so names, icons, item stats and shop stock match the server, and removes it on
leaving. With the shipped content the server catalog is 4,166,940 bytes as compact JSON (420,393
gzipped) and the client catalog is 1,048,136 bytes (151,752 gzipped).
`tests/client-catalog-page-graph.test.ts` fails when a page module reads a table this projection
does not carry. Feature-lab, world-bake and map-capture pages are authoring surfaces and install the
server catalog instead.

| Table | Client catalog | Why |
| --- | --- | --- |
| `items`, `recipes`, `resources` | whole | Tooltips, production and gathering panels show these stats. |
| `progression`, `materials`, `campfireFuels`, `equipmentSets` | whole | Tier, material and set presentation. |
| `shops` | whole | A player sees a shop's stock and prices. |
| `npcs` | whole | Names, outfits and where they stand. |
| `spells`, `spellRunes`, `elementalSpells` | whole | The spellbook and cast effects. |
| `balance/recipes`, `balance/sets`, `balance/campfires` | whole | Displayed XP, set thresholds and campfire timings. |
| `audio` | whole | Cue and loop tables. The current client still plays from the copy in its build. |
| `world.regions` | as `regions` | Region geometry for the map. |
| `species` | as `creatures`: id, asset id, scale, region, activity, description, rig and native size fields, plus name, family and tier | Presentation only. `stats`, `attack`, `habitat` and `respawnMs` stay on the server. |
| `enemies` | id, name, family, tier | The death screen, effects and hunt text need a name and a level. |
| `enemies` combat and AI fields, `lootRolls`, `gold` | no | Server only. |
| `lootTables` | no | Server only. |
| `compiledCreatures` | id, asset id, profile id, scale, availability, level; `presentation` cut down like a `creatures` row; `enemy` as id, name, family, tier | The page's creature modules index models by creature id. The definition, adjustments, inherited fields and the combat block stay on the server. |
| `species` | the `creatures` fields, with `stats` as id, name, family, tier | The same rows under the name the page's modules read. |
| `creatureDefinitions`, `creatureProfiles` | no | Authoring data. |
| `world.encounters`, `world.placements`, `world.resources`, `world.groupsByRegion`, `world.habitats`, `world.creatureByGroup` | no | Spawn tables. |
| `worldRegions`, `encounters`, `placements`, `resourcePlacements`, `equipmentFamilies`, `recipeTemplates`, `balance/formation` | no | Compiler inputs. |
| `quests` | id, name, region, giver, requirements, prerequisites, and each stage as index, objective and refs | The journal. The page builds the quest log (`QuestSummary`) from these records and the replicated quest state, and prints the objective of the stage a player is on. |
| `quests` rules: `completion`, `hint`, `grants`, `onFlag`, `onStart`, `rewards`, `summary`, `kind` | no | Server only. A completion predicate is the answer to the puzzle its stage sets. Only a host evaluates one; `questRules()` in `content/quests.ts` answers there and nowhere else. |
| `dialogue` | an empty table | The dialogue panel draws the `DialogueView` replicated in the player's state. Dialogue text and branch conditions never leave the server. |
| `sourceMap` | no | Authoring data. |

A creature's model reaches a client another way. The server stamps `view.assetId` and `view.scale`
on each creature when it builds the world, and replicates that view. A world that loads a save
takes the model and scale from the catalog it runs on now, so a model change shows after the next
server start on any client that loads, as long as the asset host has the file.

`revision` names the pair. It is the SHA-256 of the source collections, the formula revision and
the resolved tables, so equal inputs give the same revision and the same client catalog bytes on any
machine. `formulaRevision` names the formula code. A checkout hashes every `.ts` file under
`game/src/content`, with file names and line endings normalised so Windows and Linux agree. The
compiler writes that value into the catalog. A packaged server has no source tree, so it compiles
with the `formulaRevision` of the catalog it was built with. The two values are equal for one
release, which keeps an export and re-import of unchanged data on the same revision. Formula
changes ship with a server release and change the revision of everything compiled after it.

## Publishing to a live server

A running game server compiles and applies content itself. `POST /admin/content/publish` takes whole
collections, merges them over the server's active sources, and runs the compiler described above with
the asset ids of the server's asset host. [Multiplayer hosting](multiplayer-hosting.md#publishing-content)
has the endpoint reference. This section says what a publish changes in the running game.

The reply lists the compiled tables that changed, split into `live` and `onRestart`. The split is one
map, `CATALOG_TABLE_APPLIES` in `game/src/multiplayer/contentSwap.ts`, next to the code that moves the
process onto a new catalog. A test compiles the shipped content and fails if a table is missing from it.

| Table | Applies | How |
| --- | --- | --- |
| `items`, `recipes`, `shops`, `enemies` | live | The content registry holds them and is registered again. The next kill rolls the new loot, the next purchase reads the new stock and price, the next craft reads the new recipe. |
| `lootTables`, `creatureDefinitions`, `creatureProfiles` | live | Nothing reads them while the game runs. The compiler folds them into `enemies`, so their effect arrives there. |
| `compiledCreatures`, `species` | live | The creature indexes are refilled. |
| `world`, `encounters`, `placements` | live, at the next respawn | Each world builds the changed spawn groups again. See below. |
| `resources`, `resourcePlacements` | on restart | Resource nodes are stamped onto world entities when the world is built. |
| `spells`, `spellRunes`, `elementalSpells` | on restart | The spell tables are derived as their modules load. |
| `worldRegions`, `npcs`, `quests`, `dialogue` | on restart | Region geometry, settlements, quest and dialogue graphs are built at load. |
| `progression`, `materials`, `equipmentFamilies`, `recipeTemplates`, `campfireFuels`, `equipmentSets`, `balance/*`, `audio` | on restart | Tier tables and tuning are read at load. The `items` and `recipes` the compiler generates from them are live. |

A spawn change touches only the groups whose placement, encounter, habitat or creature changed. Loot
is left out of that comparison, so a loot edit never moves a spawn. For each changed group the world
builds the creatures again from the new catalog and spaces them among the residents that keep their
spawn, on copies, so the living world is never edited in place:

- A living creature keeps its position, its spawn and its old habitat until it dies. At its next
  respawn it takes the new spawn, model, scale and stat block.
- A dead creature takes the new spawn now and appears there when its timer ends.
- A creature whose placement was removed or shrunk finishes its life, then leaves the world and the save.
- A creature of a new or grown placement appears at once.

A model change reaches clients through the creature's replicated view as it respawns, and through the
client catalog the next time a client loads. Trees were scattered around the habitats of the catalog
the server started with and stay where they are until the next start. New spawn points avoid their
trunks, but a moved habitat may have trees inside its wander area until then. Coastal and regional
pack groups are generated from region tables at load and are not rebuilt by a publish.

### Retiring a definition

Deleting an item that a player holds, or a creature that is alive in a world, would leave instances
with nothing to resolve to. A publish that does so is refused with `definition_in_use` and the list of
holders. Set `retired: true` on the item or creature definition instead. A variant inherits it from its base.

| | Retired item | Retired creature |
| --- | --- | --- |
| Still resolves | Yes. Stacks in an inventory, bank or loot pile keep their name, icon, stats and sell price. | Yes. Living members fight, drop loot and die as before. |
| Drops | No. The compiler takes it out of every loot roll, direct or through a loot table. | n/a |
| Sold by shops | No. The compiler takes it off every shelf. A player can still sell one to a shop. | n/a |
| Crafted | No. A recipe whose output is retired leaves the compiled `recipes` table, so no station lists it. A recipe that only consumes it stays, so players can use up their stock. | n/a |
| Gathered | A retired bonus yield is dropped from the resource. A retired main yield is a compiler warning, because a node must yield something: give the node another yield or remove it. Resources apply on restart. | n/a |
| Spawns | n/a | No. The world compiler skips its encounter members, so its groups and habitats are gone and its living members are not replaced. |

The compiler reports each thing it removed as an `info` diagnostic, such as
`lootTables.shared_t0_frog.items: Retired item marsh_gland no longer drops`. Once no player holds a
retired item and no world has a retired creature alive, the definition can be deleted.

## The save cycle

1. Open the task area in Devdocs and start from a template or an existing record.
2. Create, duplicate, rename, or edit the authored record. Keep IDs stable when changing display
   names. Use the editor's rename action when an ID must change so references can be updated.
3. Preview the result. The preview runs the same compiler used by the game, shows diagnostics, and
   lists records affected by the change. Generated item, recipe, combat, and placement values are
   read-only results of this preview.
4. Click **Save** once. The transaction checks collection revisions, writes the changed source records,
   and writes a matching compiled catalog. A failed validation leaves both the source and the last
   valid catalog in place. A stale revision keeps the draft so it can be reviewed against the newer
   records.

There is one Save action for an ordinary edit. The workflow has no recompute, apply, or parity step.
World bakes may run after a save when terrain or navigation must be regenerated; the bake records the
source revision it used.

## Two places to edit: the repository and a live server

Devdocs is one app with two backends. The editing UI is the same in both: the same records, the same
fields, the same save bar, the same conflict and diagnostic handling. What differs is where a save
lands, and what else is there to work on.

| | Repository mode | Server mode |
| --- | --- | --- |
| Start it with | `npm run devdocs` | `npm run devdocs:build:server`, then open the build |
| Content comes from | `game/content/data/`, through the Vite middleware at `/__devdocs/` | `GET /admin/content/sources` on a running game server |
| Derived tables (`compiled-items` and the rest) | `game/content/compiled/catalog.json` | `GET /admin/content/catalog/<revision>`, the server's own compiled catalog |
| A save | writes the JSON files and a matching compiled catalog | `POST /admin/content/publish`: the running game moves onto the new catalog |
| Sign-in | none; the API is loopback only | the identity service, then a 12 hour admin session |
| Models, icons and map images | the repository's `game/public/` | the asset host the server names in `assetBaseUrl` |
| Authoring notes, status and review requests | yes | no |
| Local changes and per-file diff | yes | no |
| Bulk status, note and retier actions | yes | no |
| Asset import, candidate review and rendered thumbnails | yes | no |
| Balance formula source and the compiled check | yes | no |

The four **no** rows are all the same reason: they need the checkout. A live server holds content and
nothing else, so those surfaces are left out of the navigation rather than shown and left to fail.
Formulas are the one that is not about files: they are TypeScript that ships with a server release,
so data changes live and code changes need a deploy.

### Signing in to a server

Server mode needs an account with a role on that server. Sign-in is three steps:

1. The server address. A build the game server serves at `/admin` already knows it and does not ask.
   A build hosted anywhere else asks once and remembers it.
2. The identity service, which the **page** names through `window.__COREALM_IDENTITY_URL__` or a
   `VITE_COREALM_IDENTITY_URL` baked into the build. A game server an admin typed the address of does
   not get to choose where the login goes. A build the game server served itself may fall back to
   that server's `/admin/info`, because the page and the API are then the same origin. If the page
   and the server name different identity services, devdocs refuses to sign in and says so.
3. A join token for the server's **published endpoint**, exchanged at `POST /admin/session`. The
   published endpoint is what `/admin/info` reports, which is not always the address you typed: a
   host behind a proxy publishes the proxy's origin, and it refuses a token minted for anything else.

An account with no role on that server is told exactly that. A server that has no owner yet prints a
one-time setup code at its first start; **Enter setup code** claims it through `POST /admin/setup` and
makes that account the owner. The admin session lives in `sessionStorage`, so it ends with the tab.
An expired session returns to the sign-in screen and keeps every unsaved draft.

### What a save does on a live server

The save bar's **Save all** runs the same transaction it always did. In server mode it is translated:
the changed collections are sent whole, with the revision they were read at, to
`POST /admin/content/publish`. That revision is the server's own: `GET /admin/content/sources` reports
one per collection, computed by the function the publish checks against, and the publish reply reports
the revision each stored collection now has. The editor never computes a content hash. The server's
answers land in the states the editor already has.

| The server answers | The editor shows |
| --- | --- |
| `409 stale_collections` | the ordinary conflict row, with Compare, Overwrite and Reload |
| `422 content_invalid` | the compiler's problems, attached to the records that name them |
| `409 definition_in_use` | who still holds the definition, and to set **Retired** on it instead |
| `422 spawn_unplaceable` | the world whose changed spawn group has nowhere to stand |
| `502 asset_manifest_unavailable` | that publishing waits for the asset host to answer |
| `403` | that this credential may not publish, and that nothing was published |

A successful publish leaves a result line in place of the save bar: the new revision, how many
connected players were told to refresh, which compiled tables the running server reads **now**, which
it reads again only at its **next restart**, how many creatures respawn onto the new plan, and the
record ids the change reached. [Publishing content](multiplayer-hosting.md#publishing-content) has the
full endpoint reference.

### Keeping the repository and a live server in step

A live server owns its data. Its catalog starts as the one the repository compiled, and from the
first publish onwards the two drift apart, because the people editing loot on a Tuesday evening are
editing the server, not a checkout. The rule that settles every question about which one wins is:
**once a server is live, it is the source of truth for its data, and the repository receives
exports.**

Two workflows carry that. `Content export` reads a server's source collections, writes them back
into `game/content/data/` with the same canonical writer devdocs writes with, recompiles, and keeps
one pull request open on the branch `content/live-export`. It runs weekly and on demand. An export
of content the branch already holds is a zero-byte diff, so a quiet week leaves no pull request.

`Content publish` is the other direction and is manual only. It sends just the collections this
branch differs on, each with the revision the server reported for it, so a publish that would
overwrite an edit somebody made in devdocs is refused with `stale_collections` instead of forced.
The fix is always the same: export, merge, publish. It also needs the server's own name repeated
back to it, which is what stops a publish landing on the wrong host.

Both run as commands too, which is the way to see what a workflow will do before you let it run:

```sh
COREALM_CONTENT_TOKEN=cat_… npm run content:export:server -- --server https://play.example.com/ --dry-run
COREALM_CONTENT_TOKEN=cat_… npm run content:publish:server -- --server https://play.example.com/ --confirm "Raid Night" --validate-only
```

[Content workflows and their secrets](multiplayer-hosting.md#content-workflows-and-their-secrets)
has the tokens, the scopes and the approval gate.

Balance formulas do not take part. They are TypeScript that ships with a server release, so an
export brings back data only, and a branch whose formulas differ from the server's release compiles
the same sources to a different revision. The export says so in the pull request rather than
failing.

### Building and hosting the server-mode app

```sh
npm run devdocs:build:server
```

The output is `dist/devdocs-server`, with relative URLs, so it works both at `/admin/` on a game
server and at the root of any static host. It carries no public directory: a live server serves no
assets, and the admin API owns the first path segment under `/admin/` for `info`, `setup`, `session`,
`me`, `roles`, `bans`, `tokens`, `audit`, `content`, `stats`, `players` and `settings`. Run it after
`npm run build`, which empties `dist/`.

## Progression

### Create a tier

Open **Tuning › Tiers** and create a tier record with a stable ID, display name, tier number, and
required skill level. Add the material IDs for the roles used at that tier, the resources the tier
can acquire, and its presentation fields. Add optional magic or smelting settings only when that
tier uses them.

Select equipment families for the tier. Each member supplies its own stable item ID, name, and
description, then points to a family. Add an explicit member adjustment only for a deliberate
exception. The compiler expands the family formula into the item value, equipment bonuses, or tool
bonus.

Select recipe templates for the production entries. Each entry supplies an ID, name, ingredient
IDs and quantities, and an output item. A cooking entry can name its burnt output. The compiler
combines the template, tier, and entry adjustment into one recipe record.

Preview the tier and inspect the affected item, recipe, resource, and equipment records before
pressing Save. A new tier should not require hand edits to separate gathering and crafting ladders.

### Add an equipment family member

Create or choose a family from a column header of the **Items › Ladder** matrix, or under **Tuning › Equipment families**. A family declares its slot,
skill, category, formula, and parameters. `equipment.linear` accepts a typed value curve, bonus
curve, and gathering curve. Tools use the same family shape with a gathering skill; equipment can
also declare attack speed or magic-weapon details.

Add the member to the relevant progression tier with its stable item ID and presentation text. Keep
an exceptional value in the member's `adjustments` object. Do not copy calculated bonuses into a
second item record. The family page shows its consumers, so a parameter edit can be previewed across
every tier member before Save.

### Add a recipe

Create a `recipeTemplate` for a repeated production rule. Choose its kind, skill, accepted stations,
and the `production.linear` formula parameters for duration and experience. Add a production entry
to the tier with the ingredient references, output reference, and optional burnt output.

Use an entry adjustment for a recipe that intentionally differs from its template. The compiler
checks every ingredient, output, station, and required level and then publishes the resolved recipe.
Preview the recipe and its consumers, then use the same Save action as every other content change.

## Creatures and variants

Create a base creature in **Creatures** with its identity, family, level, availability, presentation,
profile, and loot. A creature profile owns the shared combat curve. A loot table can be shared by
several creatures, while a unique drop list can stay on the creature.

To make a variant, duplicate the base as a direct child and set `baseId`. Override only the fields
that differ, such as name, family, level, profile, presentation asset or scale, combat adjustment,
and loot. Variants may inherit from a base creature only. A variant cannot inherit from another
variant. The editor shows inherited and overridden fields and lists the consumers that change when
the base changes.

Set `availability` to `lab` while developing a fixture and to `world` when the creature should be
spawned. Preview the creature in the production-backed lab, inspect its combat and drops, then Save.
Turn a variant into an independent definition when its identity or behavior no longer belongs to
the base.

## World encounters and placements

On the **World** map choose **Add spawn**, click the map and pick the creature. That creates the
placement and its encounter together; the inspector shows the creatures, weights and activity inline.
The encounter points to creature IDs; it does not copy combat blocks.

Create a placement for that encounter. Set its region, centre, population count, radius, optional
rank or level, and formation. Grid and ring formations use spacing and rotation. An authored
formation carries explicit anchor adjustments when individual residents need a precise location.
Add dressing, roam radius, boundary, and habitat settings only when the scene needs them.

Dragging the placement centre moves the formation as one unit. The compiler expands the encounter,
checks creature and region references, validates anchor bounds and body clearance, and produces the
runtime groups and habitats. Fix diagnostics in the placement source, preview again, and Save. Run
`npm run world:build` afterward when the changed placement needs a new world bake. See
[World authoring](./world-authoring.md) for terrain, coast, water, scatter, and navigation work.

Resource placements use the same region references as progression resources. Keep resource identity
in the resource definition and use the placement only for location and cluster layout.

## Typed formulas

Canonical formula functions live in `game/src/content/formulas/`. The registry in
`game/src/content/formulas/index.ts` binds each formula ID to its input schema, parameter schema,
output schema, source symbol, and owning profile collection. Current examples include
`creature.combat`, `equipment.linear`, and `production.linear`.

Open a field's formula inspector from Devdocs to see the real source file and function, the profile
that supplies its parameters, the inputs, the resolved output, example tier values, and consumers.
Use the inspector to tune profile data and preview the impact. Use **Open in VS Code** when the
formula logic itself needs a change.

Formula code is ordinary typed TypeScript. A source edit runs project type checking before the
compiler accepts a new catalog. Diagnostics identify the source location and affected records. If
the edit fails, the last valid catalog remains active and no invalid result is saved. Keep formula
parameters in their typed profile schema. Do not store anonymous code strings or a second formula
implementation in JSON.

## Review and validation

Use the smallest check that answers the question:

```bash
npm run content:check
npm run devdocs:smoke
npm run world:build       # when world placement or baked geometry changed
npm run dev               # inspect the real player build
```

Review the compiler diagnostics, the affected-record list, and the generated catalog revision. For
visual or interaction changes, use Chromium and inspect the actual scene at a camera and zoom the
player can reach. Keep the source transaction and the compiled catalog on the same revision.
