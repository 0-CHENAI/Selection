/**
 * #717 确定性对齐分。不调用模型。
 * 用法：bun scripts/selection-3.2-office-parity.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PARITY_ITEMS, scoreParity, type ParityItem } from './office-parity/matrix.ts'

const repoRoot = join(import.meta.dir, '..')

export function evidenceProblems(items: readonly ParityItem[] = PARITY_ITEMS): string[] {
  const problems: string[] = []
  for (const item of items) {
    if (item.evidence.length === 0) problems.push(`${item.id} 没有证据路径`)
    const bodies: string[] = []
    for (const relative of item.evidence) {
      const path = join(repoRoot, relative)
      if (!existsSync(path)) {
        problems.push(`${item.id} 证据不存在：${relative}`)
        continue
      }
      bodies.push(readFileSync(path, 'utf8'))
    }
    if (item.needle && !bodies.some(body => body.includes(item.needle!))) {
      problems.push(`${item.id} 证据里没有「${item.needle}」`)
    }
  }
  return problems
}

const DOMAIN_LABEL: Record<string, string> = {
  ppt: 'PPT',
  word: 'Word',
  excel: 'Excel',
  shared: '共享底座',
}

function main(): void {
  const problems = evidenceProblems()
  const score = scoreParity()
  console.log('Selection 3.2 Office 对齐（dsh 588412b，功能结果，不含故意排除项）')
  for (const domain of score.domains) {
    console.log(`${DOMAIN_LABEL[domain.domain]}  ${domain.percent}%  对齐 ${domain.aligned}  部分 ${domain.partial}  缺失 ${domain.missing}  排除 ${domain.excluded}  计入 ${domain.counted}`)
  }
  console.log(`总体  ${score.overall.percent}%  计入 ${score.overall.counted}  排除 ${score.overall.excluded}`)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  const below = score.domains.filter(domain => domain.percent < 90)
  if (below.length || score.overall.percent < 90) {
    console.error('有领域低于 90%。')
    process.exit(1)
  }
}

if (import.meta.main) main()
