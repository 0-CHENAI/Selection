import { resolveSpawnWaitTimeoutMs } from '../../shared/src/agent/spawn-session-tool.ts';
import { BROWSER_SCREENSHOT_REPLY_TIMEOUT_MS, isStandaloneBrowserScreenshot } from '../../shared/src/agent/browser-tool-runtime.ts';

const DEFAULT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

export function isScreenshotProxyCall(toolName: string, args: Record<string, unknown>): boolean {
  return toolName === 'mcp__session__browser_tool' && isStandaloneBrowserScreenshot(args.command);
}

/** Transport fallback must not shorten a host-owned wait or time out a human decision. */
export function proxyReplyDeadlineMs(toolName: string, args: Record<string, unknown>): number | undefined {
  // These waits end through the host's scheduler/user decision or cancellation.
  // Match canonical session identities only; external tools cannot opt out by name/args.
  if (toolName === 'mcp__session__clarify' || toolName === 'mcp__session__task_help'
    || (toolName === 'mcp__session__run_task' && args.waitForCompletion === true)) return undefined;
  if (toolName === 'mcp__session__spawn_session' && args.mode === 'wait' && args.help !== true) {
    // Include the host's child-wait budget plus normal bridge/setup allowance.
    return DEFAULT_REPLY_TIMEOUT_MS + resolveSpawnWaitTimeoutMs(args.timeoutMs);
  }
  if (isScreenshotProxyCall(toolName, args)) return BROWSER_SCREENSHOT_REPLY_TIMEOUT_MS + 10_000;
  return DEFAULT_REPLY_TIMEOUT_MS;
}
