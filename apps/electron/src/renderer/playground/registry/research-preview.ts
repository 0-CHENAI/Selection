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

export function researchLinesPreview() {
  const base=researchPreview(), source=base.summary.sources[0]!
  const scope={region:'地区 X',year:'2025',currency:'CNY',tax:'含税',basis:'元/千瓦时',requirements:'同一用户类别与阶梯'}
  const lines=[{id:'high',question:'高利用率下的成本建议',premises:['每年运行 9000 小时']},{id:'low',question:'低利用率下的成本建议',premises:['每年运行 1000 小时'],parentLineIds:['high']}]
  const config=ResearchConfigSchema.parse({...base.config,line:lines[0],lines:[lines[1]],questions:[{id:'Q-price',question:'核对同地区、同年份电价',sharedTaskRef:'price',scope,commonBackground:['复用电价事实，保留不同利用率'],compatibilityReason:'双方地域、年份、币种、税口径、计算口径与输入要求一致；利用率分别保留。',parents:lines.map(line=>({lineId:line.id,premises:line.premises,inputScope:scope,claimRefs:[{id:`recommend-${line.id}`,version:1}],evidenceRefs:['cost-e1'],issueRefs:[`market-${line.id}`],path:['collect','analyze']}))}]})
  const record=(role:ResearchRecord['role'],nodeId:string,payload:unknown):ResearchRecord=>({role,payload:ResearchPayloadSchema.parse(payload),producedBy:{runId:'preview-active',nodeId,attempt:1,revision:1,artifactVersion:`preview-artifact-${nodeId}-version`,sessionId:`preview-session-${nodeId}`}})
  const records=[base.summary.records[0]!, ...lines.flatMap((line,index)=>[
    record('researcher',index?'correct-cost':'collect',{claims:[{id:`recommend-${line.id}`,version:1,lineIds:[line.id],type:'inference',text:index?'低利用率下建议方案 B，避免高固定成本。':'高利用率下建议方案 A，固定成本可被更长运行时间摊薄。',dimensionIds:['cost'],evidenceIds:['cost-e1'],critical:true,recommendation:true,conditions:line.premises}]}),
    record('reviewer',index?'review-cost':'analyze',{reviews:[{claimRef:{id:`recommend-${line.id}`,version:1},citationExists:true,support:'supported',finding:'独立核对原文和该线的利用率假设；建议成立条件不同，分歧无需消失。'}],issues:[{id:`market-${line.id}`,claimRef:{id:`recommend-${line.id}`,version:1},finding:'缺少市场需求资料',disposition:'defer',reason:'交付中保留未决问题'}]})]),
    record('reporter','report',{report:{claimRefs:lines.map(line=>({id:`recommend-${line.id}`,version:1})),limitations:['风险资料缺失，未覆盖。'],unresolved:['高低利用率两条线的市场需求异议均未决。'],alternatives:['运行时长不确定时两项建议均为条件式建议。'],changeEvidence:['实测运行时长和更新电价可能改变建议。']}})]
  // This fixed UI fixture deliberately removes the unrelated injected F5 claim.
  records[0]!.payload.claims=[]
  return {config,summary:summarizeResearch(config,[source],records)}
}

export function researchJudgmentPreview() {
  const base = researchPreview()
  const records = structuredClone(base.summary.records)
  for (const record of records) for (const claim of record.payload.claims) claim.falsificationConditions = ['更正后的原文金额或统计期间与当前结论矛盾。']
  records[3]!.payload.premiseReviews = [{ id: 'premise-cost-v2', lineId: 'main', premises: base.config.line.premises,
    claimRefs: [{ id: 'cost', version: 2 }], classification: 'retained', finding: '两年口径成立，测试资料不能推出真实市场成本。', changeEvidence: ['更新原文或不同统计期间可能改变结论。'] }]
  const config = ResearchConfigSchema.parse({ ...base.config, judgmentVersion: 1 })
  return { config, summary: summarizeResearch(config, base.summary.sources, records) }
}
