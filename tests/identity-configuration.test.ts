import { describe, expect, it } from "vitest";
import { identityConfiguration } from "../identity/src/configuration.js";

const secrets = {
  COREALM_IDENTITY_DISCORD_CLIENT_ID: "discord-id", COREALM_IDENTITY_DISCORD_CLIENT_SECRET: "discord-secret",
};

describe("identity deployment configuration", () => {
  it("defaults to a loopback development service with one provider", () => {
    const config = identityConfiguration(["--origins", "http://127.0.0.1:5173"], secrets);
    expect(config).toMatchObject({ host: "127.0.0.1", port: 4190, publicUrl: "http://127.0.0.1:4190", dataDir: "identity-data", rotateKey: false });
    expect(config.allowPrivateServers).toBe(false);
    expect(config.providers.map(provider => provider.name)).toEqual(["discord"]);
    expect(config.providers[0]!.authorizeUrl("state-1", "http://127.0.0.1:4190/callback/discord", "challenge-1"))
      .toBe("https://discord.com/oauth2/authorize?client_id=discord-id&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A4190%2Fcallback%2Fdiscord&scope=identify&prompt=none&state=state-1&code_challenge=challenge-1&code_challenge_method=S256");
  });

  it("requires credentials in pairs and at least one provider", () => {
    expect(() => identityConfiguration(["--origins", "https://play.example.com"], {})).toThrow(/Discord or GitHub/);
    expect(() => identityConfiguration(["--origins", "https://play.example.com"], { COREALM_IDENTITY_GITHUB_CLIENT_ID: "only-an-id" }))
      .toThrow(/GitHub needs both/);
    const both = identityConfiguration(["--origins", "https://play.example.com"], {
      ...secrets, COREALM_IDENTITY_GITHUB_CLIENT_ID: "github-id", COREALM_IDENTITY_GITHUB_CLIENT_SECRET: "github-secret",
    });
    expect(both.providers.map(provider => provider.name)).toEqual(["discord", "github"]);
    expect(both.providers.map(provider => provider.pkce)).toEqual([true, false]);
  });

  it("holds public hosting to HTTPS, exact origins and a bare public URL", () => {
    const remote = { ...secrets, COREALM_IDENTITY_HOST: "0.0.0.0", COREALM_IDENTITY_PUBLIC_URL: "https://id.example.com", COREALM_IDENTITY_ORIGINS: "https://play.example.com, https://docs.example.com" };
    expect(identityConfiguration([], remote)).toMatchObject({ publicUrl: "https://id.example.com", allowedOrigins: ["https://play.example.com", "https://docs.example.com"] });
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: undefined })).toThrow(/public HTTPS URL/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: "http://id.example.com" })).toThrow(/HTTPS/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: "https://id.example.com/auth" })).toThrow(/bare origin/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "https://play.example.com/" })).toThrow(/exact HTTPS origins/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "*" })).toThrow();
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "" })).toThrow(/--origins/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PORT: "0" })).toThrow(/Ephemeral/);
    // A loopback test run binds an ephemeral port, so the public URL waits until it has one.
    expect(identityConfiguration(["--port", "0", "--origins", "http://127.0.0.1:5173"], secrets)).toMatchObject({ port: 0, publicUrl: "" });
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PORT: "70000" })).toThrow(/Port/);
    expect(() => identityConfiguration(["--port"], remote)).toThrow(/--port requires a value/);
    // Private directory entries are a development convenience and never a public deployment.
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173", "--allow-private-servers"], secrets).allowPrivateServers).toBe(true);
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173"], { ...secrets, COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS: "true" }).allowPrivateServers).toBe(true);
    expect(() => identityConfiguration(["--allow-private-servers"], remote)).toThrow(/development option/);
  });
});
