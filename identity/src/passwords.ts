import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password storage and the rules a password has to pass.
 *
 * Hashing is scrypt from `node:crypto`, always through the callback form so a login never blocks the
 * event loop. A stored hash describes itself — `scrypt$N$r$p$salt$hash` — so the cost can be raised
 * later and old hashes keep verifying until their owner next signs in and gets rehashed.
 *
 * Each hash at the default cost wants about 128 MiB, so the work runs through a small queue: four at
 * a time, a bounded backlog, and a refusal past that. Without it a flood of logins is a memory
 * exhaustion lever rather than a rate limit problem.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer, salt: string | Buffer, keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface ScryptParameters { readonly N: number; readonly r: number; readonly p: number; readonly keyLength: number }

/** N=2^17 with r=8 is roughly 128 MiB and a tenth of a second per hash on a modern core. */
export const DEFAULT_SCRYPT: ScryptParameters = { N: 131_072, r: 8, p: 1, keyLength: 64 };
export const SCRYPT_CONCURRENCY = 4;
export const SCRYPT_QUEUE_LIMIT = 32;
export const SALT_BYTES = 16;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

/** Node needs headroom over the 128·N·r the algorithm itself uses. */
function maxmem(parameters: ScryptParameters): number {
  return 256 * parameters.N * parameters.r + 1_048_576;
}

/** Unicode has several ways to spell the same password; pick one before it is hashed or compared. */
export function normalizePassword(value: string): string { return value.normalize("NFKC"); }

/**
 * The hundred or so passwords that turn up first in every credential dump. Short and inline on
 * purpose: this is a speed bump in front of the worst choices, not a dictionary check.
 */
const COMMON_PASSWORDS = new Set([
  "123456", "123456789", "12345678", "1234567890", "111111", "1234567", "123123", "000000", "121212", "112233",
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword1", "passwords", "mypassword",
  "qwerty", "qwerty123", "qwertyuiop", "qwerty12345", "1q2w3e4r", "1q2w3e4r5t", "qazwsxedc", "zaq12wsx", "asdfghjkl", "zxcvbnm",
  "iloveyou", "princess", "sunshine", "football", "baseball", "superman", "batman", "pokemon", "starwars", "monkey",
  "dragon", "letmein", "welcome", "welcome1", "welcome123", "admin", "admin123", "administrator", "root", "toor",
  "login", "master", "shadow", "killer", "trustno1", "whatever", "freedom", "hello", "hello123", "charlie",
  "michael", "jennifer", "jordan23", "michelle", "daniel", "ashley", "nicole", "hunter2", "thomas", "robert",
  "computer", "internet", "samsung", "google", "facebook", "minecraft", "fortnite", "roblox", "corealm", "corealm123",
  "abc123", "abcd1234", "abcdefg", "a1b2c3d4", "qwe123", "asd123", "test123", "testing123", "changeme", "secret",
  "letmein123", "iloveyou1", "sunshine1", "football1", "summer2024", "summer2025", "winter2024", "spring2024", "august2024", "january2024",
  "11111111", "88888888", "photoshop", "starwars1", "chocolate", "liverpool", "arsenal", "chelsea", "manchester", "superman1",
]);

/**
 * Why this password cannot be used, or null. The message is shown to whoever typed it, so it names
 * the rule that was broken; nothing here depends on another account existing.
 */
export function passwordProblem(password: string, username: string): string | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return `Use a password of at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use a password of at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (normalized.toLowerCase() === username.trim().toLowerCase()) return "Your password cannot be your username.";
  if (COMMON_PASSWORDS.has(normalized.toLowerCase())) return "That is one of the most common passwords. Choose another.";
  return null;
}

/** The queue is full and the process will not start another hash. The service answers 503. */
export class HashingBusy extends Error {
  constructor() { super("Too many sign-ins are being processed"); this.name = "HashingBusy"; }
}

/** Bounded concurrency with a bounded backlog: past both, callers are refused rather than queued. */
class WorkQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly concurrency: number, private readonly backlog: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.backlog) throw new HashingBusy();
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.active++;
    try { return await task(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}

export interface VerifyResult {
  ok: boolean;
  /** True when the stored hash used weaker parameters than the current ones, so it should be rewritten. */
  stale: boolean;
}

export interface PasswordHashing {
  readonly parameters: ScryptParameters;
  hash(password: string): Promise<string>;
  /** A null stored hash still costs a full hash, so an unclaimed or unknown name is not a timing oracle. */
  verify(password: string, stored: string | null): Promise<VerifyResult>;
}

interface StoredHash { parameters: ScryptParameters; salt: Buffer; hash: Buffer }

/** `scrypt$N$r$p$<salt base64url>$<hash base64url>`, parsed defensively: it comes out of a database. */
export function parseStoredHash(stored: string): StoredHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 2 || N > 2 ** 22 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4]!, "base64url"), hash = Buffer.from(parts[5]!, "base64url");
  if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 128) return null;
  return { parameters: { N, r, p, keyLength: hash.length }, salt, hash };
}

export function formatStoredHash(parameters: ScryptParameters, salt: Buffer, hash: Buffer): string {
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export class ScryptHasher implements PasswordHashing {
  readonly parameters: ScryptParameters;
  private readonly queue: WorkQueue;
  /** A real hash to check an unknown username against, so both paths cost the same scrypt run. */
  private readonly decoy: { salt: Buffer; hash: Buffer };
  constructor(options: { parameters?: ScryptParameters; concurrency?: number; queueLimit?: number } = {}) {
    this.parameters = options.parameters ?? DEFAULT_SCRYPT;
    this.queue = new WorkQueue(options.concurrency ?? SCRYPT_CONCURRENCY, options.queueLimit ?? SCRYPT_QUEUE_LIMIT);
    this.decoy = { salt: randomBytes(SALT_BYTES), hash: randomBytes(this.parameters.keyLength) };
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await this.derive(password, salt, this.parameters);
    return formatStoredHash(this.parameters, salt, derived);
  }

  async verify(password: string, stored: string | null): Promise<VerifyResult> {
    const parsed = stored === null ? null : parseStoredHash(stored);
    // An unknown name, an unclaimed account and an unreadable hash all take the decoy path, which
    // runs the same scrypt at the current parameters and can only ever answer false.
    if (!parsed) {
      const derived = await this.derive(password, this.decoy.salt, this.parameters);
      // Compared for its cost only. There is no account behind the decoy, so a match means nothing.
      timingSafeEqual(derived, this.decoy.hash);
      return { ok: false, stale: false };
    }
    const derived = await this.derive(password, parsed.salt, parsed.parameters);
    const ok = derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
    const weaker = parsed.parameters.N < this.parameters.N || parsed.parameters.r < this.parameters.r
      || parsed.parameters.p < this.parameters.p || parsed.parameters.keyLength < this.parameters.keyLength;
    return { ok, stale: ok && weaker };
  }

  private derive(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
    const normalized = normalizePassword(password);
    return this.queue.run(() => scrypt(normalized, salt, parameters.keyLength, {
      N: parameters.N, r: parameters.r, p: parameters.p, maxmem: maxmem(parameters),
    }));
  }
}
