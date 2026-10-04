import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, type ResearchRecord } from '../../../../../../packages/shared/src/tasks/research'

/** Fixed transport fixture; the separate F5 driver records actual model execution. */
export function researchPreview() {
  const config = ResearchConfigSchema.parse({ line: { id: 'main', question: '方案 A 两年成本与风险', premises: ['两年期间，人民币元'] }, dimensions: [{ id: 'cost', requirement: '关键成本可定位原文' }, { id: 'risk', requirement: '风险需要具体原始资料' }], sources: [{ id: 'cost-source', path: 'costs.txt' }] })
  const source = { id: 'cost-source', ref: '固定成本原文', version: 'preview-source-sha256', hash: 'preview-source-sha256', acquiredAt: '2026-10-04T03:00:00Z', text: '固定资料\n方案 A 两年总成本：100 万元，即 1000000 元。', snapshotPath: '/preview/frozen-costs.txt' }
  const record = (role: ResearchRecord['role'], nodeId: string, payload: unknown, revision = 0): ResearchRecord => ({ role, payload: ResearchPayloadSchema.parse(payload), producedBy: { runId: 'preview-active', nodeId, attempt: 1, revision, artifactVersion: `preview-artifact-${nodeId}-version`, sessionId: `preview-session-${nodeId}` } })
  const claim = { id: 'cost', version: 1, type: 'fact', text: '方案 A 两年成本为 10 万元。', dimensionIds: ['cost'], evidenceIds: ['cost-e1'], critical: true, keyNumber: true, conditions: ['两年期间；税口径未核验'] }
  const issue = { id: 'wrong-cost', claimRef: { id: 'cost', version: 1 }, finding: '10 万元与原文 100 万元矛盾。', disposition: 'defer', reason: '补充修订后独立复核。' }
  const records = [
    record('researcher', 'collect', { evidence: [{ id: 'cost-e1', sourceId: source.id, sourceVersion: source.version, locator: { startLine: 2, endLine: 2 }, excerpt: '方案 A 两年总成本：100 万元，即 1000000 元。' }], claims: [claim] }),
    record('reviewer', 'analyze', { reviews: [{ claimRef: issue.claimRef, citationExists: true, support: 'contradicted', finding: issue.finding }], issues: [issue] }),
    record('researcher', 'correct-cost', { claims: [{ ...claim, version: 2, text: '方案 A 两年总成本为 100 万元（1000000 元）。' }], issues: [{ ...issue, disposition: 'correct', revisedClaimRef: { id: 'cost', version: 2 }, followupTaskRef: 'correct-cost' }] }, 1),
    record('reviewer', 'review-cost', { reviews: [{ claimRef: { id: 'cost', version: 2 }, citationExists: true, support: 'supported', finding: '独立原文读取支持新版本的成本数值。', limitations: ['税费与风险资料不足。'] }] }, 1),
    record('reporter', 'report', { report: { claimRefs: [{ id: 'cost', version: 2 }], limitations: ['风险尚未覆盖，税口径未核验。'], unresolved: ['需要具体风险资料。'] } }, 1),
  ]
  return { config, summary: summarizeResearch(config, [source], records) }
}
