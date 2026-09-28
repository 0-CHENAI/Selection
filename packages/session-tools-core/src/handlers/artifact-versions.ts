import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface ArtifactVersionsArgs {
  action: 'list' | 'restore';
  path?: string;
  artifactId?: string;
  versionId?: string;
  expectedVersion?: string;
}

export async function handleArtifactVersions(ctx: SessionToolContext, args: ArtifactVersionsArgs): Promise<ToolResult> {
  if (!ctx.artifactVersions) return errorResponse('Artifact version management is unavailable in this session.');
  if (args.action !== 'list' && args.action !== 'restore') return errorResponse('Unknown artifact version action.');
  if (args.action === 'list' && !args.path && !args.artifactId) {
    return errorResponse('Provide a file path or artifactId to list versions.');
  }
  if (args.action === 'restore' && (!args.artifactId || !args.versionId || !args.expectedVersion)) {
    return errorResponse('Restore requires artifactId, versionId and expectedVersion from a current version listing.');
  }
  try {
    return successResponse(JSON.stringify(await ctx.artifactVersions(args), null, 2));
  } catch (error) {
    return errorResponse(`Artifact version ${args.action} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
