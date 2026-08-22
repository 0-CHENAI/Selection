import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Click-to-run and MSI desktop Office layouts used by Word/Excel/PowerPoint. */
const OFFICE_DIRECTORIES = ['Office16', 'Office15', join('root', 'Office16')] as const;
const OFFICE_EXECUTABLES = ['WINWORD.EXE', 'EXCEL.EXE', 'POWERPNT.EXE'] as const;

export function windowsDesktopOfficeInstalled(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const roots = [...new Set([
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter((root): root is string => Boolean(root)))];
  for (const root of roots) {
    for (const officeDir of OFFICE_DIRECTORIES) {
      for (const exe of OFFICE_EXECUTABLES) {
        if (exists(join(root, 'Microsoft Office', officeDir, exe))) return true;
      }
    }
  }
  return false;
}

/** Strict finalize needs desktop Office. Hosted windows-2025 does not install it. */
export function shouldRequireStrictOfficeFinalize(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  officeInstalled = platform === 'win32' ? windowsDesktopOfficeInstalled(env) : false,
): boolean {
  if (env.OFFICECLI_REQUIRE_STRICT_FINALIZE === '1') return true;
  if (env.OFFICECLI_REQUIRE_STRICT_FINALIZE === '0') return false;
  return platform !== 'win32' || officeInstalled;
}
