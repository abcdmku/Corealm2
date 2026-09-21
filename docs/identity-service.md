# Identity service

One identity service serves a whole Corealm. It owns accounts and login, signs the short-lived join tokens that game servers verify, and publishes the directory of public game servers. Game servers own player data, roles and bans; the identity service knows nothing about either.

Source lives in `identity/src`. The entry point is `tools/identity-server.ts`, run with `npm run identity`. It uses `node:http`, `node:sqlite` and `node:crypto` and has no dependencies.

## What it does

- An account is a username and a password. The username is the display name: 3 to 24 characters of `A-Z a-z 0-9 _ -`, unique without regard to case, stored with the case it was typed in.
- **A password is typed on this origin and nowhere else.** The service serves its own sign-in, registration and password pages. The game client and devdocs never see a password, never hold one, and have no endpoint to send one to.
- A browser session is a bearer token, not a cookie: the game client and devdocs are static apps on other origins. The service stores only a SHA-256 hash of each session token, so a copy of the database cannot be used to sign in.
- A password is stored as scrypt with a per-account salt. The hash is never sent anywhere, and a password never appears in a log line or in a re-rendered form.
- A join token is signed with Ed25519 and lives for 60 seconds. It names the exact game server it may be used against.
- A game server verifies join tokens offline from the published keys, so a join makes no call to this service.

## Pages

These three are HTML, served by this service, and they are the only places a password is ever typed. Each one names the site the session is about to be handed to — "Signing in to continue to `https://play.example.com`" — because that is the one thing a player cannot check for themselves.

| Method and path | Purpose |
| --- | --- |
| `GET /login?return=<url>` | The sign-in form, with a link to registration when it is open. |
| `POST /login` | `application/x-www-form-urlencoded` with `state`, `username`, `password`. |
| `GET /register?return=<url>` | The registration form, or a "registration is closed" page with status 403. |
| `POST /register` | `state`, `username`, `password`. |
| `GET /password?return=<url>` | Change a password: username, current password, new password. |
| `POST /password` | `state`, `username`, `current`, `password`. |

`return` must be on the allowed origin list. A success answers `303 See Other` to `return#session=…`, exactly as the OAuth callback used to, so the game client's half of the round trip did not change. A failure re-renders the same form with one message and a fresh `state`.

The pages carry no JavaScript and load nothing from anywhere, which is what lets them be served under `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self' <return origin>; frame-ancestors 'none'; base-uri 'none'`, with `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Every value interpolated into a page is HTML-escaped. A page with no form on it — an expired form, a closed registration — gets a bare `form-action 'self'`; a form page adds the return origin it was built for, because Chromium applies `form-action` to the redirect a submission ends on and would otherwise block the 303 that carries the session home.

Each form carries a single-use `state`, valid for 15 minutes, bound to the `return` URL that was validated when the form was built. A POST without a valid state is refused, and the redirect target is read from that state row and checked against the allow-list again — never taken from the body. A POST must also be same-origin, so another site cannot post its own form here and sign a player into an account they did not choose. That check reads `Sec-Fetch-Site` first: `Referrer-Policy: no-referrer` makes a browser send `Origin: null` on these submissions, by the letter of the Fetch standard, so `Origin` alone would refuse every real sign-in. A named `Origin` still has to match, and a browser that sends neither header is refused.

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | none | Liveness. `{"ok":true}`. |
| `GET /.well-known/corealm-keys.json` | none | Published Ed25519 verification keys. CORS `*`, cached for 60 seconds. |
| `GET /account` | bearer | `{"id","name"}`. |
| `POST /account/name` | bearer | `{"name"}`. Renames. 409 when the name is taken, 400 when it is reserved. Rate limited per account. |
| `POST /logout` | bearer | Revokes this session immediately. |
| `POST /logout/all` | bearer | Revokes every session for the account and returns `{"ok":true,"revoked":<count>}`. Use it when a token leaks. |
| `POST /token` | bearer | `{"audience":"<game server endpoint>"}` returns `{"token","expiresAt"}`. Rate limited per account. |
| `GET /servers` | none | Public directory: `{"servers":[{name,endpoint,description?,registeredAt,lastSeenAt}]}`. CORS `*`. |
| `POST /servers/register` | none | `{"name","endpoint","description?"}` from a game server. Also the heartbeat. Rate limited per IP. |

Errors are `{"error":{"code","message"}}` with a matching HTTP status. Every event writes one JSON line to stdout. Passwords, tokens and session values are never logged, and a refused sign-in logs neither the name that was tried nor the address that tried it.

Cross-origin requests are answered only for origins on the allow-list, matched exactly, and no credentials header is sent: the session travels in `Authorization: Bearer`.

A rename is a bearer call from the game origin, so it asks for no password — a password must not travel to an origin that is not this one. It is rate limited like a sign-in instead.

### Login result

The form redirects to the `return` URL with the result in the fragment, because a fragment is not sent to servers or leaked in a `Referer` header:

```
https://play.example.com/play#session=<token>&expiresAt=<unix>&account=acc_...&name=Rook
```

Sessions last 30 days. The web app should strip the fragment after reading it and store the token itself. A wrong password never produces a redirect: it is answered on the form, on this origin.

A password change hands back a session the same way, and revokes every session the account had before it — a password change is what someone does when they think a session leaked.

## Reserved names

`admin`, `administrator`, `moderator`, `owner`, `system`, `server`, `corealm`, `support`, `staff`, `guest`, `local`, `root`, `null`, `undefined`. Compared without case, refused at registration and at rename. The list is deliberately short: it covers the words the service itself speaks with and the ones that would let a player pass for staff.

## Passwords

- Stored as `scrypt$N$r$p$<salt base64url>$<hash base64url>`. The parameters are in the string, so raising them later is a one-line change and old hashes keep verifying until their owner next signs in, which rewrites them at the new cost.
- Defaults: N = 131072 (2^17), r = 8, p = 1, a 16-byte random salt per account and a 64-byte key. That is roughly 128 MiB and a tenth of a second per hash.
- Hashing is always the asynchronous `crypto.scrypt`, never `scryptSync`, so a sign-in does not stop the event loop. Verification uses `timingSafeEqual`.
- An unknown username costs exactly what a known one does: it runs a real scrypt at the current parameters against a decoy, and the refusal is byte for byte the same page with the same status. An account migrated from OAuth, which has no password yet, takes the same path.
- Scrypt work runs through a queue: four hashes at once, a backlog of 32, and a `503` past that. Without the bound, a flood of sign-ins is a memory exhaustion lever rather than a rate limit problem.
- Policy: 10 to 256 characters counted as code points, not equal to the username, and not one of about a hundred passwords inlined in `identity/src/passwords.ts` that lead every credential dump. No composition rules. Passwords are normalised with NFKC before hashing, so a password typed with a ligature or a full-width digit still matches.

## Limits

In-memory fixed windows, like the rest of the service. Nothing here ever locks an account permanently: a lock that anyone can trigger by knowing a name is a denial of service lever, so the punishment is always a window that runs out on its own.

| What | Default | Window |
| --- | --- | --- |
| Sign-in attempts per username | 10 | 15 minutes, cleared by a sign-in that works |
| Sign-in attempts per address | 30 | 15 minutes |
| Registrations per address | 5 | 1 hour |
| Registrations in total | 60 | 1 hour |
| Join tokens per account | 60 | 1 minute |
| Directory registrations per address | 10 | 1 minute |

Per-address limits are keyed on the socket peer, which behind a reverse proxy is the proxy: put per-IP limits in the proxy as well. `--trust-proxy` makes the service read the first entry of `X-Forwarded-For` instead. Only set it with a proxy you run in front that overwrites that header, because otherwise every limit here can be evaded with one forged header.

`--registration closed` turns registration off: `GET /register` answers 403 with a plain page, the sign-in page stops offering the link, and accounts are made with the operator tool.

## The operator tool

There is no email in Corealm, so there is no self-service password reset. A player who forgets their password asks whoever runs the service:

```sh
npx tsx tools/identity-admin.ts --data identity-data list
npx tsx tools/identity-admin.ts --data identity-data set-password Rook
```

| Command | What it does |
| --- | --- |
| `list` | Every account, whether it has a password, and when it was created. |
| `create <name>` | A new account. The way to add players with registration closed. |
| `set-password <name>` | Replaces the password and signs that account out everywhere. |
| `claim <name>` | Sets the first password on an account that has none, which is what a migrated account is. |
| `delete <name>` | Removes the account and its sessions. The name is free again afterwards. |
| `revoke-sessions <name>` | Signs that account out everywhere, keeping the password. |

The password is read from the terminal without echoing, or from stdin when the command is piped, and never from an argument: arguments end up in shell history and in every process listing on the machine. Operator passwords pass the same policy a player's does.

The database is in WAL mode, so the tool may run while the service is up; SQLite serializes the writes, which are short. `delete` is the one worth stopping the service for, because a player holding a session for that account will otherwise see it fail mid-play.

## Migrating a database from the OAuth service

The store carries a `schema_version` table and migrates forward on open. Version 1 is this change:

- `account_providers` is dropped, along with `/login/<provider>`, `/callback/<provider>` and `/account/link/*`.
- Accounts keep their id, their name and their creation date, and gain an empty password. An account in that state is **unclaimed**: nobody can sign in to it, and nobody can register that name either, so a migrated player does not lose their name to whoever asks first. An operator turns it back into an account with `identity-admin claim <name>`.
- Login states are dropped. They live minutes, so nothing is lost.
- Signing keys, sessions and the server directory are untouched. Sessions issued before the migration keep working until they expire.

## How the game client uses it

The client's half is `game/src/multiplayer/identityClient.ts`.

The service address is a property of the **page**, never of a world: `window.__COREALM_IDENTITY_URL__`, or `VITE_COREALM_IDENTITY_URL` baked into the build, read and validated by `identityUrl()` in `game/src/app/config.ts`. A game server naming its own identity service could name a lookalike and harvest sessions, so a descriptor never gets a say. With no address configured, worlds whose descriptor says `"authentication":"account"` show as **Login unavailable** and cannot be selected; guest worlds and local play are unaffected.

For GitHub Pages, `docs.yml` reads the repository variable `COREALM_IDENTITY_URL` into `VITE_COREALM_IDENTITY_URL`. Set it to an identity origin such as `https://identity.example.com/` before the Game and guide builds. The identity service's allowed origins must include the Pages origin. Enable `registerWithDirectory` on each game server so fresh clients can discover its worlds through the directory.

Signing in leaves the page for `GET /login?return=<this page, minus its fragment>`, and **Change password** leaves it for `GET /password?return=…`. The password is typed there. On the way back the client reads `session`, `expiresAt`, `account` and `name` out of the fragment and rewrites the address bar with `history.replaceState` in the same step, so no session token stays in the URL, in the history or in a `Referer`. The session then lives in `localStorage` under one key, `corealm.identity.v1`, with the expiry the service reported. An expired entry is dropped without being sent, and any `401` clears it and returns the player to signed out.

Join tokens are never stored. `WorldProvider.authenticate` calls `joinToken(world.endpoint)` for every join attempt, including each automatic reconnect, because a token lasts 60 seconds and is single use. Guest worlds keep taking `guest:<name>` and need no session at all.

The picker also reads `GET /servers` when an address is configured, and offers those servers next to the configured host and the ones the player added. Each listed server's worlds still come from its own `/worlds`. A directory that does not answer is ignored quietly.

## Join tokens

A join token is a compact JWS. Both sides use `identity/src/joinToken.ts`; nothing else may re-implement it.

```
base64url(header) "." base64url(payload) "." base64url(signature)

header  {"alg":"EdDSA","typ":"corealm-join","kid":"<key id>"}
payload {"sub":"<account id>","name":"<display name>","aud":"<audience>","iat":<unix>,"exp":<iat+60>,"jti":"<token id>"}
```

The signature is Ed25519 over the ASCII bytes of `header.payload`.

The **audience** is the game server's public endpoint reduced to an origin by `audienceOf()`: `ws:` maps to `http:` and `wss:` to `https:`, so `wss://play.example.com/` and `https://play.example.com` both give `https://play.example.com`. The client asks for a token for the server it is about to join, and the server refuses any token minted for another audience. That is what stops a hostile host from replaying a token elsewhere.

`verifyJoinToken(token, { keys, audience, now })` returns either `{ok:true, claims}` or `{ok:false, reason}` where the reason is one of `malformed`, `unknown-key`, `bad-signature`, `wrong-audience`, `expired` or `not-yet-valid`. `unknown-key` is the only reason that should make a game server refetch the key document. Verification rejects any `alg` other than `EdDSA`, tokens over 4096 characters, non-canonical base64url, missing or extra claims, and a lifetime over 60 seconds. Clocks may differ by five seconds.

## Keys and rotation

`GET /.well-known/corealm-keys.json`:

```json
{"keys":[{"kid":"a7-IcrzsHn09","alg":"EdDSA","publicKey":"<base64url 32 bytes>","status":"active"}]}
```

The active key is always first. One key signs; retired keys stay published until every token they signed has expired, then the service deletes them an hour after retirement. Keys are generated on first start and stored in the service database. Private keys never leave the data directory and are never served.

To rotate, restart the service with `--rotate-key`. The old key becomes `retired` but keeps verifying, so joins in flight succeed. Wait for game servers to pick up the new document before assuming the old key is gone; they refetch on an unknown key id, and the document is cached for 60 seconds.

## Server directory

A game server registers itself with `POST /servers/register` and re-registers as a heartbeat. The endpoint must be a `wss:` URL, or a loopback `ws:` URL when private registration is switched on. An entry that has not re-registered in ten minutes drops off the list. The list is capped and registration is rate limited per source address.

Registration makes the service fetch a URL that an anonymous caller chose, so it is checked in two steps before anything connects:

1. The endpoint's hostname is resolved and every returned address must be public unicast. Loopback, `0.0.0.0/8`, `10/8`, `100.64/10`, `169.254/16`, `172.16/12`, `192.168/16`, multicast, `::1`, `fc00::/7`, `fe80::/10` and the IPv4-mapped forms of any of those are refused with `private_endpoint`. A name that resolves to both a public and a private address is refused outright.
2. The service then fetches `GET /worlds` on the matching `https:` origin, with a four second timeout and a 256 KiB cap, and requires a JSON array. Redirects are not followed; a 3xx is a failed probe, because the address check applied to the submitted host and not to wherever it points.

The address check runs at registration time, so a name that resolves publicly during the check and privately a moment later is not covered; a real defence against DNS rebinding would have to pin the checked address for the connection itself.

`--allow-private-servers` (or `COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS=1`) skips step 1 so a LAN or loopback game server can be listed while developing. It requires a loopback listener and must never be set on a public deployment.

## Configuration

Flags override environment variables. There are no secrets to configure: the service holds passwords, it is not given any.

| Variable | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `COREALM_IDENTITY_HOST` | `--host` | `127.0.0.1` | Listen address. |
| `COREALM_IDENTITY_PORT` | `--port` | `4190` | Listen port. `0` is loopback only. |
| `COREALM_IDENTITY_PUBLIC_URL` | `--public-url` | loopback only | Public origin, for example `https://id.example.com`. Required when the listener is not loopback. Must be a bare origin and HTTPS. |
| `COREALM_IDENTITY_DATA` | `--data` | `identity-data` | Directory holding `identity.sqlite`. |
| `COREALM_IDENTITY_ORIGINS` | `--origins` | none | Comma-separated exact origins for the game and devdocs. Required. These are both the CORS allow-list and the `return` allow-list. |
| `COREALM_IDENTITY_REGISTRATION` | `--registration` | `open` | `open` or `closed`. Closed means accounts come from `identity-admin` only. |
| `COREALM_IDENTITY_TRUST_PROXY` | `--trust-proxy` | off | Read `X-Forwarded-For` for per-address limits. Only with a proxy you run in front. |
| — | `--rotate-key` | off | Retire the current signing key at start and sign with a new one. |
| `COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS` | `--allow-private-servers` | off | Development only. Lets a loopback or private game server into the directory. Requires a loopback listener. |

```sh
npm run identity -- --origins http://127.0.0.1:4173 --port 4190
```

## Deployment

- **Terminate TLS in front of the service.** The public URL must be HTTPS, and the service refuses to start with a public HTTP one: a password crosses the network to this origin, and a session token in a fragment must not cross it in the clear either.
- Set `--trust-proxy` only when the proxy overwrites `X-Forwarded-For`, and keep per-IP limits in the proxy regardless.
- The service binds loopback by default. Keep it that way behind a proxy and let the proxy hold the certificate.
- Back up the data directory. Losing it loses every account, and every join token key with it.
- Only the service account needs read access to the data directory. It holds the signing private keys and every password hash.
- Sessions last 30 days and are revocable one at a time with `POST /logout`, all at once with `POST /logout/all`, or from outside with `identity-admin revoke-sessions`.
- A hash at the default parameters wants about 128 MiB while it runs, and four may run at once, so size the host for roughly 512 MiB of headroom on top of everything else.
- The service is a single process with one SQLite file. It is small by design: one instance is enough for a Corealm, and two instances must not share a data directory.
