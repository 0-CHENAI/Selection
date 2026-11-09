/**
 * Deterministic Craft MCP URL validation.
 */

import { debug } from '../utils/debug.ts';

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  typedError?: import('../agent/errors.ts').AgentError;
}

const CRAFT_MCP_HOST = 'mcp.craft.do';

/**
 * Validate a Craft MCP URL without calling an LLM.
 */
export async function validateMcpUrl(url: string): Promise<UrlValidationResult> {
  debug('[url-validator] Validating URL:', url);

  const trimmed = url.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return { valid: false, error: 'Enter only the URL, with no extra text.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'This is not a valid URL. It must start with https://' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'The URL must use https://, not http://' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials in the URL are not allowed.' };
  }

  if (parsed.hostname !== CRAFT_MCP_HOST) {
    return { valid: false, error: `Hostname must be exactly ${CRAFT_MCP_HOST}.` };
  }

  if (!parsed.pathname.startsWith('/links/')) {
    return { valid: false, error: 'Path must start with /links/.' };
  }

  const linkId = parsed.pathname.slice('/links/'.length).replace(/\/mcp\/?$/, '').split('/')[0] ?? '';
  if (!linkId || !/^[A-Za-z0-9_-]+$/.test(linkId)) {
    return { valid: false, error: 'The link ID may only contain letters, numbers, hyphens, and underscores.' };
  }

  return { valid: true };
}
