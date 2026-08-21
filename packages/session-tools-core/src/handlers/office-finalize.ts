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
  getOfficeArtifactRevision,
  officeToolResult,
  wasOfficeArtifactMutatedBySession,
  type OfficeCoordinatorDependencies,
} from '../runtime/office-coordinator.ts';
import { renderOfficeDocument } from './office-preview.ts';

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
  const revisionAtStart = openable.envelope.artifactRevision ?? getOfficeArtifactRevision(file) ?? 1;
  const profile = args.profile
    ?? (wasOfficeArtifactMutatedBySession(ctx.sessionId, file) ? 'strict' : 'standard');
  const checks: FinalizationCheck[] = [];
  const warnings: StructuredWarning[] = [...openable.envelope.warnings];

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
  const issues = issueList(issuesOutcome.envelope.data);
  const highSeverityIssues = issues.filter(issue => issue.severity === 0);
  const issuesOk = issuesOutcome.envelope.ok && highSeverityIssues.length === 0;
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

  const extension = extname(file).toLowerCase();
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

  const render = await renderOfficeDocument(ctx, {
    action: 'render',
    file: args.file,
    ...(extension === '.docx' || extension === '.pptx' ? { grid: 'auto' as const } : { page: '1' }),
    renderer: 'auto',
  }, dependencies);
  const renderData = render.envelope.data && typeof render.envelope.data === 'object'
    ? (render.envelope.data as { render?: { dependencyState?: string } }).render
    : undefined;
  const dependencyDegraded = renderData?.dependencyState === 'degraded';
  const finalRenderOk = render.envelope.ok && !dependencyDegraded;
  const finalRenderBlocking = !render.envelope.ok || profile === 'strict';
  checks.push({
    name: 'final_render',
    ok: finalRenderOk,
    blocking: finalRenderBlocking,
    data: render.envelope.data,
    warnings: render.envelope.warnings,
    ...(!finalRenderOk ? {
      error: dependencyDegraded ? {
        code: 'dependency_unavailable',
        category: 'dependency' as const,
        message: 'The final HTML render is degraded because reviewed external assets are unavailable offline.',
        retriable: true,
        recovery: 'Run finalization online or use a supported native renderer for current-revision evidence.',
      } : render.envelope.error,
    } : {}),
  });
  warnings.push(...render.envelope.warnings);

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
      residentFlush: 'standalone_no_open_lease',
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
        message: 'One or more current-revision machine delivery gates failed.',
        retriable: true,
        recovery: 'Repair the blocking checks, then finalize the latest revision again.',
      },
    } : {}),
  };
  return finalResultWithPreview(envelope, render.toolResult, render.previewImagePath);
}
