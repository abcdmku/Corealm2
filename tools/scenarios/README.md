# Play scenarios

Use JSON scenarios for repeatable browser inputs and semantic assertions before adding
another standalone test script. Reuse an existing scenario when it covers the behavior.

```bash
npm run play -- --run runs/local-validation --scenario tools/scenarios/lab-movement.json --url http://127.0.0.1:4173
```

See [the scenario format](../../docs/lab-reference.md#scripted-scenarios-and-acceptance-status)
and [the development loop](../../docs/feature-lab.md). A recording without assertions is
only diagnostic. Visual acceptance still requires screenshot review.
