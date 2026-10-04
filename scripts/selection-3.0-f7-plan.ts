#!/usr/bin/env bun
/** Prepare a reviewed YAML fixture for the actual desktop; never create or execute its task. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getSessionPath } from '@craft-agent/shared/sessions';
import { parseTaskSpec, serializeTaskYaml } from '@craft-agent/shared/tasks';
const record = JSON.parse(readFileSync(process.env.DESKTOP_RECORD ?? '/tmp/selection-version-3.0/457-desktop-fixture.json', 'utf8'));
const handoverId = process.env.F7_HANDOVER_ID;
if (!handoverId)
  throw new Error('F7_HANDOVER_ID required');
const handover = JSON.parse(readFileSync(join(record.workspace.rootPath, 'handovers', createHash('sha256').update(handoverId).digest('hex'), 'record.json'), 'utf8'));
const directory = join(getSessionPath(record.workspace.rootPath, handover.targetSessionId), 'data', 'handover', handover.handoverId);
const source = join(directory, handover.snapshot.files.find((file: any) => file.originalPath === record.fixture).snapshotPath), outputs = [{ name: 'research', kind: 'param', type: 'json', required: true }];
const parsed = parseTaskSpec({ schema_version: 3, id: 'f7-desktop-research', title: 'F7 两年成本与风险研究', goal: '比较 A/B 两年成本与风险，只分析不部署，交付当前独立支持的有限结论', runner: 'orchestrate', cwd: directory,
  acceptance_criteria: '必须独立发现 10 万元错误并修订 cost@2=100万元/1000000元，新版本重新独立 Read 和审查；核对 B 成本口径，风险缺资料保持 uncovered。引用当前精确版本，不作无依据总体推荐。',
  research: { line: { id: 'main', question: 'A/B 两年成本与风险', premises: ['两年期间，金额以人民币元计', '只分析，不部署；税口径未给出时不推断税额'] }, dimensions: [{ id: 'cost', requirement: 'A 两年总成本可定位原文，B 可比范围明确' }, { id: 'risk', requirement: '风险必须有具体原始资料，否则明确未覆盖' }], sources: [{ id: 'cost-source', path: source, ref: 'F7 NORM 实际读取后交接的不可变成本资料' }] },
  constraints: ['只读冻结资料、交接包与原生 Skill；不得委派额外 Swarm、改文件、部署或调用外部服务', '只分析两年期间；保留风险和 B 口径缺口，不编造税额或市场数据'],
  decisions: [
    '每次 submit_orchestration_decision 成功后结束本回合，宿主发送下一 checkpoint，不轮询、不重用旧 checkpointId。首次及 cost 错误注入完成后 continue；risk 任务输出缺口证据即可，不编造具体风险 claim。',
    '独立 review 完成后 cost@1 存在矛盾，且 fix 尚未登记，先 action=pause 让用户验收并重启。只暂停一次；当用户已明确发送 CONTINUE_AFTER_RESTART 时不要再次暂停，继续下条原子 patch。',
    'CONTINUE_AFTER_RESTART 后，在同一 action=patch 增加四个 session 节点：fix/researchRole=researcher 依赖 review；review2/researchRole=reviewer 依赖 fix；basis/researchRole=researcher 依赖 review；basis-review/researchRole=reviewer 依赖 basis。每个 outputs=[{name:research,kind:param,type:json,required:true}],cache=none。更新 pending report depends_on=[review2,basis-review,risk]。保留 risk 人工锁定节点、原 constraints/decisions/goal/acceptance。',
    'fix 独立 Read 原文，提交同一 cost claim version=2，保持 fact/critical/keyNumber 与 cost 维度，修正为1000000元/100万元，沿用已有 e-cost。用 wrong-cost 原 issue id/claimRef cost@1 更新 disposition=correct,revisedClaimRef cost@2,followupTaskRef=fix。review2 独立 Read 原文只审查 cost@2，精确版本，不能复用旧审查。',
    'basis 独立 Read 原文第4行，提交 b-basis@1 fact：B 成本口径待核对，不能与 A 直接比较；dimensionIds=[cost],critical=true，evidence id=e-basis/精确原文定位。basis-review 独立 Read 原文，只审查 b-basis@1，明确缺口和限制。将这些完整要求写到新增节点 prompt。',
    '完成所有当前关键 claim 独立审查后让 report 执行；报告引用 cost@2、b-basis@1，填写 alternatives/changeEvidence/limitations/unresolved，区分成本有限结论与风险未覆盖。无执行节点时 draining，最终实际 submit_task_verdict。',
  ], locked_fields: ['goal', 'acceptance_criteria', 'constraints', 'decisions'], defaults: { model: record.model, llmConnection: record.connection, permissionMode: 'safe' }, nodes: [
    { id: 'cost', kind: 'session', researchRole: 'researcher', cache: 'none', outputs, prompt: '这是合成 QA 错误注入节点。Read 冻结原文，准确 e-cost 证据第3行摘录；故意提交 cost@1 fact 错误关键值“A 两年成本为100000元（10万元）”，critical/keyNumber=true,dimensionIds=[cost],evidenceIds=[e-cost]。独立 reviewer 后续应发现矛盾。本节点不要修正被测错误，不编造别的 claim。' },
    { id: 'risk', kind: 'session', researchRole: 'researcher', locked: true, cache: 'none', outputs, prompt: '独立 Read 冻结原文第5行，提交 e-risk 证据和准确摘录。没有具体风险资料，所以不要提交一个已覆盖风险的 claim，不作总体推荐。通过 text 说明风险未覆盖和需要具体可靠性来源。' },
    { id: 'review', kind: 'session', researchRole: 'reviewer', cache: 'none', outputs, depends_on: ['cost'], prompt: '独立 Read 冻结原文，对 cost@1 做精确版本审查。实际检查100000元是否被原文支持。发现矛盾时记录 wrong-cost issue,claimRef cost@1,disposition=defer，明确需要修正同一 claim 的 v2 并再次独立复核。fix 尚未创建，不填写未知 followupTaskRef。' },
    { id: 'report', kind: 'session', researchRole: 'reporter', cache: 'none', outputs, depends_on: ['review', 'risk'], prompt: '提交 values.research.report；仅引用当前被独立支持的 cost@2 与 b-basis@1，明确两年、人民币、税口径未给出、风险资料缺失，以及 B 口径核对前不能作总体推荐。保留 alternatives/changeEvidence/limitations/unresolved。不得继续引用被矛盾审查否定的 cost@1。' },
  ] });
if (!parsed.success)
  throw new Error(JSON.stringify(parsed.error));
const output = process.env.F7_PLAN_PATH ?? '/tmp/selection-version-3.0/457-f7-plan.yaml';
writeFileSync(output, serializeTaskYaml(parsed.data));
console.log(JSON.stringify({ output, rootSessionId: handover.targetSessionId, source, sourceHash: createHash('sha256').update(readFileSync(source)).digest('hex') }));
