/**
 * Helpers for keeping the Pi subprocess proxy-tool set in sync.
 *
 * The subprocess replaces its registered set on each register_tools message.
 * The main process must therefore send the complete list (session tools +
 * currently enabled source tools), including an empty source list when every
 * source is turned off.
 */

export function combineProxyToolDefs<T>(sessionTools: T[], sourceTools: T[]): T[] {
  return [...sessionTools, ...sourceTools];
}

export function nextProxyToolsPayload<T>(
  sentJson: string | null,
  tools: T[],
): { json: string; shouldSend: boolean } {
  const json = JSON.stringify(tools);
  return { json, shouldSend: json !== sentJson };
}
