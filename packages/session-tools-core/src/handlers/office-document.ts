import type { SessionToolContext } from '../context.ts';
import type { OfficeResultEnvelope } from '../office-types.ts';
import type { ToolResult } from '../types.ts';
import {
  executeOfficeCommand,
  officeToolResult,
  type OfficeBatchInput,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { takeSkillBootstrapForCreate } from './office-guide.ts';
import {
  buildMorphCleanAccumulationCommands,
  buildMorphCloneCommands,
  buildMorphGhostCommands,
  checkMorphGhostAccumulation,
  verifyMorphSlide,
} from '../runtime/office-recipes.ts';
import { guideNameForCreateArgv } from '../runtime/office-skill-bootstrap.ts';

export interface OfficeInspectRecipe {
  name: 'verify' | 'final-check';
  file: string;
  slide?: number;
  previousSlide?: number;
}

export interface OfficeEditRecipe {
  name: 'clone' | 'ghost' | 'clean-accumulation';
  file: string;
  fromSlide?: number;
  toSlide?: number;
  slide?: number;
  shapeIndexes?: number[];
  queryData?: unknown;
  threshold?: number;
}

export interface OfficeDocumentInspectArgs {
  argv?: string[];
  recipe?: OfficeInspectRecipe;
  timeoutMs?: number;
}

export interface OfficeDocumentEditArgs {
  argv?: string[];
  recipe?: OfficeEditRecipe;
  batch?: OfficeBatchInput;
  timeoutMs?: number;
}

function recipeError(ctx: SessionToolContext, command: string[], message: string): ToolResult {
  return officeToolResult({
    ok: false,
    version: 'unknown',
    schemaCrc: 'unknown',
    command,
    cwd: ctx.workingDirectory ?? ctx.sessionPath ?? ctx.workspacePath,
    durationMs: 0,
    warnings: [],
    cacheHit: false,
    artifacts: [],
    error: { code: 'invalid_recipe', category: 'input', message, retriable: false },
  });
}

function outlineSlideCount(data: unknown): number {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  const record = data as Record<string, unknown>;
  if (typeof record.totalSlides === 'number' && Number.isFinite(record.totalSlides)) return record.totalSlides;
  return Array.isArray(record.slides) ? record.slides.length : 0;
}

async function runInspectRecipe(
  ctx: SessionToolContext,
  recipe: OfficeInspectRecipe,
  timeoutMs: number | undefined,
  dependencies: OfficeCoordinatorDependencies,
): Promise<ToolResult> {
  if (recipe.name === 'verify') {
    if (!recipe.slide || !Number.isInteger(recipe.slide) || recipe.slide < 1) {
      return recipeError(ctx, ['inspect', 'recipe', 'verify'], 'verify requires a positive slide number.');
    }
    const previousSlide = recipe.previousSlide ?? (recipe.slide > 1 ? recipe.slide - 1 : undefined);
    const current = await executeOfficeCommand(ctx, {
      argv: ['get', recipe.file, `/slide[${recipe.slide}]`],
      mode: 'inspect',
      cacheable: true,
      mutation: false,
      timeoutMs,
    }, dependencies);
    if (!current.envelope.ok) return officeToolResult(current.envelope);
    let previousData: unknown;
    if (previousSlide) {
      const previous = await executeOfficeCommand(ctx, {
        argv: ['get', recipe.file, `/slide[${previousSlide}]`],
        mode: 'inspect',
        cacheable: true,
        mutation: false,
        timeoutMs,
      }, dependencies);
      if (!previous.envelope.ok) return officeToolResult(previous.envelope);
      previousData = previous.envelope.data;
    }
    const verification = verifyMorphSlide(current.envelope.data, previousData, previousSlide);
    const envelope: OfficeResultEnvelope = {
      ...current.envelope,
      command: ['inspect', 'recipe', 'verify'],
      data: { recipe: recipe.name, slide: recipe.slide, previousSlide, verification },
      warnings: [
        ...current.envelope.warnings,
        ...(!verification.ok ? [{
          code: 'morph_verify_failed',
          message: verification.issues.map(issue => issue.message).join(' ') || 'Morph verify found issues.',
          severity: 'high' as const,
        }] : []),
      ],
      cacheHit: false,
    };
    return officeToolResult(envelope);
  }

  const outline = await executeOfficeCommand(ctx, {
    argv: ['view', recipe.file, 'outline'],
    mode: 'inspect',
    cacheable: true,
    mutation: false,
    timeoutMs,
  }, dependencies);
  if (!outline.envelope.ok) return officeToolResult(outline.envelope);
  const totalSlides = outlineSlideCount(outline.envelope.data);
  const slides = [];
  let previousData: unknown;
  for (let slide = 1; slide <= totalSlides; slide += 1) {
    const current = await executeOfficeCommand(ctx, {
      argv: ['get', recipe.file, `/slide[${slide}]`],
      mode: 'inspect',
      cacheable: true,
      mutation: false,
      timeoutMs,
    }, dependencies);
    if (!current.envelope.ok) return officeToolResult(current.envelope);
    slides.push({ slide, ...verifyMorphSlide(current.envelope.data, previousData, slide > 1 ? slide - 1 : undefined) });
    previousData = current.envelope.data;
  }
  const accumulation = totalSlides < 1
    ? { ok: true, issues: [] }
    : await (async () => {
      const ghosts = await executeOfficeCommand(ctx, {
        argv: ['query', recipe.file, 'shape[x>=34cm]'],
        mode: 'inspect',
        cacheable: true,
        mutation: false,
        timeoutMs,
      }, dependencies);
      return ghosts.envelope.ok
        ? checkMorphGhostAccumulation(ghosts.envelope.data, totalSlides)
        : { ok: false, issues: [{ code: 'ghost_accumulation' as const, message: ghosts.envelope.error?.message ?? 'Ghost query failed.', blocking: true }] };
    })();
  const ok = slides.every(slide => slide.ok) && accumulation.ok;
  const envelope: OfficeResultEnvelope = {
    ...outline.envelope,
    command: ['inspect', 'recipe', 'final-check'],
    data: {
      recipe: recipe.name,
      totalSlides,
      slides,
      accumulation,
      ok,
    },
    warnings: [
      ...outline.envelope.warnings,
      ...(!ok ? [{
        code: 'morph_final_check_failed',
        message: 'Morph final-check found transition, ghost, or accumulation issues.',
        severity: 'high' as const,
      }] : []),
    ],
    cacheHit: false,
  };
  return officeToolResult(envelope);
}

async function runEditRecipe(
  ctx: SessionToolContext,
  recipe: OfficeEditRecipe,
  timeoutMs: number | undefined,
  dependencies: OfficeCoordinatorDependencies,
): Promise<ToolResult> {
  let commands: string[];
  try {
    if (recipe.name === 'clone') {
      if (!recipe.fromSlide || !recipe.toSlide) {
        return recipeError(ctx, ['edit', 'recipe', 'clone'], 'clone requires fromSlide and toSlide.');
      }
      commands = buildMorphCloneCommands(recipe.fromSlide, recipe.toSlide);
    } else if (recipe.name === 'ghost') {
      if (!recipe.slide || !recipe.shapeIndexes?.length) {
        return recipeError(ctx, ['edit', 'recipe', 'ghost'], 'ghost requires slide and shapeIndexes.');
      }
      commands = buildMorphGhostCommands(recipe.slide, recipe.shapeIndexes);
    } else {
      commands = buildMorphCleanAccumulationCommands(recipe.queryData, recipe.threshold);
    }
  } catch (error) {
    return recipeError(ctx, ['edit', 'recipe', recipe.name], error instanceof Error ? error.message : String(error));
  }
  const result = await executeOfficeCommand(ctx, {
    argv: ['batch', recipe.file],
    batch: { commands },
    timeoutMs,
    mode: 'edit',
    cacheable: false,
    mutation: true,
  }, dependencies);
  if (!result.envelope.ok) return officeToolResult(result.envelope);
  return officeToolResult({
    ...result.envelope,
    data: { recipe: recipe.name, batch: result.envelope.data },
  });
}

export async function handleOfficeDocumentInspect(
  ctx: SessionToolContext,
  args: OfficeDocumentInspectArgs,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<ToolResult> {
  if (args.recipe && args.argv?.length) {
    return recipeError(ctx, ['inspect'], 'Provide exactly one of argv or recipe.');
  }
  if (args.recipe) return runInspectRecipe(ctx, args.recipe, args.timeoutMs, dependencies);
  if (!args.argv?.length) return recipeError(ctx, ['inspect'], 'inspect requires argv or a read-only recipe.');
  const result = await executeOfficeCommand(ctx, {
    argv: args.argv,
    timeoutMs: args.timeoutMs,
    mode: 'inspect',
    cacheable: true,
    mutation: false,
  }, dependencies);
  return officeToolResult(result.envelope);
}

export async function handleOfficeDocumentEdit(
  ctx: SessionToolContext,
  args: OfficeDocumentEditArgs,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<ToolResult> {
  if (args.recipe && args.argv?.length) {
    return recipeError(ctx, ['edit'], 'Provide exactly one of argv or recipe.');
  }
  if (args.recipe) return runEditRecipe(ctx, args.recipe, args.timeoutMs, dependencies);
  if (!args.argv?.length) return recipeError(ctx, ['edit'], 'edit requires argv or a Morph recipe.');
  const result = await executeOfficeCommand(ctx, {
    argv: args.argv,
    batch: args.batch,
    timeoutMs: args.timeoutMs,
    mode: 'edit',
    cacheable: false,
    mutation: true,
  }, dependencies);
  const envelope = result.envelope;
  if (envelope.ok && args.argv[0] === 'create') {
    const guide = guideNameForCreateArgv(args.argv);
    if (guide) {
      const skillBootstrap = takeSkillBootstrapForCreate(ctx.sessionId, guide);
      if (skillBootstrap) {
        const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
          ? envelope.data as Record<string, unknown>
          : { value: envelope.data };
        return officeToolResult({ ...envelope, data: { ...data, skillBootstrap } });
      }
    }
  }
  return officeToolResult(envelope);
}
