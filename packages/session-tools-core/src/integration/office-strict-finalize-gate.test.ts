import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  shouldRequireStrictOfficeFinalize,
  windowsDesktopOfficeInstalled,
  windowsDesktopWordInstalled,
} from './office-strict-finalize-gate.ts';

describe('OfficeCLI strict finalize merge gate', () => {
  it('keeps strict finalize required off Windows', () => {
    expect(shouldRequireStrictOfficeFinalize('darwin', {})).toBe(true);
    expect(shouldRequireStrictOfficeFinalize('linux', {})).toBe(true);
  });

  it('does not make hosted Windows a hard gate without desktop Office', () => {
    expect(shouldRequireStrictOfficeFinalize('win32', {}, false)).toBe(false);
    expect(windowsDesktopOfficeInstalled({ ProgramFiles: 'C:\\Program Files' }, () => false)).toBe(false);
  });

  it('requires strict finalize on Windows only with Office or an explicit override', () => {
    expect(shouldRequireStrictOfficeFinalize('win32', {}, true)).toBe(true);
    expect(shouldRequireStrictOfficeFinalize('win32', { OFFICECLI_REQUIRE_STRICT_FINALIZE: '1' }, false)).toBe(true);
    expect(shouldRequireStrictOfficeFinalize('win32', { OFFICECLI_REQUIRE_STRICT_FINALIZE: '0' }, true)).toBe(false);
    expect(windowsDesktopOfficeInstalled(
      { ProgramFiles: 'C:\\Program Files' },
      path => path.endsWith(join('Microsoft Office', 'root', 'Office16', 'WINWORD.EXE')),
    )).toBe(true);
  });

  it('does not treat Excel-only installs as Word for TOC refresh', () => {
    expect(windowsDesktopWordInstalled(
      { ProgramFiles: 'C:\\Program Files' },
      path => path.endsWith(join('Microsoft Office', 'Office16', 'EXCEL.EXE')),
    )).toBe(false);
    expect(windowsDesktopWordInstalled(
      { ProgramFiles: 'C:\\Program Files' },
      path => path.endsWith(join('Microsoft Office', 'Office16', 'WINWORD.EXE')),
    )).toBe(true);
  });
});
