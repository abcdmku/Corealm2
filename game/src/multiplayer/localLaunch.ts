import type { WorldFixture } from "../contracts.js";
import { publicBaseUrl } from "../app/config.js";
import { legacySaveImport, markLegacySaveMigrated, readLegacySave } from "../persistence/localSaveMigration.js";
import { WorkerWorldProvider, resolveLocalSeed } from "./workerProvider.js";

/**
 * Everything the page decides about worker-hosted local play before it builds a scene: which seed,
 * whether an old main-thread save is waiting to be imported, and the provider that will host it.
 *
 * It runs before the scene because the scene and the worker's world must be one seed, and the seed
 * comes from the old save or from the last session, checked against what the published pack holds.
 */
const LOCAL_SEED_KEY = "corealm.local.seed.v1";
const DEFAULT_SEED = 1337;

export interface LocalLaunch {
  provider: WorkerWorldProvider;
  seed: number;
  /** A line for the picker when something about the start needs saying. Null when nothing does. */
  notice(): string | null;
}

function rememberedSeed(): number | null {
  try { const value = Number(localStorage.getItem(LOCAL_SEED_KEY)); return Number.isSafeInteger(value) && value >= 0 && localStorage.getItem(LOCAL_SEED_KEY) !== null ? value : null; }
  catch { return null; }
}

export async function prepareLocalLaunch(options: { fixture: WorldFixture; memory?: boolean }): Promise<LocalLaunch> {
  const assetBase = new URL(publicBaseUrl(), location.href).href;
  // Read once, here: the load pipeline (migrate, recompute, validate) is not free, and the seed is needed now.
  const read = (): ReturnType<typeof legacySaveImport> | null => {
    if (options.memory) return null;
    try { const save = readLegacySave(localStorage); return save ? legacySaveImport(save.state) : null; } catch { return null; }
  };
  let legacy = read();
  const wanted = legacy?.seed ?? rememberedSeed() ?? DEFAULT_SEED;
  const { seed, fallback } = await resolveLocalSeed(assetBase, wanted);
  let notice: string | null = fallback ? `This build has no world for seed ${wanted}, so your character starts at the safe spawn of the standard world.` : null;
  const provider = new WorkerWorldProvider({
    fixture: options.fixture, seed, assetBase, ...(options.memory ? { memory: true } : {}),
    spawn: () => new Worker(new URL("../worker/localHost.ts", import.meta.url), { type: "module", name: "corealm-local-host" }),
    legacy: { read: () => legacy, migrated: () => { legacy = null; try { markLegacySaveMigrated(localStorage); } catch { /* It is offered again next boot, and the worker leaves a stored character alone. */ } } },
    storageTrouble(trouble) {
      // Said where the player looks for the state of their world, and offered to the page for anything louder.
      notice = trouble.degraded ? "This browser stopped saving your local world. Progress from here on will be lost when the page closes."
        : "Your local world could not be saved just now. The game will try again.";
      console.warn(`[corealm] Local store write failed (attempt ${trouble.attempt}, ${trouble.pending} rows waiting): ${trouble.message}`);
      window.dispatchEvent(new CustomEvent("corealm:local-storage", { detail: trouble }));
    },
    started(ready) {
      if (ready.seed.requested !== ready.seed.used) notice = `This build has no world for seed ${ready.seed.requested}, so your character starts at the safe spawn of the standard world.`;
      if (!options.memory) try { localStorage.setItem(LOCAL_SEED_KEY, String(ready.seed.used)); } catch { /* Private mode: the default seed next time. */ }
    },
  });
  return { provider, seed, notice: () => notice };
}
