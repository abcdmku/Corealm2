import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.resolve('game/src');
const sources = (extension: string): string[] =>
  readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith(extension));
const scan = (files: readonly string[], pattern: RegExp): string[] => files
  .flatMap(file => readFileSync(path.join(root, file), 'utf8').split('\n')
    .flatMap((line, index) => pattern.test(line) ? [`${file}:${index + 1}`] : []));

test('runtime asset URLs stay inside the deployment directory', () => {
  expect(scan(sources('.ts'), /["'`]\/assets\//),
    'Use assetBaseUrl() so the asset host and GitHub Pages project paths both work').toEqual([]);
});

test('stylesheets name no public file, because CSS cannot read the asset base', () => {
  // A stylesheet can only carry a fixed path, so a file it names cannot move to the asset host.
  // The display font used to live here; it is registered from `ui/displayFont.ts` instead.
  expect(scan(sources('.css'), /url\(\s*["']?\.{0,2}\/?(?:assets|audio|generated)\//),
    'Load the file from ui/displayFont.ts or another module that calls publicUrl()').toEqual([]);
});
