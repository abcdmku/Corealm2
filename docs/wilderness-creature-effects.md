# Wilderness creature emission

`WildernessCreatureEffects` adds slow fragments rising from a creature's body. Blue and violet fragments accompany deep Wilderness creatures; an optional ember palette supports molten rock creatures. The effect uses the existing production `ElementalParticleCloud` geometry and material. Fragments have volume, fade over their lifetime and drift away from changing birth sites on the body.

The renderer keeps one material and a fixed 384-fragment buffer. It selects at most 16 nearby, onscreen creatures within 36 metres of the camera. An ordinary creature contributes up to 18 fragments; a hero contributes up to 24, with slightly stronger emission. Distance fading begins at 24 metres. Empty batches disappear. It creates no lights and does not activate the full-scene HDR bloom pass during exploration.

The caller owns actor eligibility. Pass only living creatures with resident models so the effect cannot expose an unloaded or dead actor. Supply world position at the feet and a body-size factor relative to a roughly two-metre creature. This factor is not necessarily the source asset's import scale. The renderer clamps it between 0.4 and 5. The `palette` defaults to `arcane` and `hero` defaults to false.

```ts
const effects = new WildernessCreatureEffects(scene.effectsGroup);
effects.update(seconds, camera, actors.map(actor => ({
  id: actor.id,
  position: actor.position,
  scale: actor.bodySize,
  hero: actor.isBoss,
  palette: 'arcane',
})));
```

Use the existing render clock in seconds. Paths depend only on absolute time and the stable actor ID, so arrival order, frame cadence and leaving the area do not reset their motion. Particles follow the current actor position and carry no gameplay state. `setEnabled(false)` clears live particles immediately. `dispose()` detaches the batch and releases its geometry and material. `getState()` reports selected IDs and positions, live populations and budget culling for lab and world probes.

The focused test covers dense-pack limits, selection order, frustum and distance culling, deterministic motion, movement anchoring, palette selection and resource cleanup. Root must accept the module through the production lab before world integration. That check should use real resident actors, normal player-follow camera limits, a live movement sequence, inspected images, and state comparisons when actors leave or die. Unit tests do not establish appearance or gameplay acceptance.
