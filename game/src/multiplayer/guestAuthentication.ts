import { SessionFailure } from "./protocol.js";
import type { AuthenticationAdapter } from "./referenceServer.js";

/**
 * Guests name themselves with a `guest:<name>` token, for LAN, offline and development servers.
 * The player id keeps the `guest:` prefix. An account id starts `acc_` and has no colon, so no
 * guest name can claim an account's character on a server that later turns accounts on.
 */
export const guestAuthentication: AuthenticationAdapter = {
  authentication: "guest",
  async authenticate(token) {
    if (typeof token !== "string" || !/^guest:[A-Za-z0-9_.-]{1,40}$/.test(token)) throw new SessionFailure("UNAUTHORIZED", "A valid guest name is required");
    return { playerId: token, name: token.slice(6) };
  },
};
