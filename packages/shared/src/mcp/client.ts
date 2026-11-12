/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports both HTTP and stdio transports for remote and local MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  NO_RESOURCE_CAPABILITIES,
  resourceCapabilitiesFromServer,
  type McpResource,
  type McpResourceCapabilities,
  type McpResourceContent,
  type McpResourceTemplate,
} from './resources.ts';

/**
 * HTTP transport config for remote MCP servers
 */
export interface HttpMcpClientConfig {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stdio transport config for local MCP servers (spawns subprocess)
 */
export interface StdioMcpClientConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Unified config supporting both transport types
 */
export type McpClientConfig = HttpMcpClientConfig | StdioMcpClientConfig;

/**
 * Sensitive environment variables that should NOT be passed to MCP subprocesses.
 * These could contain API keys, tokens, or credentials that MCP servers don't need
 * and shouldn't have access to.
 * NOTE: This list is duplicated in packages/session-tools-core/src/handlers/transform-data.ts (BLOCKED_ENV_VARS).
 * If you add a new entry here, update it there too.
 */
const BLOCKED_ENV_VARS = [
  // Selection auth (set by the app itself)
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',

  // AWS credentials
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',

  // Common API keys/tokens
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'STRIPE_SECRET_KEY',
  'NPM_TOKEN',
];

/**
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
  getResourceCapabilities(): McpResourceCapabilities;
  listResources(cursor?: string): Promise<{ resources: McpResource[]; nextCursor?: string }>;
  listResourceTemplates(cursor?: string): Promise<{ resourceTemplates: McpResourceTemplate[]; nextCursor?: string }>;
  readResource(uri: string): Promise<{ contents: McpResourceContent[] }>;
  subscribeResource(uri: string): Promise<void>;
  unsubscribeResource(uri: string): Promise<void>;
}

export class CraftMcpClient {
  private client: Client;
  private transport: Transport;
  private connected = false;

  constructor(config: McpClientConfig) {
    this.client = new Client({
      name: 'craft-agent',
      version: '1.0.0',
    });

    // Create transport based on config type
    if (config.transport === 'stdio') {
      // Stdio transport for local MCP servers - merge with process env,
      // but filter out sensitive credentials to prevent leaking secrets to subprocesses
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !BLOCKED_ENV_VARS.includes(key)) {
          processEnv[key] = value;
        }
      }
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...processEnv, ...config.env },
      });
    } else {
      // HTTP transport for remote MCP servers
      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
        }
      );
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.client.connect(this.transport);
    this.connected = true;

    // Health-check tools/list only when the server declared tools. Calling it
    // on a resources-only (or tools-less) server throws in the bundled SDK.
    if (this.supportsTools()) {
      try {
        await this.client.listTools();
      } catch (error) {
        await this.client.close();
        this.connected = false;
        throw new Error(
          `MCP connection failed health check: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  supportsTools(): boolean {
    return Boolean(this.client.getServerCapabilities()?.tools);
  }

  getResourceCapabilities(): McpResourceCapabilities {
    return resourceCapabilitiesFromServer(this.client.getServerCapabilities());
  }

  supportsResources(): boolean {
    return this.getResourceCapabilities().resources;
  }

  async listTools(): Promise<Tool[]> {
    await this.ensureConnected();
    if (!this.supportsTools()) return [];

    const result = await this.client.listTools();
    return result.tools;
  }

  async listResources(cursor?: string): Promise<{ resources: McpResource[]; nextCursor?: string }> {
    await this.ensureConnected();
    if (!this.supportsResources()) return { resources: [] };
    const result = await this.client.listResources(cursor ? { cursor } : undefined);
    return {
      resources: (result.resources ?? []) as McpResource[],
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  async listResourceTemplates(cursor?: string): Promise<{ resourceTemplates: McpResourceTemplate[]; nextCursor?: string }> {
    await this.ensureConnected();
    if (!this.supportsResources()) return { resourceTemplates: [] };
    try {
      const result = await this.client.listResourceTemplates(cursor ? { cursor } : undefined);
      return {
        resourceTemplates: (result.resourceTemplates ?? []) as McpResourceTemplate[],
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    } catch {
      // templates/list is optional even for servers that declared resources.
      return { resourceTemplates: [] };
    }
  }

  async readResource(uri: string): Promise<{ contents: McpResourceContent[] }> {
    await this.ensureConnected();
    if (!this.supportsResources()) return { contents: [] };
    const result = await this.client.readResource({ uri });
    return { contents: (result.contents ?? []) as McpResourceContent[] };
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.ensureConnected();
    if (!this.getResourceCapabilities().subscribe) return;
    await this.client.subscribeResource({ uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.ensureConnected();
    if (!this.getResourceCapabilities().subscribe) return;
    await this.client.unsubscribeResource({ uri });
  }

  /**
   * Register list_changed / updated handlers only when the server declared
   * `capabilities.resources.listChanged`. No-op otherwise — never attach
   * handlers that would imply we called subscribe/list on an undeclared server.
   */
  enableResourceNotifications(handlers: {
    onListChanged?: () => void;
    onUpdated?: (uri: string) => void;
  }): void {
    if (!this.getResourceCapabilities().listChanged) return;
    if (handlers.onListChanged) {
      this.client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
        handlers.onListChanged?.();
      });
    }
    if (handlers.onUpdated) {
      this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
        const uri = (notification as { params?: { uri?: string } }).params?.uri;
        if (uri) handlers.onUpdated?.(uri);
      });
    }
  }

  /**
   * Returns server name/version reported during the MCP handshake.
   * Available after `connect()` resolves; undefined otherwise.
   */
  getServerInfo(): { name: string; version: string } | undefined {
    const info = this.client.getServerVersion();
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
