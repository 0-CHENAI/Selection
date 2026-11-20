import { z } from 'zod'

export const repositoryName = z.string().max(200).regex(/^[\w-]+\/[\w.-]+$/).refine(value => !['.', '..'].includes(value.split('/')[1]!))
export const branchName = z.string().min(1).max(255).refine(value =>
  !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.startsWith('-') && !value.endsWith('.') &&
  !value.includes('..') && !value.includes('@{') && !['@', 'HEAD'].includes(value) &&
  value.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock')), 'Invalid Git branch')

export const GitHubRepositorySchema = z.object({
  repository: repositoryName,
  action: z.enum(['commit', 'push', 'create_pr']),
  message: z.string().trim().min(1).max(65536).optional().describe('Commit message for staged changes'),
  head: branchName.optional().describe('Source branch for PR, or destination branch matching the current checkout for push'),
  base: branchName.optional().describe('Target branch for PR, or existing starting branch for publishing a new branch'),
  title: z.string().trim().min(1).max(256).optional(),
  body: z.string().max(65536).optional(),
  draft: z.boolean().optional(),
}).strict()
export type GitHubRepositoryInput = z.infer<typeof GitHubRepositorySchema>

export const pullInput = GitHubRepositorySchema.pick({ repository: true, head: true, base: true, title: true, body: true, draft: true })
  .required({ head: true, base: true, title: true }).refine(value => value.head !== value.base, 'Choose different head and base branches')

export const repositoryInput = GitHubRepositorySchema.pick({ repository: true })
export const branchInput = GitHubRepositorySchema.pick({ repository: true, head: true, base: true }).required({ head: true })
export const gitSha = z.string().regex(/^[0-9a-f]{40}$/)
export const pushInput = repositoryInput.extend({
  head: branchName, expected: gitSha.nullable(), tip: gitSha, baseSha: gitSha,
  bundle: z.string().max(16 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/),
})
