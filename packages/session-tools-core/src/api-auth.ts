/**
 * API source credential parsing and request-auth assembly.
 *
 * One implementation shared by the runtime request path in
 * `@craft-agent/shared` (`sources/api-tools.ts`, `sources/credential-manager.ts`)
 * and the `source_test` validator in this package, so the validator sends
 * exactly what the generated `api_<source>` tools send (OSS #1067).
 *
 * Pure module: no I/O and no workspace imports. `@craft-agent/shared` depends
 * on this package, not the other way round, so this is the lowest layer both
 * sides can reach.
 */

export interface BasicAuthCredential {
  username: string;
  password: string;
}

/** Header name → value, for APIs that need several auth headers (Datadog, Algolia). */
export type MultiHeaderCredential = Record<string, string>;

export type ApiCredential = string | BasicAuthCredential | MultiHeaderCredential;

export type ApiAuthKind = 'none' | 'header' | 'bearer' | 'query' | 'basic' | 'oauth';

/** The part of an API source config that decides how a credential goes on the wire. */
export interface ApiAuthSpec {
  type: ApiAuthKind;
  headerName?: string;
  headerNames?: string[];
  queryParam?: string;
  authScheme?: string;
}

/** Fields of a stored source config that drive credential parsing. */
export interface StoredCredentialShape {
  authType?: string;
  headerName?: string;
  headerNames?: string[];
}

export function isBasicAuthCredential(cred: ApiCredential): cred is BasicAuthCredential {
  return typeof cred === 'object' && cred !== null && 'username' in cred && 'password' in cred;
}

/** True for header maps: any object credential that is not basic auth. */
export function isMultiHeaderCredential(cred: ApiCredential): cred is MultiHeaderCredential {
  return typeof cred === 'object' && cred !== null && !('username' in cred && 'password' in cred);
}

/** An HTTP field name (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** A single-line field value: no control characters but tab. */
const HEADER_VALUE = /^[^\x00-\x08\x0a-\x1f\x7f]*$/;

/**
 * Parse a JSON object of HTTP headers, the shape the credential prompt writes:
 * every key a header name, every value a single-line header value. Returns null
 * for anything else, including empty objects, arrays, JSON scalars and object
 * secrets such as a service-account JSON (its private key spans lines), so
 * those are never spread across headers.
 */
export function parseJsonHeaderMap(raw: string): MultiHeaderCredential | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  const isHeader = ([name, value]: [string, unknown]) =>
    HEADER_NAME.test(name) && typeof value === 'string' && HEADER_VALUE.test(value);
  if (entries.length === 0 || !entries.every(isHeader)) return null;
  return parsed as MultiHeaderCredential;
}

/**
 * Map a source config `authType` onto the auth spec the builders understand.
 */
export function apiAuthSpecFromConfig(api: {
  authType?: string;
  headerName?: string;
  headerNames?: string[];
  queryParam?: string;
  authScheme?: string;
}): ApiAuthSpec {
  const kind = api.authType;
  const type: ApiAuthKind =
    kind === 'header' || kind === 'bearer' || kind === 'query' || kind === 'basic' || kind === 'oauth'
      ? kind
      : 'none';
  return {
    type,
    headerName: api.headerName,
    headerNames: api.headerNames,
    queryParam: api.queryParam,
    authScheme: api.authScheme,
  };
}

/**
 * Turn the raw vault value of an API source into the credential the request
 * path expects.
 *
 * - `basic`: `{"username","password"}` JSON becomes a BasicAuthCredential; anything
 *   else passes through as the raw string.
 * - Header maps (JSON objects of header names to single-line values, see
 *   parseJsonHeaderMap) are recognized for `header` auth and for any source with
 *   `headerNames`:
 *   - configured `headerNames`: the map when every configured name is present,
 *     otherwise the raw string so the misconfiguration stays visible;
 *   - a single configured `headerName` holding exactly that key: the bare value,
 *     so the header carries the key and not the serialized object;
 *   - otherwise the map, each entry becoming its own header.
 * - Everything else is the raw string.
 */
export function parseStoredApiCredential(raw: string, api: StoredCredentialShape | undefined): ApiCredential {
  if (api?.authType === 'basic') {
    try {
      const parsed = JSON.parse(raw) as { username?: unknown; password?: unknown } | null;
      if (parsed && typeof parsed === 'object' && parsed.username && parsed.password) {
        return { username: String(parsed.username), password: String(parsed.password) };
      }
    } catch {
      // Not JSON: legacy or hand-edited value, pass through
    }
    return raw;
  }

  const configuredNames = api?.headerNames?.filter(Boolean) ?? [];
  const mayBeHeaderMap = configuredNames.length > 0 || api?.authType === 'header';
  const headerMap = mayBeHeaderMap ? parseJsonHeaderMap(raw) : null;
  if (!headerMap) return raw;

  if (configuredNames.length > 0) {
    return configuredNames.every((name) => name in headerMap) ? headerMap : raw;
  }

  const keys = Object.keys(headerMap);
  if (api?.headerName && keys.length === 1 && keys[0] === api.headerName) {
    return headerMap[api.headerName]!;
  }
  // The prompt stores the header the user typed when it is not `headerName`: send it
  // under that name. Object secrets never get here (parseJsonHeaderMap rejects them).
  return headerMap;
}

/**
 * Store-side counterpart of `parseStoredApiCredential` for the credential
 * prompt: a single header that matches the source's `headerName` is stored
 * bare, anything else as a JSON header map.
 */
export function serializeHeaderCredential(headers: Record<string, string>, singleHeaderName?: string): string {
  const names = Object.keys(headers);
  if (names.length === 1 && singleHeaderName && names[0] === singleHeaderName) {
    return headers[singleHeaderName]!;
  }
  return JSON.stringify(headers);
}

/**
 * Authorization header value for bearer-style authentication.
 *
 * `authScheme` undefined → "Bearer <token>", "Token" → "Token <token>",
 * "" → "<token>" for APIs that expect the raw token.
 */
export function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  const scheme = authScheme ?? 'Bearer';
  return scheme ? `${scheme} ${token}` : token;
}

/**
 * Request headers for an API source: JSON content type, default headers, auth.
 *
 * Header auth accepts a header map, a bare value, or a JSON-serialized header
 * map that escaped parsing upstream; the last case is unwrapped rather than
 * sent verbatim. Basic auth accepts the parsed credential or an already
 * encoded string.
 */
export function buildApiAuthHeaders(
  auth: ApiAuthSpec | undefined,
  credential: ApiCredential,
  defaultHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...defaultHeaders,
  };

  if (!auth || auth.type === 'none') return headers;

  if (auth.type === 'basic') {
    if (isBasicAuthCredential(credential)) {
      const encoded = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else if (typeof credential === 'string' && credential) {
      headers['Authorization'] = `Basic ${credential}`;
    }
    return headers;
  }

  if (auth.type === 'header') {
    const headerMap = isMultiHeaderCredential(credential)
      ? credential
      : typeof credential === 'string'
        ? parseJsonHeaderMap(credential)
        : null;
    if (headerMap) {
      Object.assign(headers, headerMap);
    } else if (typeof credential === 'string' && credential) {
      headers[auth.headerName || 'x-api-key'] = credential;
    }
    return headers;
  }

  const token = typeof credential === 'string' ? credential : '';
  if (!token) return headers;

  if (auth.type === 'bearer' || auth.type === 'oauth') {
    headers['Authorization'] = buildAuthorizationHeader(auth.authScheme, token);
  }
  // 'query' goes on the URL, see appendQueryAuth
  return headers;
}

/** Append query-parameter auth to a URL. Only string credentials apply. */
export function appendQueryAuth(url: string, auth: ApiAuthSpec | undefined, credential: ApiCredential): string {
  const token = typeof credential === 'string' ? credential : '';
  if (auth?.type !== 'query' || !token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${auth.queryParam || 'api_key'}=${encodeURIComponent(token)}`;
}

/**
 * Describe where the credential goes, for diagnostics. Never includes values.
 */
export function describeApiAuth(auth: ApiAuthSpec | undefined, credential: ApiCredential): string {
  if (!auth || auth.type === 'none') return 'no authentication';
  if (auth.type === 'basic') return 'Authorization: Basic';
  if (auth.type === 'bearer' || auth.type === 'oauth') {
    const scheme = auth.authScheme ?? 'Bearer';
    return scheme ? `Authorization: ${scheme}` : 'Authorization (raw token)';
  }
  if (auth.type === 'query') return `query parameter "${auth.queryParam || 'api_key'}"`;

  const headerMap = isMultiHeaderCredential(credential)
    ? credential
    : typeof credential === 'string'
      ? parseJsonHeaderMap(credential)
      : null;
  const names = headerMap ? Object.keys(headerMap) : [auth.headerName || 'x-api-key'];
  return names.length === 1 ? `header ${names[0]}` : `headers ${names.join(', ')}`;
}
