import { passwordProblem, ScryptHasher, type PasswordHashing } from "./passwords.js";
import { NAME_PATTERN, reservedName, type IdentityStore } from "./store.js";

/**
 * The operator's half of the identity service.
 *
 * There is no email in Corealm, so there is no self-service password reset: a player who forgets
 * their password asks whoever runs the service, and the answer is `set-password`. The same tool
 * claims the accounts that came over from the OAuth service, which have a name and no credential.
 *
 * It talks to the same SQLite file the service uses, which is in WAL mode, so it may run while the
 * service is up: writes are short and serialized by SQLite. `delete` is the one command worth
 * stopping the service for, because a player holding a session will otherwise see it fail mid-play.
 */

export interface AdminPorts {
  /** Reads a password without echoing it. Never an argument: a shell would keep that in its history. */
  secret(prompt: string): Promise<string>;
  out(line: string): void;
  hasher?: PasswordHashing;
  now?: () => number;
}

export const ADMIN_USAGE = `Usage: tsx tools/identity-admin.ts --data <dir> <command>

  list                    Every account, whether it has a password, and when it was created
  create <name>           A new account; the password is read from stdin
  set-password <name>     Replaces the password and signs that account out everywhere
  claim <name>            Sets the first password on an account that has none
  delete <name>           Removes the account and its sessions
  revoke-sessions <name>  Signs that account out everywhere, keeping the password`;

/** Returns the process exit code. Every failure is one line on stdout, not an exception. */
export async function runAdminCommand(store: IdentityStore, args: readonly string[], ports: AdminPorts): Promise<number> {
  const [command, name] = args;
  const now = ports.now ?? (() => Math.floor(Date.now() / 1000));
  const hasher = ports.hasher ?? new ScryptHasher();
  if (!command || command === "help" || command === "--help") { ports.out(ADMIN_USAGE); return command ? 0 : 1; }

  if (command === "list") {
    const accounts = store.listAccounts();
    if (!accounts.length) { ports.out("No accounts yet."); return 0; }
    for (const account of accounts) {
      ports.out(`${account.name.padEnd(24)} ${account.id}  ${account.claimed ? "password" : "UNCLAIMED"}  created ${new Date(account.createdAt * 1000).toISOString().slice(0, 10)}`);
    }
    ports.out(`${accounts.length} account${accounts.length === 1 ? "" : "s"}, ${accounts.filter(account => !account.claimed).length} unclaimed.`);
    return 0;
  }

  if (!["create", "set-password", "claim", "delete", "revoke-sessions"].includes(command)) { ports.out(`Unknown command: ${command}\n\n${ADMIN_USAGE}`); return 1; }
  if (!name) { ports.out(`${command} needs an account name.`); return 1; }

  if (command === "create") {
    if (!NAME_PATTERN.test(name)) { ports.out("A username is 3 to 24 characters of letters, digits, underscore or hyphen."); return 1; }
    if (reservedName(name)) { ports.out(`${name} is a reserved name.`); return 1; }
    if (store.accountByName(name)) { ports.out(`${name} already exists.`); return 1; }
    const password = await readPassword(ports, name);
    if (!password.ok) { ports.out(password.problem); return 1; }
    const account = store.createAccount(name, await hasher.hash(password.value), now());
    if (!account) { ports.out(`${name} already exists.`); return 1; }
    ports.out(`Created ${account.name} (${account.id}).`);
    return 0;
  }

  const account = store.accountByName(name);
  if (!account) { ports.out(`No account named ${name}.`); return 1; }

  if (command === "claim" && account.claimed) { ports.out(`${account.name} already has a password. Use set-password to replace it.`); return 1; }

  if (command === "set-password" || command === "claim") {
    const password = await readPassword(ports, account.name);
    if (!password.ok) { ports.out(password.problem); return 1; }
    store.setPassword(account.id, await hasher.hash(password.value));
    const revoked = store.revokeAllSessions(account.id);
    ports.out(`Set the password for ${account.name} (${account.id}) and revoked ${revoked} session${revoked === 1 ? "" : "s"}.`);
    return 0;
  }

  if (command === "revoke-sessions") {
    const revoked = store.revokeAllSessions(account.id);
    ports.out(`Revoked ${revoked} session${revoked === 1 ? "" : "s"} for ${account.name}.`);
    return 0;
  }

  store.deleteAccount(account.id);
  ports.out(`Deleted ${account.name} (${account.id}). The name is free again.`);
  return 0;
}

async function readPassword(ports: AdminPorts, username: string): Promise<{ ok: true; value: string } | { ok: false; problem: string }> {
  const value = await ports.secret(`New password for ${username}: `);
  const problem = passwordProblem(value, username);
  return problem ? { ok: false, problem } : { ok: true, value };
}
