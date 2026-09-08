import { beforeAll, describe, expect, it } from 'bun:test';

let sanitizeRequestBodyForDebug: typeof import('../unified-network-interceptor.ts').sanitizeRequestBodyForDebug;
let toSanitizedCurl: typeof import('../unified-network-interceptor.ts').toSanitizedCurl;

describe('unified network interceptor logging', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    sanitizeRequestBodyForDebug = mod.sanitizeRequestBodyForDebug;
    toSanitizedCurl = mod.toSanitizedCurl;
  });

  it('retains ordinary request body fields', () => {
    const body = JSON.stringify({ prompt: 'inspect this diagram', model: 'test-model' });
    const output = toSanitizedCurl('https://example.com/messages', {
      method: 'POST',
      body,
    });

    expect(output).toContain('inspect this diagram');
    expect(output).toContain('test-model');
  });

  it('replaces data URL payloads with a placeholder', () => {
    const payload = 'A'.repeat(4096);
    const sanitized = sanitizeRequestBodyForDebug(JSON.stringify({
      image_url: `data:image/png;base64,${payload}`,
    }));

    expect(sanitized).toContain(`[BASE64 PAYLOAD OMITTED: ${payload.length} chars]`);
    expect(sanitized).not.toContain(payload);
  });

  it('replaces nested base64 source data with a placeholder', () => {
    const payload = 'B'.repeat(4096);
    const sanitized = sanitizeRequestBodyForDebug(JSON.stringify({
      source: { type: 'base64', media_type: 'image/jpeg', data: payload },
    }));

    expect(sanitized).toContain(`[BASE64 PAYLOAD OMITTED: ${payload.length} chars]`);
    expect(sanitized).not.toContain(payload);
  });
});
