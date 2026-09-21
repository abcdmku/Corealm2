import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runAdminCommand } from "../identity/src/admin.js";
import {
  DEFAULT_SCRYPT, HashingBusy, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SALT_BYTES, ScryptHasher,
  SCRYPT_CONCURRENCY, SCRYPT_QUEUE_LIMIT, type PasswordHashing,
} from "../identity/src/passwords.js";
import { IdentityStore, RESERVED_NAMES } from "../identity/src/store.js";
import { accountOf, fastHasher, openForm, PASSWORD, PLAY_ORIGIN, RETURN_URL, signIn, startService, submit, temporaryDirectory } from "./identity-harness.js";

/** A state value is random per page, so two otherwise identical pages differ by exactly that. */
const withoutState = (page: string) => page.replace(/name="state" value="[^"]*"/, 'name="state" value="STATE"');

/** The real hasher, watched: the test can see which stored hash each verify ran against. */
function spyHasher(inner: PasswordHashing) {
  const verified: (string | null)[] = [];
  const hashed: string[] = [];
  return {
    verified, hashed, parameters: inner.parameters,
    hash(password: string) { hashed.push(password); return inner.hash(password); },
    verify(password: string, stored: string | null) { verified.push(stored); return inner.verify(password, stored); },
  };
}

describe("signing in", () => {
  it("costs an unknown name exactly what a wrong password costs, and says the same thing", async () => {
    const hasher = spyHasher(fastHasher());
    const { base } = await startService({ hasher });
    await signIn(base, "register", "Rook", PASSWORD);
    hasher.verified.length = 0;

    const wrong = await signIn(base, "login", "Rook", "not-the-password-1");
    const unknown = await signIn(base, "login", "Ghost", "not-the-password-1");
    expect([wrong.response.status, unknown.response.status]).toEqual([401, 401]);
    // One real scrypt either way: a known name ran against its hash, an unknown one against the decoy.
    expect(hasher.verified).toHaveLength(2);
    expect(hasher.verified[0]).toMatch(/^scrypt\$16\$8\$1\$/);
    expect(hasher.verified[1]).toBe(null);
    const [first, second] = [await wrong.response.text(), await unknown.response.text()];
    expect(withoutState(second)).toBe(withoutState(first));
    expect(first).toContain("That username and password do not match.");
    // The username is not echoed back, which is what keeps the two answers identical byte for byte.
    expect(first).not.toContain("Ghost");
    expect(first).not.toContain("Rook");
  });

  it("refuses a password that is short, the username, or one of the famous ones", async () => {
    const { base } = await startService({ registrationsPerAddress: 20 });
    const refused = async (username: string, password: string) => {
      const attempt = await signIn(base, "register", username, password);
      return { status: attempt.response.status, page: await attempt.response.text() };
    };
    expect(await refused("Rook", "short-1")).toMatchObject({ status: 400 });
    expect((await refused("Rook", "short-1")).page).toContain("Use a password of at least 10 characters.");
    expect((await refused("Rook", "x".repeat(PASSWORD_MAX_LENGTH + 1))).page).toContain("Use a password of at most 256 characters.");
    expect((await refused("Rookwoodhall", "rookwoodhall")).page).toContain("Your password cannot be your username.");
    expect((await refused("Rook", "welcome123")).page).toContain("That is one of the most common passwords. Choose another.");
    // Exactly at the minimum is fine, and the account is real afterwards.
    const made = await signIn(base, "register", "Rook", "gravel-ash");
    expect([made.response.status, PASSWORD_MIN_LENGTH]).toEqual([303, 10]);
    expect((await accountOf(base, made.session)).status).toBe(200);
  });

  it("takes a password typed in another Unicode normal form", async () => {
    const hasher = fastHasher();
    // U+FB01, the "fi" ligature, which NFKC folds to two plain letters before anything is hashed.
    const stored = await hasher.hash("ﬁreflies-1234");
    expect(await hasher.verify("fireflies-1234", stored)).toEqual({ ok: true, stale: false });
  });

  it("keeps the reserved names out of everyone's hands", () => {
    expect(RESERVED_NAMES).toContain("admin");
    expect(RESERVED_NAMES).toContain("corealm");
    expect(RESERVED_NAMES.length).toBeLessThan(20);
  });
});

describe("the form's single-use state", () => {
  it("refuses a missing, reused, expired or mismatched state", async () => {
    const { clock, base } = await startService({ stateTtlSeconds: 60 });
    const first = await openForm(base, "register");
    const used = await submit(base, "register", { state: first.state, username: "Rook", password: PASSWORD });
    expect(used.status).toBe(303);
    const replayed = await submit(base, "register", { state: first.state, username: "Rook2", password: PASSWORD });
    expect(replayed.status).toBe(400);
    expect(await replayed.text()).toContain("This form expired or was already used.");

    expect((await submit(base, "login", { username: "Rook", password: PASSWORD })).status).toBe(400);
    expect((await submit(base, "login", { state: "made-up", username: "Rook", password: PASSWORD })).status).toBe(400);

    // A state made for one page is not a state for another.
    const registerState = (await openForm(base, "register")).state;
    expect((await submit(base, "login", { state: registerState, username: "Rook", password: PASSWORD })).status).toBe(400);

    const stale = await openForm(base, "login");
    clock.unix += 61;
    expect((await submit(base, "login", { state: stale.state, username: "Rook", password: PASSWORD })).status).toBe(400);
  });

  it("refuses a return URL that is not on the allow-list, and one smuggled into the body", async () => {
    const { base } = await startService();
    const hostile = await fetch(`${base}/login?return=${encodeURIComponent("https://evil.example.com/steal")}`, { redirect: "manual" });
    expect(hostile.status).toBe(400);
    expect(await hostile.text()).toContain("does not name a Corealm site");
    expect((await fetch(`${base}/login?return=${encodeURIComponent("https://play.example.com.evil.test/")}`, { redirect: "manual" })).status).toBe(400);
    expect((await fetch(`${base}/login`, { redirect: "manual" })).status).toBe(400);
    expect((await fetch(`${base}/register?return=${encodeURIComponent("https://evil.example.com/")}`, { redirect: "manual" })).status).toBe(400);

    // The destination is the one the state was minted with; a `return` in the body is ignored.
    const { state } = await openForm(base, "register");
    const smuggled = await submit(base, "register", { state, username: "Rook", password: PASSWORD, return: "https://evil.example.com/steal" });
    expect(smuggled.status).toBe(303);
    expect(new URL(smuggled.headers.get("location")!).origin).toBe(PLAY_ORIGIN);
  });

  it("refuses a form posted from another site", async () => {
    const { base } = await startService();
    const { state } = await openForm(base, "register");
    const crossSite = await submit(base, "register", { state, username: "Rook", password: PASSWORD },
      { Origin: "https://evil.example.com", "Sec-Fetch-Site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.text()).toContain("This form was sent from another site.");
    const noOrigin = await fetch(`${base}/register`, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ state, username: "Rook", password: PASSWORD }).toString(),
    });
    expect(noOrigin.status).toBe(403);
    // A named origin that is not this one is refused even when the site header says otherwise.
    expect((await submit(base, "register", { state, username: "Rook", password: PASSWORD }, { Origin: "https://evil.example.com" })).status).toBe(403);
    // The state was never spent, so the player's own tab still works. `Referrer-Policy: no-referrer`
    // on these pages means a real browser sends `Origin: null` here, which the site header covers.
    const real = await submit(base, "register", { state, username: "Rook", password: PASSWORD }, { Origin: "null" });
    expect(real.status).toBe(303);
  });
});

describe("abuse limits", () => {
  it("slows a name and an address down without ever locking an account", async () => {
    const { clock, base } = await startService({ loginsPerName: 3, loginsPerAddress: 8, loginWindowSeconds: 900 });
    await signIn(base, "register", "Rook", PASSWORD);
    for (let attempt = 0; attempt < 3; attempt++) expect((await signIn(base, "login", "Rook", "wrong-password-1")).response.status).toBe(401);
    const limited = await signIn(base, "login", "Rook", "wrong-password-1");
    expect(limited.response.status).toBe(429);
    expect(await limited.response.text()).toContain("Too many sign-in attempts.");
    // Even the right password waits: the window is the punishment, and it runs out on its own.
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(429);
    clock.unix += 900;
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(303);
    // A sign-in that worked clears the name's window, so a player's own typos cannot lock them out.
    for (let attempt = 0; attempt < 2; attempt++) await signIn(base, "login", "Rook", "wrong-password-1");
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(303);

    const perAddress = await startService({ loginsPerName: 50, loginsPerAddress: 2 });
    await signIn(perAddress.base, "register", "Rook", PASSWORD);
    expect((await signIn(perAddress.base, "login", "One", "wrong-password-1")).response.status).toBe(401);
    expect((await signIn(perAddress.base, "login", "Two", "wrong-password-1")).response.status).toBe(401);
    expect((await signIn(perAddress.base, "login", "Three", "wrong-password-1")).response.status).toBe(429);
  });

  it("caps registrations per address and overall", async () => {
    const { clock, base } = await startService({ registrationsPerAddress: 2, registrationWindowSeconds: 3_600 });
    expect((await signIn(base, "register", "One", PASSWORD)).response.status).toBe(303);
    expect((await signIn(base, "register", "Two", PASSWORD)).response.status).toBe(303);
    const limited = await signIn(base, "register", "Three", PASSWORD);
    expect(limited.response.status).toBe(429);
    expect(await limited.response.text()).toContain("Too many accounts have been created recently.");
    clock.unix += 3_600;
    expect((await signIn(base, "register", "Three", PASSWORD)).response.status).toBe(303);

    const global = await startService({ registrationsPerAddress: 50, registrationsPerWindow: 1 });
    expect((await signIn(global.base, "register", "One", PASSWORD)).response.status).toBe(303);
    expect((await signIn(global.base, "register", "Two", PASSWORD)).response.status).toBe(429);
  });

  it("closes registration when the operator says so", async () => {
    const { base } = await startService({ registration: "closed" });
    const closed = await fetch(`${base}/register?return=${encodeURIComponent(RETURN_URL)}`, { redirect: "manual" });
    expect(closed.status).toBe(403);
    const page = await closed.text();
    expect(page).toContain("Registration is closed");
    expect(page).toContain("Ask the operator for one.");
    // Nothing offers a way in that is not there.
    const login = await openForm(base, "login");
    expect(login.page).not.toContain("/register");
    expect((await submit(base, "register", { state: login.state, username: "Rook", password: PASSWORD })).status).toBe(400);
  });

  it("answers 503 rather than starting unbounded scrypt work", async () => {
    const busy: PasswordHashing = {
      parameters: DEFAULT_SCRYPT,
      hash: () => Promise.reject(new HashingBusy()),
      verify: () => Promise.reject(new HashingBusy()),
    };
    const { base } = await startService({ hasher: busy });
    const refused = await signIn(base, "login", "Rook", PASSWORD);
    expect(refused.response.status).toBe(503);
    expect(await refused.response.text()).toContain("The service is busy signing people in.");

    // The queue itself: four at once, a short backlog, and a refusal past that.
    const hasher = new ScryptHasher({ parameters: { N: 16, r: 8, p: 1, keyLength: 64 }, concurrency: 2, queueLimit: 1 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => hasher.hash("gravel-ash-42")));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter(result => result.status === "rejected").map(result => (result as PromiseRejectedResult).reason))
      .toEqual([new HashingBusy(), new HashingBusy(), new HashingBusy()]);
  });
});

describe("the pages themselves", () => {
  it("escapes a hostile return URL and a hostile username", async () => {
    const { base } = await startService();
    const hostile = `${PLAY_ORIGIN}/play?evil=${encodeURIComponent('"><script>alert(1)</script>')}`;
    const opened = await openForm(base, "login", hostile);
    expect(opened.response.status).toBe(200);
    expect(opened.page).not.toContain("<script>");
    expect(opened.page).not.toContain('"><script');
    // The page names the origin it will hand the session to, not the whole URL.
    expect(opened.page).toContain("<strong>https://play.example.com</strong>");

    const attempt = await signIn(base, "register", '"><script>alert(1)</script>', PASSWORD);
    const page = await attempt.response.text();
    expect(attempt.response.status).toBe(400);
    expect(page).not.toContain("<script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("puts the same locked-down headers on every page", async () => {
    const { base } = await startService();
    const expected = {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    // A page with a form also names where that form's own redirect may land, because Chromium
    // applies `form-action` to the 303 as well as to the action attribute.
    const withForm = {
      ...expected,
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${PLAY_ORIGIN}; frame-ancestors 'none'; base-uri 'none'`,
    };
    const headersOf = (response: Response) => Object.fromEntries(Object.keys(expected).map(name => [name, response.headers.get(name)]));
    expect(headersOf((await openForm(base, "login")).response)).toEqual(withForm);
    expect(headersOf((await openForm(base, "register")).response)).toEqual(withForm);
    expect(headersOf((await openForm(base, "password")).response)).toEqual(withForm);
    expect(headersOf((await signIn(base, "login", "Rook", PASSWORD)).response)).toEqual(withForm);
    // A page with nothing to submit keeps the tightest form-action there is.
    expect(headersOf(await fetch(`${base}/login`, { redirect: "manual" }))).toEqual(expected);
    // There is no script on any of them to have a nonce for.
    expect((await openForm(base, "register")).page).not.toContain("<script");
  });
});

describe("changing a password", () => {
  it("signs every other session out and hands this browser a new one", async () => {
    const { base } = await startService();
    const phone = await signIn(base, "register", "Rook", PASSWORD);
    const desktop = await signIn(base, "login", "Rook", PASSWORD);

    const wrong = await submit(base, "password", { state: (await openForm(base, "password")).state, username: "Rook", current: "not-the-password-1", password: "quarry-lantern-7" });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("That username and password do not match.");
    const weak = await submit(base, "password", { state: (await openForm(base, "password")).state, username: "Rook", current: PASSWORD, password: "short" });
    expect(weak.status).toBe(400);
    expect(await weak.text()).toContain("Use a password of at least 10 characters.");
    expect((await accountOf(base, phone.session)).status).toBe(200);

    const changed = await submit(base, "password", { state: (await openForm(base, "password")).state, username: "Rook", current: PASSWORD, password: "quarry-lantern-7" });
    expect(changed.status).toBe(303);
    const session = new URLSearchParams(new URL(changed.headers.get("location")!).hash.slice(1)).get("session")!;
    expect((await accountOf(base, session)).status).toBe(200);
    expect((await accountOf(base, phone.session)).status).toBe(401);
    expect((await accountOf(base, desktop.session)).status).toBe(401);
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(401);
    expect((await signIn(base, "login", "Rook", "quarry-lantern-7")).response.status).toBe(303);
  });

  it("rewrites a hash that was stored at weaker parameters", async () => {
    const dataDir = await temporaryDirectory();
    const weak = new ScryptHasher({ parameters: { N: 2, r: 8, p: 1, keyLength: 64 } });
    const store = new IdentityStore(`${dataDir}/identity.sqlite`);
    const account = store.createAccount("Rook", await weak.hash(PASSWORD), 1_700_000_000)!;
    store.close();

    const { base } = await startService({ dataDir });
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(303);
    const after = new IdentityStore(`${dataDir}/identity.sqlite`);
    expect(after.accountByName("Rook")!.passwordHash).toMatch(/^scrypt\$16\$8\$1\$/);
    expect(after.account(account.id)!.claimed).toBe(true);
    after.close();
  });
});

describe("a database from the OAuth service", () => {
  it("keeps its accounts as unclaimed names and drops the provider rows", async () => {
    const dataDir = await temporaryDirectory();
    const path = `${dataDir}/identity.sqlite`;
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT");
    legacy.exec("CREATE TABLE account_providers (provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, account_id TEXT NOT NULL, linked_at INTEGER NOT NULL, PRIMARY KEY (provider, provider_user_id)) STRICT");
    legacy.exec("CREATE TABLE login_states (state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, return_url TEXT NOT NULL, verifier TEXT, intent TEXT NOT NULL, account_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT");
    legacy.prepare("INSERT INTO accounts VALUES (?,?,?,?)").run("acc_legacy", "Rook", "rook", 1_600_000_000);
    legacy.prepare("INSERT INTO account_providers VALUES ('discord','1001','acc_legacy',1600000000)").run();
    legacy.close();

    const store = new IdentityStore(path);
    expect(store.accountByName("rook")).toMatchObject({ id: "acc_legacy", name: "Rook", claimed: false, passwordHash: null });
    expect(store.listAccounts()).toEqual([{ id: "acc_legacy", name: "Rook", createdAt: 1_600_000_000, claimed: false }]);
    const tables = store["db"].prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name));
    expect(tables).not.toContain("account_providers");
    expect(tables).toContain("schema_version");
    store.close();

    const { base } = await startService({ dataDir });
    // Nobody may claim a migrated name by registering it, and nobody can sign in to it yet.
    const stolen = await signIn(base, "register", "Rook", PASSWORD);
    expect(stolen.response.status).toBe(409);
    expect((await signIn(base, "login", "Rook", PASSWORD)).response.status).toBe(401);

    // The operator claims it instead, against the same database file the service has open.
    const lines: string[] = [];
    const admin = new IdentityStore(path);
    expect(await runAdminCommand(admin, ["claim", "Rook"], { secret: async () => PASSWORD, out: line => lines.push(line), hasher: fastHasher() })).toBe(0);
    expect(lines[0]).toContain("Set the password for Rook (acc_legacy)");
    expect(await runAdminCommand(admin, ["claim", "Rook"], { secret: async () => PASSWORD, out: line => lines.push(line), hasher: fastHasher() })).toBe(1);
    expect(lines[1]).toContain("already has a password");
    admin.close();

    const claimed = await signIn(base, "login", "Rook", PASSWORD);
    expect(claimed.response.status).toBe(303);
    expect(claimed.fragment.get("account")).toBe("acc_legacy");
  });
});

describe("the operator tool", () => {
  it("lists, creates, resets, revokes and deletes", async () => {
    const dataDir = await temporaryDirectory();
    const store = new IdentityStore(`${dataDir}/identity.sqlite`);
    const lines: string[] = [];
    const ports = { secret: async () => PASSWORD, out: (line: string) => lines.push(line), hasher: fastHasher(), now: () => 1_700_000_000 };
    const run = (...args: string[]) => runAdminCommand(store, args, ports);

    expect(await run("list")).toBe(0);
    expect(lines.at(-1)).toBe("No accounts yet.");
    expect(await run("create", "Rook")).toBe(0);
    expect(lines.at(-1)).toMatch(/^Created Rook \(acc_/);
    expect(await run("create", "rook")).toBe(1);
    expect(lines.at(-1)).toBe("rook already exists.");
    expect(await run("create", "admin")).toBe(1);
    expect(lines.at(-1)).toBe("admin is a reserved name.");
    expect(await run("create", "no")).toBe(1);

    const account = store.accountByName("Rook")!;
    store.createSession(account.id, 1_700_000_000, 60);
    expect(await run("revoke-sessions", "Rook")).toBe(0);
    expect(lines.at(-1)).toBe("Revoked 1 session for Rook.");
    expect(await run("set-password", "Rook")).toBe(0);
    expect(store.accountByName("Rook")!.passwordHash).not.toBe(account.passwordHash);
    expect(await run("set-password", "Ghost")).toBe(1);
    expect(lines.at(-1)).toBe("No account named Ghost.");

    // A password the operator picks still has to pass the same rules a player's does.
    expect(await runAdminCommand(store, ["set-password", "Rook"], { ...ports, secret: async () => "short" })).toBe(1);
    expect(lines.at(-1)).toBe("Use a password of at least 10 characters.");

    expect(await run("list")).toBe(0);
    expect(lines.at(-2)).toContain("Rook");
    expect(lines.at(-2)).toContain("password");
    expect(lines.at(-1)).toBe("1 account, 0 unclaimed.");
    expect(await run("delete", "Rook")).toBe(0);
    expect(store.accountByName("Rook")).toBe(null);
    expect(await run("nonsense")).toBe(1);
    store.close();
  });
});

describe("the stored hash", () => {
  it("describes the parameters it was made with", async () => {
    expect(DEFAULT_SCRYPT).toEqual({ N: 131_072, r: 8, p: 1, keyLength: 64 });
    expect([SCRYPT_CONCURRENCY, SCRYPT_QUEUE_LIMIT, SALT_BYTES]).toEqual([4, 32, 16]);
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([10, 256]);
    const hasher = new ScryptHasher({ parameters: { N: 16, r: 8, p: 1, keyLength: 64 } });
    const stored = await hasher.hash(PASSWORD);
    expect(stored).toMatch(/^scrypt\$16\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(await hasher.verify(PASSWORD, stored)).toEqual({ ok: true, stale: false });
    expect(await hasher.verify("not-the-password-1", stored)).toEqual({ ok: false, stale: false });
    // A hash nobody can read is not a way in: it takes the decoy path and answers no.
    expect(await hasher.verify(PASSWORD, "not-a-hash")).toEqual({ ok: false, stale: false });
    expect(await hasher.verify(PASSWORD, null)).toEqual({ ok: false, stale: false });
    const weak = await new ScryptHasher({ parameters: { N: 2, r: 8, p: 1, keyLength: 64 } }).hash(PASSWORD);
    expect(await hasher.verify(PASSWORD, weak)).toEqual({ ok: true, stale: true });
  });
});
