import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { ScryptHasher } from "../identity/src/passwords.js";
import { startIdentityService, type IdentityService, type IdentityServiceOptions } from "../identity/src/server.js";

/**
 * A real identity service on an ephemeral port, driven the way a browser drives it: GET the page,
 * read the state out of the HTML, POST the form, follow nothing automatically.
 */

export const PLAY_ORIGIN = "https://play.example.com";
export const RETURN_URL = `${PLAY_ORIGIN}/play?mode=live`;
export const PASSWORD = "clamber-rook-91";
export type PageKind = "login" | "register" | "password";

/** The real hasher at a cost that runs in a millisecond. The default cost is asserted separately. */
export const fastHasher = () => new ScryptHasher({ parameters: { N: 16, r: 8, p: 1, keyLength: 64 } });

const running: IdentityService[] = [];
const directories: string[] = [];
// One hook for both, in this order: Windows will not unlink a SQLite file a live service still holds.
afterEach(async () => {
  for (const service of running.splice(0)) await service.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** A data directory that outlives the service, for the tests that open the database themselves. */
export async function temporaryDirectory(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "corealm-identity-"));
  directories.push(made);
  return made;
}

export async function startService(options: Partial<IdentityServiceOptions> = {}) {
  const directory = options.dataDir ?? await temporaryDirectory();
  const clock = { unix: 1_700_000_000 };
  const service = await startIdentityService({
    dataDir: directory, allowedOrigins: [PLAY_ORIGIN, "http://127.0.0.1:5173"],
    now: () => clock.unix, log: () => {}, hasher: fastHasher(), ...options,
  });
  running.push(service);
  return { service, clock, base: `http://127.0.0.1:${service.port}`, directory };
}

/** The value of the single-use state the page just handed out. */
export function stateOf(page: string): string {
  return /name="state" value="([^"]*)"/.exec(page)?.[1] ?? "";
}
export async function openForm(base: string, kind: PageKind, returnUrl = RETURN_URL) {
  const response = await fetch(`${base}/${kind}?return=${encodeURIComponent(returnUrl)}`, { redirect: "manual" });
  const page = await response.text();
  return { response, page, state: stateOf(page) };
}
/** A real form post, with the headers a browser puts on one. */
export function submit(base: string, kind: PageKind, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(`${base}/${kind}`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, "Sec-Fetch-Site": "same-origin", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}
export function fragmentOf(response: Response) {
  const location = new URL(response.headers.get("location") ?? "https://play.example.com/");
  const fragment = new URLSearchParams(location.hash.slice(1));
  return { location, fragment, session: fragment.get("session") ?? "" };
}
/** Everything a browser does between pressing the button and landing back on the game. */
export async function signIn(base: string, kind: "login" | "register", username: string, password: string, returnUrl = RETURN_URL) {
  const { state } = await openForm(base, kind, returnUrl);
  const response = await submit(base, kind, { state, username, password });
  return { response, state, ...fragmentOf(response) };
}
export const accountOf = (base: string, session: string) => fetch(`${base}/account`, { headers: { Authorization: `Bearer ${session}` } });
