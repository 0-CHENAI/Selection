import { getEventListeners } from 'node:events';
import { expect, it } from 'bun:test';
import { boundedModelStream } from './bounded-model-stream.ts';

it('does not treat ongoing generation as semantic failure before the request limit', async () => {
  const values: number[] = [];
  for await (const value of boundedModelStream(async function* () {
    for (let index = 0; index < 4; index++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      yield index;
    }
  }, undefined, 200)) values.push(value);
  expect(values).toEqual([0, 1, 2, 3]);
});

it('cancels the producer when the consumer stops early', async () => {
  let signal: AbortSignal | undefined;
  let cleaned = false;
  for await (const value of boundedModelStream(async function* (requestSignal) {
    signal = requestSignal;
    try { yield 1; await new Promise(() => {}); } finally { cleaned = true; }
  })) {
    expect(value).toBe(1);
    break;
  }
  expect(signal?.aborted).toBe(true);
  expect(cleaned).toBe(true);
});

it('does not cut a long thinking stream that keeps emitting chunks', async () => {
  const values: number[] = [];
  for await (const value of boundedModelStream(async function* () {
    for (let index = 0; index < 6; index++) {
      await new Promise(resolve => setTimeout(resolve, 8));
      yield index;
    }
  }, undefined, 20)) values.push(value);
  expect(values).toEqual([0, 1, 2, 3, 4, 5]);
});

it('expires only after the stream stays silent', async () => {
  const stream = boundedModelStream(async function* () {
    await new Promise(() => {});
  }, undefined, 15);
  await expect(stream.next()).rejects.toThrow('time limit');
});

it('expires if output stops after earlier chunks', async () => {
  const stream = boundedModelStream(async function* () {
    yield 1;
    await new Promise(() => {});
  }, undefined, 15);
  expect((await stream.next()).value).toBe(1);
  await expect(stream.next()).rejects.toThrow('time limit');
});

it('handles a late provider rejection after the deadline', async () => {
  let rejectNext!: (reason: Error) => void;
  const stream = boundedModelStream(() => ({
    [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<number>>((_, reject) => { rejectNext = reject; }) }; },
  }), undefined, 10);
  await expect(stream.next()).rejects.toThrow('time limit');
  rejectNext(new Error('Late transport failure'));
  await new Promise(resolve => setTimeout(resolve, 5));
});


it('releases cancellation listeners between chunks during long output', async () => {
  let signal: AbortSignal | undefined;
  let count = 0;
  for await (const _value of boundedModelStream(async function* (requestSignal) {
    signal = requestSignal;
    for (let index = 0; index < 1000; index++) yield index;
  })) {
    count++;
    expect(getEventListeners(signal!, 'abort')).toHaveLength(0);
  }
  expect(count).toBe(1000);
});
