import { extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import {
  isPathWithinDirectory,
  isPathWithinDirectoryForCreation,
} from '../runtime/path-security.ts';

const OFFICE_EXTENSIONS = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pptx']);

export function resolveOfficecliDocumentPath(
  ctx: SessionToolContext,
  file: string,
  options: { docxOnly?: boolean; allowMissing?: boolean } = {},
): { file?: string; error?: string } {
  const baseDir = resolve(ctx.workingDirectory ?? ctx.workspacePath);
  const resolvedFile = resolve(baseDir, file);

  const staysWithinWorkingDirectory = options.allowMissing && !existsSync(resolvedFile)
    ? isPathWithinDirectoryForCreation(resolvedFile, baseDir)
    : isPathWithinDirectory(resolvedFile, baseDir);
  if (!staysWithinWorkingDirectory) {
    return { error: 'file must stay within the session working directory.' };
  }
  if (!options.allowMissing && !existsSync(resolvedFile)) {
    return { error: `Office file not found: ${file}` };
  }

  const extension = extname(resolvedFile).toLowerCase();
  if (options.docxOnly) {
    if (extension !== '.docx' && extension !== '.docm') {
      return { error: 'officecli_qa currently supports only .docx and .docm files.' };
    }
  } else if (!OFFICE_EXTENSIONS.has(extension)) {
    return { error: 'file must be .docx, .docm, .xlsx, .xlsm, or .pptx.' };
  }

  return { file: resolvedFile };
}
