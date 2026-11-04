export interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The main process sends the whole proxy-tool set. A tool it leaves out
 * (a source turned off) must be dropped, not merged into leftovers.
 */
export function replaceProxyTools(
  current: ProxyToolDef[],
  incoming: ProxyToolDef[],
): { tools: ProxyToolDef[]; changed: boolean } {
  const changed = JSON.stringify(incoming) !== JSON.stringify(current);
  return { tools: incoming, changed };
}
