import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type {
  ArtifactRef,
  OfficeErrorCategory,
  OfficecliManifestGuide,
  OfficeGuideName,
  OfficeResultEnvelope,
  StructuredWarning,
} from '../office-types.ts';
import type { ToolResult } from '../types.ts';
import { chooseOfficeWorkingDirectory, officeToolResult } from '../runtime/office-coordinator.ts';
import { resolveOfficecliResources } from '../runtime/office-manifest.ts';
import { OFFICE_MORPH_RECIPES, validateMorphGlb } from '../runtime/office-recipes.ts';
import { isPathWithinDirectory } from '../runtime/path-security.ts';

export interface OfficeDocumentGuideArgs {
  guide: OfficeGuideName;
  topic?: string;
  referencePath?: string;
}

interface HeadingSection {
  level: number;
  title: string;
  start: number;
  end: number;
}

const loadedGuideSections = new Set<string>();
const verifiedGuideResources = new Map<string, string>();
const SAFE_REFERENCE_EXTENSIONS = new Set(['.md', '.pptx']);
const MAX_GUIDE_SECTION_CHARS = 40_000;
const MAX_GUIDE_REFERENCE_CHARS = 40_000;

const SELECTION_EXECUTION_CONTRACT = `## Selection execution contract (immutable)

- Examples below omit the \`officecli\` prefix. Pass each native token through the appropriate Selection Office tool's \`argv\` array; never invoke a shell.
- When a property name is uncertain, call \`office_document_inspect\` with \`argv: ['help', format, element]\` before guessing.
- A turn with more than about 10 structural or cell edits must use \`batch\` (inline or \`batch.file\`). After a batch, run \`view issues\` plus \`view html\` or \`office_document_preview.render\`.
- Morph clone/ghost/clean-accumulation and verify/final-check must use the \`recipe\` field. Do not invent shell or Python helpers.
- Selection owns binary installation, updates, command classification, paths, resident/watch lifecycle, rendering, and finalization. Do not call install/update/skills/load_skill/mcp/plugins/config/open/save/close.
- Only \`office_document_preview.start\` may open or focus the BrowserPane. Ordinary work and finalization use inline render evidence.
- Existing outputs require explicit \`--force\`; mutation goes through \`office_document_edit\`; preview marks are not document edits.
- OfficeCLI 1.0.144 adds a 3D element with \`--type 3dmodel\`, but its canonical returned/query path is \`/model3d[N]\`; Selection normalizes outdated \`/3dmodel[N]\` guide examples accordingly.
- \`deliveryReady\` means current-revision machine gates passed. It does not replace Microsoft Office human visual review.`;

function hash(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function guideResourceHash(root: string): string {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = resolve(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in pinned guide resources: ${path}`);
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) files.push(path);
    }
  };
  visit(root);
  const digest = createHash('sha256');
  for (const path of files.sort()) {
    digest.update(relative(root, path));
    digest.update('\0');
    digest.update(readFileSync(path));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function guideResourceFingerprint(root: string): string {
  const digest = createHash('sha256');
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = resolve(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in pinned guide resources: ${path}`);
      digest.update(relative(root, path));
      digest.update(`\0${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}\0`);
      if (stats.isDirectory()) visit(path);
    }
  };
  visit(root);
  return digest.digest('hex');
}

function verifyPinnedGuideResource(root: string, expectedHash: string, guide: OfficeGuideName): void {
  const verificationKey = `${root}\0${expectedHash}`;
  const fingerprint = guideResourceFingerprint(root);
  if (verifiedGuideResources.get(verificationKey) === fingerprint) return;
  const actualHash = guideResourceHash(root);
  if (actualHash !== expectedHash) {
    throw new Error(`Pinned guide resource hash mismatch for ${guide}.`);
  }
  verifiedGuideResources.set(verificationKey, fingerprint);
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function removeAdministrativeSections(markdown: string): string {
  const forbidden = /^(?:setup|install(?:ation)?|updat(?:e|ing)|plugin(?:s)?|mcp)$/i;
  const kept: string[] = [];
  let skippedLevel: number | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (skippedLevel !== undefined) {
      if (!heading || heading[1]!.length > skippedLevel) continue;
      skippedLevel = undefined;
    }
    if (heading && forbidden.test(heading[2]!.trim())) {
      skippedLevel = heading[1]!.length;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function replaceUnsafeMorphScriptBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^\s*```(?:python|py|bash|sh|zsh|powershell|pwsh)\s*$/i.exec(lines[index] ?? '');
    if (!opening) {
      result.push(lines[index]!);
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end] ?? '')) end += 1;
    const block = lines.slice(index, Math.min(end + 1, lines.length)).join('\n');
    if (/(?:morph-helpers\.(?:py|sh)|\bsubprocess\b|\bcurl\b|\birm\b|python3?\s+-c)/i.test(block)) {
      result.push('> [Selection execution note] Upstream shell/Python helper code is intentionally not shipped or executable. Use the validated TypeScript Morph recipes via office_document_edit.recipe or office_document_inspect.recipe; do not invent shell or Python helpers.');
    } else {
      result.push(...lines.slice(index, Math.min(end + 1, lines.length)));
    }
    index = end;
  }
  return result.join('\n');
}

function sanitizeOfficialContent(markdown: string, guide?: OfficeGuideName): string {
  const withoutAdmin = removeAdministrativeSections(stripFrontmatter(markdown));
  const withoutUnsafeMorphScripts = guide === 'morph-ppt' || guide === 'morph-ppt-3d'
    ? replaceUnsafeMorphScriptBlocks(withoutAdmin)
    : withoutAdmin;
  return withoutUnsafeMorphScripts
    // Setup/update/plugin instructions are upstream distribution concerns, not
    // document-authoring guidance. Removing the whole section avoids placing
    // an actionable curl/PowerShell installer below Selection's prohibition.
    .replace(
      /^.*(?:install\.sh|install\.ps1|\bofficecli(?:\.exe)?\s+(?:install|update|skills|load_skill|mcp|plugins|config|open|save|close)\b).*$/gim,
      '[Selection-managed operation omitted]',
    )
    .replace(/reference\/morph-helpers\.(?:py|sh)/gi, 'Selection TypeScript Morph recipes')
    .replace(/\bmorph-helpers\.(?:py|sh)\b/gi, 'Selection TypeScript Morph recipes')
    .replace(/\bbuild\.(?:sh|py)\b/gi, 'Selection Office tool plan')
    .replace(/\s+\|\s+jq\b[^\n`]*/g, '')
    .replace(/AionUi/g, 'Selection BrowserPane')
    .replace(/\/3dmodel\[/g, '/model3d[')
    .replace(/(^|[\s`'"(])officecli(?:\.exe)?\s+/gim, '$1')
    .replace(/(^|[\s`'"(])(?:\.\/)?officecli\s+/gim, '$1');
}

function sections(markdown: string): HeadingSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Array<Omit<HeadingSection, 'end'>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? '');
    if (!match) continue;
    headings.push({ level: match[1]!.length, title: match[2]!, start: index });
  }
  return headings.map((heading, index) => {
    let end = lines.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next]!.level <= heading.level) {
        end = headings[next]!.start;
        break;
      }
    }
    return { ...heading, end };
  });
}

function compactCatalog(markdown: string): Array<{ level: number; title: string }> {
  return sections(markdown)
    .filter(section => section.level <= 3)
    .slice(0, 200)
    .map(({ level, title }) => ({ level, title }));
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');
}

function topicContent(markdown: string, topic: string): { matched: string[]; content: string } {
  const lines = markdown.split(/\r?\n/);
  const needle = normalizeSearch(topic);
  const allSections = sections(markdown);
  let matches = allSections.filter(section => normalizeSearch(section.title).includes(needle));
  if (matches.length === 0) {
    matches = allSections.filter(section => {
      const body = lines.slice(section.start, section.end).join('\n');
      return normalizeSearch(body).includes(needle);
    }).slice(0, 4);
  }
  // Do not duplicate a child section when its matching parent is already included.
  matches = matches.filter(section => !matches.some(other => (
    other !== section && other.start < section.start && other.end >= section.end
  ))).slice(0, 8);
  const content = matches
    .map(section => lines.slice(section.start, section.end).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    matched: matches.map(section => section.title),
    content: content.slice(0, MAX_GUIDE_SECTION_CHARS),
  };
}

function pathArtifact(path: string): ArtifactRef {
  const stats = statSync(path);
  return {
    kind: 'resource',
    path,
    mimeType: extname(path).toLowerCase() === '.pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : extname(path).toLowerCase() === '.glb'
        ? 'model/gltf-binary'
        : 'text/markdown',
    sizeBytes: stats.size,
  };
}

function errorEnvelope(
  version: string,
  schemaCrc: string,
  cwd: string,
  command: string[],
  code: string,
  category: OfficeErrorCategory,
  message: string,
  recovery?: string,
): OfficeResultEnvelope {
  return {
    ok: false,
    version,
    schemaCrc,
    command,
    cwd,
    durationMs: 0,
    warnings: [],
    cacheHit: false,
    artifacts: [],
    error: {
      code,
      category,
      message,
      retriable: category === 'runtime' || category === 'timeout',
      ...(recovery ? { recovery } : {}),
    },
  };
}

function inheritedGuideContent(
  versionRoot: string,
  manifestGuides: Record<OfficeGuideName, OfficecliManifestGuide>,
  inherits: OfficeGuideName[],
  topic: string | undefined,
): Array<Record<string, unknown>> {
  return inherits.map(base => {
    const definition = manifestGuides[base];
    const root = resolve(versionRoot, 'skills', definition.directory);
    const path = resolve(root, definition.entry);
    verifyPinnedGuideResource(root, definition.resourceHash, base);
    const buffer = readFileSync(path);
    if (hash(buffer) !== definition.contentHash) {
      throw new Error(`Pinned inherited guide entry hash mismatch for ${base}.`);
    }
    const markdown = sanitizeOfficialContent(buffer.toString('utf8'), base);
    if (topic) {
      const match = topicContent(markdown, topic);
      if (match.content) return { guide: base, matched: match.matched, content: match.content };
    }
    return { guide: base, catalog: compactCatalog(markdown).slice(0, 40) };
  });
}

export async function handleOfficeDocumentGuide(
  ctx: SessionToolContext,
  args: OfficeDocumentGuideArgs,
): Promise<ToolResult> {
  const startedAt = Date.now();
  let cwd = ctx.workspacePath;
  const command = ['guide', typeof args?.guide === 'string' ? args.guide : '(unknown)'];
  let version = 'unknown';
  let schemaCrc = 'unknown';
  if (
    !args
    || typeof args !== 'object'
    || typeof args.guide !== 'string'
    || args.guide.trim().length === 0
    || (args.topic !== undefined && typeof args.topic !== 'string')
    || (args.referencePath !== undefined && typeof args.referencePath !== 'string')
  ) {
    return officeToolResult(errorEnvelope(
      version, schemaCrc, cwd, command, 'invalid_guide_input', 'input',
      'guide must be a non-empty guide name; topic and referencePath must be strings when provided.',
    ));
  }
  try {
    cwd = chooseOfficeWorkingDirectory(ctx);
    let resources: ReturnType<typeof resolveOfficecliResources>;
    try {
      resources = resolveOfficecliResources();
    } catch (error) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'officecli_manifest_invalid', 'dependency',
        error instanceof Error ? error.message : String(error),
        'Reinstall Selection or rebuild the audited OfficeCLI resource bundle.',
      ));
    }
    if (!resources) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'officecli_resources_unavailable', 'dependency',
        'The bundled OfficeCLI guide resources are unavailable.',
      ));
    }
    version = resources.manifest.version;
    schemaCrc = resources.manifest.schemaCrc;
    const definition = resources.manifest.guides[args.guide];
    if (!definition) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'unknown_guide', 'input', `Unknown Office guide: ${String(args.guide)}`,
      ));
    }
    const hasTopic = typeof args.topic === 'string' && args.topic.trim().length > 0;
    const hasReference = typeof args.referencePath === 'string' && args.referencePath.trim().length > 0;
    if (hasTopic && hasReference) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'guide_selector_conflict', 'input',
        'topic and referencePath are mutually exclusive.',
      ));
    }
    const guideRoot = resolve(resources.versionRoot, 'skills', definition.directory);
    const entryPath = resolve(guideRoot, definition.entry);
    if (!isPathWithinDirectory(entryPath, guideRoot) || !existsSync(entryPath)) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'guide_resource_missing', 'dependency',
        `Pinned guide entry is missing: ${entryPath}`,
      ));
    }
    try {
      verifyPinnedGuideResource(guideRoot, definition.resourceHash, args.guide);
    } catch (error) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'guide_resource_hash_mismatch', 'dependency',
        error instanceof Error ? error.message : String(error),
        'Rebuild Selection from an audited OfficeCLI upgrade PR.',
      ));
    }
    const entryBuffer = readFileSync(entryPath);
    const actualHash = hash(entryBuffer);
    if (actualHash !== definition.contentHash) {
      return officeToolResult(errorEnvelope(
        version, schemaCrc, cwd, command, 'guide_hash_mismatch', 'dependency',
        `Pinned guide hash mismatch for ${args.guide}.`,
        'Rebuild Selection from an audited OfficeCLI upgrade PR.',
      ));
    }

    let data: Record<string, unknown>;
    const artifacts: ArtifactRef[] = [];
    const warnings: StructuredWarning[] = [];
    let contentHash = definition.contentHash;
    let cacheSelector = `catalog:${definition.resourceHash}`;
    if (hasReference) {
      const requested = args.referencePath!.trim();
      let reference: string;
      const isWorkspaceGlb = args.guide === 'morph-ppt-3d' && extname(requested).toLowerCase() === '.glb';
      if (isWorkspaceGlb) {
        const resolvedReference = resolve(isAbsolute(requested) ? requested : resolve(cwd, requested));
        const lexicalReference = resolvedReference;
        reference = existsSync(lexicalReference)
          ? realpathSync.native(lexicalReference)
          : lexicalReference;
        const allowedRoots = [cwd, ctx.sessionPath, ctx.workspacePath]
          .filter((value): value is string => Boolean(value && existsSync(value)))
          .map(root => realpathSync.native(resolve(root)));
        if (!allowedRoots.some(root => isPathWithinDirectory(reference, root))) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'reference_outside_allowed_roots', 'permission',
            `GLB reference is outside the authorized session/workspace roots: ${reference}`,
          ));
        }
        const glbError = validateMorphGlb(reference);
        if (glbError) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'invalid_glb', 'input', glbError,
          ));
        }
      } else {
        if (isAbsolute(requested)) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'external_reference_forbidden', 'permission',
            'Absolute referencePath is only allowed for a validated Morph 3D .glb inside the session/workspace.',
          ));
        }
        reference = resolve(guideRoot, requested);
        if (!isPathWithinDirectory(reference, guideRoot)) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'reference_path_escape', 'permission',
            'referencePath must stay inside the selected vendored guide directory.',
          ));
        }
        if (!SAFE_REFERENCE_EXTENSIONS.has(extname(reference).toLowerCase())) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'reference_type_forbidden', 'unsupported',
            'Only vendored .md and .pptx references are loadable; executable .sh/.py resources are never shipped.',
          ));
        }
        if (existsSync(reference)) {
          if (lstatSync(reference).isSymbolicLink()) {
            return officeToolResult(errorEnvelope(
              version, schemaCrc, cwd, command, 'reference_symlink_forbidden', 'permission',
              'Vendored guide references must be regular pinned files, not symbolic links.',
            ));
          }
          reference = realpathSync.native(reference);
          const canonicalGuideRoot = realpathSync.native(guideRoot);
          if (!isPathWithinDirectory(reference, canonicalGuideRoot)) {
            return officeToolResult(errorEnvelope(
              version, schemaCrc, cwd, command, 'reference_path_escape', 'permission',
              'referencePath resolves outside the selected vendored guide directory.',
            ));
          }
        }
      }
      if (!existsSync(reference) || !statSync(reference).isFile()) {
        return officeToolResult(errorEnvelope(
          version, schemaCrc, cwd, command, 'reference_not_found', 'path', `Guide reference not found: ${reference}`,
        ));
      }
      const buffer = readFileSync(reference);
      contentHash = hash(buffer);
      cacheSelector = `${isWorkspaceGlb ? `workspace-glb:${reference}` : `reference:${relative(guideRoot, reference)}`}:${contentHash}`;
      artifacts.push(pathArtifact(reference));
      const sanitizedReference = extname(reference).toLowerCase() === '.md'
        ? sanitizeOfficialContent(buffer.toString('utf8'), args.guide)
        : undefined;
      if (sanitizedReference && sanitizedReference.length > MAX_GUIDE_REFERENCE_CHARS) {
        warnings.push({
          code: 'guide_reference_truncated',
          message: `The Markdown reference exceeds ${MAX_GUIDE_REFERENCE_CHARS} characters; Selection returned a bounded excerpt and preserved the complete artifact.`,
          severity: 'medium',
          recovery: 'Request a narrower topic or open the returned artifact when the complete reference is required.',
        });
      }
      data = {
        referencePath: reference,
        ...(sanitizedReference !== undefined
          ? { content: `${SELECTION_EXECUTION_CONTRACT}\n\n${sanitizedReference.slice(0, MAX_GUIDE_REFERENCE_CHARS)}` }
          : { content: SELECTION_EXECUTION_CONTRACT }),
      };
    } else {
      const markdown = sanitizeOfficialContent(entryBuffer.toString('utf8'), args.guide);
      if (hasTopic) {
        const selected = topicContent(markdown, args.topic!.trim());
        if (!selected.content) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'guide_topic_not_found', 'input',
            `No guide section matched topic '${args.topic}'.`,
            'Call the guide without topic to inspect its compact catalog.',
          ));
        }
        cacheSelector = `topic:${normalizeSearch(args.topic!)}:${definition.resourceHash}`;
        let inherited: Array<Record<string, unknown>>;
        try {
          inherited = inheritedGuideContent(
            resources.versionRoot,
            resources.manifest.guides,
            definition.inherits,
            args.topic!.trim(),
          );
        } catch (error) {
          return officeToolResult(errorEnvelope(
            version, schemaCrc, cwd, command, 'inherited_guide_integrity_error', 'dependency',
            error instanceof Error ? error.message : String(error),
            'Reinstall Selection or rebuild the audited OfficeCLI resource bundle.',
          ));
        }
        data = {
          topic: args.topic!.trim(),
          matchedSections: selected.matched,
          content: `${SELECTION_EXECUTION_CONTRACT}\n\n${selected.content}`,
          inherited,
        };
      } else {
        data = {
          catalog: compactCatalog(markdown),
          inherited: definition.inherits.map(base => ({ guide: base })),
          executionContract: SELECTION_EXECUTION_CONTRACT,
        };
      }
    }
    if (args.guide === 'morph-ppt' || args.guide === 'morph-ppt-3d') {
      data.recipes = OFFICE_MORPH_RECIPES;
      data.recipeRuntime = 'validated-typescript';
    }
    const loadedKey = `${ctx.sessionId}\0${args.guide}\0${cacheSelector}`;
    const alreadyLoaded = loadedGuideSections.has(loadedKey);
    loadedGuideSections.add(loadedKey);
    if (alreadyLoaded) {
      data = {
        alreadyLoaded: true,
        message: 'This exact guide section/resource hash is already present in the session context.',
      };
    }
    const envelope: OfficeResultEnvelope = {
      ok: true,
      version,
      schemaCrc,
      command: [...command, ...(hasTopic ? ['--topic', args.topic!.trim()] : []), ...(hasReference ? ['--reference', args.referencePath!.trim()] : [])],
      cwd,
      durationMs: Math.max(0, Date.now() - startedAt),
      data: {
        guide: args.guide,
        guideVersion: version,
        sourceCommit: resources.manifest.tagCommit,
        contentHash,
        cacheHit: alreadyLoaded,
        alreadyLoaded,
        ...data,
      },
      warnings,
      cacheHit: alreadyLoaded,
      artifacts,
    };
    return officeToolResult(envelope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && typeof error === 'object') {
      const record = error as Partial<{
        code: string;
        category: OfficeErrorCategory;
        message: string;
        recovery: string;
      }>;
      if (record.code && record.category && record.message) {
        return officeToolResult(errorEnvelope(
          version,
          schemaCrc,
          cwd,
          command,
          record.code,
          record.category,
          record.message,
          record.recovery,
        ));
      }
    }
    return officeToolResult(errorEnvelope(version, schemaCrc, cwd, command, 'guide_runtime_error', 'runtime', message));
  }
}

export function clearOfficeGuideCache(): void {
  loadedGuideSections.clear();
  verifiedGuideResources.clear();
}

export function releaseOfficeGuideSession(sessionId: string): void {
  const prefix = `${sessionId}\0`;
  for (const key of loadedGuideSections) {
    if (key.startsWith(prefix)) loadedGuideSections.delete(key);
  }
}
