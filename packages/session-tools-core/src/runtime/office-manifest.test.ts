import { afterEach, describe, expect, it } from 'bun:test';
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { executeOfficeCommand } from './office-coordinator.ts';
import {
  clearOfficecliManifestCache,
  diagnoseOfficecliResourceFailure,
  resolveOfficecliResources,
  resolveOfficeManifestModuleDirectory,
} from './office-manifest.ts';

const realOfficecliRoot = resolve(import.meta.dir, '../../../../apps/electron/resources/officecli');
const realManifestPath = join(realOfficecliRoot, 'officecli-manifest.json');
const require = createRequire(import.meta.url);
const tempRoots: string[] = [];

function tempRoot(prefix = 'office-manifest-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function installOfficecliTree(root: string): string {
  const manifest = JSON.parse(readFileSync(realManifestPath, 'utf8')) as { version: string };
  mkdirSync(join(root, manifest.version), { recursive: true });
  copyFileSync(realManifestPath, join(root, 'officecli-manifest.json'));
  return root;
}

function isolatedResolveOptions(
  overrides: Parameters<typeof resolveOfficecliResources>[0] = {},
): Parameters<typeof resolveOfficecliResources>[0] {
  return {
    env: {},
    moduleDirectory: null,
    resourcesPath: null,
    cwd: join(tempRoot(), 'empty-cwd'),
    ...overrides,
  };
}

function sessionContext(root: string): SessionToolContext {
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  return {
    sessionId: 'session-1',
    workspacePath: workspace,
    sessionPath: workspace,
    dataPath: workspace,
    workingDirectory: workspace,
    get sourcesPath() { return join(workspace, 'sources'); },
    get skillsPath() { return join(workspace, 'skills'); },
    plansFolderPath: join(workspace, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
  };
}

afterEach(() => {
  clearOfficecliManifestCache();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveOfficeManifestModuleDirectory', () => {
  it('does not throw when the module URL is missing or invalid', () => {
    expect(resolveOfficeManifestModuleDirectory(undefined)).toBeUndefined();
    expect(resolveOfficeManifestModuleDirectory(null)).toBeUndefined();
    expect(resolveOfficeManifestModuleDirectory('')).toBeUndefined();
    expect(resolveOfficeManifestModuleDirectory(123)).toBeUndefined();
    expect(resolveOfficeManifestModuleDirectory('not-a-file-url')).toBeUndefined();
  });

  it('resolves a real file URL to its directory', () => {
    expect(resolveOfficeManifestModuleDirectory(import.meta.url)).toBe(import.meta.dir);
  });
});

describe('OfficeCLI resource resolution', () => {
  it('still finds the development resources from an explicit module directory', () => {
    const resolved = resolveOfficecliResources({
      env: {},
      cwd: join(tempRoot(), 'empty'),
      resourcesPath: null,
      moduleDirectory: import.meta.dir,
    });

    expect(resolved?.root).toBe(realOfficecliRoot);
    expect(resolved?.manifest.version).toBeTruthy();
  });

  it('resolves a Windows packaged layout without import.meta.url', () => {
    const installRoot = join(tempRoot(), 'Users', '陈 AI User', 'AppData', 'Local', 'Programs', 'Selection');
    const resourcesPath = join(installRoot, 'resources');
    const resourcesBase = join(resourcesPath, 'app');
    const officecliRoot = installOfficecliTree(join(resourcesBase, 'dist', 'resources', 'officecli'));

    const resolved = resolveOfficecliResources(isolatedResolveOptions({
      env: {
        CRAFT_IS_PACKAGED: '1',
        CRAFT_RESOURCES_BASE: resourcesBase,
      },
      cwd: join(tempRoot(), 'cwd with spaces'),
      resourcesPath,
    }));

    expect(resolved?.root).toBe(officecliRoot);
  });

  it('resolves packaged resources from process.resourcesPath when env hints are absent', () => {
    const resourcesPath = join(tempRoot('Selection resources '), 'resources');
    const officecliRoot = installOfficecliTree(join(resourcesPath, 'app', 'dist', 'resources', 'officecli'));

    const resolved = resolveOfficecliResources(isolatedResolveOptions({ resourcesPath }));

    expect(resolved?.root).toBe(officecliRoot);
  });

  it('skips a corrupt earlier candidate and uses the next valid tree', () => {
    const root = tempRoot();
    const corruptRoot = join(root, 'corrupt');
    mkdirSync(corruptRoot, { recursive: true });
    writeFileSync(join(corruptRoot, 'officecli-manifest.json'), '{not-json');
    const officecliRoot = installOfficecliTree(join(root, 'resources', 'officecli'));

    expect(resolveOfficecliResources(isolatedResolveOptions({
      explicitRoot: corruptRoot,
      cwd: root,
    }))?.root).toBe(officecliRoot);
  });

  it('rethrows when every discovered manifest is invalid', () => {
    const corruptRoot = join(tempRoot(), 'corrupt');
    mkdirSync(corruptRoot, { recursive: true });
    writeFileSync(join(corruptRoot, 'officecli-manifest.json'), '{not-json');

    expect(() => resolveOfficecliResources(isolatedResolveOptions({
      explicitRoot: corruptRoot,
    }))).toThrow(/Invalid OfficeCLI manifest|JSON/i);
  });

  it('classifies a missing packaged tree as a packaging misconfiguration', () => {
    const resourcesPath = join(tempRoot(), 'resources');
    mkdirSync(join(resourcesPath, 'app'), { recursive: true });

    expect(diagnoseOfficecliResourceFailure(isolatedResolveOptions({
      env: { CRAFT_IS_PACKAGED: '1', CRAFT_RESOURCES_BASE: join(resourcesPath, 'app') },
      resourcesPath,
    }))).toMatchObject({
      kind: 'packaging_misconfigured',
      code: 'officecli_packaging_misconfigured',
    });
  });

  it('does not treat Electron resourcesPath alone as a packaged install', () => {
    expect(diagnoseOfficecliResourceFailure(isolatedResolveOptions({
      resourcesPath: join(tempRoot(), 'electron', 'dist', 'resources'),
    }))).toMatchObject({
      kind: 'resources_missing',
      code: 'officecli_resources_unavailable',
    });
  });

  it('classifies a missing module URL without configured roots as a path failure', () => {
    expect(diagnoseOfficecliResourceFailure(isolatedResolveOptions({
      env: {},
    }))).toMatchObject({
      kind: 'path_unresolved',
      code: 'officecli_path_unresolved',
    });
  });

  it('classifies an existing but empty candidate as missing resources, not a path failure', () => {
    const cwd = tempRoot();
    mkdirSync(join(cwd, 'resources', 'officecli'), { recursive: true });

    expect(diagnoseOfficecliResourceFailure(isolatedResolveOptions({ cwd }))).toMatchObject({
      kind: 'resources_missing',
      code: 'officecli_resources_unavailable',
    });
  });

  it('classifies an empty explicit root as missing resources', () => {
    const emptyRoot = join(tempRoot(), 'officecli');
    mkdirSync(emptyRoot, { recursive: true });

    expect(diagnoseOfficecliResourceFailure(isolatedResolveOptions({
      explicitRoot: emptyRoot,
    }))).toMatchObject({
      kind: 'resources_missing',
      code: 'officecli_resources_unavailable',
    });
  });
});

describe('Windows packaged Office startup smoke', () => {
  it('loads a CJS bundle when import.meta.url is undefined', async () => {
    const outfile = join(tempRoot(), 'office-manifest.cjs');
    const result = await build({
      entryPoints: [join(import.meta.dir, 'office-manifest.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      logLevel: 'silent',
    });
    expect(result.warnings.filter(warning => warning.id === 'empty-import-meta')).toEqual([]);

    expect(() => require(outfile)).not.toThrow();
    const bundled = require(outfile) as {
      resolveOfficeManifestModuleDirectory: (url: unknown) => string | undefined;
      resolveOfficecliResources: typeof resolveOfficecliResources;
    };
    expect(bundled.resolveOfficeManifestModuleDirectory(undefined)).toBeUndefined();

    const resourcesBase = join(tempRoot(), 'app');
    const officecliRoot = installOfficecliTree(join(resourcesBase, 'dist', 'resources', 'officecli'));
    const resolved = bundled.resolveOfficecliResources({
      env: { CRAFT_RESOURCES_BASE: resourcesBase },
      cwd: tempRoot(),
      moduleDirectory: null,
      resourcesPath: null,
    });
    expect(resolved?.root).toBe(officecliRoot);
  });

  it('loads the Office runtime init chain as a packaged CJS main bundle', async () => {
    const outfile = join(tempRoot(), 'session-tools-core.cjs');
    const result = await build({
      entryPoints: [join(import.meta.dir, '../index.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      logLevel: 'silent',
      plugins: [{
        name: 'stub-optional-natives',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^(electron|sharp|beautiful-mermaid)$/ }, args => ({
            path: args.path,
            namespace: 'issue70-stub',
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: 'issue70-stub' }, () => ({
            contents: 'module.exports = new Proxy({}, { get: () => () => undefined });',
            loader: 'js',
          }));
        },
      }],
    });
    expect(result.warnings.filter(warning => warning.id === 'empty-import-meta')).toEqual([]);

    const loaded = require(outfile) as {
      resolveOfficecliResources: typeof resolveOfficecliResources;
      diagnoseOfficecliResourceFailure: typeof diagnoseOfficecliResourceFailure;
    };

    const installRoot = join(tempRoot(), 'Local Programs', 'Selection 测试');
    const resourcesPath = join(installRoot, 'resources');
    const officecliRoot = installOfficecliTree(join(resourcesPath, 'app', 'dist', 'resources', 'officecli'));

    const resolved = loaded.resolveOfficecliResources({
      env: {
        CRAFT_IS_PACKAGED: '1',
        CRAFT_RESOURCES_BASE: join(resourcesPath, 'app'),
      },
      cwd: join(installRoot, 'unrelated cwd'),
      moduleDirectory: null,
      resourcesPath,
    });
    expect(resolved?.root).toBe(officecliRoot);
    expect(loaded.diagnoseOfficecliResourceFailure({
      env: { CRAFT_IS_PACKAGED: '1' },
      cwd: join(installRoot, 'empty'),
      moduleDirectory: null,
      resourcesPath: join(installRoot, 'missing-resources'),
    }).kind).toBe('packaging_misconfigured');
  });

  it('returns a structured Office error instead of throwing when resources are unavailable', async () => {
    const result = await executeOfficeCommand(sessionContext(tempRoot()), {
      argv: ['status'],
      mode: 'inspect',
    }, {
      resolveResources: () => undefined,
    });

    expect(result.envelope.ok).toBe(false);
    expect(result.envelope.error?.code).toMatch(/^officecli_/);
    expect(result.envelope.error?.category).toBe('dependency');
  });

  it('maps a corrupt manifest to officecli_manifest_invalid instead of crashing', async () => {
    const result = await executeOfficeCommand(sessionContext(tempRoot()), {
      argv: ['status'],
      mode: 'inspect',
    }, {
      resolveResources: () => {
        throw new Error('Invalid OfficeCLI manifest: fixture');
      },
    });

    expect(result.envelope.ok).toBe(false);
    expect(result.envelope.error?.code).toBe('officecli_manifest_invalid');
    expect(result.envelope.error?.category).toBe('dependency');
  });
});
