import { describe, expect, it } from 'bun:test';
import { missingSensitive, redactSensitive, sensitiveParamNames } from './sensitive.ts';

describe('sensitive params', () => {
  it('redacts and reports missing secrets', () => {
    const names = sensitiveParamNames([
      { name: 'token', sensitive: true },
      { name: 'public' },
    ]);
    expect(names).toEqual(['token']);
    expect(redactSensitive({ token: 's3cret', public: 'ok' }, names)).toEqual({ token: '***', public: 'ok' });
    expect(missingSensitive({ public: 'ok' }, names)).toEqual(['token']);
    expect(missingSensitive({ token: '***' }, names)).toEqual(['token']);
  });
});
