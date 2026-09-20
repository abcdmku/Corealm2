# Identity service

One identity service serves a whole Corealm. It owns accounts and login, signs the short-lived join tokens that game servers verify, and publishes the directory of public game servers. Game servers own player data, roles and bans; the identity service knows nothing about either.

Source lives in `identity/src`. The entry point is `tools/identity-server.ts`, run with `npm run identity`. It uses `node:http`, `node:sqlite` and `node:crypto` and has no dependencies.

## What it does

- Login is OAuth only, with Discord and GitHub as the first providers. No passwords are entered, transmitted or stored.
- An account has a stable id (`acc_` plus 22 characters of randomness), a display name that is unique case-insensitively, and one or more linked provider identities.
- A browser session is a bearer token, not a cookie: the game client and devdocs are static apps on other origins. The service stores only a SHA-256 hash of each session token, so a copy of the database cannot be used to sign in.
- A join token is signed with Ed25519 and lives for 60 seconds. It names the exact game server it may be used against.
- A game server verifies join tokens offline from the published keys, so a join makes no call to this service.

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | none | Liveness. `{"ok":true}`. |
| `GET /.well-known/corealm-keys.json` | none | Published Ed25519 verification keys. CORS `*`, cached for 60 seconds. |
| `GET /login/<provider>?return=<url>` | none | Starts login. Redirects to the provider. `return` must be on the allowed origin list. |
| `GET /callback/<provider>?code&state` | none | Provider redirect target. Redirects back to `return` with the result in the URL fragment. |
| `GET /account` | bearer | `{"id","name","providers":[...]}`. |
| `POST /account/name` | bearer | `{"name"}`. Renames. 409 when the name is taken. |
| `POST /account/link/<provider>` | bearer | `{"return"}` returns `{"url"}` to send the browser to, which links a second provider to this account. |
| `POST /logout` | bearer | Revokes this session immediately. |
| `POST /logout/all` | bearer | Revokes every session for the account and returns `{"ok":true,"revoked":<count>}`. Use it when a token leaks. |
| `POST /token` | bearer | `{"audience":"<game server endpoint>"}` returns `{"token","expiresAt"}`. Rate limited per account. |
| `GET /servers` | none | Public directory: `{"servers":[{name,endpoint,description?,registeredAt,lastSeenAt}]}`. CORS `*`. |
| `POST /servers/register` | none | `{"name","endpoint","description?"}` from a game server. Also the heartbeat. Rate limited per IP. |

Errors are `{"error":{"code","message"}}` with a matching HTTP status. Every event writes one JSON line to stdout. Tokens, session values and client secrets are never logged.

Cross-origin requests are answered only for origins on the allow-list, matched exactly, and no credentials header is sent: the session travels in `Authorization: Bearer`.

### Login result

The callback redirects to the `return` URL with the result in the fragment, because a fragment is not sent to servers or leaked in a `Referer` header:

```
https://play.example.com/play#session=<token>&expiresAt=<unix>&account=acc_...&name=Rook
```

A refused login returns `#error=access_denied`, `#error=exchange_failed` or `#error=provider_already_linked` instead. A successful link returns `#linked=<provider>`. Sessions last 30 days. The web app should strip the fragment after reading it and store the token itself.

## How the game client uses it

The client's half is `game/src/multiplayer/identityClient.ts`.

The service address is a property of the **page**, never of a world: `window.__COREALM_IDENTITY_URL__`, or `VITE_COREALM_IDENTITY_URL` baked into the build, read and validated by `identityUrl()` in `game/src/app/config.ts`. A game server naming its own identity service could name a lookalike and harvest sessions, so a descriptor never gets a say. With no address configured, worlds whose descriptor says `"authentication":"account"` show as **Login unavailable** and cannot be selected; guest worlds and local play are unaffected.

Signing in leaves the page for `GET /login/<provider>?return=<this page, minus its fragment>`. On the way back the client reads `session`, `expiresAt`, `account` and `name` out of the fragment and rewrites the address bar with `history.replaceState` in the same step, so no session token stays in the URL, in the history or in a `Referer`. The session then lives in `localStorage` under one key, `corealm.identity.v1`, with the expiry the service reported. An expired entry is dropped without being sent, and any `401` clears it and returns the player to signed out.

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

Flags override environment variables. Secrets are environment variables only, never flags, so they stay out of shell history and process listings.

| Variable | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `COREALM_IDENTITY_HOST` | `--host` | `127.0.0.1` | Listen address. |
| `COREALM_IDENTITY_PORT` | `--port` | `4190` | Listen port. `0` is loopback only. |
| `COREALM_IDENTITY_PUBLIC_URL` | `--public-url` | loopback only | Public origin, for example `https://id.example.com`. Required when the listener is not loopback. Must be a bare origin and HTTPS. |
| `COREALM_IDENTITY_DATA` | `--data` | `identity-data` | Directory holding `identity.sqlite`. |
| `COREALM_IDENTITY_ORIGINS` | `--origins` | none | Comma-separated exact origins for the game and devdocs. Required. These are both the CORS allow-list and the `return` allow-list. |
| `COREALM_IDENTITY_DISCORD_CLIENT_ID` | — | none | Discord application client id. |
| `COREALM_IDENTITY_DISCORD_CLIENT_SECRET` | — | none | Discord client secret. |
| `COREALM_IDENTITY_GITHUB_CLIENT_ID` | — | none | GitHub OAuth app client id. |
| `COREALM_IDENTITY_GITHUB_CLIENT_SECRET` | — | none | GitHub client secret. |
| — | `--rotate-key` | off | Retire the current signing key at start and sign with a new one. |
| `COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS` | `--allow-private-servers` | off | Development only. Lets a loopback or private game server into the directory. Requires a loopback listener. |

At least one provider must be configured, and each provider needs both halves of its credentials.

```sh
COREALM_IDENTITY_DISCORD_CLIENT_ID=... COREALM_IDENTITY_DISCORD_CLIENT_SECRET=... \
npm run identity -- --origins http://127.0.0.1:4173 --port 4190
```

## Creating the OAuth apps

Discord, at <https://discord.com/developers/applications>:

1. Create an application, then open **OAuth2**.
2. Add the redirect `https://id.example.com/callback/discord`, matching your public URL exactly.
3. Copy the client id and generate a client secret into the environment. The service asks for the `identify` scope only and uses PKCE.

GitHub, at <https://github.com/settings/developers> under **OAuth Apps**:

1. Register a new application with any homepage URL.
2. Set the authorization callback URL to `https://id.example.com/callback/github`.
3. Copy the client id and generate a client secret into the environment. The service asks for the `read:user` scope only. GitHub OAuth apps do not support PKCE, so the `state` value carries the whole binding there.

For local development, point both redirects at your loopback URL, such as `http://127.0.0.1:4190/callback/discord`.

## Deployment

- Terminate TLS in front of the service and pass requests through to it. The public URL must be HTTPS because OAuth providers refuse plain-HTTP redirects and a session token in a fragment must not cross the network in the clear.
- The service binds loopback by default. Keep it that way behind a proxy and let the proxy hold the certificate.
- Back up the data directory. Losing it loses every account, and every join token key with it.
- Only the service account needs read access to the data directory. It holds the signing private keys.
- Rate limits are in-memory and keyed on the socket peer address, which behind a proxy is the proxy. Put per-IP limits in the proxy as well.
- Sessions last 30 days and are revocable one at a time with `POST /logout` or all at once with `POST /logout/all`.
- The service is a single process with one SQLite file. It is small by design: one instance is enough for a Corealm, and two instances must not share a data directory.
