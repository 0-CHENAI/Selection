import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  commandSchemaContractsEqual,
  extractExternalDependencies,
  posixRelPath,
  validateOfficecliReleaseAssetUrl,
  validateManifestFiles,
  type CommandSnapshot,
  type OfficecliManifest,
} from './sync-officecli.ts';

const manifestPath = resolve(import.meta.dir, '../apps/electron/resources/officecli/officecli-manifest.json');

function manifest(): OfficecliManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as OfficecliManifest;
}

describe('OfficeCLI sync governance', () => {
  it('builds automated OfficeCLI upgrades from test and opens their PRs against test', () => {
    const workflow = readFileSync(
      resolve(import.meta.dir, '../.github/workflows/officecli-update.yml'),
      'utf8',
    );

    expect(workflow).toContain('OFFICECLI_BASE_BRANCH: test');
    expect(workflow).toContain('ref: ${{ env.OFFICECLI_BASE_BRANCH }}');
    expect(workflow).toContain('gh pr list --state open --base "$OFFICECLI_BASE_BRANCH"');
    expect(workflow).toContain('gh pr edit "$pr_number" --base "$OFFICECLI_BASE_BRANCH"');
    expect(workflow).toContain('gh pr create --draft --base "$OFFICECLI_BASE_BRANCH"');
    expect(workflow.indexOf('Enforce reviewed command and resource policy')).toBeLessThan(
      workflow.indexOf('Publish or refresh draft upgrade PR'),
    );
  });

  it('accepts the complete reviewed manifest', () => {
    expect(() => validateManifestFiles(manifest())).not.toThrow();
  });

  it('prevents reviewed binaries from self-updating through every managed launch path', () => {
    const repositoryRoot = resolve(import.meta.dir, '..');
    const managedLaunchPaths = [
      'scripts/sync-officecli.ts',
      'scripts/run-officecli-integration-tests.ts',
      'apps/electron/resources/bin/officecli',
      'apps/electron/resources/bin/officecli.cmd',
      'apps/electron/resources/scripts/officecli-wrapper.ts',
      'apps/electron/resources/scripts/officecli-heading-repair.ts',
      'packages/shared/src/agent/pi-agent.ts',
    ];

    for (const path of managedLaunchPaths) {
      const content = readFileSync(join(repositoryRoot, path), 'utf8');
      expect(content, `${path} must disable OfficeCLI self-updates`).toMatch(
        /OFFICECLI_SKIP_UPDATE(?:=1|['"]?\s*:\s*['"]1['"])/,
      );
    }
  });

  it('records the reviewed Windows schema CRC without changing the default CRC', () => {
    const reviewed = manifest();
    expect(reviewed.schemaCrc).toBe('b2b0b395');
    expect(reviewed.assets['win32-x64']?.schemaCrc).toBe('22d3fc61');

    const invalid = manifest();
    invalid.assets['win32-x64']!.schemaCrc = 'not-a-crc';
    expect(() => validateManifestFiles(invalid)).toThrow('Invalid platform schema CRC');
  });

  it('hashes nested guide resources with posix relative paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-officecli-posix-rel-'));
    try {
      mkdirSync(join(root, 'reference', 'styles'), { recursive: true });
      writeFileSync(join(root, 'SKILL.md'), '# skill\n');
      writeFileSync(join(root, 'reference', 'styles', 'theme.md'), '# theme\n');
      expect(posixRelPath(root, join(root, 'reference', 'styles', 'theme.md'))).toBe('reference/styles/theme.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats platform-specific help hashes as non-blocking when the command contract matches', () => {
    const reviewed = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../apps/electron/resources/officecli/1.0.144/command-schema.json'), 'utf8'),
    ) as CommandSnapshot;
    const sameContractDifferentHelp: CommandSnapshot = {
      ...reviewed,
      rootHelpSha256: '0'.repeat(64),
      helpAllSha256: '1'.repeat(64),
      commands: Object.fromEntries(
        Object.entries(reviewed.commands).map(([name, command]) => [
          name,
          { ...command, helpSha256: '2'.repeat(64) },
        ]),
      ),
    };
    const extraPlatformFlags: CommandSnapshot = {
      ...reviewed,
      helpAllEntries: reviewed.helpAllEntries + 10,
      commands: {
        ...reviewed.commands,
        get: { ...reviewed.commands.get!, flags: [...reviewed.commands.get!.flags, '--Native'] },
      },
    };
    const missingReviewedFlags: CommandSnapshot = {
      ...reviewed,
      commands: {
        ...reviewed.commands,
        get: { ...reviewed.commands.get!, flags: reviewed.commands.get!.flags.filter(flag => flag !== '--json') },
      },
    };
    const driftedReviewedFlags: CommandSnapshot = {
      ...reviewed,
      commands: {
        ...reviewed.commands,
        get: { ...reviewed.commands.get!, flags: [...reviewed.commands.get!.flags, '--unreviewed'] },
      },
    };

    expect(commandSchemaContractsEqual(reviewed, sameContractDifferentHelp)).toBe(true);
    expect(commandSchemaContractsEqual(extraPlatformFlags, reviewed)).toBe(true);
    expect(commandSchemaContractsEqual(missingReviewedFlags, reviewed)).toBe(false);
    expect(commandSchemaContractsEqual(reviewed, driftedReviewedFlags)).toBe(false);
  });

  it('rejects lookalike release URLs and version/tag drift', () => {
    const lookalike = manifest();
    lookalike.assets['linux-x64']!.url = `https://attacker.example/redirect?target=${encodeURIComponent(lookalike.assets['linux-x64']!.url)}`;
    expect(() => validateManifestFiles(lookalike)).toThrow('exact reviewed GitHub release path');

    const mismatchedTag = manifest();
    mismatchedTag.tag = 'v1.0.999';
    expect(() => validateManifestFiles(mismatchedTag)).toThrow('version/tag mismatch');
  });

  it('validates release asset ownership before downloading', () => {
    const reviewed = manifest();
    const asset = reviewed.assets['linux-x64']!;
    expect(() => validateOfficecliReleaseAssetUrl(reviewed.tag, asset.name, asset.url)).not.toThrow();
    expect(() => validateOfficecliReleaseAssetUrl(
      reviewed.tag,
      asset.name,
      `${asset.url}?download=1`,
    )).toThrow('exact reviewed GitHub release path');
    expect(() => validateOfficecliReleaseAssetUrl(
      reviewed.tag,
      asset.name,
      asset.url.replace('/iOfficeAI/', '/lookalike/'),
    )).toThrow('exact reviewed GitHub release path');
  });

  it('rejects incomplete guide catalogs and unreviewed dependency declarations', () => {
    const missingGuide = manifest();
    delete (missingGuide.guides as Partial<OfficecliManifest['guides']>).word;
    expect(() => validateManifestFiles(missingGuide)).toThrow('guide catalog mismatch');

    const extraDependency = manifest();
    extraDependency.externalDependencies.push({
      id: 'unreviewed-renderer',
      version: '1.0.0',
      license: 'MIT',
      networkRequiredFor: ['render'],
      fallback: 'none',
      hosts: ['cdn.jsdelivr.net'],
    });
    expect(() => validateManifestFiles(extraDependency)).toThrow('Unreviewed OfficeCLI external dependencies');
  });

  it('requires compatibility recipes to remain explicit and reviewed', () => {
    const invalidImportRecipe = manifest();
    invalidImportRecipe.compatibilityRecipes!.importViaAtomicBatch!.maxSourceBytes = 0;
    expect(() => validateManifestFiles(invalidImportRecipe)).toThrow('Invalid OfficeCLI import compatibility recipe');

    const unknownRecipe = manifest() as OfficecliManifest & {
      compatibilityRecipes: Record<string, unknown>;
    };
    unknownRecipe.compatibilityRecipes.unreviewedWriter = { enabled: true };
    expect(() => validateManifestFiles(unknownRecipe)).toThrow('Unreviewed OfficeCLI compatibility recipes');
  });

  it('reads dependency versions from the exact case-sensitive upstream source layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-officecli-source-layout-'));
    try {
      const core = join(root, 'src', 'officecli', 'Core');
      mkdirSync(join(core, 'Diagram'), { recursive: true });
      writeFileSync(join(core, 'KatexAssets.cs'), 'public const string Version = "1.2.3";');
      writeFileSync(join(core, 'ThreeAssets.cs'), 'public const string Version = "4.5.6";');
      writeFileSync(
        join(core, 'Diagram', 'MermaidImageRenderer.cs'),
        'private const string MermaidVersion = "7";\nprivate const string ElkVersion = "8.9";',
      );

      expect(extractExternalDependencies(root).map(item => [item.id, item.version])).toEqual([
        ['katex', '1.2.3'],
        ['three', '4.5.6'],
        ['mermaid', '7'],
        ['mermaid-layout-elk', '8.9'],
      ]);
      expect(() => extractExternalDependencies(join(root, 'missing'))).toThrow('src/officecli');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps legacy Office wrappers out of packages, permissions, and validation', () => {
    const repositoryRoot = resolve(import.meta.dir, '..');
    const governedFiles = [
      'apps/electron/electron-builder.yml',
      'apps/electron/resources/permissions/default.json',
      'package.json',
    ].map(path => readFileSync(join(repositoryRoot, path), 'utf8'));
    for (const legacyTool of ['docx-tool', 'xlsx-tool', 'pptx-tool']) {
      for (const content of governedFiles) expect(content).not.toContain(legacyTool);
    }
    for (const legacyResource of [
      'apps/electron/resources/bin/docx-tool',
      'apps/electron/resources/bin/docx-tool.cmd',
      'apps/electron/resources/bin/xlsx-tool',
      'apps/electron/resources/bin/xlsx-tool.cmd',
      'apps/electron/resources/bin/pptx-tool',
      'apps/electron/resources/bin/pptx-tool.cmd',
      'apps/electron/resources/scripts/docx_tool.py',
      'apps/electron/resources/scripts/xlsx_tool.py',
      'apps/electron/resources/scripts/pptx_tool.py',
    ]) {
      expect(existsSync(join(repositoryRoot, legacyResource))).toBe(false);
    }
  });
});
