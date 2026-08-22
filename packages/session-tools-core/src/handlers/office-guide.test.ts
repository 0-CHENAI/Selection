import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import { clearOfficeGuideCache, handleOfficeDocumentGuide, releaseOfficeGuideSession } from './office-guide.ts';

const roots: string[] = [];

function context(sessionId = 'guide-session'): { ctx: SessionToolContext; root: string; working: string } {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-guide-'));
  roots.push(root);
  const workspace = join(root, 'workspace');
  const sessionPath = join(workspace, 'sessions', sessionId);
  const working = join(workspace, 'project');
  mkdirSync(join(sessionPath, 'data'), { recursive: true });
  mkdirSync(join(workspace, 'skills', 'officecli-docx'), { recursive: true });
  mkdirSync(working, { recursive: true });
  return {
    root,
    working,
    ctx: {
      sessionId,
      workspacePath: workspace,
      sessionPath,
      dataPath: join(sessionPath, 'data'),
      workingDirectory: working,
      get sourcesPath() { return join(workspace, 'sources'); },
      get skillsPath() { return join(workspace, 'skills'); },
      plansFolderPath: join(sessionPath, 'plans'),
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
      fs: createNodeFileSystem(),
      loadSourceConfig: () => null,
    },
  };
}

function envelope(result: Awaited<ReturnType<typeof handleOfficeDocumentGuide>>): OfficeResultEnvelope {
  return result.structuredContent as OfficeResultEnvelope;
}

function data(result: Awaited<ReturnType<typeof handleOfficeDocumentGuide>>): Record<string, unknown> {
  return envelope(result).data as Record<string, unknown>;
}

function validGlbBuffer(extraBytes = 0): Buffer {
  const buffer = Buffer.alloc(12 + extraBytes);
  buffer.write('glTF', 0, 'ascii');
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  return buffer;
}

beforeEach(() => clearOfficeGuideCache());
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('office_document_guide', () => {
  it('returns a compact catalog with pinned provenance instead of the full guide', async () => {
    const { ctx } = context();
    const result = await handleOfficeDocumentGuide(ctx, { guide: 'word' });
    const payload = envelope(result);
    const payloadData = data(result);

    expect(payload).toMatchObject({ ok: true, version: '1.0.144', schemaCrc: 'b2b0b395', cacheHit: false });
    expect(payloadData).toMatchObject({
      guide: 'word',
      guideVersion: '1.0.144',
      sourceCommit: '1ced45e900782c5083ed550ddf328ee974e425e7',
      alreadyLoaded: false,
    });
    expect(Array.isArray(payloadData.catalog)).toBe(true);
    expect(JSON.stringify(payloadData).length).toBeLessThan(40_000);
    expect(payloadData.executionContract).toContain('Selection execution contract');
    expect(payloadData.executionContract).toContain('After a non-standard batch');
    expect(payloadData.executionContract).toContain('/model3d[N]');
    expect(JSON.stringify(payloadData)).not.toContain('install.sh');
    expect(JSON.stringify(payloadData)).not.toContain('install.ps1');
    expect(JSON.stringify(payloadData.catalog).toLowerCase()).not.toContain('"title":"setup"');
  });

  it('progressively loads matching sections, inherited context, and caches the exact hash', async () => {
    const { ctx } = context();
    const first = await handleOfficeDocumentGuide(ctx, { guide: 'financial-model', topic: 'formula' });
    const second = await handleOfficeDocumentGuide(ctx, { guide: 'financial-model', topic: 'formula' });
    const firstData = data(first);
    const secondData = data(second);

    expect(envelope(first).ok).toBe(true);
    expect(firstData.content).toContain('Selection execution contract');
    expect(String(firstData.content).toLowerCase()).not.toContain('officecli view');
    expect(firstData.inherited).toEqual(expect.arrayContaining([expect.objectContaining({ guide: 'excel' })]));
    expect(envelope(second).cacheHit).toBe(true);
    expect(secondData).toMatchObject({ alreadyLoaded: true });
    expect(secondData.content).toBeUndefined();
  });

  it('drops only one session guide cache when that session ends', async () => {
    const { ctx } = context('guide-release');
    await handleOfficeDocumentGuide(ctx, { guide: 'word', topic: 'tables' });
    const cached = await handleOfficeDocumentGuide(ctx, { guide: 'word', topic: 'tables' });
    expect(envelope(cached).cacheHit).toBe(true);

    releaseOfficeGuideSession(ctx.sessionId);
    const reloaded = await handleOfficeDocumentGuide(ctx, { guide: 'word', topic: 'tables' });

    expect(envelope(reloaded).cacheHit).toBe(false);
    expect(data(reloaded).alreadyLoaded).toBe(false);
  });

  it('replaces upstream Morph shell/Python helpers with validated TypeScript recipes', async () => {
    const { ctx } = context();
    const morph = data(await handleOfficeDocumentGuide(ctx, {
      guide: 'morph-ppt', topic: 'Continuous multi-slide morph',
    }));
    const modelDiscovery = data(await handleOfficeDocumentGuide(ctx, {
      guide: 'morph-ppt-3d', topic: 'Model Discovery Flow',
    }));
    const combined = `${String(morph.content)}\n${String(modelDiscovery.content)}`;

    expect(combined).toContain('validated TypeScript Morph recipes');
    expect(combined).not.toMatch(/morph-helpers\.(?:py|sh)|\bsubprocess\b|\bcurl\b|\birm\b/i);
    expect(morph.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'clone', implementation: expect.stringContaining('buildMorphCloneCommands') }),
      expect.objectContaining({ name: 'final-check', mutatesDocument: false }),
    ]));
  });

  it('does not allow a same-named user Skill to override the internal guide', async () => {
    const { ctx } = context();
    writeFileSync(join(ctx.skillsPath, 'officecli-docx', 'SKILL.md'), '# MALICIOUS USER OVERRIDE');
    const result = await handleOfficeDocumentGuide(ctx, { guide: 'word', topic: 'tables' });

    expect(envelope(result).ok).toBe(true);
    expect(JSON.stringify(data(result))).not.toContain('MALICIOUS USER OVERRIDE');
    expect(envelope(result).artifacts.every(artifact => !artifact.path.startsWith(ctx.skillsPath))).toBe(true);
  });

  it('loads only allowlisted vendored references and blocks executable/traversal paths', async () => {
    const { ctx } = context();
    const allowed = await handleOfficeDocumentGuide(ctx, {
      guide: 'morph-ppt',
      referencePath: 'reference/styles/INDEX.md',
    });
    const executable = await handleOfficeDocumentGuide(ctx, {
      guide: 'morph-ppt',
      referencePath: 'reference/morph-helpers.py',
    });
    const traversal = await handleOfficeDocumentGuide(ctx, {
      guide: 'morph-ppt',
      referencePath: '../officecli-pptx/SKILL.md',
    });

    expect(envelope(allowed).ok).toBe(true);
    expect(envelope(allowed).artifacts[0]?.mimeType).toBe('text/markdown');
    expect(data(allowed).recipeRuntime).toBe('validated-typescript');
    expect(JSON.stringify(data(allowed).recipes)).toContain('buildMorphCloneCommands');
    expect(envelope(executable).error?.code).toBe('reference_type_forbidden');
    expect(envelope(traversal).error?.code).toBe('reference_path_escape');
  });

  it('accepts a validated in-workspace Morph 3D GLB and rejects outside/invalid files', async () => {
    const { ctx, working } = context();
    const valid = join(working, 'scene.glb');
    writeFileSync(valid, validGlbBuffer(4));
    const invalid = join(working, 'invalid.glb');
    writeFileSync(invalid, Buffer.alloc(16));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'selection-office-guide-outside-'));
    roots.push(outsideRoot);
    const outside = join(outsideRoot, 'outside.glb');
    writeFileSync(outside, validGlbBuffer(4));
    const symlinkEscape = join(working, 'linked-outside.glb');
    symlinkSync(outside, symlinkEscape);

    const accepted = await handleOfficeDocumentGuide(ctx, { guide: 'morph-ppt-3d', referencePath: valid });
    const relativeAccepted = await handleOfficeDocumentGuide(ctx, { guide: 'morph-ppt-3d', referencePath: 'scene.glb' });
    const badHeader = await handleOfficeDocumentGuide(ctx, { guide: 'morph-ppt-3d', referencePath: invalid });
    const escaped = await handleOfficeDocumentGuide(ctx, { guide: 'morph-ppt-3d', referencePath: outside });
    const symlinkEscaped = await handleOfficeDocumentGuide(ctx, { guide: 'morph-ppt-3d', referencePath: symlinkEscape });

    expect(envelope(accepted).ok).toBe(true);
    expect(envelope(relativeAccepted).ok).toBe(true);
    expect(envelope(relativeAccepted).artifacts[0]?.path).toBe(realpathSync.native(valid));
    expect(envelope(accepted).artifacts[0]).toMatchObject({ path: realpathSync.native(valid), mimeType: 'model/gltf-binary' });
    expect(envelope(badHeader).error?.code).toBe('invalid_glb');
    expect(envelope(escaped).error?.code).toBe('reference_outside_allowed_roots');
    expect(envelope(symlinkEscaped).error?.code).toBe('reference_outside_allowed_roots');
  });

  it('bounds large Markdown references while preserving the complete artifact', async () => {
    const { ctx } = context();
    const result = await handleOfficeDocumentGuide(ctx, {
      guide: 'pitch-deck',
      referencePath: 'SKILL.md',
    });
    const payloadData = data(result);

    expect(envelope(result).ok).toBe(true);
    expect(String(payloadData.content).length).toBeLessThan(42_000);
    expect(envelope(result).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'guide_reference_truncated' }),
    ]));
    expect(envelope(result).artifacts[0]?.sizeBytes).toBeGreaterThan(40_000);
  });

  it('rejects conflicting selectors and unknown topics with actionable errors', async () => {
    const { ctx } = context();
    const conflict = await handleOfficeDocumentGuide(ctx, {
      guide: 'pptx',
      topic: 'charts',
      referencePath: 'SKILL.md',
    });
    const missing = await handleOfficeDocumentGuide(ctx, { guide: 'excel', topic: 'definitely-no-such-topic-xyz' });

    expect(envelope(conflict).error?.code).toBe('guide_selector_conflict');
    expect(envelope(missing).error).toMatchObject({
      code: 'guide_topic_not_found',
      recovery: expect.stringContaining('compact catalog'),
    });
  });

  it('classifies malformed runtime input as an input error', async () => {
    const { ctx } = context();
    const result = await handleOfficeDocumentGuide(ctx, undefined as never);

    expect(envelope(result).error).toMatchObject({
      code: 'invalid_guide_input',
      category: 'input',
      retriable: false,
    });
  });

  it('preserves working-directory path errors instead of misclassifying them as dependencies', async () => {
    const { ctx, root } = context();
    ctx.workingDirectory = join(root, 'missing-working-directory');

    const result = await handleOfficeDocumentGuide(ctx, { guide: 'word' });

    expect(envelope(result).error).toMatchObject({
      code: 'working_directory_not_found',
      category: 'path',
      retriable: false,
    });
  });
});
