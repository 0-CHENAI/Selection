import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import type { TextContent, ToolContent, ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { resolveOfficecliDocumentPath } from './officecli-path.ts';
import {
  parseOfficecliJson,
  runOfficecli,
  withOfficecliFileLock,
  type OfficecliProcessResult,
} from '../runtime/officecli-runtime.ts';
import { OfficecliQaSchema } from './officecli-schemas.ts';
import { inspectOfficecliAttribution } from './officecli-metadata.ts';

export interface OfficecliQaArgs {
  file: string;
  mode?: 'balanced' | 'strict';
}

export interface OfficecliQaCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface OfficecliQaResult {
  structuralStatus: 'passed' | 'failed';
  visualStatus: 'checked' | 'skipped_no_vision' | 'render_failed';
  checks: OfficecliQaCheck[];
  requiresHumanVisualReview: boolean;
  mode: 'balanced' | 'strict';
  durationMs: number;
  errorType?: 'command_error' | 'render_error';
}

type JsonResult = {
  process: OfficecliProcessResult;
  json: Record<string, unknown> | null;
};

const QA_TOTAL_TIMEOUT_MS = 120_000;
const QA_COMMAND_TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;

function commandPassed(result: JsonResult): boolean {
  return !result.process.timedOut &&
    !result.process.outputTruncated &&
    result.process.exitCode === 0 &&
    result.json?.success === true;
}

function isPng(buffer: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, signature.length).equals(signature)) return false;

  let offset = signature.length;
  let chunkIndex = 0;
  let hasIdat = false;
  while (offset <= buffer.length - 12) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return false;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (width === 0 || height === 0 || width > 20_000 || height > 20_000) return false;
    }
    if (type === 'IDAT') hasIdat = true;
    if (type === 'IEND') return length === 0 && hasIdat && chunkEnd === buffer.length;
    offset = chunkEnd;
    chunkIndex += 1;
  }
  return false;
}

function dataObject(result: JsonResult): Record<string, unknown> | undefined {
  const data = result.json?.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : undefined;
}

function matchCount(result: JsonResult): number {
  const data = dataObject(result);
  return typeof data?.matches === 'number' ? data.matches : 0;
}

function hasHeadingOutlineLevels(value: unknown): boolean {
  const levels = new Map<string, string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const format = record.format;
    if (format && typeof format === 'object' && !Array.isArray(format)) {
      const props = format as Record<string, unknown>;
      if (typeof props.styleId === 'string') {
        const children = Array.isArray(record.children) ? record.children : [];
        const outline = children
          .map(child => child && typeof child === 'object'
            ? (child as Record<string, unknown>).format
            : undefined)
          .find(childFormat =>
            childFormat && typeof childFormat === 'object' &&
            typeof (childFormat as Record<string, unknown>).outlineLvl === 'string'
          ) as Record<string, unknown> | undefined;
        if (outline) levels.set(props.styleId, String(outline.outlineLvl));
      }
    }
    for (const child of Array.isArray(record.children) ? record.children : []) visit(child);
    for (const result of Array.isArray(record.results) ? record.results : []) visit(result);
    if (record.data) visit(record.data);
  };
  visit(value);
  return levels.get('Heading1') === '0' && levels.get('Heading2') === '1' && levels.get('Heading3') === '2';
}

function placeholderCount(text: string): number {
  const patterns = [
    /\{\{[^{}\r\n]+\}\}/g,
    /\[(?:TODO|TBD|PLACEHOLDER)\]/gi,
    /<<(?:TODO|TBD|[^<>\r\n]{1,80})>>/gi,
    /\b(?:TODO|TBD|Lorem ipsum)\b/gi,
    /\\[nrtvabf]/g,
  ];
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
}

function qaResponse(result: OfficecliQaResult, image?: Buffer): ToolResult {
  const failed = result.structuralStatus === 'failed';
  const content: [TextContent, ...ToolContent[]] = [
    { type: 'text', text: `${failed ? '[ERROR] ' : ''}${JSON.stringify(result, null, 2)}` },
  ];
  if (image) {
    content.push({ type: 'image', data: image.toString('base64'), mimeType: 'image/png' });
  }
  return {
    content,
    structuredContent: result as unknown as Record<string, unknown>,
    isError: failed,
  };
}

export async function handleOfficecliQa(
  ctx: SessionToolContext,
  args: OfficecliQaArgs,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const validated = OfficecliQaSchema.safeParse(args);
  if (!validated.success) {
    return errorResponse(`Invalid officecli_qa input: ${validated.error.issues.map(issue => issue.message).join('; ')}`);
  }
  args = validated.data;
  if (!ctx.officecli?.binaryPath) {
    return errorResponse('officecli_qa is unavailable because this Selection build has no app-managed OfficeCLI runtime.');
  }
  const resolved = resolveOfficecliDocumentPath(ctx, args.file, { docxOnly: true });
  if (!resolved.file) return errorResponse(resolved.error ?? 'Invalid Word file path.');
  const file = resolved.file;
  const officecli = ctx.officecli;

  return withOfficecliFileLock(file, async () => {
    const mode = args.mode ?? 'balanced';
    const cwd = ctx.workingDirectory ?? ctx.workspacePath;
    const deadline = Date.now() + QA_TOTAL_TIMEOUT_MS;
    const remainingTimeout = () => Math.max(1, Math.min(QA_COMMAND_TIMEOUT_MS, deadline - Date.now()));
    const executeJson = async (commandArgs: string[]): Promise<JsonResult> => {
      const process = await runOfficecli(officecli.binaryPath, [...commandArgs, '--json'], {
        cwd,
        timeoutMs: remainingTimeout(),
      });
      return { process, json: parseOfficecliJson(process.stdout) };
    };

    try {
    const checks: OfficecliQaCheck[] = [];
    let commandError = false;

    const validate = await executeJson(['validate', file]);
    checks.push({
      name: 'openxml_validation',
      passed: commandPassed(validate),
      detail: commandPassed(validate) ? 'OpenXML validation passed.' : 'OpenXML validation failed.',
    });
    commandError ||= !commandPassed(validate);

    const issues = await executeJson(['view', file, 'issues']);
    const issuesData = dataObject(issues);
    const issueCount = typeof issuesData?.count === 'number' ? issuesData.count : 0;
    const issueItems = Array.isArray(issuesData?.issues) ? issuesData.issues : [];
    const highSeverityIssueCount = issueItems.filter(issue =>
      issue && typeof issue === 'object' &&
      typeof (issue as Record<string, unknown>).severity === 'number' &&
      ((issue as Record<string, unknown>).severity as number) >= 3
    ).length;
    const issuesPassed = commandPassed(issues) &&
      (mode === 'strict' ? issueCount === 0 : highSeverityIssueCount === 0);
    checks.push({
      name: 'issues_scan',
      passed: issuesPassed,
      detail: commandPassed(issues)
        ? `${issueCount} issue(s) found; ${highSeverityIssueCount} high-severity.`
        : 'Issue scan failed.',
    });
    commandError ||= !commandPassed(issues);

    const outline = await executeJson(['view', file, 'outline']);
    const headingCount = Array.isArray(dataObject(outline)?.headings)
      ? (dataObject(outline)!.headings as unknown[]).length
      : 0;
    checks.push({
      name: 'heading_outline',
      passed: commandPassed(outline) && headingCount > 0,
      detail: `${headingCount} heading(s) found.`,
    });
    commandError ||= !commandPassed(outline);

    const styles = await executeJson(['get', file, '/styles', '--depth', '2']);
    const stylesPassed = commandPassed(styles) && hasHeadingOutlineLevels(styles.json);
    checks.push({
      name: 'heading_style_levels',
      passed: stylesPassed,
      detail: stylesPassed
        ? 'Heading1–Heading3 outline levels are 0–2.'
        : 'Heading1–Heading3 outline levels are missing or invalid.',
    });
    commandError ||= !commandPassed(styles);

    const toc = await executeJson(['query', file, 'toc']);
    checks.push({
      name: 'toc_field',
      passed: commandPassed(toc) && matchCount(toc) > 0,
      detail: `${matchCount(toc)} TOC field(s) found.`,
    });
    commandError ||= !commandPassed(toc);

    const page = await executeJson(['query', file, 'field[fieldType=page]']);
    checks.push({
      name: 'page_field',
      passed: commandPassed(page) && matchCount(page) > 0,
      detail: `${matchCount(page)} PAGE field(s) found.`,
    });
    commandError ||= !commandPassed(page);

    const text = await runOfficecli(officecli.binaryPath, ['view', file, 'text'], {
      cwd,
      timeoutMs: remainingTimeout(),
    });
    const textPassed = !text.timedOut && !text.outputTruncated && text.exitCode === 0;
    const leakedPlaceholders = textPassed ? placeholderCount(text.stdout) : -1;
    checks.push({
      name: 'placeholder_and_escape_scan',
      passed: textPassed && leakedPlaceholders === 0,
      detail: leakedPlaceholders >= 0
        ? `${leakedPlaceholders} placeholder or escaped-control sequence(s) found.`
        : 'Text scan failed.',
    });
    commandError ||= !textPassed;

    const attribution = inspectOfficecliAttribution(file, {
      allowVisibleAttribution:
        ctx.officecliAttributionPolicy === 'allow-visible' ||
        ctx.officecliAttributionPolicy === 'allow-all',
      allowMetadataAttribution:
        ctx.officecliAttributionPolicy === 'allow-metadata' ||
        ctx.officecliAttributionPolicy === 'allow-all',
    });
    checks.push({
      name: 'tool_attribution_scan',
      passed: attribution.clean,
      detail: attribution.clean
        ? 'No unrequested OfficeCLI generator stamp was found in provenance metadata or Word content; topical OfficeCLI research is allowed.'
        : `OfficeCLI generator attribution was found in ${attribution.entries.length} protected package part(s): ${attribution.entries.join(', ')}.`,
    });

    const html = await executeJson(['view', file, 'html']);
    const htmlData = html.json?.data;
    const htmlPassed = commandPassed(html) && typeof htmlData === 'string' &&
      /<!doctype html/i.test(htmlData) && /class=["']page/i.test(htmlData);
    checks.push({
      name: 'html_structure',
      passed: htmlPassed,
      detail: htmlPassed ? 'HTML preview contains a document page structure.' : 'HTML preview generation failed.',
    });
    commandError ||= !commandPassed(html);

    let visualStatus: OfficecliQaResult['visualStatus'] = 'skipped_no_vision';
    let image: Buffer | undefined;
    if (ctx.supportsImages === true) {
      const outputDir = ctx.dataPath ?? tmpdir();
      mkdirSync(outputDir, { recursive: true });
      const screenshotPath = join(outputDir, `officecli-qa-${randomUUID()}.png`);
      try {
        const screenshot = await executeJson([
          'view', file, 'screenshot', '--grid', 'auto', '--render', 'auto', '--out', screenshotPath,
          ...(mode === 'strict' ? ['--screenshot-width', '2000', '--screenshot-height', '1600'] : []),
        ]);
        if (
          commandPassed(screenshot) &&
          existsSync(screenshotPath) &&
          statSync(screenshotPath).size > 0 &&
          statSync(screenshotPath).size <= MAX_SCREENSHOT_BYTES
        ) {
          const rendered = readFileSync(screenshotPath);
          if (isPng(rendered)) {
            image = rendered;
            visualStatus = 'checked';
          } else {
            visualStatus = 'render_failed';
          }
        } else {
          visualStatus = 'render_failed';
        }
      } finally {
        try { unlinkSync(screenshotPath); } catch { /* best-effort cleanup */ }
      }
      checks.push({
        name: 'visual_grid',
        passed: visualStatus === 'checked',
        detail: visualStatus === 'checked'
          ? 'A whole-document contact sheet is attached for model inspection.'
          : 'Visual rendering failed; human visual review is required.',
      });
    } else {
      checks.push({
        name: 'visual_grid',
        passed: true,
        detail: 'Skipped because the current model has no declared image capability; no pixel-level review was claimed.',
      });
    }

    const structuralStatus = checks
      .filter(check => check.name !== 'visual_grid')
      .every(check => check.passed)
      ? 'passed'
      : 'failed';
    const result: OfficecliQaResult = {
      structuralStatus,
      visualStatus,
      checks,
      requiresHumanVisualReview: visualStatus !== 'checked',
      mode,
      durationMs: Date.now() - startedAt,
      ...((commandError || visualStatus === 'render_failed')
        ? { errorType: visualStatus === 'render_failed' ? 'render_error' as const : 'command_error' as const }
        : {}),
    };
    return qaResponse(result, image);
    } catch (error) {
      const result: OfficecliQaResult = {
        structuralStatus: 'failed',
        visualStatus: ctx.supportsImages === true ? 'render_failed' : 'skipped_no_vision',
        checks: [{
          name: 'qa_execution',
          passed: false,
          detail: `OfficeCLI QA failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        requiresHumanVisualReview: true,
        mode,
        durationMs: Date.now() - startedAt,
        errorType: 'command_error',
      };
      return qaResponse(result);
    }
  });
}
