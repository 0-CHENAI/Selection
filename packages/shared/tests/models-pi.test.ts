import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('keeps Claude Opus 4.6 models in Anthropic catalogs', () => {
    // TODO(opus-4.6-sunset): flip these back to exclusion when 4.6 is deprecated.
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-4-6');

    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds.some(id => id.includes('claude-opus-4-6'))).toBe(true);
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models from the Pi SDK catalog', () => {
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('pi/deepseek-v4-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');
  });

  it('includes both Moonshot API regions with human-readable labels', () => {
    const providers = getPiApiKeyProviders();
    expect(providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'moonshotai', label: 'Moonshot AI' }),
      expect.objectContaining({ key: 'moonshotai-cn', label: 'Moonshot AI (CN)' }),
    ]));
  });

  it('exposes Kimi K3 for Moonshot and Kimi Coding providers', () => {
    expect(getPiModelsForAuthProvider('moonshotai').map(model => model.id)).toContain('pi/kimi-k3');
    expect(getPiModelsForAuthProvider('moonshotai-cn').map(model => model.id)).toContain('pi/kimi-k3');
    expect(getPiModelsForAuthProvider('kimi-coding').map(model => model.id)).toContain('pi/k3');
  });
});
