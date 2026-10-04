#!/usr/bin/env bun
/** F5: real model review, persisted restart, dynamic correction and canonical report. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunLog, type ResearchSummary } from '@craft-agent/shared/tasks'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { TaskRunner, type ConductorSessionHost } from '@craft-agent/server-core/tasks'
import { getSwarmAgentsEnabled, setSwarmAgentsEnabled } from '../packages/shared/src/config/storage'

const repo = resolve(import.meta.dir,'..'), workspace = getWorkspaces()[0]!
const connection = getLlmConnections().find(item => item.slug === getDefaultLlmConnection())!
assert(workspace && connection?.defaultModel)
process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1'
setBundledAssetsRoot(join(repo,'apps/electron')); setSessionPlatform(createHeadlessPlatform())
const recovered = process.env.F5_RECOVER_RECORD ? JSON.parse(readFileSync(process.env.F5_RECOVER_RECORD,'utf8')) : undefined
const fixture = join(repo,'scripts/fixtures/selection-3.0/costs.txt'), slug = recovered?.slug ?? `f5-${Date.now()}`
const originalSwarm = getSwarmAgentsEnabled(), calls: unknown[] = [], snapshots: unknown[] = []
const output = [{name:'research',kind:'param',type:'json',required:true}]
let manager: SessionManager, runner: TaskRunner, rootId = '', runId = '', restarted = false, finished = false, beforeRestart: ResearchSummary | undefined
let restartReady!: () => void, rejectBlocked!: (error: Error) => void
const ready = new Promise<void>(resolve => { restartReady = resolve })
const blocked = new Promise<never>((_resolve,reject) => {rejectBlocked=reject});void blocked.catch(()=>{})
function initialize() {
  manager = new SessionManager()
  manager.setEventSink((_channel,_target,...args) => {
    const event = args.find(item => item && typeof item === 'object' && 'type' in item)
    if(!event)return
    if(event.type==='tool_start')calls.push({type:event.type,sessionId:event.sessionId,toolName:event.toolName,toolInput:event.toolInput})
    if(event.type==='tool_result')calls.push({type:event.type,sessionId:event.sessionId,toolName:event.toolName,toolUseId:event.toolUseId,isError:event.isError})
  })
  const host = new Proxy(manager,{get(target,property){
    if(property==='sendMessage')return async(id:string,message:string)=>{
      if(id===rootId && !restarted && runId) {
        const state=loadTaskResults(workspace.rootPath,slug,runId).research
        if(state?.records.some(record=>record.role==='reviewer')) { beforeRestart=state;restartReady();return }
      }
      return target.sendMessage(id,message)
    }
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value
  }}) as ConductorSessionHost
  let last = ''
  runner = new TaskRunner({host,workspaceId:workspace.id,workspaceRoot:workspace.rootPath,onRunChanged(snapshot){
    const brief=`${snapshot.status}:r${snapshot.revision}:${snapshot.nodes.map(node=>`${node.id}=${node.state}`).join(',')}`
    if(brief!==last){last=brief;console.log(brief)}
    if(snapshot.research?.claims[0]?.version===2&&!snapshot.research.claims[0].review)snapshots.push({stage:'new-version-awaiting-independent-review',snapshot})
    if(snapshot.status==='failed'||snapshot.status==='paused'&&!beforeRestart)rejectBlocked(new Error(`F5 blocked: ${brief}: ${snapshot.blockers?.join(', ')}`))
  }})
  manager.setTaskRunnerLookup(()=>runner)
}
try {
  setSwarmAgentsEnabled(true);initialize();await manager!.reinitializeAuth()
  let terminal: ReturnType<TaskRunner['getLatestRun']>
  if(!recovered) {
  const parsed=parseTaskSpec({schema_version:3,id:slug,title:'Selection 3.0 F5',goal:'审查并修正 A 两年成本关键事实，交付可追溯成本与风险有限报告',runner:'orchestrate',cwd:join(repo,'scripts/fixtures/selection-3.0'),
    acceptance_criteria:'必须独立识别并修正注入的 10 万元错误，新结论版本再次独立审查；报告只引用当前有效支持版本，成本已覆盖且风险未覆盖。不要编造风险或税额。',
    research:{line:{id:'main',question:'A 两年成本与风险',premises:['两年期间，金额以人民币元计']},dimensions:[{id:'cost',requirement:'两年总成本关键数值可定位原文'},{id:'risk',requirement:'风险必须有具体原始资料，否则明确未覆盖'}],sources:[{id:'cost-source',path:'costs.txt',ref:'Selection 固定成本资料'}]},
    constraints:['只读固定原文和原生 Skill。不得委派 Swarm、改文件或执行外部操作。不要改问题、维度、关键性或事实分类以通过验收。'],
    decisions:[
      'first-schedule 和 research 完成后的 checkpoint 使用 continue。review 完成后若 cost@1 被指出矛盾且 fix 尚不存在，提交一次 apply_orchestration_decision(action=patch)：新增 id=fix/researchRole=researcher 的 session 依赖 review；新增 id=review2/researchRole=reviewer 的 session 依赖 fix；更新 pending report depends_on=[review2]。两新节点声明 outputs=[{name:research,kind:param,type:json,required:true}]，cache=none；不要改其它字段或角色。',
      'fix 必须独立 Read 冻结原文，修正同一 cost claim 为 version=2，保留 fact/critical/keyNumber 和原有 evidence 关联；不要发明数值。用原 issue id=wrong-cost、claimRef cost@1 更新 disposition=correct、revisedClaimRef cost@2、followupTaskRef=fix 和原因。review2 独立 Read 原文审查 cost@2，分开记录定位、语义支持和限制；不能复用 v1 审查。把这些要求写入新增节点 prompt。',
      '只添加一次 fix/review2。之后 continue 消费结果；报告完成且业务校验通过才 draining。最终 submit_task_verdict 必须核对当前报告与研究记录。风险没有具体资料必须披露未覆盖，不把限制当支持。',
    ],locked_fields:['goal','acceptance_criteria','constraints','decisions'],defaults:{model:connection.defaultModel,llmConnection:connection.slug,permissionMode:'safe'},
    nodes:[
      {id:'research',kind:'session',researchRole:'researcher',cache:'none',prompt:'这是固定 QA 的错误注入节点。Read 原文并引用成本原文的准确行号和摘录，evidence id=cost-e1。故意提交 cost@1 的错误关键事实“方案 A 两年总成本为 100000 元（10 万元）”，type=fact,critical=true,keyNumber=true,dimensionIds=[cost],evidenceIds=[cost-e1]。不要自行修正这个被测错误；独立 reviewer 必须实际检查。不要为缺失风险编造 claim。输出 values.research。',outputs:output},
      {id:'review',kind:'session',researchRole:'reviewer',cache:'none',depends_on:['research'],prompt:'独立 Read 必要冻结原文；不接受作者自评。准确审查 cost@1 的定位、数值支持与来源限制。若发现关键矛盾，写 issue id=wrong-cost、claimRef cost@1、disposition=defer、具体 finding/reason，需要 root planner 新增修订和独立复核任务；尚不存在 fix 时不要编造 followupTaskRef。提交 values.research。',outputs:output},
      {id:'report',kind:'session',researchRole:'reporter',cache:'none',depends_on:['review'],prompt:'用 values.research.report 交付中文报告；claimRefs 只引用当前有效支持结论，限于原始资料支持的内容。limitations/unresolved 明确风险资料缺失、税口径限制。所有重要修正必须独立复核新版本。宿主从相同版本渲染报告。',outputs:output},
    ]});assert(parsed.success,JSON.stringify(parsed));saveTaskSpec(workspace.rootPath,parsed.data)
  const root=await manager!.createSession(workspace.id,{name:'Selection 3.0 F5',taskSlug:slug,hidden:true,workMode:'PRO',swarmEnabled:true,permissionMode:'safe',thinkingLevel:'low',workingDirectory:join(repo,'scripts/fixtures/selection-3.0'),model:connection.defaultModel,llmConnection:connection.slug});rootId=root.id
  runId=runner!.run(slug,{orchestratorSessionId:rootId,orchestrateAllowed:true}).runId
  await Promise.race([ready,blocked])
  assert(beforeRestart?.claims[0]?.review);assert.equal(beforeRestart!.claims[0]!.review!.support,'contradicted')
  snapshots.push({stage:'review-before-restart',snapshot:runner!.getRunState(slug,runId)})
  runner!.pause(slug,runId);await manager!.flushAllSessions();manager!.cleanup();restarted=true
  initialize();await manager!.reinitializeAuth();manager!.reloadSessions();assert(await manager!.getSession(rootId),'Persisted root must be loaded before resume')
  const restored=loadTaskResults(workspace.rootPath,slug,runId).research!;assert.deepEqual(restored.records,beforeRestart!.records)
  snapshots.push({stage:'restored-before-correction',research:restored});runner!.resume(slug,runId)
  terminal=await Promise.race([runner!.waitUntilSettled(slug,runId),blocked])
  } else {
    rootId=recovered.rootSessionId;runId=recovered.runId;restarted=recovered.restarted;snapshots.push(...recovered.snapshots);manager!.reloadSessions();assert(await manager!.getSession(rootId));terminal=runner!.getLatestRun(slug)
  }
  assert(terminal)
  await new Promise<void>(resolve=>{
    if(!(manager as any).sessions.get(rootId)?.isProcessing)return resolve()
    const off=manager!.onSessionComplete(event=>{if(event.sessionId===rootId){off();resolve()}})
  })
  await manager!.flushAllSessions()
  const results=loadTaskResults(workspace.rootPath,slug,runId),log=readRunLog(workspace.rootPath,slug,runId)
  for(const id of new Set([rootId,...results.research!.records.map(record=>record.producedBy.sessionId)])) {
    const session=await manager!.getSession(id)
    for(const message of session?.messages??[])if(message.toolName&&message.toolInput)calls.push({type:'tool_start',sessionId:id,toolName:message.toolName,toolInput:message.toolInput,toolStatus:message.toolStatus,isError:message.isError,toolResult:message.toolName==='Read'?message.toolResult:undefined,persisted:true})
  }
  const handover=(await manager!.handoverSession(rootId,{type:'create',handoverId:`f5-handover-${runId}`,targetMode:'NORM'})).records[0]!
  assert.equal(handover.status,'applied')
  const target=await manager!.getSession(handover.targetSessionId!);assert.equal(target!.workMode,'NORM');assert.equal(target!.parentSessionId,undefined)
  const handoverResults=JSON.parse(handover.snapshot!.originals.find(original=>original.role==='task-result')!.text)
  assert.deepEqual(handoverResults.research.report.claimRefs,[{id:'cost',version:2}]);assert(handover.snapshot!.openQuestions.some(question=>question.includes('/risk: uncovered')))
  const record={case:'F5-a/b/d',slug,runId,rootSessionId:rootId,model:connection.defaultModel,connection:connection.slug,permissionMode:'safe',fixtureSha256:createHash('sha256').update(readFileSync(fixture)).digest('hex'),handover,verificationNote:recovered?`Offline verification of the completed actual model run after driver failure: ${recovered.error}`:undefined,restart:'SessionManager and TaskRunner closed after independent review, then rebuilt from persisted sessions and run records before correction',snapshots,calls,terminal,results,log}
  writeFileSync(process.env.F5_RECORD_PATH??'/tmp/selection-version-3.0/455-f5-real.json',JSON.stringify(record,null,2))
  assert.equal(terminal.status,'completed');assert.equal(results.research!.claims[0]!.version,2);assert.equal(results.research!.claims[0]!.review!.support,'supported')
  assert.equal(results.research!.coverage.covered,1);assert.equal(results.research!.coverage.uncovered,1);assert.equal(results.research!.issues[0]!.state,'resolved');assert.deepEqual(results.research!.blockers,[])
  assert.deepEqual(results.research!.report!.claimRefs,[{id:'cost',version:2}]);assert(!results.nodes.find(node=>node.id==='report')!.output!.includes('100000 元'))
  assert(snapshots.some((entry:any)=>entry.stage==='new-version-awaiting-independent-review'))
  const reviewer=results.research!.claims[0]!.reviewer!;assert.notEqual(reviewer.sessionId,results.research!.claims[0]!.producedBy.sessionId)
  assert(calls.some((entry:any)=>entry.type==='tool_start'&&entry.sessionId===reviewer.sessionId&&entry.toolStatus==='completed'&&!entry.isError&&JSON.stringify(entry.toolInput).includes('source-0.txt')&&entry.toolResult?.includes('1000000')))
  assert(calls.some((entry:any)=>entry.type==='tool_start'&&entry.toolStatus==='completed'&&!entry.isError&&JSON.stringify(entry.toolInput).includes('resources/skills/deep-research/SKILL.md')))
  finished=true;console.log(JSON.stringify({case:'F5',slug,runId,rootSessionId:rootId,status:terminal.status,coverage:results.research!.coverage,claim:'cost@2',restarted:true}))
} catch(error) {
  writeFileSync(process.env.F5_RECORD_PATH??'/tmp/selection-version-3.0/455-f5-real.json',JSON.stringify({case:'F5',outcome:'failed',error:String(error),slug,runId,rootSessionId:rootId,restarted,snapshots,calls,snapshot:runner!?.getRunState(slug,runId),log:runId?readRunLog(workspace.rootPath,slug,runId):[]},null,2));throw error
} finally {
  if(!finished&&runner!&&runId)await runner.stop(slug,runId).catch(()=>{})
  if(rootId&&manager!)await manager.cancelProcessing(rootId,true).catch(()=>{})
  if(manager!){await manager.flushAllSessions();manager.cleanup()}setSwarmAgentsEnabled(originalSwarm)
}
