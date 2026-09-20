import { expect, it, vi } from "vitest";
import { WORLD_PROTOCOL_VERSION, type SessionPhase, type WorldDescriptor, type WorldSession, type WorldUpdate } from "../game/src/contracts.js";
import { ProviderRegistry, SessionController } from "../game/src/multiplayer/providers.js";

const world: WorldDescriptor = { providerId: "test", worldId: "one", name: "One", endpoint: "ws://127.0.0.1/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1, population: 0, capacity: 2, availability: "available" };

it("switches only after release and ignores a late packet from the old session", async () => {
  const phases: SessionPhase[] = []; const apply = vi.fn(); const order: string[] = [];
  const listeners = new Map<string, (value: WorldUpdate) => void>();
  const registry = new ProviderRegistry();
  registry.register({ id: "test", discover: async () => [world], authenticate: async () => ({ token: "test" }),
    connect: async (descriptor): Promise<WorldSession> => ({ id: descriptor.worldId, playerId: "player", world: descriptor,
      command: vi.fn(), subscribe(listener) { listeners.set(descriptor.worldId, listener); return () => {}; },
      close: async () => { order.push(`closed:${descriptor.worldId}`); },
    }) });
  const controller = new SessionController(registry, { apply, clear: () => { order.push("clear"); },
    phase: (phase) => { phases.push(phase); }, offline: async () => {} });
  await controller.join(world); await controller.join({ ...world, worldId: "two" });
  listeners.get("one")!({ sessionId: "one" } as WorldUpdate);
  expect(apply).not.toHaveBeenCalled();
  listeners.get("two")!({ sessionId: "two" } as WorldUpdate);
  expect(apply).toHaveBeenCalledOnce();
  expect(order).toEqual(["clear", "closed:one", "clear"]);
  expect(phases.at(-1)).toBe("connected");
  await controller.leave(); expect(phases.at(-1)).toBe("offline");
});

it("cancels a pending authentication without allowing a late connection to replace offline state", async () => {
  let authenticate!: () => void; const connect = vi.fn(); const phases: SessionPhase[] = [];
  const registry = new ProviderRegistry(); registry.register({ id: "test", discover: async () => [world], connect,
    authenticate: () => new Promise((resolve) => { authenticate = () => resolve({ token: "test" }); }) });
  const controller = new SessionController(registry, { apply: vi.fn(), clear: vi.fn(), offline: async () => {}, phase: (phase) => { phases.push(phase); } });
  const pending = controller.join(world);
  await vi.waitFor(() => expect(authenticate).toBeDefined());
  await controller.leave(); authenticate(); await pending;
  expect(connect).not.toHaveBeenCalled(); expect(phases.at(-1)).toBe("offline");
});
