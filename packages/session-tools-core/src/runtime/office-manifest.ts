import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OfficecliManifest } from '../office-types.ts';

const MANIFEST_NAME = 'officecli-manifest.json';

export type OfficecliResourceFailureKind =
  | 'resources_missing'
  | 'path_unresolved'
  | 'packaging_misconfigured';

export interface OfficecliResourceFailure {
  kind: OfficecliResourceFailureKind;
  code:
    | 'officecli_resources_unavailable'
    | 'officecli_path_unresolved'
    | 'officecli_packaging_misconfigured';
  message: string;
  recovery: string;
  candidates: string[];
}

/**
 * Convert an ESM module URL into a directory. Never throws: Windows CJS
 * bundles often leave `import.meta.url` undefined, and passing that to
 * `fileURLToPath` crashes Electron during module init.
 */
export function resolveOfficeManifestModuleDirectory(importMetaUrl: unknown): string | undefined {
  if (typeof importMetaUrl !== 'string' || importMetaUrl.length === 0) return undefined;
  try {
    return dirname(fileURLToPath(importMetaUrl));
  } catch {
    return undefined;
  }
}

const bundledModuleDirectory = resolveOfficeManifestModuleDirectory(import.meta.url);

interface ManifestCacheEntry {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  manifest: OfficecliManifest;
}

const manifestCache = new Map<string, ManifestCacheEntry>();

export interface ResolvedOfficecliResources {
  root: string;
  versionRoot: string;
  manifestPath: string;
  manifest: OfficecliManifest;
}

export interface ResolveOfficecliResourcesOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  explicitRoot?: string;
  /**
   * Override the directory derived from `import.meta.url`.
   * Pass `null` to skip that candidate (CJS / tests).
   */
  moduleDirectory?: string | null;
  /** Electron `process.resourcesPath` override. Pass `null` to ignore the process value. */
  resourcesPath?: string | null;
}

function manifestAt(root: string): string | undefined {
  const candidate = join(root, MANIFEST_NAME);
  if (!existsSync(candidate)) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function loadManifest(path: string): OfficecliManifest {
  const stats = statSync(path);
  const { mtimeMs, ctimeMs, size } = stats;
  const cached = manifestCache.get(path);
  if (cached?.mtimeMs === mtimeMs && cached.ctimeMs === ctimeMs && cached.size === size) return cached.manifest;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as OfficecliManifest;
  const policy = parsed.commandPolicy;
  const policyValid = policy
    && ['read', 'edit', 'preview', 'lifecycle', 'admin'].every(category => {
      const commands = policy[category as keyof typeof policy];
      return Array.isArray(commands)
        && commands.every(command => typeof command === 'string' && /^[a-z][a-z0-9_-]*$/.test(command));
    });
  const assetsValid = parsed.assets
    && Object.values(parsed.assets).every(asset => (
      asset
      && typeof asset.name === 'string'
      && typeof asset.url === 'string'
      && /^[0-9a-f]{64}$/.test(asset.sha256)
      && (asset.schemaCrc === undefined || /^[0-9a-f]{8}$/.test(asset.schemaCrc))
    ));
  const compatibilityKeys = Object.keys(parsed.compatibilityRecipes ?? {});
  const importRecipe = parsed.compatibilityRecipes?.importViaAtomicBatch;
  const compatibilityValid = compatibilityKeys.every(key => key === 'importViaAtomicBatch')
    && (!importRecipe || (
      importRecipe.enabled === true
      && Number.isInteger(importRecipe.maxSourceBytes)
      && importRecipe.maxSourceBytes > 0
      && importRecipe.maxSourceBytes <= 50_000_000
      && typeof importRecipe.reason === 'string'
      && importRecipe.reason.trim().length >= 20
    ));
  if (
    parsed.manifestVersion !== 1
    || !/^\d+\.\d+\.\d+$/.test(parsed.version)
    || parsed.tag !== `v${parsed.version}`
    || !/^[0-9a-f]{40}$/.test(parsed.tagCommit)
    || !/^[0-9a-f]{8}$/.test(parsed.schemaCrc)
    || !assetsValid
    || !parsed.guides
    || !policyValid
    || !compatibilityValid
    || !Array.isArray(parsed.externalDependencies)
  ) {
    throw new Error(`Invalid OfficeCLI manifest: ${path}`);
  }
  manifestCache.set(path, { mtimeMs, ctimeMs, size, manifest: parsed });
  return parsed;
}

function processResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveModuleDirectory(options: ResolveOfficecliResourcesOptions): string | undefined {
  if (options.moduleDirectory !== undefined) {
    return typeof options.moduleDirectory === 'string' && options.moduleDirectory.length > 0
      ? options.moduleDirectory
      : undefined;
  }
  return bundledModuleDirectory;
}

function resolveResourcesPath(options: ResolveOfficecliResourcesOptions): string | undefined {
  if (options.resourcesPath === null) return undefined;
  if (typeof options.resourcesPath === 'string') {
    return options.resourcesPath.length > 0 ? options.resourcesPath : undefined;
  }
  return processResourcesPath();
}

function packagedOfficecliRoots(base: string): string[] {
  return [
    join(base, 'dist', 'resources', 'officecli'),
    join(base, 'resources', 'officecli'),
    join(base, 'officecli'),
  ];
}

function candidateRoots(options: ResolveOfficecliResourcesOptions): string[] {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const moduleDirectory = resolveModuleDirectory(options);
  const resourcesPath = resolveResourcesPath(options);
  const roots: string[] = [];
  if (options.explicitRoot) roots.push(options.explicitRoot);
  if (env.CRAFT_OFFICECLI_RESOURCES) roots.push(env.CRAFT_OFFICECLI_RESOURCES);
  if (env.CRAFT_RESOURCES_BASE) {
    roots.push(...packagedOfficecliRoots(env.CRAFT_RESOURCES_BASE));
  }
  for (const base of [env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
    if (!base) continue;
    roots.push(...packagedOfficecliRoots(base));
  }
  if (resourcesPath) {
    roots.push(
      join(resourcesPath, 'app', 'dist', 'resources', 'officecli'),
      join(resourcesPath, 'app', 'resources', 'officecli'),
      join(resourcesPath, 'officecli'),
    );
  }
  roots.push(
    join(cwd, 'apps', 'electron', 'resources', 'officecli'),
    join(cwd, 'resources', 'officecli'),
  );
  if (moduleDirectory) {
    roots.push(
      join(moduleDirectory, 'resources', 'officecli'),
      resolve(moduleDirectory, '../../../../apps/electron/resources/officecli'),
    );
  }
  return [...new Set(roots.map(root => resolve(root)))];
}

function hasConfiguredResourceRoot(
  options: ResolveOfficecliResourcesOptions,
  env: NodeJS.ProcessEnv,
): boolean {
  return Boolean(
    options.explicitRoot
    || env.CRAFT_OFFICECLI_RESOURCES
    || env.CRAFT_RESOURCES_BASE
    || env.CRAFT_BUNDLED_ASSETS_ROOT
    || env.CRAFT_RESOURCES_PATH
    || resolveResourcesPath(options),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function resolveOfficecliResources(
  options: ResolveOfficecliResourcesOptions = {},
): ResolvedOfficecliResources | undefined {
  let invalidManifest: Error | undefined;
  for (const root of candidateRoots(options)) {
    const manifestPath = manifestAt(root);
    if (!manifestPath) continue;
    try {
      const manifest = loadManifest(manifestPath);
      const versionRoot = join(root, manifest.version);
      if (!existsSync(versionRoot)) continue;
      return { root, versionRoot, manifestPath, manifest };
    } catch (error) {
      invalidManifest = toError(error);
    }
  }
  if (invalidManifest) throw invalidManifest;
  return undefined;
}

export function diagnoseOfficecliResourceFailure(
  options: ResolveOfficecliResourcesOptions = {},
): OfficecliResourceFailure {
  const env = options.env ?? process.env;
  const candidates = candidateRoots(options);
  const existingCandidates = candidates.filter(root => existsSync(root));
  const packaged = env.CRAFT_IS_PACKAGED === '1';

  if (packaged && existingCandidates.length === 0) {
    return {
      kind: 'packaging_misconfigured',
      code: 'officecli_packaging_misconfigured',
      message: 'OfficeCLI resources are missing from the packaged install layout.',
      recovery: 'Reinstall Selection. The installer should include resources/app/dist/resources/officecli.',
      candidates,
    };
  }

  if (
    existingCandidates.length === 0
    && !resolveModuleDirectory(options)
    && !hasConfiguredResourceRoot(options, env)
  ) {
    return {
      kind: 'path_unresolved',
      code: 'officecli_path_unresolved',
      message: 'OfficeCLI resource path could not be derived from the bundled module or install layout.',
      recovery: 'Reinstall Selection, or set CRAFT_OFFICECLI_RESOURCES to a valid officecli resource root.',
      candidates,
    };
  }

  return {
    kind: 'resources_missing',
    code: 'officecli_resources_unavailable',
    message: 'The bundled OfficeCLI manifest and internal guide resources could not be resolved.',
    recovery: 'Reinstall or rebuild Selection with resources/officecli.',
    candidates,
  };
}

export function logOfficecliResourceFailure(failure: OfficecliResourceFailure): void {
  console.warn(`[officecli] ${failure.code}: ${failure.message}`);
}

export function clearOfficecliManifestCache(): void {
  manifestCache.clear();
}

export function reviewedOfficecliSchemaCrc(
  manifest: OfficecliManifest,
  platformKey = `${process.platform}-${process.arch}`,
): string {
  return manifest.assets[platformKey]?.schemaCrc ?? manifest.schemaCrc;
}
