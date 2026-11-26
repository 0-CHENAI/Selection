import { expect, test } from 'bun:test';
import { isScreenshotProxyCall, proxyReplyDeadlineMs } from './proxy-reply-deadline';
import { BROWSER_SCREENSHOT_REPLY_TIMEOUT_MS } from '../../shared/src/agent/browser-tool-runtime.ts';
import { resolveSpawnWaitTimeoutMs } from '../../shared/src/agent/spawn-session-tool';

test('bridge fallback respects default and maximum Swarm child wait contracts', () => {
  for (const timeoutMs of [undefined, 100, 900_000, 1_800_000, Infinity, 9_999_999]) {
    const deadline = proxyReplyDeadlineMs('mcp__session__spawn_session', { mode: 'wait', timeoutMs });
    expect(deadline!).toBeGreaterThan(resolveSpawnWaitTimeoutMs(timeoutMs));
    expect(deadline!).toBeLessThanOrEqual(40 * 60_000);
  }
  expect(proxyReplyDeadlineMs('mcp__session__spawn_session', { mode: 'background' })).toBe(600_000);
});

test('host-owned human/scheduler waits remain cancellable without a conflicting wall deadline', () => {
  for (const tool of ['clarify', 'task_help']) expect(proxyReplyDeadlineMs(`mcp__session__${tool}`, {})).toBeUndefined();
  expect(proxyReplyDeadlineMs('mcp__session__run_task', { waitForCompletion: true })).toBeUndefined();
  expect(proxyReplyDeadlineMs('mcp__session__run_task', { waitForCompletion: false })).toBe(600_000);
  for (const name of ['mcp__external__task_help', 'mcp__external__spawn_session', 'mcp__external__clarify', 'mcp__external__run_task']) {
    expect(proxyReplyDeadlineMs(name, { waitForCompletion: true, mode: 'wait', timeoutMs: 9_999_999 })).toBe(600_000);
  }
});

test('only standalone built-in screenshots get the recoverable bridge deadline', () => {
  const browser = 'mcp__session__browser_tool';
  for (const command of ['screenshot --png', ['screenshot', '--annotated'], 'screenshot-region --selector "div[data-x=\'a;b\']"']) {
    expect(isScreenshotProxyCall(browser, { command })).toBe(true);
    expect(proxyReplyDeadlineMs(browser, { command })!).toBeGreaterThan(BROWSER_SCREENSHOT_REPLY_TIMEOUT_MS);
    expect(proxyReplyDeadlineMs(browser, { command })!).toBeLessThan(600_000);
  }
  for (const command of ['click @e2; screenshot', 'screenshot; fill @e2 test', 'screenshot --selector "unfinished', 'snapshot']) {
    expect(isScreenshotProxyCall(browser, { command })).toBe(false);
    expect(proxyReplyDeadlineMs(browser, { command })).toBe(600_000);
  }
  expect(proxyReplyDeadlineMs('mcp__external__browser_tool', { command: 'screenshot' })).toBe(600_000);
});
