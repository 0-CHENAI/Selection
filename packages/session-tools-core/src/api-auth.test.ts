import { describe, test, expect } from 'bun:test';
import {
  apiAuthSpecFromConfig,
  appendQueryAuth,
  buildApiAuthHeaders,
  describeApiAuth,
  isMultiHeaderCredential,
  parseJsonHeaderMap,
  parseStoredApiCredential,
  serializeHeaderCredential,
} from './api-auth.ts';

// Regression coverage for OSS #1067: a header-auth source whose credential was
// stored through the multi-header prompt put the serialized JSON object on the
// wire (`x-goog-api-key: {"x-goog-api-key":"…"}`), and source_test assembled
// auth on its own so it never noticed.

const KEY = 'AIzaSy' + 'k'.repeat(33);
const WRAPPED = JSON.stringify({ 'x-goog-api-key': KEY });
const DATADOG = { 'DD-API-KEY': 'api', 'DD-APPLICATION-KEY': 'app' };

describe('parseJsonHeaderMap', () => {
  test('accepts an object of strings', () => {
    expect(parseJsonHeaderMap(WRAPPED)).toEqual({ 'x-goog-api-key': KEY });
    expect(parseJsonHeaderMap(`  ${JSON.stringify(DATADOG)}\n`)).toEqual(DATADOG);
  });

  test('rejects everything that is not a non-empty string map', () => {
    for (const raw of ['plain-key', '"quoted"', '42', '[]', '["a"]', '{}', '{"a":1}', '{"a":{"b":"c"}}', '{"a":null}', '{bad json}', '']) {
      expect(parseJsonHeaderMap(raw)).toBeNull();
    }
  });

  // Security review "High #5": an object secret (service-account JSON) must never be
  // spread across headers. Its keys are tokens, but values span lines or names are not
  // header names, so it is not a header map.
  test('rejects object secrets that are not headers', () => {
    const serviceAccount = JSON.stringify({
      type: 'service_account',
      client_email: 'bot@project.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n',
    });
    expect(parseJsonHeaderMap(serviceAccount)).toBeNull();
    expect(parseJsonHeaderMap(JSON.stringify({ 'api key': 'v' }))).toBeNull();
    expect(parseJsonHeaderMap(JSON.stringify({ 'X-Key': 'a\r\nX-Injected: b' }))).toBeNull();
    expect(parseJsonHeaderMap(JSON.stringify({ 'X-Key': 'tab\tis fine' }))).toEqual({ 'X-Key': 'tab\tis fine' });
  });
});

describe('parseStoredApiCredential', () => {
  test('single headerName with a wrapped object returns the bare value', () => {
    expect(parseStoredApiCredential(WRAPPED, { authType: 'header', headerName: 'x-goog-api-key' })).toBe(KEY);
  });

  test('header auth without headerName returns a header map', () => {
    const cred = parseStoredApiCredential(WRAPPED, { authType: 'header' });
    expect(isMultiHeaderCredential(cred)).toBe(true);
    expect(cred).toEqual({ 'x-goog-api-key': KEY });
  });

  test('object key that differs from headerName is kept as a header map', () => {
    // The user typed the value under this name in the prompt; send it under that name.
    expect(parseStoredApiCredential(WRAPPED, { authType: 'header', headerName: 'X-API-Key' })).toEqual({ 'x-goog-api-key': KEY });
  });

  test('headerNames fully present returns the map, partially present returns raw', () => {
    const stored = JSON.stringify(DATADOG);
    const api = { authType: 'header', headerNames: ['DD-API-KEY', 'DD-APPLICATION-KEY'] };
    expect(parseStoredApiCredential(stored, api)).toEqual(DATADOG);
    const partial = JSON.stringify({ 'DD-API-KEY': 'api' });
    expect(parseStoredApiCredential(partial, api)).toBe(partial);
  });

  test('MCP header credentials use the same shape (no authType)', () => {
    const stored = JSON.stringify({ 'X-Key': 'v' });
    expect(parseStoredApiCredential(stored, { headerNames: ['X-Key'] })).toEqual({ 'X-Key': 'v' });
  });

  test('plain keys pass through unchanged', () => {
    expect(parseStoredApiCredential(KEY, { authType: 'header', headerName: 'x-goog-api-key' })).toBe(KEY);
    expect(parseStoredApiCredential('tok', { authType: 'bearer' })).toBe('tok');
    expect(parseStoredApiCredential('not-json{{{', { authType: 'header', headerNames: ['A', 'B'] })).toBe('not-json{{{');
  });

  test('header auth never spreads a service-account JSON, configured header or not', () => {
    const serviceAccount = JSON.stringify({ type: 'service_account', private_key: 'line1\nline2' });
    expect(parseStoredApiCredential(serviceAccount, { authType: 'header' })).toBe(serviceAccount);
    expect(parseStoredApiCredential(serviceAccount, { authType: 'header', headerName: 'X-API-Key' })).toBe(serviceAccount);
  });

  test('bearer and query credentials are never parsed as header maps', () => {
    expect(parseStoredApiCredential(WRAPPED, { authType: 'bearer' })).toBe(WRAPPED);
    expect(parseStoredApiCredential(WRAPPED, { authType: 'query' })).toBe(WRAPPED);
    expect(parseStoredApiCredential(WRAPPED, undefined)).toBe(WRAPPED);
  });

  test('basic auth parses {username,password} and passes other strings through', () => {
    expect(parseStoredApiCredential(JSON.stringify({ username: 'u', password: 'p' }), { authType: 'basic' })).toEqual({ username: 'u', password: 'p' });
    expect(parseStoredApiCredential('dTpw', { authType: 'basic' })).toBe('dTpw');
    expect(parseStoredApiCredential(JSON.stringify({ username: 'u' }), { authType: 'basic' })).toBe(JSON.stringify({ username: 'u' }));
  });
});

describe('serializeHeaderCredential', () => {
  test('single header matching headerName is stored bare', () => {
    expect(serializeHeaderCredential({ 'x-goog-api-key': KEY }, 'x-goog-api-key')).toBe(KEY);
  });

  test('single header without a matching headerName and multi headers are stored as JSON', () => {
    expect(serializeHeaderCredential({ 'x-goog-api-key': KEY }, undefined)).toBe(WRAPPED);
    expect(serializeHeaderCredential({ 'x-goog-api-key': KEY }, 'X-API-Key')).toBe(WRAPPED);
    expect(serializeHeaderCredential(DATADOG, undefined)).toBe(JSON.stringify(DATADOG));
  });

  test('round-trips through parseStoredApiCredential for every shape', () => {
    const single = { authType: 'header', headerName: 'x-goog-api-key' };
    expect(parseStoredApiCredential(serializeHeaderCredential({ 'x-goog-api-key': KEY }, 'x-goog-api-key'), single)).toBe(KEY);
    const multi = { authType: 'header', headerNames: Object.keys(DATADOG) };
    expect(parseStoredApiCredential(serializeHeaderCredential(DATADOG, undefined), multi)).toEqual(DATADOG);
  });
});

describe('buildApiAuthHeaders', () => {
  test('header auth with a bare value', () => {
    const h = buildApiAuthHeaders({ type: 'header', headerName: 'x-goog-api-key' }, KEY);
    expect(h['x-goog-api-key']).toBe(KEY);
    expect(h['Content-Type']).toBe('application/json');
  });

  test('header auth with a header map sends every header', () => {
    const h = buildApiAuthHeaders({ type: 'header' }, DATADOG);
    expect(h['DD-API-KEY']).toBe('api');
    expect(h['DD-APPLICATION-KEY']).toBe('app');
  });

  test('header auth unwraps a JSON-serialized header map instead of sending it verbatim', () => {
    const h = buildApiAuthHeaders({ type: 'header', headerName: 'x-goog-api-key' }, WRAPPED);
    expect(h['x-goog-api-key']).toBe(KEY);
    expect(Object.values(h).some((v) => v.includes('{'))).toBe(false);
  });

  test('header auth defaults the header name to x-api-key', () => {
    expect(buildApiAuthHeaders({ type: 'header' }, 'k')['x-api-key']).toBe('k');
  });

  test('bearer and oauth honor authScheme', () => {
    expect(buildApiAuthHeaders({ type: 'bearer' }, 't')['Authorization']).toBe('Bearer t');
    expect(buildApiAuthHeaders({ type: 'bearer', authScheme: 'Token' }, 't')['Authorization']).toBe('Token t');
    expect(buildApiAuthHeaders({ type: 'bearer', authScheme: '' }, 't')['Authorization']).toBe('t');
    expect(buildApiAuthHeaders({ type: 'oauth' }, 't')['Authorization']).toBe('Bearer t');
    expect(buildApiAuthHeaders({ type: 'bearer' }, DATADOG)['Authorization']).toBeUndefined();
  });

  test('basic auth encodes the credential object and passes encoded strings through', () => {
    const encoded = Buffer.from('u:p').toString('base64');
    expect(buildApiAuthHeaders({ type: 'basic' }, { username: 'u', password: 'p' })['Authorization']).toBe(`Basic ${encoded}`);
    expect(buildApiAuthHeaders({ type: 'basic' }, encoded)['Authorization']).toBe(`Basic ${encoded}`);
    expect(buildApiAuthHeaders({ type: 'basic' }, '')['Authorization']).toBeUndefined();
  });

  test('none and query add no auth header; defaults are merged and auth wins', () => {
    expect(Object.keys(buildApiAuthHeaders({ type: 'none' }, 'k'))).toEqual(['Content-Type']);
    expect(Object.keys(buildApiAuthHeaders({ type: 'query', queryParam: 'key' }, 'k'))).toEqual(['Content-Type']);
    expect(Object.keys(buildApiAuthHeaders(undefined, 'k'))).toEqual(['Content-Type']);
    const h = buildApiAuthHeaders({ type: 'header', headerName: 'X-Key' }, 'live', { 'X-Key': 'stale', 'X-Beta': '1' });
    expect(h['X-Key']).toBe('live');
    expect(h['X-Beta']).toBe('1');
  });
});

describe('appendQueryAuth', () => {
  test('adds the credential as a query parameter for query auth only', () => {
    expect(appendQueryAuth('https://a.test/v1', { type: 'query', queryParam: 'key' }, 'k 1')).toBe('https://a.test/v1?key=k%201');
    expect(appendQueryAuth('https://a.test/v1?x=1', { type: 'query' }, 'k')).toBe('https://a.test/v1?x=1&api_key=k');
    expect(appendQueryAuth('https://a.test/v1', { type: 'header' }, 'k')).toBe('https://a.test/v1');
    expect(appendQueryAuth('https://a.test/v1', { type: 'query' }, DATADOG)).toBe('https://a.test/v1');
  });
});

describe('describeApiAuth', () => {
  test('names where the credential goes without leaking values', () => {
    expect(describeApiAuth({ type: 'header', headerName: 'x-goog-api-key' }, KEY)).toBe('header x-goog-api-key');
    expect(describeApiAuth({ type: 'header' }, DATADOG)).toBe('headers DD-API-KEY, DD-APPLICATION-KEY');
    expect(describeApiAuth({ type: 'header', headerName: 'X-API-Key' }, WRAPPED)).toBe('header x-goog-api-key');
    expect(describeApiAuth({ type: 'bearer' }, 't')).toBe('Authorization: Bearer');
    expect(describeApiAuth({ type: 'bearer', authScheme: '' }, 't')).toBe('Authorization (raw token)');
    expect(describeApiAuth({ type: 'basic' }, 't')).toBe('Authorization: Basic');
    expect(describeApiAuth({ type: 'query', queryParam: 'key' }, 't')).toBe('query parameter "key"');
    expect(describeApiAuth({ type: 'none' }, 't')).toBe('no authentication');
    for (const spec of [{ type: 'header' as const, headerName: 'x-goog-api-key' }, { type: 'bearer' as const }]) {
      expect(describeApiAuth(spec, KEY)).not.toContain(KEY);
    }
  });
});

describe('apiAuthSpecFromConfig', () => {
  test('maps known auth types and falls back to none', () => {
    expect(apiAuthSpecFromConfig({ authType: 'header', headerName: 'X' }).type).toBe('header');
    expect(apiAuthSpecFromConfig({ authType: 'oauth', authScheme: 'Token' })).toEqual({ type: 'oauth', headerName: undefined, headerNames: undefined, queryParam: undefined, authScheme: 'Token' });
    expect(apiAuthSpecFromConfig({ authType: 'weird' }).type).toBe('none');
    expect(apiAuthSpecFromConfig({}).type).toBe('none');
  });
});
