// Explicit local development. Each world has independent durable progression.
window.__COREALM_DEVELOPMENT_GUESTS__ = true;
window.__COREALM_MULTIPLAYER__ = ["corealm", "second-corealm"].map(worldId => ({
  providerId: "reference", worldId, name: worldId,
  endpoint: "ws://127.0.0.1:4180/", protocolVersion: 3,
  fixture: "authored", seed: 1337,
  population: 0, capacity: 1000, availability: "available"
}));
