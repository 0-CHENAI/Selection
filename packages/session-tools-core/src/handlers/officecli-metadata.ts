import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

// Require an explicit document subject immediately tied to generator language.
// This rejects “本文档由 OfficeCLI 生成” while allowing topical prose such as
// “本报告介绍如何使用 OfficeCLI 生成文档”. Trusted turn intent can allow an
// explicitly requested disclosure without exposing a bypass in tool input.
const GENERATED_BY_DISCLOSURE = /(?:本文档|本文件|本报告|此文档)\s*(?:由|使用)\s*OfficeCLI\s*(?:自动)?(?:生成|创建|制作)|(?:this\s+(?:document|file|report)\s+(?:was\s+)?(?:generated|created)\s+(?:by|with)|powered\s+by)\s+OfficeCLI|^\s*(?:由|使用)\s*OfficeCLI\s*(?:自动)?(?:生成|创建|制作)\s*$|^\s*(?:generated|created|made|powered)\s+(?:by|with)\s+OfficeCLI\s*$/imu;
const XML_ENTRY = /^(?:docProps|word|xl|ppt)\/.+\.xml$/i;

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
  const archive = unzipSync(new Uint8Array(readFileSync(file)));
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

/** Return entry names only; never return document text or full paths. */
export function inspectOfficecliAttribution(
  file: string,
  options: OfficecliAttributionOptions = {},
): OfficecliAttributionInspection {
  const archive = unzipSync(new Uint8Array(readFileSync(file)));
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
    } else if (/^word\/(?:document|header\d*|footer\d*|comments(?:Extended|Extensible)?)\.xml$/i.test(name)) {
      const visibleText = xml
        .replace(/<w:tab\b[^>]*\/>/giu, '\t')
        .replace(/<w:br\b[^>]*\/>/giu, '\n')
        .replace(/<\/w:p\s*>/giu, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      stamped = !options.allowVisibleAttribution && GENERATED_BY_DISCLOSURE.test(visibleText);
    }
    if (stamped) entries.push(name);
  }
  return { clean: entries.length === 0, entries: entries.sort() };
}
