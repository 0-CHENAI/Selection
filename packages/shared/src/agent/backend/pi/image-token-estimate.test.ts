import { describe, expect, it } from 'bun:test';
import { deepSeekImageTokens } from '../../../utils/image-send-size.ts';
import {
  anthropicImageTokens,
  estimateImageTokens,
  glmImageTokens,
  kimiImageTokens,
  openAiHighDetailTokens,
  openAiPatchTokens,
  qwen25ImageTokens,
  qwen3ImageTokens,
  resolveImageTokenFamily,
  unknownImageTokens,
} from './image-token-estimate.ts';

describe('image token families', () => {
  it('resolves a family from the connection, never from a model id', () => {
    expect(resolveImageTokenFamily({ piAuthProvider: 'moonshotai-cn' })).toBe('kimi');
    expect(resolveImageTokenFamily({ piAuthProvider: 'zai-coding-cn' })).toBe('glm');
    expect(resolveImageTokenFamily({ piAuthProvider: 'qwen-token-plan' })).toBe('qwen3');
    expect(resolveImageTokenFamily({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })).toBe('qwen3');
    expect(resolveImageTokenFamily({ baseUrl: 'https://api.moonshot.cn/v1' })).toBe('kimi');
    expect(resolveImageTokenFamily({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })).toBe('glm');
    expect(resolveImageTokenFamily({ piAuthProvider: 'openai', baseUrl: 'https://api.anthropic.com' })).toBe('openai');
    expect(resolveImageTokenFamily({
      piAuthProvider: 'openai',
      imageTokenFamily: 'kimi',
    })).toBe('kimi');
    expect(resolveImageTokenFamily({ piAuthProvider: 'amazon-bedrock', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com' })).toBe('unknown');
    expect(resolveImageTokenFamily({ imageTokenFamily: 'not-a-family', piAuthProvider: 'anthropic' })).toBe('anthropic');
  });

  it('matches the worked examples for Kimi, GLM, and Qwen', () => {
    expect(kimiImageTokens(1024, 1024)).toBe(1369);
    expect(kimiImageTokens(1920, 1080)).toBe(2691);
    expect(kimiImageTokens(2048, 2048)).toBe(4225);
    expect(glmImageTokens(2048, 2048)).toBe(5329);
    expect(glmImageTokens(1000, 6000)).toBe(6144);
    expect(qwen3ImageTokens(2048, 2048)).toBe(2502);
    expect(qwen25ImageTokens(2048, 2048)).toBe(1227);
  });

  it('estimates Anthropic, OpenAI, DeepSeek, and unknown images conservatively', () => {
    expect(anthropicImageTokens(1568, 1568)).toBe(1534);
    expect(openAiHighDetailTokens(1024, 1024)).toBe(765);
    expect(openAiPatchTokens(1024, 1024)).toBe(1024);
    expect(estimateImageTokens(1024, 1024, { piAuthProvider: 'openai' })).toBe(1024);
    expect(estimateImageTokens(1024, 1024, { imageTokenFamily: 'openai-patch' })).toBe(1024);
    expect(estimateImageTokens(12, 1123, { piAuthProvider: 'deepseek' })).toBe(deepSeekImageTokens(12, 1123));
    expect(unknownImageTokens(100, 100)).toBe(Math.ceil((100 * 100) / 784) + 4);
    expect(estimateImageTokens(2048, 2048, { baseUrl: 'https://example.invalid/v1' })).toBe(unknownImageTokens(2048, 2048));
  });

  it('honors a DashScope high-resolution budget and caps it at 16384 tokens', () => {
    expect(qwen3ImageTokens(2048, 2048, { vlHighResolutionImages: true })).toBe(64 * 64 + 2);
    expect(qwen3ImageTokens(8000, 8000, { imageMaxPixels: 16_384 * 32 * 32 })).toBe(16_384);
    expect(qwen25ImageTokens(2048, 2048, { vlHighResolutionImages: true })).toBeGreaterThan(1227);
    expect(qwen25ImageTokens(8000, 8000, { imageMaxPixels: 16_384 * 28 * 28 })).toBeLessThanOrEqual(16_384);
  });
});
