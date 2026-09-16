import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('runtime asset URLs stay inside the deployment directory', () => {
  const root = path.resolve('game/src');
  const violations = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts'))
    .flatMap(file => readFileSync(path.join(root, file), 'utf8').split('\n')
      .flatMap((line, index) => /["'`]\/assets\//.test(line)
        ? [`${file}:${index + 1}`] : []));
  expect(violations, 'Use ASSET_BASE_URL so GitHub Pages project paths work').toEqual([]);
});
