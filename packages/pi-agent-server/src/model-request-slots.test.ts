import { expect, test } from 'bun:test';
import { createModelRequestSlots, type ModelRequestSlotMessage } from './model-request-slots';

test('A8 queued abort and late grant release their own request without granting a cancelled dispatch', async () => {
  const messages: ModelRequestSlotMessage[] = [], slots = createModelRequestSlots(message => messages.push(message));
  const controller = new AbortController(), pending = slots.acquire(controller.signal).catch(error => error);
  const id = messages[0]!.requestId;
  controller.abort(); expect(await pending).toBeInstanceOf(Error);
  slots.granted(id);
  expect(messages.filter(message => message.type === 'model_request_release').every(message => message.requestId === id)).toBe(true);
});

test('A8 transport shutdown rejects pending slots, returns active slots and ignores duplicate completion', async () => {
  const messages: ModelRequestSlotMessage[] = [], slots = createModelRequestSlots(message => messages.push(message));
  const first = slots.acquire(); slots.granted(messages[0]!.requestId); const active = await first;
  const waiting = slots.acquire().catch(error => error);
  slots.close(); active.release({ status: 429 });
  expect(await waiting).toBeInstanceOf(Error);
  expect(messages.filter(message => message.type === 'model_request_release')).toHaveLength(2);
});
