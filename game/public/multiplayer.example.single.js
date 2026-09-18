// Explicit local development. Load before the game module.
window.__COREALM_DEVELOPMENT_GUESTS__ = true;
window.__COREALM_MULTIPLAYER__ = {
  providerId: "reference", worldId: "corealm", name: "Local Corealm",
  endpoint: "ws://127.0.0.1:4180/", protocolVersion: 3,
  contentVersion: "corealm-pve-1", seed: 1337,
  population: 0, capacity: 1000, availability: "available"
};
