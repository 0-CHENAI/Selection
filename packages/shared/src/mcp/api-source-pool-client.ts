/**
 * Pool client for API sources.
 *
 * Connects to an in-process McpServer (created by createSdkMcpServer) via
 * in-memory transport, exposing it through the same PoolClient interface
 * that CraftMcpClient uses for remote MCP sources.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PoolClient } from './client.ts';
import {
  NO_RESOURCE_CAPABILITIES,
  resourceCapabilitiesFromServer,
  type McpResource,
  type McpResourceCapabilities,
  type McpResourceContent,
  type McpResourceTemplate,
} from './resources.ts';

export class ApiSourcePoolClient implements PoolClient {
  private client: Client;
  private connected = false;

  constructor(private mcpServer: McpServer) {
    this.client = new Client({ name: 'craft-pool-api-source', version: '1.0.0' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect both ends
    await this.mcpServer.connect(serverTransport);
    await this.client.connect(clientTransport);

    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) await this.connect();
    if (!this.client.getServerCapabilities()?.tools) return [];
    const result = await this.client.listTools();
    return result.tools;
  }

  getResourceCapabilities(): McpResourceCapabilities {
    if (!this.connected) return { ...NO_RESOURCE_CAPABILITIES };
    return resourceCapabilitiesFromServer(this.client.getServerCapabilities());
  }

  async listResources(cursor?: string): Promise<{ resources: McpResource[]; nextCursor?: string }> {
    if (!this.connected) await this.connect();
    if (!this.getResourceCapabilities().resources) return { resources: [] };
    const result = await this.client.listResources(cursor ? { cursor } : undefined);
    return {
      resources: (result.resources ?? []) as McpResource[],
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  async listResourceTemplates(cursor?: string): Promise<{ resourceTemplates: McpResourceTemplate[]; nextCursor?: string }> {
    if (!this.connected) await this.connect();
    if (!this.getResourceCapabilities().resources) return { resourceTemplates: [] };
    try {
      const result = await this.client.listResourceTemplates(cursor ? { cursor } : undefined);
      return {
        resourceTemplates: (result.resourceTemplates ?? []) as McpResourceTemplate[],
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    } catch {
      return { resourceTemplates: [] };
    }
  }

  async readResource(uri: string): Promise<{ contents: McpResourceContent[] }> {
    if (!this.connected) await this.connect();
    if (!this.getResourceCapabilities().resources) return { contents: [] };
    const result = await this.client.readResource({ uri });
    return { contents: (result.contents ?? []) as McpResourceContent[] };
  }

  async subscribeResource(uri: string): Promise<void> {
    if (!this.connected) await this.connect();
    if (!this.getResourceCapabilities().subscribe) return;
    await this.client.subscribeResource({ uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    if (!this.connected) await this.connect();
    if (!this.getResourceCapabilities().subscribe) return;
    await this.client.unsubscribeResource({ uri });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) await this.connect();
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close().catch(() => {});
      this.connected = false;
    }
  }
}
