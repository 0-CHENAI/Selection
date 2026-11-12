/**
 * MCP resources protocol helpers.
 *
 * Resources are an optional server capability (resources/list, resources/templates/list,
 * resources/read, optional subscribe + list_changed). The bundled SDK client throws if
 * those methods are called when the server did not declare `capabilities.resources`.
 * Every resources/* call must go through these gates — never hit the SDK on a
 * server that didn't declare the capability.
 */

import { formatBytes } from '../utils/binary-detection.ts';

export interface McpResourceToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const LIST_MCP_RESOURCES_TOOL = 'list_mcp_resources';
export const READ_MCP_RESOURCE_TOOL = 'read_mcp_resource';

/** Assembled page size for list_mcp_resources (not the server's page size). */
export const MCP_RESOURCE_LIST_PAGE = 50;

/** First-page cap for the source-detail UI preview. */
export const MCP_RESOURCE_UI_PREVIEW_LIMIT = 30;

/** Images at or under this size are returned as tool-result attachments. */
export const MCP_RESOURCE_IMAGE_ATTACH_MAX_BYTES = 2 * 1024 * 1024;

/** Text resource contents longer than this are truncated in the tool result. */
export const MCP_RESOURCE_TEXT_MAX_CHARS = 200_000;

export const NO_RESOURCE_CAPABILITIES: McpResourceCapabilities = {
  resources: false,
  subscribe: false,
  listChanged: false,
};

export interface McpResourceCapabilities {
  resources: boolean;
  subscribe: boolean;
  listChanged: boolean;
}

export interface McpResource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpResourcePreview {
  supported: boolean;
  subscribe: boolean;
  listChanged: boolean;
  items: McpResource[];
  templates: McpResourceTemplate[];
  truncated?: boolean;
}

export interface ResourceListCursor {
  slugs: string[];
  index: number;
  phase: 'resources' | 'templates';
  cursor?: string;
}

export interface ResourceHost {
  getResourceCapableSlugs(): string[];
  getResourceCapabilities(slug: string): McpResourceCapabilities;
  listResources(slug: string, cursor?: string): Promise<{ resources: McpResource[]; nextCursor?: string }>;
  listResourceTemplates(slug: string, cursor?: string): Promise<{ resourceTemplates: McpResourceTemplate[]; nextCursor?: string }>;
  readResource(slug: string, uri: string): Promise<{ contents: McpResourceContent[] }>;
  sessionPath?: string;
}

export type McpResourceToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpResourceToolResult {
  content: string | McpResourceToolContent[];
  isError: boolean;
}

export function isMcpResourceTool(name: string): boolean {
  return name === LIST_MCP_RESOURCES_TOOL || name === READ_MCP_RESOURCE_TOOL;
}

export function resourceCapabilitiesFromServer(
  caps: { resources?: { subscribe?: boolean; listChanged?: boolean } | object } | undefined | null,
): McpResourceCapabilities {
  const resources = caps?.resources;
  if (!resources || typeof resources !== 'object') return { ...NO_RESOURCE_CAPABILITIES };
  const rec = resources as { subscribe?: boolean; listChanged?: boolean };
  return {
    resources: true,
    subscribe: rec.subscribe === true,
    listChanged: rec.listChanged === true,
  };
}

export function encodeResourceListCursor(cursor: ResourceListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeResourceListCursor(raw: string): ResourceListCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<ResourceListCursor>;
    if (!parsed || !Array.isArray(parsed.slugs) || typeof parsed.index !== 'number') return null;
    if (parsed.phase !== 'resources' && parsed.phase !== 'templates') return null;
    if (!parsed.slugs.every(slug => typeof slug === 'string')) return null;
    return {
      slugs: parsed.slugs,
      index: parsed.index,
      phase: parsed.phase,
      ...(typeof parsed.cursor === 'string' ? { cursor: parsed.cursor } : {}),
    };
  } catch {
    return null;
  }
}

export function getMcpResourceToolDefs(): McpResourceToolDef[] {
  return [
    {
      name: LIST_MCP_RESOURCES_TOOL,
      description:
        'List MCP resources and URI templates from connected servers that declared the resources capability. Optional `server` is a source slug. Paginate with `cursor` from a previous nextCursor. Resources are protocol data, not tools. For a template, fill the URI then call read_mcp_resource.',
      inputSchema: {
        type: 'object',
        properties: {
          server: {
            type: 'string',
            description: 'Optional source slug. Omit to list every connected server that declared resources.',
          },
          cursor: {
            type: 'string',
            description: 'Opaque pagination cursor from a previous nextCursor.',
          },
        },
      },
    },
    {
      name: READ_MCP_RESOURCE_TOOL,
      description:
        'Read one MCP resource by `server` (source slug) and `uri`. Only works if that server declared resources. Returns text. Small images are attached; other binary is a size-capped summary. Fill URI templates before reading.',
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Source slug of the MCP server.' },
          uri: { type: 'string', description: 'Resource URI. For templates, fill placeholders first.' },
        },
        required: ['server', 'uri'],
      },
    },
  ];
}

export async function collectResourcePreview(
  listResources: () => Promise<{ resources: McpResource[]; nextCursor?: string }>,
  listResourceTemplates: () => Promise<{ resourceTemplates: McpResourceTemplate[]; nextCursor?: string }>,
  caps: McpResourceCapabilities,
  limit = MCP_RESOURCE_UI_PREVIEW_LIMIT,
): Promise<McpResourcePreview> {
  if (!caps.resources) {
    return {
      supported: false,
      subscribe: caps.subscribe,
      listChanged: caps.listChanged,
      items: [],
      templates: [],
    };
  }

  const [listed, templates] = await Promise.all([
    listResources().catch(() => ({ resources: [] as McpResource[], nextCursor: undefined as string | undefined })),
    listResourceTemplates().catch(() => ({ resourceTemplates: [] as McpResourceTemplate[], nextCursor: undefined as string | undefined })),
  ]);

  const items = listed.resources.slice(0, limit);
  const remaining = Math.max(0, limit - items.length);
  const previewTemplates = templates.resourceTemplates.slice(0, remaining);
  const truncated =
    listed.resources.length + templates.resourceTemplates.length > limit
    || Boolean(listed.nextCursor)
    || Boolean(templates.nextCursor);

  return {
    supported: true,
    subscribe: caps.subscribe,
    listChanged: caps.listChanged,
    items,
    templates: previewTemplates,
    ...(truncated ? { truncated: true } : {}),
  };
}

export async function executeListMcpResources(
  host: ResourceHost,
  args: Record<string, unknown>,
): Promise<McpResourceToolResult> {
  const server = typeof args.server === 'string' && args.server.trim() ? args.server.trim() : undefined;
  const rawCursor = typeof args.cursor === 'string' && args.cursor.trim() ? args.cursor.trim() : undefined;
  const capable = host.getResourceCapableSlugs();

  let state: ResourceListCursor;
  if (rawCursor) {
    const decoded = decodeResourceListCursor(rawCursor);
    if (!decoded) {
      return { content: 'Invalid cursor. Call list_mcp_resources without cursor to start over.', isError: true };
    }
    state = decoded;
  } else if (server) {
    if (!capable.includes(server)) {
      return {
        content: `Server "${server}" is not connected or does not declare the resources capability.`,
        isError: false,
      };
    }
    state = { slugs: [server], index: 0, phase: 'resources' };
  } else if (capable.length === 0) {
    return {
      content: 'No connected MCP servers declare the resources capability.',
      isError: false,
    };
  } else {
    state = { slugs: capable, index: 0, phase: 'resources' };
  }

  const resources: Array<McpResource & { server: string }> = [];
  const templates: Array<McpResourceTemplate & { server: string }> = [];
  let pages = 0;
  const maxPages = 20;

  while (
    state.index < state.slugs.length
    && resources.length + templates.length < MCP_RESOURCE_LIST_PAGE
    && pages < maxPages
  ) {
    pages += 1;
    const slug = state.slugs[state.index];
    if (!slug || !host.getResourceCapabilities(slug).resources) {
      state.index += 1;
      state.phase = 'resources';
      delete state.cursor;
      continue;
    }

    if (state.phase === 'resources') {
      const page = await host.listResources(slug, state.cursor).catch((): { resources: McpResource[]; nextCursor?: string } => ({ resources: [] }));
      for (const resource of page.resources) {
        resources.push({ server: slug, ...resource });
      }
      if (page.nextCursor) {
        state.cursor = page.nextCursor;
        if (resources.length + templates.length >= MCP_RESOURCE_LIST_PAGE) break;
        continue;
      }
      state.phase = 'templates';
      delete state.cursor;
      continue;
    }

    const page = await host.listResourceTemplates(slug, state.cursor).catch((): { resourceTemplates: McpResourceTemplate[]; nextCursor?: string } => ({ resourceTemplates: [] }));
    for (const template of page.resourceTemplates) {
      templates.push({ server: slug, ...template });
    }
    if (page.nextCursor) {
      state.cursor = page.nextCursor;
      if (resources.length + templates.length >= MCP_RESOURCE_LIST_PAGE) break;
      continue;
    }
    state.index += 1;
    state.phase = 'resources';
    delete state.cursor;
  }

  const more = state.index < state.slugs.length || Boolean(state.cursor);
  const payload: Record<string, unknown> = { resources, templates };
  if (more) payload.nextCursor = encodeResourceListCursor(state);
  if (templates.length > 0) {
    payload.note = 'URI templates are not readable until placeholders are filled. Fill the URI, then call read_mcp_resource.';
  }

  return { content: JSON.stringify(payload, null, 2), isError: false };
}

export async function executeReadMcpResource(
  host: ResourceHost,
  args: Record<string, unknown>,
): Promise<McpResourceToolResult> {
  const server = typeof args.server === 'string' ? args.server.trim() : '';
  const uri = typeof args.uri === 'string' ? args.uri.trim() : '';
  if (!server || !uri) {
    return { content: 'read_mcp_resource requires `server` (source slug) and `uri`.', isError: true };
  }
  if (!host.getResourceCapabilities(server).resources) {
    return {
      content: `Server "${server}" is not connected or does not declare the resources capability.`,
      isError: false,
    };
  }

  const result = await host.readResource(server, uri);
  return formatReadResourceResult(result.contents, { server, uri, sessionPath: host.sessionPath });
}

export function formatReadResourceResult(
  contents: McpResourceContent[],
  options: { server: string; uri: string; sessionPath?: string },
): McpResourceToolResult {
  if (!contents.length) {
    return {
      content: `Resource ${options.uri} on ${options.server} returned no contents.`,
      isError: false,
    };
  }

  const textParts: string[] = [];
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];

  for (const block of contents) {
    const mime = block.mimeType || 'application/octet-stream';
    if (typeof block.text === 'string') {
      textParts.push(truncateText(block.text, mime, block.uri || options.uri));
      continue;
    }
    if (typeof block.blob === 'string') {
      const formatted = formatBlobContent(block.blob, mime, block.uri || options.uri);
      textParts.push(formatted.summary);
      if (formatted.image) images.push(formatted.image);
    }
  }

  const header = `Resource ${options.uri} (server: ${options.server})`;
  const body = [header, ...textParts].join('\n\n');
  if (images.length === 0) {
    return { content: body, isError: false };
  }
  return {
    content: [{ type: 'text', text: body }, ...images],
    isError: false,
  };
}

function truncateText(text: string, mimeType: string, uri: string): string {
  if (text.length <= MCP_RESOURCE_TEXT_MAX_CHARS) {
    return `Text (${mimeType}, ${uri}):\n${text}`;
  }
  return `Text (${mimeType}, ${uri}, truncated from ${text.length} chars):\n${text.slice(0, MCP_RESOURCE_TEXT_MAX_CHARS)}\n\n[truncated]`;
}

function formatBlobContent(
  blob: string,
  mimeType: string,
  uri: string,
): { summary: string; image?: { type: 'image'; data: string; mimeType: string } } {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(blob, 'base64');
  } catch {
    return { summary: `Blob (${mimeType}, ${uri}): invalid base64.` };
  }

  const size = formatBytes(bytes.length);
  if (mimeType.startsWith('image/') && bytes.length <= MCP_RESOURCE_IMAGE_ATTACH_MAX_BYTES && bytes.length > 0) {
    return {
      summary: `Image attached (${mimeType}, ${size}, ${uri}).`,
      image: { type: 'image', data: blob, mimeType },
    };
  }

  if (mimeType.startsWith('image/')) {
    return { summary: `Image too large to attach (${mimeType}, ${size}, ${uri}). Use a smaller resource or fetch via a tool that saves files.` };
  }

  return { summary: `Binary blob (${mimeType}, ${size}, ${uri}). Contents omitted.` };
}
