import { resolve } from "node:path";
import { runAdminCommand, ADMIN_USAGE } from "../identity/src/admin.js";
import { IdentityStore } from "../identity/src/store.js";

/**
 * Operator commands against an identity database: `npx tsx tools/identity-admin.ts --data identity-data list`.
 *
 * This is where a forgotten password is reset, because the service has no email to send one to. The
 * password is read from the terminal without echoing, or from stdin when this is piped, and never
 * from the command line: arguments end up in shell history and in every process listing on the box.
 */

const args = process.argv.slice(2);
const flag = args.indexOf("--data");
if (flag >= 0 && (!args[flag + 1] || args[flag + 1]!.startsWith("--"))) { console.log("--data requires a directory"); process.exit(1); }
const dataDir = flag >= 0 ? args[flag + 1]! : process.env.COREALM_IDENTITY_DATA ?? "identity-data";
const rest = args.filter((_, index) => index !== flag && index !== flag + 1);
if (!rest.length) { console.log(ADMIN_USAGE); process.exit(1); }

/** Piped input hands out one line per prompt; a terminal reads the keys without printing them. */
function secretReader(): (prompt: string) => Promise<string> {
  let piped: Promise<string[]> | null = null;
  return async prompt => {
    if (!process.stdin.isTTY) {
      piped ??= new Promise<string[]>((done, fail) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk => chunks.push(chunk as Buffer));
        process.stdin.on("end", () => done(Buffer.concat(chunks).toString("utf8").split(/\r?\n/)));
        process.stdin.on("error", fail);
      });
      return (await piped).shift() ?? "";
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    return new Promise<string>(done => {
      let value = "";
      const finish = (result: string) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        done(result);
      };
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") { finish(value); return; }
          if (character === "") { finish(""); process.exit(130); }
          if (character === "" || character === "\b") { value = value.slice(0, -1); continue; }
          if (character >= " ") value += character;
        }
      };
      process.stdin.on("data", onData);
    });
  };
}

const store = new IdentityStore(`${resolve(dataDir)}/identity.sqlite`);
let code = 1;
try {
  code = await runAdminCommand(store, rest, { secret: secretReader(), out: line => console.log(line) });
} finally {
  store.close();
}
process.exit(code);
