import { z } from 'zod'
import type { SessionToolContext } from '../context.ts'
import { errorResponse, successResponse } from '../response.ts'

export const GitHubIssueSchema = z.object({
  repository: z.string().max(200).regex(/^[\w-]+\/[\w.-]+$/).describe('GitHub owner/repository'),
  action: z.enum(['create', 'comment', 'close']),
  number: z.number().int().positive().safe().optional().describe('Issue number for comment or close'),
  title: z.string().trim().min(1).max(256).optional().describe('Required for create'),
  body: z.string().trim().min(1).max(65536).optional().describe('Issue description or comment'),
}).strict()

export type GitHubIssueInput = z.infer<typeof GitHubIssueSchema>

export function parseGitHubIssue(input: unknown): GitHubIssueInput {
  const value = GitHubIssueSchema.parse(input)
  const repo = value.repository.split('/')[1]
  if (repo === '.' || repo === '..') throw new Error('Invalid repository')
  if (value.action === 'create') {
    if (!value.title || value.number !== undefined) throw new Error('Create requires a title and no issue number.')
  } else {
    if (!value.number || value.title !== undefined) throw new Error('Comment and close require an issue number and no title.')
    if (value.action === 'comment' && !value.body) throw new Error('Comment requires a body.')
    if (value.action === 'close' && value.body !== undefined) throw new Error('Use a separate comment before closing.')
  }
  return value
}

export async function handleGitHubIssue(ctx: SessionToolContext, input: unknown) {
  try {
    if (!ctx.githubIssue) throw new Error('请前往「设置 → 外部连接」连接 GitHub。')
    return successResponse(JSON.stringify(await ctx.githubIssue(parseGitHubIssue(input))))
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'GitHub Issue 操作失败')
  }
}
