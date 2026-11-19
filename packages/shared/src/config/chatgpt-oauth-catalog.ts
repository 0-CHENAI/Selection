import { thinkingLevelMapForLevels } from '../agent/thinking-capabilities.ts';
import type { CustomEndpointModelPayload } from './model-image-support.ts';
import type { Api, Model, Provider } from '@earendil-works/pi-ai';

// The account catalog is ahead of Pi 1.5.0. Use the supported Codex transport
// of each model's predecessor until Pi supplies its own complete definition.
const chatgptModels = [
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', contextWindow: 500_000, predecessor: 'gpt-6.1-sol' },
  { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', contextWindow: 272_000, predecessor: 'gpt-6-astra' },
] as const;

export function missingChatGptModels(models: readonly Model<Api>[]): Model<Api>[] {
  const additions: Model<Api>[] = [];
  for (const { predecessor, id, name, contextWindow } of chatgptModels) {
    if (models.some(model => model.id === id)) continue;
    const template = models.find(model => model.id === predecessor && model.provider === 'openai-codex');
    if (template) {
      // This is subscription access. The account catalog supplies no token prices.
      additions.push({ ...template, id, name, contextWindow, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    }
  }
  return additions;
}

// Read the connection catalog lazily so a running session can switch to a
// newly discovered model after a runtime-config update.
export function withChatGptModels(
  provider: Provider,
  connectionModels: () => readonly CustomEndpointModelPayload[] | undefined,
): Provider {
  const getModels = (): Model<Api>[] => {
    const builtin = provider.getModels();
    const models = new Map([...builtin, ...missingChatGptModels(builtin)].map(model => [model.id, model]));
    const transport = models.get('gpt-6.1-sol') ?? builtin[0];
    const account = connectionModels();
    if (!account) return [...models.values()];
    if (!transport) return [];
    return account.map(item => {
      const entry = typeof item === 'string' ? { id: item } : item;
      const id = entry.id.replace(/^pi\//, '');
      const existing = models.get(id);
      const base = existing ?? transport;
      const contextWindow = entry.contextWindow ?? base.contextWindow;
      return {
        ...base, id, name: existing?.name ?? id, contextWindow,
        maxTokens: Math.min(entry.maxTokens ?? base.maxTokens, contextWindow),
        cost: existing?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        input: entry.supportsImages === undefined ? base.input : entry.supportsImages ? ['text', 'image'] : ['text'],
        reasoning: entry.thinkingMode ? entry.thinkingMode !== 'unsupported' : base.reasoning,
        thinkingLevelMap: entry.supportedThinkingLevels?.length
          ? thinkingLevelMapForLevels(entry.supportedThinkingLevels) : base.thinkingLevelMap,
      };
    });
  };
  return {
    ...provider, getModels,
    getAllModels: () => [...getModels(), ...(provider.getAllModels?.() ?? []).filter(model => model.type && model.type !== 'chat')],
  };
}
