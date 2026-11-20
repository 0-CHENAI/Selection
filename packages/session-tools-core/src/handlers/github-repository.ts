import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'
import { GitHubRepositorySchema } from '../github-repository-protocol.ts'

export async function handleGitHubRepository(ctx: SessionToolContext, input: unknown) {
  try {
    if (!ctx.githubRepository) throw new Error('请前往「设置 → 外部连接」连接 GitHub。')
    return successResponse(JSON.stringify(await ctx.githubRepository(GitHubRepositorySchema.parse(input))))
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'GitHub 仓库操作失败')
  }
}
