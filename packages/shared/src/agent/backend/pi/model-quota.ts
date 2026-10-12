import { createHash } from 'node:crypto';
/** Quota identity excludes connection slug/model. Identical credentials and endpoint share a bucket. */
export function modelQuotaIdentity(provider: string, endpoint: string | undefined, credential: unknown): string {
  const normalizedProvider = provider.replace(/-(responses|completions)$/, '');
  let normalizedEndpoint = endpoint?.trim() || (normalizedProvider === 'openai' ? 'https://api.openai.com/v1' : `native:${normalizedProvider}`);
  try { const url = new URL(normalizedEndpoint); normalizedEndpoint = `${url.origin}${url.pathname}`.replace(/\/(chat\/completions|responses|messages)\/?$/, '').replace(/\/+$/, ''); } catch { /* Native provider without an exposed endpoint. */ }
  const value = credential && typeof credential === 'object' ? credential as Record<string, unknown> : {};
  let account: unknown = value.type === 'api_key' ? String(value.key ?? '').trim() : credential;
  if (value.type === 'oauth') {
    // Token rotation must not split one account's quota. Unknown OAuth identity shares a conservative provider bucket.
    account = value.accountId ?? value.account_id ?? 'oauth-account-unavailable';
    if (typeof value.access === 'string') try {
      const jwt = JSON.parse(Buffer.from(value.access.split('.')[1] ?? '', 'base64url').toString());
      account = jwt['https://api.openai.com/auth']?.chatgpt_account_id ?? jwt.sub ?? account;
    } catch { /* Opaque OAuth credentials retain the conservative bucket. */ }
  }
  return createHash('sha256').update(JSON.stringify([normalizedProvider, normalizedEndpoint, account ?? 'keyless'])).digest('hex');
}
