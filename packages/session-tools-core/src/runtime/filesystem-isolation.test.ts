import { describe, it, expect } from 'bun:test';
import { buildDarwinSandboxProfile } from './filesystem-isolation.ts';

describe('buildDarwinSandboxProfile', () => {
  it('includes session subpath write allow', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session');
    expect(profile).toContain('(allow file-write* (subpath "/tmp/craft-session"))');
    expect(profile).not.toContain('(deny network*)');
  });

  it('includes deny network when requested', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session', { includeNetworkDeny: true });
    expect(profile).toContain('(deny network*)');
  });

  it('quotes session paths that contain spaces', () => {
    const profile = buildDarwinSandboxProfile('/Users/me/Library/Application Support/Selection/sessions/abc');
    expect(profile).toContain(
      '(allow file-write* (subpath "/Users/me/Library/Application Support/Selection/sessions/abc"))',
    );
    expect(profile).toContain('(allow process*)');
    expect(profile).toContain('(allow file-read*)');
  });
});
