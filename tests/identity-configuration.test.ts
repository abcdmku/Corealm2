import { describe, expect, it } from "vitest";
import { identityConfiguration } from "../identity/src/configuration.js";

describe("identity deployment configuration", () => {
  it("defaults to a loopback development service that takes registrations", () => {
    const config = identityConfiguration(["--origins", "http://127.0.0.1:5173"], {});
    expect(config).toEqual({
      host: "127.0.0.1", port: 4190, publicUrl: "http://127.0.0.1:4190", dataDir: "identity-data",
      allowedOrigins: ["http://127.0.0.1:5173"], registration: "open", trustProxy: false,
      rotateKey: false, allowPrivateServers: false,
    });
  });

  it("switches registration off and trusts a proxy only when told to", () => {
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173", "--registration", "closed"], {}).registration).toBe("closed");
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173"], { COREALM_IDENTITY_REGISTRATION: "closed" }).registration).toBe("closed");
    expect(() => identityConfiguration(["--origins", "http://127.0.0.1:5173", "--registration", "invite"], {})).toThrow(/open or closed/);
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173", "--trust-proxy"], {}).trustProxy).toBe(true);
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173"], { COREALM_IDENTITY_TRUST_PROXY: "1" }).trustProxy).toBe(true);
  });

  it("holds public hosting to HTTPS, exact origins and a bare public URL", () => {
    const remote = { COREALM_IDENTITY_HOST: "0.0.0.0", COREALM_IDENTITY_PUBLIC_URL: "https://id.example.com", COREALM_IDENTITY_ORIGINS: "https://play.example.com, https://docs.example.com" };
    expect(identityConfiguration([], remote)).toMatchObject({ publicUrl: "https://id.example.com", allowedOrigins: ["https://play.example.com", "https://docs.example.com"] });
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: undefined })).toThrow(/public HTTPS URL/);
    // A password crosses the network to this origin, so plain HTTP is refused outright.
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: "http://id.example.com" })).toThrow(/Passwords require HTTPS/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PUBLIC_URL: "https://id.example.com/auth" })).toThrow(/bare origin/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "https://play.example.com/" })).toThrow(/exact HTTPS origins/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "*" })).toThrow();
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_ORIGINS: "" })).toThrow(/--origins/);
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PORT: "0" })).toThrow(/Ephemeral/);
    // A loopback test run binds an ephemeral port, so the public URL waits until it has one.
    expect(identityConfiguration(["--port", "0", "--origins", "http://127.0.0.1:5173"], {})).toMatchObject({ port: 0, publicUrl: "" });
    expect(() => identityConfiguration([], { ...remote, COREALM_IDENTITY_PORT: "70000" })).toThrow(/Port/);
    expect(() => identityConfiguration(["--port"], remote)).toThrow(/--port requires a value/);
    // Private directory entries are a development convenience and never a public deployment.
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173", "--allow-private-servers"], {}).allowPrivateServers).toBe(true);
    expect(identityConfiguration(["--origins", "http://127.0.0.1:5173"], { COREALM_IDENTITY_ALLOW_PRIVATE_SERVERS: "true" }).allowPrivateServers).toBe(true);
    expect(() => identityConfiguration(["--allow-private-servers"], remote)).toThrow(/development option/);
  });
});
