import type { ModelDefinition } from '../config/models.ts';
import { thinkingFieldsFromUpstream } from '../agent/thinking-capabilities.ts';
import { extractChatGptAccountId } from './chatgpt-account-id.ts';

// The Codex account catalog is versioned independently of the public OpenAI API.
const catalogUrl = 'https://chatgpt.com/backend-api/codex/models?client_version=0.169.0';

interface CatalogEntry {
  slug?: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  context_window?: number;
  input_modalities?: string[];
  supported_reasoning_levels?: Array<{ effort: string }>;
}

export async function fetchChatGptModels(accessToken: string | undefined, timeoutMs: number): Promise<ModelDefinition[]> {
  if (!accessToken) throw new Error('ChatGPT OAuth access token unavailable');
  const accountId = extractChatGptAccountId(accessToken);
  const response = await fetch(catalogUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      originator: 'codex_cli_rs',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ChatGPT model catalog returned HTTP ${response.status}`);
  const { models } = await response.json() as { models?: CatalogEntry[] };
  if (!Array.isArray(models)) throw new Error('Invalid ChatGPT model catalog');

  const visible = new Map<string, ModelDefinition>();
  for (const entry of models) {
    if (!entry || typeof entry.visibility !== 'string') throw new Error('Invalid ChatGPT catalog entry');
    if (entry.visibility !== 'list') continue;
    const id = entry.slug?.trim();
    const contextWindow = entry.context_window;
    if (!id || typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
      throw new Error('Invalid visible model in ChatGPT catalog');
    }
    const name = entry.display_name?.trim() || id;
    const efforts = entry.supported_reasoning_levels?.map(level => level.effort);
    visible.set(id, {
      id: `pi/${id}`, name, shortName: name, provider: 'pi',
      description: entry.description ?? '', contextWindow,
      ...(entry.input_modalities ? { imageSupport: 'auto' as const, supportsImages: entry.input_modalities.includes('image') } : {}),
      ...thinkingFieldsFromUpstream({ id, provider: 'openai-codex', supportedReasoningEfforts: efforts,
        reasoningMandatory: !efforts?.some(level => level === 'none' || level === 'off'),
        reasoning: efforts ? efforts.length > 0 : undefined }),
    });
  }
  return [...visible.values()];
}
