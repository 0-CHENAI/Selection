import { existsSync, openSync, closeSync, readSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type {
  FinalizationCheck,
  FinalizationEvidence,
  OfficeResultEnvelope,
  StructuredWarning,
} from '../office-types.ts';
import type { ToolResult } from '../types.ts';
import {
  executeOfficeCommand,
  flushOfficeResidentLease,
  getOfficeArtifactRevision,
  officeToolResult,
  wasOfficeArtifactMutatedBySession,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import {
  compileDocxTocIfPresent,
  officeQueryMatchCount,
  outlineHeadingSourceCount,
  refineDeferredTocFromOutline,
  type DocxTocCompileResult,
} from '../runtime/office-docx-fields.ts';
import {
  EXCEL_ERROR_SELECTORS,
  WORD_HEADING1_MIN_PT,
  hasHeadingSizeEvidence,
  isSkillFalsePositiveIssue,
  placeholderLeakCount,
  skillHeadingGateRequired,
  skillPageRequired,
  skillTocRequired,
  undersizedHeading1Count,
} from '../runtime/office-delivery-gates.ts';
import { getCachedOfficePreview, renderOfficeDocument } from './office-preview.ts';

export interface OfficeDocumentFinalizeArgs {
  file: string;
  profile?: 'standard' | 'strict';
}

function issueList(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const issues = (data as Record<string, unknown>).issues;
  return Array.isArray(issues)
    ? issues.filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === 'object' && !Array.isArray(issue)))
    : [];
}

function issueWarnings(issues: Array<Record<string, unknown>>): StructuredWarning[] {
  return issues.slice(0, 100).map(issue => ({
    code: typeof issue.subtype === 'string'
      ? issue.subtype
      : typeof issue.id === 'string'
        ? `office_issue_${issue.id}`
        : 'office_document_issue',
    message: `${typeof issue.path === 'string' ? `${issue.path}: ` : ''}${typeof issue.message === 'string' ? issue.message : 'OfficeCLI reported a document issue.'}`,
    severity: issue.severity === 0 ? 'high' : issue.severity === 2 ? 'low' : 'medium',
    ...(typeof issue.suggestion === 'string' ? { recovery: issue.suggestion } : {}),
  }));
}

function readZipHeader(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(4);
    const bytes = readSync(fd, header, 0, 4, 0);
    return bytes === 4 && header[0] === 0x50 && header[1] === 0x4b;
  } finally {
    closeSync(fd);
  }
}

function checkFromOutcome(
  name: string,
  outcome: Awaited<ReturnType<typeof executeOfficeCommand>>,
  blocking: boolean,
): FinalizationCheck {
  return outcome.envelope.ok
    ? { name, ok: true, blocking, data: outcome.envelope.data, warnings: outcome.envelope.warnings }
    : { name, ok: false, blocking, error: outcome.envelope.error, warnings: outcome.envelope.warnings };
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function hasMeaningfulOfficeContent(extension: string, data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (extension === '.docx') {
    return ['paragraphs', 'tables', 'images', 'equations']
      .some(key => numberField(record, key) > 0);
  }
  if (extension === '.xlsx') {
    const sheets = Array.isArray(record.sheets) ? record.sheets : [];
    return sheets.some(sheet => {
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return false;
      const summary = sheet as Record<string, unknown>;
      return ['rows', 'cols', 'formulas', 'tables', 'charts', 'oleObjects']
        .some(key => numberField(summary, key) > 0);
    });
  }
  if (extension === '.pptx') return numberField(record, 'totalSlides') > 0;
  return false;
}

function finalResultWithPreview(
  envelope: OfficeResultEnvelope,
  previewResult: ToolResult | undefined,
  previewPath: string | undefined,
): ToolResult {
  const image = previewResult?.content.find(block => block.type === 'image');
  const text = [
    JSON.stringify(envelope, null, 2),
    ...(previewPath ? [
      '',
      '```image-preview',
      JSON.stringify({ src: previewPath, title: `Office finalization evidence: ${envelope.documentPath}` }, null, 2),
      '```',
    ] : []),
  ].join('\n');
  return {
    content: [
      { type: 'text', text },
      ...(image ? [image] : []),
    ],
    structuredContent: envelope,
    isError: !envelope.ok,
  };
}

export async function handleOfficeDocumentFinalize(
  ctx: SessionToolContext,
  args: OfficeDocumentFinalizeArgs,
  dependencies: OfficeCoordinatorDependencies = {},
): Promise<ToolResult> {
  const startedAt = Date.now();
  if (!args || typeof args.file !== 'string' || !args.file.trim()) {
    return officeToolResult({
      ok: false,
      version: 'unknown',
      schemaCrc: 'unknown',
      command: ['finalize'],
      cwd: ctx.workingDirectory ?? ctx.sessionPath ?? ctx.workspacePath,
      durationMs: 0,
      warnings: [],
      cacheHit: false,
      artifacts: [],
      error: { code: 'file_required', category: 'input', message: 'finalize requires a non-empty file path.', retriable: false },
    });
  }
  if (args.profile !== undefined && args.profile !== 'standard' && args.profile !== 'strict') {
    return officeToolResult({
      ok: false,
      version: 'unknown',
      schemaCrc: 'unknown',
      command: ['finalize', args.file],
      cwd: ctx.workingDirectory ?? ctx.sessionPath ?? ctx.workspacePath,
      durationMs: 0,
      warnings: [],
      cacheHit: false,
      artifacts: [],
      deliveryReady: false,
      error: {
        code: 'invalid_finalize_profile',
        category: 'input',
        message: 'finalize profile must be standard or strict.',
        retriable: false,
      },
    });
  }

  // A root read is both a path/permission check and a real OfficeCLI openability check.
  const openable = await executeOfficeCommand(ctx, {
    argv: ['get', args.file, '/', '--depth', '0'],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  if (!openable.envelope.ok || !openable.envelope.documentPath) {
    const envelope: OfficeResultEnvelope = {
      ...openable.envelope,
      command: ['finalize', args.file],
      deliveryReady: false,
      evidence: {
        file: openable.envelope.documentPath ?? args.file,
        profile: args.profile ?? 'standard',
        artifactRevision: openable.envelope.artifactRevision ?? 0,
        generatedAt: new Date().toISOString(),
        checks: [checkFromOutcome('file_openable', openable, true)],
      },
    };
    return officeToolResult(envelope);
  }
  const file = openable.envelope.documentPath;
  const profile = args.profile
    ?? (wasOfficeArtifactMutatedBySession(ctx.sessionId, file) ? 'strict' : 'standard');
  const flushed = await flushOfficeResidentLease(ctx, file, dependencies);
  if (flushed && !flushed.envelope.ok) {
    return officeToolResult({
      ...flushed.envelope,
      command: ['finalize', args.file, '--profile', profile],
      documentPath: file,
      deliveryReady: false,
      data: {
        gate: 'machine',
        claim: 'machine_gates_blocked',
        humanMicrosoftOfficeVisualApproval: false,
        residentFlush: 'selection_lease_flush_failed',
      },
      evidence: {
        file,
        profile,
        artifactRevision: openable.envelope.artifactRevision ?? getOfficeArtifactRevision(file) ?? 1,
        generatedAt: new Date().toISOString(),
        checks: [{
          name: 'resident_flush',
          ok: false,
          blocking: true,
          error: flushed.envelope.error,
          warnings: flushed.envelope.warnings,
        }],
      },
    });
  }
  let residentFlush = flushed ? 'selection_lease_saved' : 'standalone_no_open_lease';
  const checks: FinalizationCheck[] = [];
  const warnings: StructuredWarning[] = [...openable.envelope.warnings];
  const revisionBeforeCompile = getOfficeArtifactRevision(file) ?? 1;
  let compiledToc: DocxTocCompileResult | undefined;
  if (extname(file).toLowerCase() === '.docx') {
    compiledToc = await compileDocxTocIfPresent(ctx, file, dependencies);
    if (compiledToc.mutated) {
      const compiledFlush = await flushOfficeResidentLease(ctx, file, dependencies);
      if (compiledFlush && !compiledFlush.envelope.ok) {
        return officeToolResult({
          ...compiledFlush.envelope,
          command: ['finalize', args.file, '--profile', profile],
          documentPath: file,
          deliveryReady: false,
          data: {
            gate: 'machine',
            claim: 'machine_gates_blocked',
            humanMicrosoftOfficeVisualApproval: false,
            residentFlush: 'selection_lease_flush_failed',
          },
          evidence: {
            file,
            profile,
            artifactRevision: getOfficeArtifactRevision(file) ?? 1,
            generatedAt: new Date().toISOString(),
            checks: [
              ...checks,
              ...(compiledToc.check ? [compiledToc.check] : []),
              {
                name: 'resident_flush',
                ok: false,
                blocking: true,
                error: compiledFlush.envelope.error,
                warnings: compiledFlush.envelope.warnings,
              },
            ],
          },
        });
      }
      if (compiledFlush) residentFlush = 'selection_lease_saved';
    }
  }
  const revisionAtStart = getOfficeArtifactRevision(file) ?? 1;

  let headerOk = false;
  let sizeBytes = 0;
  try {
    if (existsSync(file)) {
      sizeBytes = statSync(file).size;
      headerOk = sizeBytes > 0 && readZipHeader(file);
    }
  } catch {
    headerOk = false;
  }
  checks.push({
    name: 'file_exists_size_zip_header',
    ok: headerOk,
    blocking: true,
    data: { exists: existsSync(file), sizeBytes, openXmlZipHeader: headerOk },
    ...(!headerOk ? {
      error: {
        code: 'file_not_openxml_package',
        category: 'path' as const,
        message: 'The output is missing, empty, or not an OpenXML ZIP package.',
        retriable: false,
      },
    } : {}),
  });
  checks.push(checkFromOutcome('file_openable', openable, true));

  const validate = await executeOfficeCommand(ctx, {
    argv: ['validate', args.file],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  const validateBlocking = profile === 'strict';
  checks.push(checkFromOutcome('openxml_validate', validate, validateBlocking));
  warnings.push(...validate.envelope.warnings);
  if (!validate.envelope.ok && !validateBlocking) {
    warnings.push({
      code: 'validation_failed_standard_profile',
      message: validate.envelope.error?.message ?? 'OpenXML validation failed under the standard profile.',
      severity: 'high',
      recovery: 'Use profile=strict after repairing structural errors for a delivery gate.',
    });
  }

  const issuesOutcome = await executeOfficeCommand(ctx, {
    argv: ['view', args.file, 'issues', '--limit', '200'],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  const extension = extname(file).toLowerCase();
  const issues = issueList(issuesOutcome.envelope.data)
    .filter(issue => !isSkillFalsePositiveIssue(extension, issue));
  const highSeverityIssues = issues.filter(issue => issue.severity === 0);
  const issuesOk = issuesOutcome.envelope.ok && (
    extension === '.pptx' ? issues.length === 0 : highSeverityIssues.length === 0
  );
  const issuesBlocking = profile === 'strict';
  const issuesWarnings = issueWarnings(issues);
  checks.push({
    name: 'format_structure_content_issues',
    ok: issuesOk,
    blocking: issuesBlocking,
    data: {
      count: issues.length,
      highSeverityCount: highSeverityIssues.length,
      issues,
    },
    warnings: [...issuesOutcome.envelope.warnings, ...issuesWarnings],
    ...(!issuesOutcome.envelope.ok ? { error: issuesOutcome.envelope.error } : {}),
  });
  warnings.push(...issuesOutcome.envelope.warnings, ...issuesWarnings);

  const contentOutcome = await executeOfficeCommand(ctx, {
    argv: ['view', args.file, 'outline'],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  const meaningfulContent = contentOutcome.envelope.ok
    && hasMeaningfulOfficeContent(extension, contentOutcome.envelope.data);
  checks.push(contentOutcome.envelope.ok ? {
    name: 'key_content_summary',
    ok: meaningfulContent,
    blocking: true,
    data: contentOutcome.envelope.data,
    warnings: contentOutcome.envelope.warnings,
    ...(!meaningfulContent ? {
      error: {
        code: 'empty_or_unrecognized_content',
        category: 'conflict' as const,
        message: 'OfficeCLI opened the file, but its format-specific outline contains no meaningful document content.',
        retriable: true,
        recovery: 'Add the required document content, then rerun finalize.',
      },
    } : {}),
  } : checkFromOutcome('key_content_summary', contentOutcome, true));
  warnings.push(...contentOutcome.envelope.warnings);
  if (compiledToc) {
    const refined = refineDeferredTocFromOutline(compiledToc, contentOutcome.envelope.data);
    warnings.push(...refined.warnings);
    if (refined.check) checks.push(refined.check);
  }

  const textOutcome = await executeOfficeCommand(ctx, {
    argv: ['view', args.file, 'text'],
    mode: 'internal',
    mutation: false,
    cacheable: false,
  }, dependencies);
  const leakCount = textOutcome.envelope.ok ? placeholderLeakCount(textOutcome.envelope.data) : 0;
  const leakOk = textOutcome.envelope.ok && leakCount === 0;
  checks.push({
    name: 'skill_placeholder_leak',
    ok: leakOk,
    blocking: true,
    data: { leakCount },
    warnings: textOutcome.envelope.warnings,
    ...(!leakOk ? {
      error: {
        code: 'docx_placeholder_leak',
        category: 'conflict' as const,
        message: textOutcome.envelope.ok
          ? `The document text still contains ${leakCount} placeholder or escaped-token leak(s).`
          : textOutcome.envelope.error?.message ?? 'Could not scan document text for placeholder leaks.',
        retriable: true,
        recovery: 'Remove $var$, {var}, {{placeholders}}, <TODO>, xxxx, lorem/ipsum, placeholder, and literal \\$ \\t \\n. See the skill Delivery Gate.',
      },
    } : {}),
  });
  warnings.push(...textOutcome.envelope.warnings);

  const headingMatches = outlineHeadingSourceCount(contentOutcome.envelope.data);
  if (skillHeadingGateRequired(extension, contentOutcome.envelope.data) && headingMatches < 1) {
    const headingBlocking = profile === 'strict';
    checks.push({
      name: 'skill_heading_sources',
      ok: false,
      blocking: headingBlocking,
      data: { headingMatches },
      ...(!headingBlocking ? {} : {
        error: {
          code: 'docx_heading_hierarchy_missing',
          category: 'conflict' as const,
          message: 'A non-trivial Word document must use Heading1–3 or outlineLvl, not only Normal paragraphs.',
          retriable: true,
          recovery: 'Change title-like paragraphs to Heading1–Heading3, then finalize again. See word Requirements for Outputs.',
        },
      }),
    });
    if (!headingBlocking) {
      warnings.push({
        code: 'docx_heading_hierarchy_missing',
        message: 'A non-trivial Word document should use Heading1–3 or outlineLvl.',
        severity: 'high',
        recovery: 'Change title-like paragraphs to Heading1–Heading3.',
      });
    }
  }

  let headingSizeData = contentOutcome.envelope.data;
  if (extension === '.docx' && headingMatches >= 1 && !hasHeadingSizeEvidence(headingSizeData)) {
    const headingSizeOutcome = await executeOfficeCommand(ctx, {
      argv: ['query', args.file, 'paragraph[style=Heading1]'],
      mode: 'internal',
      mutation: false,
      cacheable: false,
    }, dependencies);
    if (headingSizeOutcome.envelope.ok) headingSizeData = headingSizeOutcome.envelope.data;
  }
  if (extension === '.docx' && hasHeadingSizeEvidence(headingSizeData)) {
    const undersized = undersizedHeading1Count(headingSizeData);
    const sizeOk = undersized === 0;
    const sizeBlocking = profile === 'strict';
    checks.push({
      name: 'skill_heading_size',
      ok: sizeOk,
      blocking: sizeBlocking,
      data: { undersized, minPt: WORD_HEADING1_MIN_PT },
      ...(!sizeOk && sizeBlocking ? {
        error: {
          code: 'docx_heading_size_below_floor',
          category: 'conflict' as const,
          message: `Heading1 must be at least ${WORD_HEADING1_MIN_PT}pt. Found ${undersized} undersized title(s).`,
          retriable: true,
          recovery: `Set Heading1 size to ${WORD_HEADING1_MIN_PT}pt or larger. See word Requirements for Outputs.`,
        },
      } : {}),
    });
    if (!sizeOk && !sizeBlocking) {
      warnings.push({
        code: 'docx_heading_size_below_floor',
        message: `Heading1 should be at least ${WORD_HEADING1_MIN_PT}pt.`,
        severity: 'high',
        recovery: `Set Heading1 size to ${WORD_HEADING1_MIN_PT}pt or larger.`,
      });
    }
  }

  if (extension === '.xlsx') {
    let errorMatches = 0;
    const selectors: string[] = [];
    for (const selector of EXCEL_ERROR_SELECTORS) {
      const errorOutcome = await executeOfficeCommand(ctx, {
        argv: ['query', args.file, selector],
        mode: 'internal',
        mutation: false,
        cacheable: false,
      }, dependencies);
      const matches = errorOutcome.envelope.ok ? officeQueryMatchCount(errorOutcome.envelope.data) : 0;
      if (matches > 0) {
        errorMatches += matches;
        selectors.push(selector);
      }
    }
    const errorsOk = errorMatches === 0;
    checks.push({
      name: 'skill_excel_errors',
      ok: errorsOk,
      blocking: true,
      data: { errorMatches, selectors },
      ...(!errorsOk ? {
        error: {
          code: 'xlsx_formula_error_cells',
          category: 'conflict' as const,
          message: `The workbook still contains ${errorMatches} Excel error cell(s).`,
          retriable: true,
          recovery: 'Fix #REF!, #DIV/0!, #VALUE!, #NAME?, and #N/A cells. See excel QA (Required).',
        },
      } : {}),
    });
  }

  if (extension === '.docx' && skillTocRequired(contentOutcome.envelope.data)) {
    const tocCheckOk = Boolean(compiledToc?.detected);
    checks.push({
      name: 'skill_toc_field',
      ok: tocCheckOk,
      blocking: true,
      data: { headingMatches, detected: tocCheckOk },
      ...(!tocCheckOk ? {
        error: {
          code: 'docx_toc_required',
          category: 'conflict' as const,
          message: 'Documents with 3+ heading sources must include a TOC field.',
          retriable: true,
          recovery: 'Add --type toc after Heading1–3 sources exist. See word Table of Contents.',
        },
      } : {}),
    });
  }
  if (extension === '.docx' && skillPageRequired(contentOutcome.envelope.data)) {
    const pageOutcome = await executeOfficeCommand(ctx, {
      argv: ['query', args.file, 'field[fieldType=page]'],
      mode: 'internal',
      mutation: false,
      cacheable: false,
    }, dependencies);
    const pageMatches = pageOutcome.envelope.ok
      ? officeQueryMatchCount(pageOutcome.envelope.data)
      : 0;
    const pageOk = pageMatches > 0;
    checks.push({
      name: 'skill_page_field',
      ok: pageOk,
      blocking: true,
      data: { matches: pageMatches },
      warnings: pageOutcome.envelope.warnings,
      ...(!pageOk ? {
        error: {
          code: 'docx_page_field_required',
          category: 'conflict' as const,
          message: 'Multi-page or heading-structured Word documents must include a live PAGE field in the header or footer.',
          retriable: true,
          recovery: 'Add a footer with --prop field=page. See word Delivery Gate 3.',
        },
      } : {}),
    });
    warnings.push(...pageOutcome.envelope.warnings);
  }

  const cachedPreview = getCachedOfficePreview(ctx.sessionId, file, revisionAtStart)
    ?? getCachedOfficePreview(ctx.sessionId, args.file, revisionAtStart)
    ?? getCachedOfficePreview(ctx.sessionId, file, revisionBeforeCompile)
    ?? getCachedOfficePreview(ctx.sessionId, args.file, revisionBeforeCompile);
  const render = cachedPreview
    ? { envelope: cachedPreview.envelope, toolResult: cachedPreview.toolResult, previewImagePath: cachedPreview.previewImagePath, fullImagePath: cachedPreview.fullImagePath }
    : await renderOfficeDocument(ctx, {
      action: 'render',
      file: args.file,
      page: '1',
      renderer: 'auto',
    }, dependencies);
  const renderData = render.envelope.data && typeof render.envelope.data === 'object'
    ? (render.envelope.data as { render?: { dependencyState?: string } }).render
    : undefined;
  const dependencyDegraded = renderData?.dependencyState === 'degraded';
  const finalRenderOk = render.envelope.ok && !dependencyDegraded;
  const visualWarning: StructuredWarning | undefined = finalRenderOk ? undefined : {
    code: 'visual_not_verified',
    message: dependencyDegraded
      ? 'Final visual evidence is degraded because reviewed external assets are unavailable offline.'
      : render.envelope.error?.message ?? 'Final visual evidence could not be rendered.',
    severity: 'medium',
    recovery: 'Open the document or rerun office_document_preview.render when you need a visual pass. Delivery is not blocked.',
  };
  checks.push({
    name: 'final_render',
    ok: finalRenderOk,
    blocking: false,
    data: {
      ...(typeof render.envelope.data === 'object' && render.envelope.data && !Array.isArray(render.envelope.data)
        ? render.envelope.data
        : { render: render.envelope.data }),
      reusedPreview: Boolean(cachedPreview),
    },
    warnings: [...render.envelope.warnings, ...(visualWarning ? [visualWarning] : [])],
    ...(!finalRenderOk ? {
      error: dependencyDegraded ? {
        code: 'dependency_unavailable',
        category: 'dependency' as const,
        message: 'The final HTML render is degraded because reviewed external assets are unavailable offline.',
        retriable: true,
        recovery: 'Run a preview online or accept visual_not_verified. Screenshot failure does not block delivery.',
      } : render.envelope.error,
    } : {}),
  });
  warnings.push(...render.envelope.warnings);
  if (visualWarning) warnings.push(visualWarning);

  const revisionAtEnd = getOfficeArtifactRevision(file) ?? revisionAtStart;
  const revisionCurrent = revisionAtEnd === revisionAtStart;
  checks.push({
    name: 'artifact_revision_current',
    ok: revisionCurrent,
    blocking: true,
    data: { revisionAtStart, revisionAtEnd },
    ...(!revisionCurrent ? {
      error: {
        code: 'artifact_changed_during_finalize',
        category: 'conflict' as const,
        message: 'The document changed while finalization was running, so its evidence is stale.',
        retriable: true,
        recovery: 'Stop concurrent edits and run finalize again.',
      },
    } : {}),
  });

  const deliveryReady = checks.every(check => !check.blocking || check.ok);
  const evidence: FinalizationEvidence = {
    file,
    profile,
    artifactRevision: revisionAtEnd,
    generatedAt: new Date().toISOString(),
    backend: render.envelope.backend,
    checks,
  };
  const artifacts = [
    ...openable.envelope.artifacts,
    ...render.envelope.artifacts.filter(artifact => !openable.envelope.artifacts.some(existing => existing.path === artifact.path)),
  ];
  const envelope: OfficeResultEnvelope = {
    ok: deliveryReady,
    version: openable.envelope.version,
    schemaCrc: openable.envelope.schemaCrc,
    command: ['finalize', args.file, '--profile', profile],
    cwd: openable.envelope.cwd,
    documentPath: file,
    durationMs: Math.max(0, Date.now() - startedAt),
    data: {
      gate: 'machine',
      claim: deliveryReady ? 'machine_gates_passed' : 'machine_gates_blocked',
      humanMicrosoftOfficeVisualApproval: false,
      residentFlush,
    },
    backend: render.envelope.backend,
    warnings,
    cacheHit: false,
    artifactRevision: revisionAtEnd,
    artifacts,
    evidence,
    deliveryReady,
    ...(!deliveryReady ? {
      error: {
        code: 'finalization_blocked',
        category: 'conflict' as const,
        message: checks.find(check => check.blocking && !check.ok)?.error?.message
          ?? 'One or more current-revision machine delivery gates failed.',
        retriable: true,
        recovery: checks.find(check => check.blocking && !check.ok)?.error?.recovery
          ?? 'Repair the blocking checks, then finalize the latest revision again.',
      },
    } : {}),
  };
  return finalResultWithPreview(envelope, render.toolResult, render.previewImagePath);
}
