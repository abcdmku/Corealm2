import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { repoRoot } from "./lib/paths.js";
import type {
  CollectionResponse,
  ContentOperation,
  ContentTransactionRequest,
  ContentTransactionResponse,
} from "../devdocs/shared/contracts.js";

/**
 * A short, production-backed editor smoke. The source copy is disposable so a browser run can
 * prove real writes, transactions, and rebuild protection without changing the checkout.
 *
 * The first navigation warms Vite's dependency optimizer. The acceptance budget starts after that
 * navigation; every later wait uses the small Playwright defaults below and the explicit deadline.
 */

type JsonRecord = Record<string, unknown>;
type Diagnostic = { path: string; message: string; severity: string };
type TransactionPayload = ContentTransactionResponse & {
  error?: string;
  diagnostics?: Diagnostic[];
  revisions?: Record<string, string>;
};

const evidence = path.join(repoRoot, "test-results/devdocs");
const temporary = await mkdtemp(path.join(tmpdir(), "corealm-devdocs-smoke-"));
const contentRoot = path.join(temporary, "content");
const reportPath = path.join(evidence, "report.json");
const dataRoot = path.join(repoRoot, "game/content/data");

await mkdir(evidence, { recursive: true });
await cp(dataRoot, path.join(contentRoot, "data"), { recursive: true });

const oldContentRoot = process.env.DEVDOCS_CONTENT_ROOT;
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let expectedConflict = false;
let expectedValidationFailure = false;
const errors: string[] = [];
const checks: Record<string, unknown> = {};

function restoreContentRoot(): void {
  if (oldContentRoot === undefined) delete process.env.DEVDOCS_CONTENT_ROOT;
  else process.env.DEVDOCS_CONTENT_ROOT = oldContentRoot;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function collection(name: string): Promise<CollectionResponse> {
  assert(page, "Browser page is not ready");
  const base = page.url().split("/#", 1)[0]!;
  const response = await page.request.get(`${base}/__devdocs/collections/${encodeURIComponent(name)}`);
  assert.equal(response.status(), 200, `Unable to load collection ${name}`);
  return response.json() as Promise<CollectionResponse>;
}

async function transaction(url: string, body: ContentTransactionRequest): Promise<{ status: number; payload: TransactionPayload }> {
  assert(page, "Browser page is not ready");
  const response = await page.request.post(`${url}/__devdocs/transaction`, { data: body });
  return { status: response.status(), payload: await response.json() as TransactionPayload };
}

function deadlineGuard(deadline: number, label: string): void {
  if (Date.now() > deadline) throw new Error(`Devdocs smoke exceeded its 60-second acceptance budget during ${label}`);
}

async function screenshot(name: string): Promise<void> {
  assert(page, "Browser page is not ready");
  await page.screenshot({ path: path.join(evidence, name), fullPage: false });
}

async function waitForHeading(name: string | RegExp): Promise<void> {
  assert(page, "Browser page is not ready");
  await page.getByRole("heading", { name }).first().waitFor();
}

async function saveItemDescription(url: string, description: string): Promise<void> {
  assert(page, "Browser page is not ready");
  await page.goto(`${url}/#/items/worn_sword`);
  await waitForHeading("Worn Shortsword");
  const editor = page.getByRole("textbox", { name: "Description", exact: true });
  await editor.fill(description);
  const [response] = await Promise.all([
    page.waitForResponse(candidate => candidate.request().method() === "PUT" && candidate.url().endsWith("/collections/items/worn_sword")),
    page.getByRole("button", { name: "Save changes", exact: true }).click(),
  ]);
  assert.equal(response.status(), 200, await response.text());
  await page.locator(".editor-dirty").filter({ hasText: "Saved" }).waitFor();
  const rows = await readJson<JsonRecord[]>(path.join(contentRoot, "data/items.json"));
  assert.equal(rows.find(row => row.id === "worn_sword")?.description, description);
  checks.uiEditSave = { collection: "items", id: "worn_sword", field: "description" };
  await screenshot("item-edit.png");
}

async function exerciseUiConflict(url: string): Promise<void> {
  assert(page, "Browser page is not ready");
  const editor = page.getByRole("textbox", { name: "Description", exact: true });
  const draft = "A browser draft preserved across a source conflict.";
  await editor.fill(draft);

  const current = await collection("items");
  const currentRows = current.data as JsonRecord[];
  const worn = currentRows.find(row => row.id === "worn_sword");
  assert(worn, "Expected the starter sword in items");
  const concurrent = await page.request.put(`${url}/__devdocs/collections/items/worn_sword`, {
    data: { revision: current.revision, record: { ...worn, description: "Concurrent source text." } },
  });
  assert.equal(concurrent.status(), 200);

  expectedConflict = true;
  const conflictResponse = page.waitForResponse(response => response.status() === 409 && response.url().includes("/collections/items/worn_sword"));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await conflictResponse;
  expectedConflict = false;
  await page.getByRole("alert").filter({ hasText: "This file changed after you opened it" }).waitFor();
  assert.equal(await editor.inputValue(), draft);
  assert(await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled());
  await screenshot("edit-conflict.png");

  await page.getByRole("button", { name: "Reset draft", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement | null)?.value === "Concurrent source text.");
  checks.uiConflictDraft = true;
}

async function addAuthoredRecords(url: string): Promise<void> {
  assert(page, "Browser page is not ready");
  const [progression, items, creatures] = await Promise.all([
    collection("progression"),
    collection("items"),
    collection("creatureDefinitions"),
  ]);

  const smokeTier = {
    id: "smoke_tier",
    name: "Smoke Tier",
    tier: 2,
    reqLevel: 2,
    materials: {},
    resourceIds: [],
    equipment: [],
    production: [],
    presentation: {},
  };
  const smokeItem = {
    id: "smoke_unique_item",
    name: "Smoke Compass",
    tier: 2,
    description: "A unique authored exception for the editor smoke.",
    stackable: false,
    value: 17,
    category: "quest",
  };
  const frogPresentation = (creatures.data as JsonRecord[]).find(row => row.id === 'redsill_frogs')?.presentation;
  assert(frogPresentation && typeof frogPresentation === 'object', 'Expected a reviewed frog appearance');
  const smokeVariant = {
    id: "smoke_frog_variant",
    baseId: "frog_t1",
    availability: "world",
    name: "Smoke Frog",
    presentation: { ...frogPresentation as JsonRecord, id: "smoke_frog_variant" },
  };
  const changes: ContentOperation[] = [
    { kind: "put", collection: "progression", id: smokeTier.id, record: smokeTier, create: true },
    { kind: "put", collection: "items", id: smokeItem.id, record: smokeItem, create: true },
    { kind: "put", collection: "creatureDefinitions", id: smokeVariant.id, record: smokeVariant, create: true },
  ];
  const result = await transaction(url, {
    operation: "save",
    revisions: {
      progression: progression.revision,
      items: items.revision,
      creatureDefinitions: creatures.revision,
    },
    changes,
  });
  assert.equal(result.status, 200, result.payload.error ?? JSON.stringify(result.payload.diagnostics));
  assert(changes.every(change => result.payload.affected.some(row => row.collection === change.collection && row.id === change.id)));
  const savedProgression = await readJson<JsonRecord[]>(path.join(contentRoot, "data/progression.json"));
  const savedItems = await readJson<JsonRecord[]>(path.join(contentRoot, "data/items.json"));
  const savedCreatures = await readJson<JsonRecord[]>(path.join(contentRoot, "data/creatureDefinitions.json"));
  assert(savedProgression.some(row => row.id === smokeTier.id));
  assert(savedItems.some(row => row.id === smokeItem.id));
  const variant = savedCreatures.find(row => row.id === smokeVariant.id);
  assert.deepEqual({ id: variant?.id, baseId: variant?.baseId, availability: variant?.availability, name: variant?.name, presentation: variant?.presentation }, smokeVariant);
  checks.authoredDefinitions = { tier: smokeTier.id, uniqueItem: smokeItem.id, creatureVariant: smokeVariant.id };
}

async function exerciseInvalidTransaction(url: string): Promise<void> {
  assert(page, "Browser page is not ready");
  const sourceFile = path.join(contentRoot, "data/progression.json");
  const compiledFile = path.join(contentRoot, "compiled/catalog.json");
  const beforeSource = await readFile(sourceFile, "utf8");
  const beforeCompiled = await readFile(compiledFile, "utf8");
  const current = await collection("progression");
  const rows = current.data as JsonRecord[];
  const tier = rows.find(row => row.id === "tier_1");
  assert(tier, "Expected tier_1 progression source");
  const invalid = structuredClone(tier);
  invalid.id = "smoke_invalid_tier";
  invalid.tier = 2;
  invalid.materials = { ...(tier.materials as JsonRecord), ore: "missing_material" };
  expectedValidationFailure = true;
  const result = await transaction(url, {
    operation: "save",
    revisions: { progression: current.revision },
    changes: [{ kind: "put", collection: "progression", id: String(invalid.id), record: invalid, create: true }],
  });
  expectedValidationFailure = false;
  assert.equal(result.status, 422);
  assert(result.payload.error?.includes("last valid") || result.payload.diagnostics?.some(diagnostic => diagnostic.severity === "error"));
  assert.equal(await readFile(sourceFile, "utf8"), beforeSource);
  assert.equal(await readFile(compiledFile, "utf8"), beforeCompiled);
  checks.invalidTransactionKeepsLastValid = true;
}

async function exerciseTransactionConflict(url: string): Promise<void> {
  assert(page, "Browser page is not ready");
  const current = await collection("items");
  const rows = current.data as JsonRecord[];
  const worn = rows.find(row => row.id === "worn_sword");
  assert(worn);
  const compiledFile = path.join(contentRoot, "compiled/catalog.json");
  const staleCompiled = await readFile(compiledFile, "utf8");
  const concurrent = await transaction(url, {
    operation: "save",
    revisions: { items: current.revision },
    changes: [{ kind: "put", collection: "items", id: "worn_sword", record: { ...worn, description: "Concurrent transaction source." } }],
  });
  assert.equal(concurrent.status, 200);
  expectedConflict = true;
  const stale = await transaction(url, {
    operation: "save",
    revisions: { items: current.revision },
    changes: [{ kind: "put", collection: "items", id: "worn_sword", record: { ...worn, description: "Stale transaction draft." } }],
  });
  expectedConflict = false;
  assert.equal(stale.status, 409);
  assert(stale.payload.error?.toLowerCase().includes("changed") || stale.payload.error?.toLowerCase().includes("revision"));
  const saved = await readJson<JsonRecord[]>(path.join(contentRoot, "data/items.json"));
  assert.equal(saved.find(row => row.id === "worn_sword")?.description, "Concurrent transaction source.");
  const afterConcurrent = await readFile(compiledFile, "utf8");
  assert.notEqual(afterConcurrent, staleCompiled);
  assert.equal(await readFile(compiledFile, "utf8"), afterConcurrent);
  checks.transactionConflict = { status: stale.status, publishedConcurrentChange: true, staleDraftRejected: true };
}

async function exerciseWorldAuthoring(url: string): Promise<void> {
  assert(page, "Browser page is not ready");
  await page.goto(`${url}/#/world`);
  await waitForHeading("World");
  const placementsPanel = page.getByRole("complementary", { name: "Placements", exact: true });
  await placementsPanel.getByRole("button", { name: "New", exact: true }).waitFor();
  // Encounter: the "+ New" menu opens an inline ID form; members are picked from a searchable popover.
  await placementsPanel.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Encounter", exact: true }).click();
  await page.getByLabel("New encounter ID", { exact: true }).fill("smoke_ui_encounter");
  await page.getByRole("button", { name: "Add encounter", exact: true }).click();
  await page.getByLabel("Encounter definition", { exact: true }).selectOption("smoke_ui_encounter");
  await page.getByRole("button", { name: "Change creature", exact: true }).first().click();
  await page.getByLabel("Search Creatures", { exact: true }).fill("smoke_frog_variant");
  await page.getByRole("option", { name: /smoke_frog_variant/ }).first().click();
  await placementsPanel.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Placement at map centre", exact: true }).click();
  await page.getByLabel("New placement ID", { exact: true }).fill("smoke_ui_placement");
  await page.getByRole("button", { name: "Add placement", exact: true }).click();
  await page.locator('.world-list [data-id="smoke_ui_placement"] .ref-row').click();
  const centreX = page.getByRole("spinbutton", { name: "Centre X", exact: true });
  await centreX.fill("-97");
  const worldPreview = page.waitForResponse(response => response.url().endsWith('/__devdocs/transaction'));
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const worldPreviewResponse = await worldPreview;
  assert.equal(worldPreviewResponse.status(), 200, await worldPreviewResponse.text());
  await page.getByText(/affected ·/i).waitFor();
  await page.getByRole("button", { name: /^Save \d+$/ }).click();
  await page.getByRole("status").filter({ hasText: /Saved \d+ source changes/ }).waitFor();
  const placements = await readJson<JsonRecord[]>(path.join(contentRoot, "data/placements.json"));
  const encounters = await readJson<JsonRecord[]>(path.join(contentRoot, "data/encounters.json"));
  const placement = placements.find(row => row.id === "smoke_ui_placement");
  const encounter = encounters.find(row => row.id === "smoke_ui_encounter");
  assert(placement, "World UI did not save the new placement");
  assert(encounter, "World UI did not save the new encounter");
  assert.equal((placement.centre as number[])[0], -97);
  assert.equal(placement.encounterId, "smoke_ui_encounter");
  assert.equal(((encounter.members as JsonRecord[])[0]?.creatureId), "smoke_frog_variant");
  checks.worldAuthoring = { placement: "smoke_ui_placement", encounter: "smoke_ui_encounter", variant: "smoke_frog_variant" };
  await screenshot("world-authoring.png");
}

try {
  process.env.DEVDOCS_CONTENT_ROOT = contentRoot;
  server = await createServer({
    configFile: path.join(repoRoot, "devdocs/vite.config.ts"),
    cacheDir: path.join(repoRoot, "node_modules/.vite-devdocs-smoke"),
    optimizeDeps: { force: true },
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  restoreContentRoot();
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing devdocs TCP address");
  const url = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    // HTTP failures are classified by URL/status below; Chromium may log them after the action ends.
    if (message.text().startsWith('Failed to load resource:')) return;
    errors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() < 400) return;
    if (response.status() === 404 && response.url().endsWith('/__devdocs/icons/smoke_unique_item.png')) return;
    // Model thumbnails are rendered on demand; a miss is the expected first response.
    if (response.status() === 404 && response.url().includes('/__devdocs/thumbnails/')) return;
    if (expectedConflict && response.status() === 409) return;
    if (expectedValidationFailure && response.status() === 422) return;
    errors.push(`${response.status()} ${response.url()}`);
  });

  // This first load includes Vite's optimizer and is intentionally outside the acceptance budget.
  await page.goto(`${url}/#/`);
  const sidebar = page.locator(".sidebar");
  for (const label of ["Tiers", "World map", "Formulas", "Work queue"]) {
    await sidebar.getByRole("button", { name: label, exact: true }).waitFor();
  }
  checks.taskNavigation = ["Tiers", "World map", "Formulas", "Work queue"];
  await page.waitForFunction(async () => {
    const response = await fetch('/__devdocs/formulas');
    const result = await response.json();
    if (result.build?.state === 'invalid') throw new Error(JSON.stringify(result.build.diagnostics));
    return result.build?.state === 'valid';
  }, undefined, { timeout: 30_000 });
  await screenshot("overview.png");
  const deadline = Date.now() + 60_000;

  await sidebar.getByRole("button", { name: "Tiers", exact: true }).click();
  await waitForHeading(/^Tiers/);
  assert.equal(await sidebar.getByRole("button", { name: "Tiers", exact: true }).getAttribute("aria-current"), "page");
  await screenshot("progression.png");
  deadlineGuard(deadline, "progression navigation");

  await sidebar.getByRole("button", { name: "World map", exact: true }).click();
  await waitForHeading(/World/);
  assert.equal(await sidebar.getByRole("button", { name: "World map", exact: true }).getAttribute("aria-current"), "page");
  await screenshot("world.png");
  deadlineGuard(deadline, "world navigation");

  await sidebar.getByRole("button", { name: "Formulas", exact: true }).click();
  await waitForHeading("Formulas");
  await page.getByRole("navigation", { name: "Formula index", exact: true }).waitFor();
  await page.getByLabel("Find a formula", { exact: true }).waitFor();
  const formulaCount = await page.getByRole("navigation", { name: "Formula index", exact: true }).getByRole("button").count();
  assert(formulaCount > 0, "Formula workspace must list a registered production formula");
  checks.formulaWorkspace = { registeredFormulas: formulaCount };
  await screenshot("formulas.png");
  deadlineGuard(deadline, "formula workspace");

  await sidebar.getByRole("button", { name: "Work queue", exact: true }).click();
  await waitForHeading(/Work queue|Requests|Review/);
  assert.equal(await sidebar.getByRole("button", { name: "Work queue", exact: true }).getAttribute("aria-current"), "page");
  checks.workQueue = true;
  await screenshot("work-queue.png");
  deadlineGuard(deadline, "work queue");

  await saveItemDescription(url, "A copper sword edited by the concise editor smoke.");
  await exerciseUiConflict(url);
  deadlineGuard(deadline, "UI save and conflict");

  await exerciseInvalidTransaction(url);
  await addAuthoredRecords(url);
  await page.reload();
  deadlineGuard(deadline, "content transactions");

  await page.goto(`${url}/#/progression`);
  await waitForHeading(/^Tiers/);
  await page.getByText("Smoke Tier", { exact: true }).first().waitFor();
  await page.goto(`${url}/#/items/smoke_unique_item`);
  await waitForHeading("Smoke Compass");
  await page.goto(`${url}/#/creatureDefinitions/smoke_frog_variant`);
  await waitForHeading("Smoke Frog");
  // The base creature is shown as a reference chip (its name, not its id) in the Base ID field.
  await page.getByRole("button", { name: "Frog", exact: true }).first().waitFor();
  checks.authoredRecordsVisible = true;

  await exerciseWorldAuthoring(url);
  await exerciseTransactionConflict(url);
  deadlineGuard(deadline, "world authoring and transaction conflict");

  const validation = await page.request.post(`${url}/__devdocs/validate`);
  assert.equal(validation.status(), 200);
  const validationBody = await validation.json() as { ok: boolean; diagnostics: Diagnostic[] };
  assert.equal(validationBody.ok, true, JSON.stringify(validationBody.diagnostics));
  const formulas = await page.request.get(`${url}/__devdocs/formulas`);
  assert.equal(formulas.status(), 200);
  const formulaBody = await formulas.json() as { build: { state: string } };
  assert.notEqual(formulaBody.build.state, "invalid");
  checks.lastValidBuild = { validation: true, formulaState: formulaBody.build.state };
  await writeFile(reportPath, JSON.stringify({ passed: true, checks, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
  await writeFile(reportPath, JSON.stringify({ passed: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally {
  restoreContentRoot();
  await browser?.close();
  await server?.close();
  const expectedTempParent = path.resolve(tmpdir());
  if (path.dirname(temporary) !== expectedTempParent) throw new Error("Unexpected temporary root");
  await rm(temporary, { recursive: true, force: true });
}
