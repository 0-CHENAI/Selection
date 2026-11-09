import { expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { getCurrentSystemPrompt, type Context, type ToolResultMessage } from '@earendil-works/pi-ai';
import { unknownToolRecovery } from './unknown-tool-guard';

const failure = (name = 'image-preview'): ToolResultMessage => ({
  role: 'toolResult', toolCallId: crypto.randomUUID(), toolName: name,
  content: [{ type: 'text', text: `Tool ${name} not found` }], isError: true, timestamp: Date.now(),
});
const base: Context = { systemPrompt: 'original', messages: [], tools: [{ name: 'read', description: 'Read files', parameters: Type.Object({ path: Type.String() }) }] };
it('explains preview/tool confusion using the real active registry without rewriting tool results', () => {
  const context = { ...base, messages: [failure()] };
  const result = unknownToolRecovery(context);
  expect(getCurrentSystemPrompt(result.context.messages)).toContain('NOT a callable tool');
  expect(getCurrentSystemPrompt(result.context.messages)).toContain('Currently registered tools: read');
  expect(result.context.messages.at(-2)).toBe(context.messages[0]);
  expect(context.systemPrompt).toBe('original');
});
it('stops three repeated unknown calls, including alternating invented names', () => {
  expect(unknownToolRecovery({ ...base, messages: [failure(), failure('fake'), failure(), failure()] }).stop).toContain('已停止');
});
it('does not stop on past turns or after successful recovery', () => {
  expect(unknownToolRecovery({ ...base, messages: [failure(), failure(), { role:'user',content:'继续',timestamp:Date.now() }, failure()] }).stop).toBeUndefined();
  expect(getCurrentSystemPrompt(unknownToolRecovery({ ...base, messages: [failure(), failure(), {...failure('read'), isError:false}] }).context.messages)).toBe('original');
});
it('leaves valid tool errors and newly registered tools alone', () => {
  expect(getCurrentSystemPrompt(unknownToolRecovery({ ...base, messages: [failure('read')] }).context.messages)).toBe('original');
  expect(getCurrentSystemPrompt(unknownToolRecovery({ ...base, messages: [{...failure(),content:[{type:'text',text:'Permission denied'}]}] }).context.messages)).toBe('original');
});
it('also bounds a loop that keeps inventing different tool names', () => {
  expect(unknownToolRecovery({...base,messages:Array.from({length:6},(_,i)=>failure(`invented_${i}`))}).stop).toContain('已停止');
});
