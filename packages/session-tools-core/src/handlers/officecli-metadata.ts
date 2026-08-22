import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

// Match only a self-contained generator badge. A research paragraph may quote
// the exact phrase (for example, “常见异常是‘本文档由 OfficeCLI 自动生成’出现在
// 页脚”) without becoming attribution itself. Trusted turn intent can preserve
// an explicitly requested standalone badge without exposing a bypass in tool
// input.
const STANDALONE_GENERATOR_BADGE = /^\s*(?:(?:本文档|本文件|本报告|此文档)\s*(?:由|使用)\s*OfficeCLI\s*(?:自动)?(?:生成|创建|制作)|(?:由|使用)\s*OfficeCLI\s*(?:自动)?(?:生成|创建|制作)|(?:使用\s*)?OfficeCLI\s*(?:自动)?(?:生成|创建|制作)|this\s+(?:document|file|report)\s+(?:was\s+)?(?:generated|created|made)\s+(?:by|with)\s+OfficeCLI|(?:generated|created|made|powered)\s+(?:by|with)\s+OfficeCLI)\s*[。.!！]?\s*$/iu;
const XML_ENTRY = /^(?:docProps|word|xl|ppt)\/.+\.xml$/i;
const WORD_VISIBLE_ENTRY = /^word\/(?:document|header\d*|footer\d*|comments(?:Extended|Extensible)?)\.xml$/i;
const WORD_PARAGRAPH_TAG = /<w:p\b[^>]*>|<\/w:p\s*>/giu;
const MAX_OPENXML_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_OPENXML_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_OPENXML_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_OPENXML_ENTRIES = 10_000;

export interface OfficecliAttributionInspection {
  clean: boolean;
  entries: string[];
}

export interface OfficecliAttributionOptions {
  /** Set only from trusted user-intent context, never from model tool input. */
  allowVisibleAttribution?: boolean;
  /** Preserve an explicitly requested dc:creator credit only. */
  allowMetadataAttribution?: boolean;
}

export interface OfficecliAttributionSanitization {
  changed: boolean;
  metadataChanged: boolean;
  visibleChanged: boolean;
  removedVisibleBadges: number;
}

function readOpenXmlArchive(file: string, relevantOnly = false): Record<string, Uint8Array> {
  const compressedSize = statSync(file).size;
  if (compressedSize > MAX_OPENXML_ARCHIVE_BYTES) {
    throw new Error('Office package exceeds the 128MB compressed-size safety limit.');
  }

  let entryCount = 0;
  let totalUncompressedBytes = 0;
  return unzipSync(new Uint8Array(readFileSync(file)), {
    filter: entry => {
      entryCount += 1;
      totalUncompressedBytes += entry.originalSize;
      if (entryCount > MAX_OPENXML_ENTRIES) {
        throw new Error('Office package exceeds the 10000-entry safety limit.');
      }
      if (entry.originalSize > MAX_OPENXML_ENTRY_BYTES) {
        throw new Error(`Office package entry exceeds the 64MB safety limit: ${entry.name}`);
      }
      if (totalUncompressedBytes > MAX_OPENXML_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('Office package exceeds the 256MB total-uncompressed-size safety limit.');
      }
      return !relevantOnly || XML_ENTRY.test(entry.name);
    },
  });
}

function visibleWordText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/giu, '\t')
    .replace(/<w:br\b[^>]*\/>/giu, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isStandaloneGeneratorBadge(paragraphXml: string): boolean {
  return STANDALONE_GENERATOR_BADGE.test(visibleWordText(paragraphXml));
}

/** Quoted/code samples are document content even when the sample is exactly the badge. */
function isProtectedResearchParagraph(paragraphXml: string): boolean {
  const style = paragraphXml.match(/<w:pStyle\b[^>]*\bw:val=["']([^"']+)["'][^>]*\/?\s*>/iu)?.[1];
  return !!style && /^(?:Quote|IntenseQuote|Code|CodeBlock|HTMLPreformatted|PreformattedText)$/iu.test(style);
}

function isRemovableStandaloneGeneratorBadge(
  paragraphXml: string,
  allowResearchStyleProtection: boolean,
): boolean {
  return isStandaloneGeneratorBadge(paragraphXml) &&
    (!allowResearchStyleProtection || !isProtectedResearchParagraph(paragraphXml));
}

interface WordParagraphSpan {
  start: number;
  end: number;
}

/**
 * Locate complete Word paragraphs without assuming they cannot be nested.
 * Text boxes can contain a w:p inside an outer drawing paragraph; a lazy XML
 * regex would cut that structure in half when removing the inner paragraph.
 */
function wordParagraphSpans(xml: string): WordParagraphSpan[] {
  const stack: number[] = [];
  const spans: WordParagraphSpan[] = [];
  WORD_PARAGRAPH_TAG.lastIndex = 0;
  for (const match of xml.matchAll(WORD_PARAGRAPH_TAG)) {
    if (/^<w:p\b/iu.test(match[0])) {
      stack.push(match.index);
      continue;
    }
    const start = stack.pop();
    if (start !== undefined) spans.push({ start, end: match.index + match[0].length });
  }
  return spans;
}

function containsStandaloneGeneratorBadge(xml: string, allowResearchStyleProtection: boolean): boolean {
  return wordParagraphSpans(xml).some(span => isRemovableStandaloneGeneratorBadge(
    xml.slice(span.start, span.end),
    allowResearchStyleProtection,
  ));
}

function sanitizeVisibleWordXml(
  xml: string,
  allowResearchStyleProtection: boolean,
): { xml: string; removed: number } {
  const matching = wordParagraphSpans(xml)
    .filter(span => isRemovableStandaloneGeneratorBadge(
      xml.slice(span.start, span.end),
      allowResearchStyleProtection,
    ));
  // When a text-box paragraph and its outer drawing paragraph both contain
  // only the badge, remove the outermost span once. This preserves valid XML.
  const removals = matching.filter(span => !matching.some(other =>
    other !== span && other.start <= span.start && other.end >= span.end
  ));
  let sanitized = xml;
  for (const span of removals.sort((a, b) => b.start - a.start)) {
    sanitized = `${sanitized.slice(0, span.start)}${sanitized.slice(span.end)}`;
  }
  return { xml: sanitized, removed: removals.length };
}

function sanitizeDocPropsXml(name: string, xml: string, options: OfficecliAttributionOptions): string {
  let sanitized = xml;
  if (/^docProps\/core\.xml$/i.test(name)) {
    const fields = options.allowMetadataAttribution ? 'cp:lastModifiedBy' : 'dc:creator|cp:lastModifiedBy';
    sanitized = sanitized.replace(
      new RegExp(`<(${fields})(\\s[^>]*)?>\\s*(?:OfficeCLI|使用\\s*OfficeCLI\\s*生成)(?:\\/[^<]*)?\\s*<\\/\\1>`, 'giu'),
      '<$1$2></$1>',
    );
  }
  if (/^docProps\/app\.xml$/i.test(name)) {
    sanitized = sanitized
      .replace(/<([\w-]+:)?Application(\s[^>]*)?>\s*OfficeCLI(?:\/[^<]*)?\s*<\/\1Application>/giu, '<$1Application$2></$1Application>');
  }
  if (/^docProps\/custom\.xml$/i.test(name)) {
    sanitized = sanitized.replace(
      /<([\w-]+:)?property\b(?=[^>]*\bname=["']OfficeCLI(?:\.[^"']*)?["'])[^>]*>[\s\S]*?<\/\1property>/giu,
      '',
    );
  }
  return sanitized;
}

/** Remove only app-generated OfficeCLI attribution from OpenXML metadata. */
export function sanitizeOfficecliMetadata(
  file: string,
  options: OfficecliAttributionOptions = {},
): { changed: boolean } {
  const archive = readOpenXmlArchive(file);
  let changed = false;
  for (const [name, bytes] of Object.entries(archive)) {
    if (!/^docProps\/.+\.xml$/i.test(name)) continue;
    const original = strFromU8(bytes);
    const sanitized = sanitizeDocPropsXml(name, original, options);
    if (sanitized !== original) {
      archive[name] = strToU8(sanitized);
      changed = true;
    }
  }
  if (!changed) return { changed: false };

  const temporary = join(dirname(file), `.${randomUUID()}.officecli-sanitize.tmp`);
  try {
    const originalMode = statSync(file).mode & 0o7777;
    // Seed from the original so platform copy semantics retain metadata where
    // possible, then restore POSIX mode before the atomic replacement.
    copyFileSync(file, temporary);
    writeFileSync(temporary, zipSync(archive, { level: 6 }));
    chmodSync(temporary, originalMode);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { changed: true };
}

/**
 * Remove unrequested OfficeCLI provenance metadata and standalone visible
 * generator badges in one atomic package rewrite. Topical prose and quoted
 * discussion are preserved because only whole-paragraph badges are removed.
 */
export function sanitizeOfficecliAttribution(
  file: string,
  options: OfficecliAttributionOptions = {},
): OfficecliAttributionSanitization {
  const archive = readOpenXmlArchive(file);
  let metadataChanged = false;
  let visibleChanged = false;
  let removedVisibleBadges = 0;
  for (const [name, bytes] of Object.entries(archive)) {
    if (!XML_ENTRY.test(name)) continue;
    const original = strFromU8(bytes);
    let sanitized = original;
    if (/^docProps\/.+\.xml$/i.test(name)) {
      sanitized = sanitizeDocPropsXml(name, sanitized, options);
      metadataChanged ||= sanitized !== original;
    }
    if (!options.allowVisibleAttribution && WORD_VISIBLE_ENTRY.test(name)) {
      // Quote/code styles are legitimate research samples in the document body
      // and comments, but must not act as an attribution bypass in headers or
      // footers where generator stamps normally live.
      const allowResearchStyleProtection = /^word\/(?:document|comments(?:Extended|Extensible)?)\.xml$/i.test(name);
      const visible = sanitizeVisibleWordXml(sanitized, allowResearchStyleProtection);
      sanitized = visible.xml;
      removedVisibleBadges += visible.removed;
      visibleChanged ||= visible.removed > 0;
    }
    if (sanitized !== original) archive[name] = strToU8(sanitized);
  }

  const changed = metadataChanged || visibleChanged;
  if (!changed) return { changed: false, metadataChanged: false, visibleChanged: false, removedVisibleBadges: 0 };

  const temporary = join(dirname(file), `.${randomUUID()}.officecli-sanitize.tmp`);
  try {
    const originalMode = statSync(file).mode & 0o7777;
    copyFileSync(file, temporary);
    writeFileSync(temporary, zipSync(archive, { level: 6 }));
    chmodSync(temporary, originalMode);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { changed, metadataChanged, visibleChanged, removedVisibleBadges };
}

/** Return entry names only; never return document text or full paths. */
export function inspectOfficecliAttribution(
  file: string,
  options: OfficecliAttributionOptions = {},
): OfficecliAttributionInspection {
  const archive = readOpenXmlArchive(file, true);
  const entries: string[] = [];
  for (const [name, bytes] of Object.entries(archive)) {
    if (!XML_ENTRY.test(name)) continue;
    const xml = strFromU8(bytes);
    let stamped = false;
    if (/^docProps\/core\.xml$/i.test(name)) {
      const creatorStamped = /<dc:creator(?:\s[^>]*)?>[\s\S]*?OfficeCLI[\s\S]*?<\/dc:creator>/iu.test(xml);
      const modifierStamped = /<cp:lastModifiedBy(?:\s[^>]*)?>[\s\S]*?OfficeCLI[\s\S]*?<\/cp:lastModifiedBy>/iu.test(xml);
      stamped = modifierStamped || (!options.allowMetadataAttribution && creatorStamped);
    } else if (/^docProps\/app\.xml$/i.test(name)) {
      stamped = /<([\w-]+:)?Application(?:\s[^>]*)?>[\s\S]*?OfficeCLI[\s\S]*?<\/\1Application>/iu.test(xml);
    } else if (/^docProps\/custom\.xml$/i.test(name)) {
      stamped = /<([\w-]+:)?property\b(?=[^>]*\bname=["']OfficeCLI(?:\.[^"']*)?["'])[^>]*>/iu.test(xml);
    } else if (WORD_VISIBLE_ENTRY.test(name)) {
      const allowResearchStyleProtection = /^word\/(?:document|comments(?:Extended|Extensible)?)\.xml$/i.test(name);
      stamped = !options.allowVisibleAttribution && containsStandaloneGeneratorBadge(
        xml,
        allowResearchStyleProtection,
      );
    }
    if (stamped) entries.push(name);
  }
  return { clean: entries.length === 0, entries: entries.sort() };
}
