import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', source: '' }));
vi.mock('../tools/lib/paths.js', () => ({ get repoRoot() { return fixture.root; } }));
vi.mock('../tools/content/compile.js', () => ({
  formulaSourceRevision: () => createHash('sha256').update(readFileSync(fixture.source)).digest('hex'),
  readContentSources: async () => new Map(),
}));

it('checks real TypeScript consumers before activating fresh formula output and preserves the last valid build on type errors', async () => {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  fixture.root = await mkdtemp(path.join(tmpdir(), 'corealm-formula-watch-'));
  fixture.source = path.join(fixture.root, 'game/src/content/formulas/arithmetic.ts');
  const contentRoot = path.join(fixture.root, 'game/content');
  const catalog = path.join(contentRoot, 'compiled/catalog.json');
  const watcher = new EventEmitter();
  const httpServer = new EventEmitter();
  const nodeOptions = process.env.NODE_OPTIONS;
  try {
    await mkdir(path.dirname(fixture.source), { recursive: true });
    await mkdir(path.join(fixture.root, 'tools/content'), { recursive: true });
    // Reuse installed tools, while tsc reads this isolated project's real config and imports.
    await symlink(path.join(repository, 'node_modules'), path.join(fixture.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(fixture.root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(path.join(fixture.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, types: ['node'] }, include: ['game/src/**/*.ts'] }));
    await writeFile(fixture.source, 'export function calculate(tier: number): number { return tier * 2; }\n');
    await writeFile(path.join(fixture.root, 'game/src/content/consumer.ts'), "import { calculate } from './formulas/arithmetic.js';\nexport const itemValue: number = calculate(10);\n");
    await writeFile(path.join(fixture.root, 'tools/content/compile.ts'), `
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { calculate } from '../../game/src/content/formulas/arithmetic.js';
const source = await readFile(path.resolve('game/src/content/formulas/arithmetic.ts'));
const revision = createHash('sha256').update(source).digest('hex');
if (revision !== process.argv[3]) throw new Error('Unchecked source revision');
const target = path.join(process.argv[2]!, 'compiled/catalog.json');
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({ version: 1, revision, tables: { value: calculate(10) }, diagnostics: [], sourceMap: {} }));
`);
    const compileContent = vi.fn();
    const server = { watcher, httpServer, ws: { send: vi.fn() }, ssrLoadModule: vi.fn(async () => ({ compileContent, acceptedValue: JSON.parse(await readFile(catalog, 'utf8')).tables.value })) } as unknown as ViteDevServer;
    const { installFormulaWatcher } = await import('../devdocs/server/lib/formulaWatcher.js');
    // Reproduce a compiler process exiting without diagnostics, then recover without a source edit.
    const preload = path.join(fixture.root, 'fail-typecheck.cjs');
    await writeFile(preload, "if (process.argv[1]?.replaceAll('\\\\', '/').endsWith('/typescript/bin/tsc')) process.exit(7);\n");
    vi.stubEnv('NODE_OPTIONS', `${nodeOptions ?? ''} --require ${JSON.stringify(preload)}`);
    const services = installFormulaWatcher(server, { contentRoot });
    expect((await services.getBuildStatus!()).state).toBe('checking');
    await vi.waitFor(async () => expect((await services.getBuildStatus!()).state).toBe('invalid'), { timeout: 30_000, interval: 50 });
    expect((await services.getBuildStatus!()).diagnostics[0]?.message).toContain('exit code 7');
    vi.unstubAllEnvs();
    const [first, concurrent] = await Promise.all([services.compiler(), services.compiler()]);
    expect(first).toBe(compileContent);
    expect(concurrent).toBe(compileContent);
    expect((await services.getBuildStatus!()).state).toBe('valid');
    expect(server.ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(catalog, 'utf8')).tables.value).toBe(20);

    await writeFile(fixture.source, 'export function calculate(tier: number): number { return tier * 3; }\n');
    watcher.emit('change', fixture.source);
    expect((await services.getBuildStatus!()).state).toBe('checking');
    await expect(services.compiler()).resolves.toBe(compileContent);
    expect((await services.getBuildStatus!()).state).toBe('valid');
    const accepted = await readFile(catalog, 'utf8');
    expect(JSON.parse(accepted).tables.value).toBe(30);
    const acceptedRegistry = await services.loadRegistry!();

    // This file is syntactically valid; the consumer's number assignment must fail type checking.
    await writeFile(fixture.source, 'export function calculate(tier: number): string { return String(tier); }\n');
    watcher.emit('change', fixture.source);
    expect((await services.getBuildStatus!()).state).toBe('checking');
    await vi.waitFor(async () => expect((await services.getBuildStatus!()).state).toBe('invalid'), { timeout: 30_000, interval: 50 });
    const invalid = await services.getBuildStatus!();
    expect(invalid.diagnostics.map(issue => issue.message).join('\n')).toContain('TS2322');
    expect(await readFile(catalog, 'utf8')).toBe(accepted);
    expect(await services.loadRegistry!()).toBe(acceptedRegistry);
    await expect(services.compiler()).rejects.toThrow('TS2322');
    expect(await readFile(catalog, 'utf8')).toBe(accepted);
    expect(await services.loadRegistry!()).toBe(acceptedRegistry);
  } finally {
    vi.unstubAllEnvs();
    httpServer.emit('close');
    const resolved = path.resolve(fixture.root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('corealm-formula-watch-')) throw new Error('Unexpected fixture cleanup path');
    // Remove the junction explicitly before recursively deleting the isolated project.
    await rm(path.join(resolved, 'node_modules'), { recursive: true, force: true });
    await rm(resolved, { recursive: true, force: true });
  }
}, 100_000);
