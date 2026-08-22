import type { SessionToolContext } from '../context.ts';
import { windowsDesktopWordInstalled } from '../integration/office-strict-finalize-gate.ts';
import type { FinalizationCheck, StructuredWarning } from '../office-types.ts';
import {
  executeOfficeCommand,
  type OfficeCoordinatorDependencies,
} from './office-coordinator.ts';

export const TOC_ENTRY_SELECTOR = 'paragraph[style=TOC1 or style=TOC2 or style=TOC3]';

export type TocCompileStatus = 'compiled' | 'deferred' | 'empty' | 'refresh_failed';
export type TocCompileAction = 'native_refresh' | 'defer_to_word' | 'no_sources';

export interface CompileDocxTocOptions {
  nativeRefreshAvailable?: boolean;
}

export interface DocxTocCompileResult {
  detected: boolean;
  mutated: boolean;
  check?: FinalizationCheck;
  warnings: StructuredWarning[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTocNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'toc' || value.type === 'tableofcontents') return true;
  return typeof value.text === 'string' && /^\s*TOC\b/i.test(value.text);
}

export function documentHasTocField(data: unknown): boolean {
  if (data == null) return false;
  if (Array.isArray(data)) return data.some(item => documentHasTocField(item));
  if (!isRecord(data)) return false;
  if (isTocNode(data)) return true;
  return Array.isArray(data.results) && data.results.some(isTocNode);
}

export function officeQueryMatchCount(data: unknown): number {
  if (!isRecord(data)) return 0;
  if (typeof data.matches === 'number' && Number.isFinite(data.matches)) return Math.max(0, data.matches);
  return Array.isArray(data.results) ? data.results.length : 0;
}

export function outlineHeadingSourceCount(data: unknown): number {
  if (!isRecord(data) || !Array.isArray(data.headings)) return 0;
  return data.headings.filter(heading => {
    if (!isRecord(heading)) return false;
    const style = typeof heading.style === 'string' ? heading.style : '';
    if (/^TOC/i.test(style)) return false;
    if (/^Heading[1-3]$/i.test(style)) return true;
    const level = typeof heading.level === 'number' ? heading.level : 0;
    return level >= 1 && level <= 3;
  }).length;
}

export function nativeTocRefreshAvailable(
  platform: NodeJS.Platform = process.platform,
  wordInstalled = platform === 'win32' ? windowsDesktopWordInstalled() : false,
): boolean {
  return platform === 'win32' && wordInstalled;
}

export function planTocCompileAction(nativeRefreshAvailable: boolean): Exclude<TocCompileAction, 'no_sources'> {
  return nativeRefreshAvailable ? 'native_refresh' : 'defer_to_word';
}

export function classifyTocCompile(input: {
  refreshOk: boolean;
  entryMatches: number;
}): Extract<TocCompileStatus, 'compiled' | 'empty' | 'refresh_failed'> {
  if (!input.refreshOk) return 'refresh_failed';
  if (input.entryMatches < 1) return 'empty';
  return 'compiled';
}

export function refreshBackendFromPayload(data: unknown): string | undefined {
  if (isRecord(data) && typeof data.backend === 'string' && data.backend.trim()) {
    return data.backend.trim().toLowerCase();
  }
  const haystack = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data);
  return haystack.match(/backend:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
}

export function docxFieldRefreshWarnings(input: {
  status: TocCompileStatus;
}): StructuredWarning[] {
  if (input.status === 'deferred') {
    return [{
      code: 'docx_toc_deferred',
      message: 'Skipped headless-browser TOC pagination. updateFields=true so Word or WPS will compile the directory on open.',
      severity: 'medium',
      recovery: 'Open the document in Word or WPS if you need in-file TOC entries and page numbers now.',
    }];
  }
  if (input.status === 'empty') {
    return [{
      code: 'docx_toc_empty',
      message: 'The TOC has no Heading 1–3 sources. Use built-in Heading styles or a custom style with outlineLvl. updateFields=true so Word or WPS can rebuild it on open.',
      severity: 'high',
      recovery: 'Change title-like paragraphs to Heading1–Heading3, then finalize again.',
    }];
  }
  if (input.status === 'refresh_failed') {
    return [{
      code: 'docx_toc_uncompiled',
      message: 'Word could not compile the table of contents here. updateFields=true so Word or WPS will rebuild it on open.',
      severity: 'high',
      recovery: 'Open the document in Word or WPS and accept the field-update prompt.',
    }];
  }
  return [];
}

export function refineDeferredTocFromOutline(
  result: DocxTocCompileResult,
  outline: unknown,
): DocxTocCompileResult {
  const data = result.check ? (isRecord(result.check.data) ? result.check.data : undefined) : undefined;
  if (!result.check || !data || data.status !== 'deferred') return result;

  const headingMatches = outlineHeadingSourceCount(outline);
  if (headingMatches > 0) {
    return {
      ...result,
      check: {
        ...result.check,
        data: { ...data, headingMatches },
      },
    };
  }

  const warnings = [
    ...result.warnings.filter(warning => warning.code !== 'docx_toc_deferred'),
    ...docxFieldRefreshWarnings({ status: 'empty' }),
  ];
  return {
    ...result,
    warnings,
    check: {
      ...result.check,
      ok: false,
      data: {
        ...data,
        compiled: false,
        status: 'empty',
        action: 'no_sources',
        fallback: true,
        headingMatches: 0,
      },
      warnings,
      error: {
        code: 'docx_toc_empty',
        category: 'conflict',
        message: 'The TOC field has no Heading 1–3 sources.',
        retriable: true,
        recovery: 'Use Heading1–Heading3 (or outlineLvl), then finalize again.',
      },
    },
  };
}

async function queryMatchCount(
  ctx: SessionToolContext,
  file: string,
  selector: string,
  dependencies: OfficeCoordinatorDependencies,
): Promise<number> {
  const outcome = await executeOfficeCommand(ctx, {
    argv: ['query', file, selector],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  return outcome.envelope.ok ? officeQueryMatchCount(outcome.envelope.data) : 0;
}

async function enableUpdateFields(
  ctx: SessionToolContext,
  file: string,
  dependencies: OfficeCoordinatorDependencies,
) {
  return executeOfficeCommand(ctx, {
    argv: ['set', file, '/settings', '--prop', 'updateFields=true'],
    mode: 'edit',
    mutation: true,
  }, dependencies);
}

function compileResult(input: {
  status: TocCompileStatus;
  action: TocCompileAction;
  compiled: boolean;
  backend?: string;
  update: Awaited<ReturnType<typeof executeOfficeCommand>>;
  extraWarnings?: StructuredWarning[];
  entryMatches: number;
  headingMatches: number;
  error?: FinalizationCheck['error'];
}): DocxTocCompileResult {
  const warnings: StructuredWarning[] = [
    ...(input.extraWarnings ?? []),
    ...input.update.envelope.warnings,
    ...docxFieldRefreshWarnings({ status: input.status }),
  ];
  if (!input.update.envelope.ok) {
    warnings.push({
      code: 'docx_update_fields_failed',
      message: input.update.envelope.error?.message ?? 'Could not set updateFields=true after TOC compile.',
      severity: 'high',
      recovery: 'Set /settings updateFields=true, then open the document in Word or WPS.',
    });
  }
  return {
    detected: true,
    mutated: true,
    warnings,
    check: {
      name: 'docx_field_refresh',
      ok: input.compiled,
      blocking: false,
      data: {
        detected: true,
        compiled: input.compiled,
        status: input.status,
        action: input.action,
        backend: input.backend,
        updateFields: input.update.envelope.ok,
        fallback: !input.compiled,
        entryMatches: input.entryMatches,
        headingMatches: input.headingMatches,
      },
      warnings,
      ...(input.error ? { error: input.error } : {}),
    },
  };
}

export async function compileDocxTocIfPresent(
  ctx: SessionToolContext,
  file: string,
  dependencies: OfficeCoordinatorDependencies = {},
  options: CompileDocxTocOptions = {},
): Promise<DocxTocCompileResult> {
  const probe = await executeOfficeCommand(ctx, {
    argv: ['get', file, '/toc', '--depth', '0'],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  if (!probe.envelope.ok || !documentHasTocField(probe.envelope.data)) {
    return { detected: false, mutated: false, warnings: [] };
  }

  // Do not pre-query TOC1/Heading styles. Uncompiled fields emit "no match for
  // style=TOC*" warnings, leftover TOC1 rows must not skip a Word COM refresh,
  // and Heading1–3 misses outlineLvl sources that Word itself would compile.
  const action = planTocCompileAction(options.nativeRefreshAvailable ?? nativeTocRefreshAvailable());
  if (action === 'defer_to_word') {
    const update = await enableUpdateFields(ctx, file, dependencies);
    return compileResult({
      status: 'deferred',
      action,
      compiled: false,
      update,
      extraWarnings: probe.envelope.warnings,
      entryMatches: 0,
      headingMatches: 0,
    });
  }

  const refresh = await executeOfficeCommand(ctx, {
    argv: ['refresh', file],
    mode: 'edit',
    mutation: true,
  }, dependencies);
  const backend = refreshBackendFromPayload(refresh.envelope.data)
    ?? (refresh.envelope.backend && refresh.envelope.backend !== 'officecli'
      ? refresh.envelope.backend
      : undefined);
  const refreshedEntries = refresh.envelope.ok
    ? await queryMatchCount(ctx, file, TOC_ENTRY_SELECTOR, dependencies)
    : 0;
  const status = classifyTocCompile({
    refreshOk: refresh.envelope.ok,
    entryMatches: refreshedEntries,
  });
  const update = await enableUpdateFields(ctx, file, dependencies);
  return compileResult({
    status,
    action,
    compiled: status === 'compiled',
    backend,
    update,
    extraWarnings: [...probe.envelope.warnings, ...refresh.envelope.warnings],
    entryMatches: refreshedEntries,
    headingMatches: 0,
    ...(status !== 'compiled' ? {
      error: refresh.envelope.error ?? {
        code: status === 'empty' ? 'docx_toc_empty' : 'docx_toc_uncompiled',
        category: 'dependency' as const,
        message: status === 'empty'
          ? 'Word refreshed the TOC without Heading 1–3 entries.'
          : 'Word could not compile the table of contents.',
        retriable: true,
        recovery: status === 'empty'
          ? 'Use Heading1–Heading3 (or outlineLvl), then finalize again.'
          : 'Open the document in Word or WPS so fields update on open.',
      },
    } : {}),
  });
}
