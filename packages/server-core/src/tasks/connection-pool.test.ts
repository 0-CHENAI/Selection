import { describe, expect, it } from 'bun:test';
import { LlmConnectionPool } from './connection-pool';

describe('LlmConnectionPool', () => {
  it('tightens concurrency per connection and releases capacity after failure', () => {
    const pool = new LlmConnectionPool(2);
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
    expect(pool.tryAcquire('alpha', 2)).toBe(false);
    expect(pool.tryAcquire('beta', 2)).toBe(true);
    pool.release('alpha');
    expect(pool.tryAcquire('alpha', 2)).toBe(true);
  });
});
