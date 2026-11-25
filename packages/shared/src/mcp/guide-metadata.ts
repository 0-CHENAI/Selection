import type { McpGuideMetadata } from '../protocol/dto.ts';

/** Keep guide generation independent of MCP configuration, credentials and tool execution. */
export function collectMcpGuideMetadata(
  instructions: string | undefined,
  tools: McpGuideMetadata['tools'],
): McpGuideMetadata {
  return {
    instructions: instructions?.trim().slice(0, 3000) || undefined,
    tools: tools.slice(0, 80).map(({ name, description }) => ({
      name: name.slice(0, 128),
      description: description?.trim().slice(0, 400) || undefined,
    })),
  };
}
