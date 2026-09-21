import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privateAddress, type AddressLookup } from "../identity/src/addresses.js";
import { startIdentityService, type IdentityService } from "../identity/src/server.js";

const running: { service: IdentityService; directory: string }[] = [];
afterEach(async () => {
  for (const entry of running.splice(0)) {
    await entry.service.close();
    await rm(entry.directory, { recursive: true, force: true });
  }
});

/** Stands in for the game servers being registered. Only `/worlds` is ever probed. */
function worldProbe(answers: Record<string, { status: number; body: string; headers?: Record<string, string> }>) {
  const asked: string[] = [];
  const probe: typeof fetch = async (input, init) => {
    const url = String(input);
    asked.push(url);
    const answer = answers[url];
    if (!answer) throw new TypeError("fetch failed");
    // The service must ask for a manual redirect, so a 3xx arrives as a failed probe.
    expect(init?.redirect).toBe("manual");
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: { "Content-Type": "application/json", ...answer.headers } });
  };
  return { probe, asked };
}
/** Stands in for DNS. Unlisted hosts resolve to a public address. */
function resolver(addresses: Record<string, string[]>) {
  const asked: string[] = [];
  const lookup: AddressLookup = async hostname => {
    asked.push(hostname);
    const found = addresses[hostname] ?? ["203.0.113.10"];
    if (!found.length) throw new Error("ENOTFOUND");
    return found.map(address => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { lookup, asked };
}

async function startService(options: { probe: typeof fetch; lookup?: AddressLookup; allowPrivateServers?: boolean; registrationsPerMinute?: number }) {
  const directory = await mkdtemp(join(tmpdir(), "corealm-directory-"));
  const clock = { unix: 1_700_000_000 };
  const service = await startIdentityService({
    dataDir: directory, allowedOrigins: ["https://play.example.com"],
    now: () => clock.unix, log: () => {}, fetch: options.probe, lookup: options.lookup ?? resolver({}).lookup,
    directoryTtlSeconds: 600, directoryCapacity: 2, registrationsPerMinute: options.registrationsPerMinute ?? 10,
    ...(options.allowPrivateServers ? { allowPrivateServers: true } : {}),
  });
  running.push({ service, directory });
  return { service, clock, base: `http://127.0.0.1:${service.port}` };
}
const register = (base: string, body: unknown) =>
  fetch(`${base}/servers/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const errorCode = async (response: Response) => (await response.json() as { error: { code: string } }).error.code;

it("lists confirmed game servers, refreshes them on heartbeat and drops the silent ones", async () => {
  const { probe, asked } = worldProbe({
    "https://eu.corealm.example/worlds": { status: 200, body: "[]" },
    "https://us.corealm.example/worlds": { status: 200, body: JSON.stringify([{ worldId: "corealm" }]) },
    "https://ap.corealm.example/worlds": { status: 200, body: "[]" },
  });
  const { clock, base } = await startService({ probe });

  expect((await register(base, { name: "Corealm EU", endpoint: "wss://eu.corealm.example/", description: "Europe" })).status).toBe(200);
  expect(asked).toEqual(["https://eu.corealm.example/worlds"]);
  expect((await register(base, { name: "Corealm US", endpoint: "wss://us.corealm.example/" })).status).toBe(200);

  const listing = await fetch(`${base}/servers`);
  expect(listing.headers.get("access-control-allow-origin")).toBe("*");
  expect(await listing.json()).toEqual({ servers: [
    { name: "Corealm EU", endpoint: "wss://eu.corealm.example/", description: "Europe", registeredAt: clock.unix, lastSeenAt: clock.unix },
    { name: "Corealm US", endpoint: "wss://us.corealm.example/", registeredAt: clock.unix, lastSeenAt: clock.unix },
  ] });

  // The cap keeps the public list small; an established entry may still heartbeat.
  expect((await register(base, { name: "Corealm AP", endpoint: "wss://ap.corealm.example/" })).status).toBe(503);
  clock.unix += 500;
  expect((await register(base, { name: "Corealm EU", endpoint: "wss://eu.corealm.example/", description: "Europe" })).status).toBe(200);

  clock.unix += 101;
  const later = await (await fetch(`${base}/servers`)).json() as { servers: { name: string; lastSeenAt: number; registeredAt: number }[] };
  expect(later.servers.map(server => server.name)).toEqual(["Corealm EU"]);
  expect(later.servers[0]!.lastSeenAt).toBe(clock.unix - 101);
  expect(later.servers[0]!.registeredAt).toBe(1_700_000_000);

  clock.unix += 600;
  expect(await (await fetch(`${base}/servers`)).json()).toEqual({ servers: [] });
});

it("refuses endpoints that are not game servers", async () => {
  const { probe, asked } = worldProbe({
    "https://eu.corealm.example/worlds": { status: 404, body: "" },
    "https://blog.example.com/worlds": { status: 200, body: JSON.stringify({ hello: "world" }) },
    "https://moved.example.com/worlds": { status: 302, body: "", headers: { Location: "https://eu.corealm.example/worlds" } },
  });
  const { base } = await startService({ probe });

  const plain = await register(base, { name: "Corealm EU", endpoint: "https://eu.corealm.example/" });
  expect(plain.status).toBe(400);
  expect(await errorCode(plain)).toBe("invalid_endpoint");
  expect((await register(base, { name: "Corealm EU", endpoint: "ws://evil.example.com/" })).status).toBe(400);
  expect((await register(base, { name: "Corealm EU", endpoint: "wss://eu.corealm.example/?token=secret" })).status).toBe(400);
  expect((await register(base, { name: "x", endpoint: "wss://eu.corealm.example/" })).status).toBe(400);
  expect((await register(base, { endpoint: "wss://eu.corealm.example/" })).status).toBe(400);

  const missing = await register(base, { name: "Corealm EU", endpoint: "wss://eu.corealm.example/" });
  expect(missing.status).toBe(422);
  expect(await errorCode(missing)).toBe("unreachable");
  expect((await register(base, { name: "A Blog", endpoint: "wss://blog.example.com/" })).status).toBe(422);
  expect((await register(base, { name: "Nowhere", endpoint: "wss://offline.example.com/" })).status).toBe(422);
  expect(asked).toContain("https://offline.example.com/worlds");

  // A redirect is never followed: the address check covered the submitted host, not the next one.
  const moved = await register(base, { name: "Moved Realm", endpoint: "wss://moved.example.com/" });
  expect(moved.status).toBe(422);
  expect(await errorCode(moved)).toBe("unreachable");
  expect(await (await fetch(`${base}/servers`)).json()).toEqual({ servers: [] });
});

it("never connects to an endpoint that resolves inside the network", async () => {
  const { probe, asked } = worldProbe({ "https://internal.example.com/worlds": { status: 200, body: "[]" } });
  const resolved = resolver({
    "internal.example.com": ["192.168.1.10"],
    "router.example.com": ["10.0.0.1"],
    "metadata.example.com": ["169.254.169.254"],
    "cgnat.example.com": ["100.64.0.1"],
    "corp.example.com": ["172.20.5.9"],
    "mapped.example.com": ["::ffff:10.0.0.7"],
    "ula.example.com": ["fd12:3456::1"],
    "mixed.example.com": ["203.0.113.10", "10.1.2.3"],
    "unknown.example.com": [],
    "127.0.0.1": ["127.0.0.1"],
    "::1": ["::1"],
  });
  const { base } = await startService({ probe, lookup: resolved.lookup, registrationsPerMinute: 50 });

  for (const host of ["internal.example.com", "router.example.com", "metadata.example.com", "cgnat.example.com",
    "corp.example.com", "mapped.example.com", "ula.example.com", "mixed.example.com", "unknown.example.com"]) {
    const refused = await register(base, { name: "Corealm Internal", endpoint: `wss://${host}/` });
    expect(refused.status, host).toBe(422);
    expect(await errorCode(refused), host).toBe("private_endpoint");
  }
  const loopback = await register(base, { name: "Corealm Local", endpoint: "ws://127.0.0.1:4180/" });
  expect(loopback.status).toBe(422);
  expect(await errorCode(loopback)).toBe("private_endpoint");
  expect((await register(base, { name: "Corealm Six", endpoint: "wss://[::1]/" })).status).toBe(422);

  // Refused before anything is fetched, so registration cannot be used to probe the network.
  expect(asked).toEqual([]);
  expect(resolved.asked).toContain("mixed.example.com");
  expect(await (await fetch(`${base}/servers`)).json()).toEqual({ servers: [] });
});

it("rate limits registration by source address", async () => {
  const { probe } = worldProbe({ "https://eu.corealm.example/worlds": { status: 200, body: "[]" } });
  const { base } = await startService({ probe, registrationsPerMinute: 2 });
  const body = { name: "Corealm EU", endpoint: "wss://eu.corealm.example/" };
  expect((await register(base, body)).status).toBe(200);
  expect((await register(base, body)).status).toBe(200);
  const limited = await register(base, body);
  expect(limited.status).toBe(429);
  expect(await errorCode(limited)).toBe("rate_limited");
});

it("lists a loopback host only when private registration is switched on", async () => {
  const { probe } = worldProbe({ "http://127.0.0.1:4180/worlds": { status: 200, body: "[]" } });
  const { clock, base } = await startService({ probe, lookup: resolver({ "127.0.0.1": ["127.0.0.1"] }).lookup, allowPrivateServers: true });

  expect((await register(base, { name: "Corealm Local", endpoint: "ws://127.0.0.1:4180/" })).status).toBe(200);
  expect(await (await fetch(`${base}/servers`)).json()).toEqual({ servers: [
    { name: "Corealm Local", endpoint: "ws://127.0.0.1:4180/", registeredAt: clock.unix, lastSeenAt: clock.unix },
  ] });
});

describe("address classification", () => {
  it("names every form the directory refuses", () => {
    for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1",
      "172.31.255.255", "192.168.1.1", "224.0.0.1", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:192.168.0.1", "::ffff:10.0.0.7", "not-an-address", ""]) {
      expect(privateAddress(address), address).toBe(true);
    }
    for (const address of ["203.0.113.10", "8.8.8.8", "172.32.0.1", "172.15.0.1", "100.128.0.1", "1.1.1.1",
      "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
      expect(privateAddress(address), address).toBe(false);
    }
  });
});
