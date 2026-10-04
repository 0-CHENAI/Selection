#!/usr/bin/env bun
/** Actual F6 models: two premises, one atomic shared question, restart and conditional Handover. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {getWorkspaces,getLlmConnections,getDefaultLlmConnection} from '@craft-agent/shared/config'
import {parseTaskSpec,saveTaskSpec,loadTaskResults,readRunLog,readSpecRevision,type ResearchSummary} from '@craft-agent/shared/tasks'
import {setBundledAssetsRoot} from '@craft-agent/shared/utils'
import {SessionManager,setSessionPlatform} from '@craft-agent/server-core/sessions'
import {createHeadlessPlatform} from '@craft-agent/server-core/runtime'
import {TaskRunner,type ConductorSessionHost} from '@craft-agent/server-core/tasks'
import {getSwarmAgentsEnabled,setSwarmAgentsEnabled} from '../packages/shared/src/config/storage'

const repo=resolve(import.meta.dir,'..'),workspace=getWorkspaces()[0]!,connection=getLlmConnections().find(item=>item.slug===getDefaultLlmConnection())!
assert(workspace&&connection?.defaultModel)
process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE='1';setBundledAssetsRoot(join(repo,'apps/electron'));setSessionPlatform(createHeadlessPlatform())
const recovered=process.env.F6_RECOVER_RECORD?JSON.parse(readFileSync(process.env.F6_RECOVER_RECORD,'utf8')):undefined
const repair=process.env.F6_REPAIR_RECORD?JSON.parse(readFileSync(process.env.F6_REPAIR_RECORD,'utf8')):undefined
const prior=recovered??repair
const slug=prior?.slug??`f6-${Date.now()}`,directory=join(repo,'scripts/fixtures/selection-3.0'),originalSwarm=getSwarmAgentsEnabled(),usageEvents:unknown[]=[...(prior?.usageEvents??[])],snapshots:unknown[]=[...(prior?.snapshots??[])]
const outputs=[{name:'research',kind:'param',type:'json',required:true}], scope={region:'X',year:'2025',currency:'CNY',tax:'included',basis:'yuan/kWh',requirements:'same tariff class'}
let manager:SessionManager,runner:TaskRunner,rootId='',runId='',restarted=false,finished=false,beforeRestart:ResearchSummary|undefined,predecessor:ReturnType<typeof loadTaskResults>|undefined,predecessorLog:ReturnType<typeof readRunLog>=[]
let restartReady!:()=>void,rejectBlocked!:(error:Error)=>void
const ready=new Promise<void>(resolve=>{restartReady=resolve}),blocked=new Promise<never>((_resolve,reject)=>{rejectBlocked=reject});void blocked.catch(()=>{})
function initialize(){
 manager=new SessionManager();manager.setEventSink((_channel,_target,...args)=>{const event=args.find(item=>item&&typeof item==='object'&&'type'in item);if(event?.type==='usage_update')usageEvents.push({sessionId:event.sessionId,at:Date.now(),tokenUsage:structuredClone(event.tokenUsage)})})
 const host=new Proxy(manager,{get(target,property){
  if(property==='sendMessage')return async(id:string,message:string)=>{if(id===rootId&&!restarted&&runId){const research=loadTaskResults(workspace.rootPath,slug,runId).research;if(research?.records.some(record=>record.producedBy.nodeId==='price-review')){beforeRestart=research;restartReady();return}}return target.sendMessage(id,message)}
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value
 }})as ConductorSessionHost
 let last='';runner=new TaskRunner({host,workspaceId:workspace.id,workspaceRoot:workspace.rootPath,onRunChanged(snapshot){const brief=`${snapshot.status}:r${snapshot.revision}:${snapshot.nodes.map(node=>`${node.id}=${node.state}`).join(',')}`;if(last!==brief){last=brief;console.log(brief)}if(snapshot.status==='failed'||snapshot.status==='paused'&&!beforeRestart)rejectBlocked(new Error(`F6 blocked: ${brief}: ${snapshot.blockers?.join(', ')}`))}});manager.setTaskRunnerLookup(()=>runner)
}
try{
 setSwarmAgentsEnabled(true);initialize();await manager!.reinitializeAuth()
 let terminal:ReturnType<TaskRunner['getLatestRun']>
 if(repair){
  rootId=repair.rootSessionId;restarted=true;manager!.reloadSessions();assert(await manager!.getSession(rootId))
  const old=runner!.getLatestRun(slug)!;assert(['completed','failed','stopped'].includes(old.status))
  predecessor=loadTaskResults(workspace.rootPath,slug,old.runId);predecessorLog=readRunLog(workspace.rootPath,slug,old.runId)
  const frozen=readSpecRevision(workspace.rootPath,slug,old.runId,old.revision)!;assert(frozen.research?.questions?.length===1)
  const next=parseTaskSpec({...frozen,execution:{...frozen.execution,coordinator_gate:{mode:'off'}},nodes:[
   {id:'correct-fixed-high',kind:'session',researchRole:'researcher',researchLineIds:['high'],cache:'none',outputs,prompt:'独立 Read 冻结成本原文。修正已有 fixed-high claim 为 version=2，保留 fact/critical/keyNumber、cost 维度与 high 归属；写清 Region X、2025、CNY、含税、90000元固定成本、1kWh每小时、B每小时20元全包、9000小时前提。引用已有 e-high-scope（含范围头与准确原文），不要重复提交 evidence 或旧 claims。不修订不受影响的 low、price、fixed-high-scope 或 recommendation。另用原 high-scope-lineage issue id/原 recommend-high@1 claimRef 更新 disposition=correct，revisedClaimRef=当前已独立支持的 recommend-high@2，具体说明原修订与独立审查记录已补齐该审计缺口；不要修改市场异议或把其标记为解决。'},
   {id:'review-fixed-high',kind:'session',researchRole:'reviewer',researchLineIds:['high'],cache:'none',outputs,depends_on:['correct-fixed-high'],prompt:'独立 Read 原文，审查最新 fixed-high@2 的完整范围、原文定位与数字，记录精确版本的支持和缺失市场/可靠性限制。不要复用旧 v1 审查；其它受支持结论沿用原实际独立审查。'},
   {id:'current-report',kind:'session',researchRole:'reporter',cache:'none',outputs,depends_on:['review-fixed-high'],prompt:'交付当前条件式报告。引用所有当前已独立支持的关键 claim（包括 fixed-high@2、fixed-low@1、price@1、fixed-high-scope@1、recommend-high@2、recommend-low@1）；保留高9000小时选择A（99000 vs180000）与低1000小时选择B（91000 vs20000）的各自条件，不合并前提。披露风险两个维度尚未覆盖、市场异议暂存、税年范围限制、原版本修复过程和仍有限的回应。必须填写 alternatives/changeEvidence/limitations/unresolved。'},
  ]});assert(next.success,JSON.stringify(next));saveTaskSpec(workspace.rootPath,next.data)
  snapshots.push({stage:'affected-only-canonical-successor',previousRunId:old.runId,previousResearch:predecessor.research})
  runId=runner!.run(slug,{orchestratorSessionId:rootId,orchestrateAllowed:true,resumedFrom:old.runId}).runId
  terminal=await Promise.race([runner!.waitUntilSettled(slug,runId),blocked])
  assert.deepEqual(loadTaskResults(workspace.rootPath,slug,old.runId).research,predecessor.research)
 }else if(!recovered){
 const lines=[{id:'high',question:'高利用率是否选 A',premises:['Region X; year 2025; CNY; tax included','9000 operating hours per year']},{id:'low',question:'低利用率是否选 A',premises:['Region X; year 2025; CNY; tax included','1000 operating hours per year'],parentLineIds:['high']}]
 const parsed=parseTaskSpec({schema_version:3,id:slug,title:'Selection 3.0 F6',goal:'按高低利用率分别审查成本，共享兼容电价事实，交付保留分歧的条件式报告',runner:'orchestrate',cwd:directory,
 acceptance_criteria:'高利用率 A 年成本99000元低于 B 180000元，建议 A；低利用率 A 91000元高于 B 20000元，建议 B。共享 Q-price 恰有一个 price 逻辑任务，两方前提、claim/evidence/issue/path 都保留；所有关键推荐独立审查当前版本。风险未覆盖和两个市场异议明确保留。',
 research:{line:lines[0],lines:[lines[1]],dimensions:[{id:'cost',requirement:'固定成本、利用率与电价口径一致，推荐有可定位证据'},{id:'risk',requirement:'需要具体可靠性资料，否则明确未覆盖'}],sources:[{id:'cost-source',path:'utilization.txt',ref:'F6 固定利用率与成本'},{id:'price-source',path:'price.txt',ref:'F6 固定电价'}]},
 constraints:['只读冻结资料和原生 Skill。不得改文件、执行外部操作或委派 Swarm。成本与风险覆盖分开。不得用平均或投票抹平分歧。'],
 decisions:[
  '每次 submit_orchestration_decision 成功后立即结束本回合，不轮询结果、不重复使用旧 checkpointId；宿主下次 checkpoint 自动触发下一回合。',
  '开始及 initial-high/initial-low 完成的 checkpoint 使用 continue，让 reviewer-high/reviewer-low 审查。两份初步审查完成且 price 尚未登记时，使用一次 action=patch 新增 price、price-review、final-high、final-low、check-high、check-low 六个 session 节点，outputs 每个声明 [{name:research,kind:param,type:json,required:true}]、cache=none、按角色和依赖执行。price 角色 researcher 依赖 reviewer-high/reviewer-low；price-review 角色 reviewer 依赖 price；final-high/final-low 角色 researcher 依赖 price-review，分别 researchLineIds=[high]/[low]；check-high/check-low 角色 reviewer 分别依赖 final-high/final-low。更新 report depends_on=[check-high,check-low]，保留其它原字段。',
  `上述同一 patch 还提交 researchExpansion.questions=[{id:Q-price,question:核对同地区同年份电价,sharedTaskRef:price,scope:${JSON.stringify(scope)},commonBackground:[复用同一电价事实而保留各自利用率],compatibilityReason:双方六项范围与输入经明确核对兼容,parents:[双方父输入]}]。每方 parents 保存 lineId、原 premises、inputScope=${JSON.stringify(scope)}、claimRefs 对应 fixed-high@1/fixed-low@1、evidenceRefs=[e-high]/[e-low]、issueRefs=[need-price-high]/[need-price-low]、path=[initial-high,reviewer-high]/[initial-low,reviewer-low]。不要重复登记或另建同一问题的任务。`,
  '给 price 的 prompt 明确独立 Read price-source 冻结原文，提交共享 fact price@1、lineIds=[high,low]、dimensionIds=[cost]、critical/keyNumber=true、evidence id=e-price、准确定位摘录。price-review 独立 Read 原文只审查 price@1。',
  'final-high/low 独立 Read 必要原文，保持自己的利用率前提，提交 recommendation id=recommend-high/recommend-low、version=1、type=inference、critical/recommendation/keyNumber=true、dimensionIds=[cost]、lineIds=[本线]、inputClaimRefs=[price@1]、evidenceIds=[e-high或e-low,e-price]。高利用率计算 A=90000+9000*1=99000、B=9000*20=180000，推荐 A；低利用率 A=90000+1000*1=91000、B=1000*20=20000，推荐 B。不要提交别的旧 evidence/claim/review。记录市场异议 market-high/market-low，claimRef 对应本线 recommend@1，disposition=defer，说明需要具体需求资料。将原 need-price issue 更新 disposition=respond，原 claimRef 固定不变，reason引用 canonical Q-price/price@1 已查明输入；不把这个处置标成已解决事实修正。',
  'check-high/check-low 各自独立 Read 原文核对当前 recommend claim 的算式、成立条件、引用定位和来源限制；不要求两方建议相同。模型不得把自己的完成当作业务审查。所有节点完成后 continue/draining，然后实际 submit_task_verdict。',
 ],locked_fields:['goal','acceptance_criteria','constraints','decisions'],defaults:{model:connection.defaultModel,llmConnection:connection.slug,permissionMode:'safe'},nodes:[
 ...['high','low'].map((line,index)=>({id:`initial-${line}`,kind:'session',researchRole:'researcher',researchLineIds:[line],cache:'none',outputs,prompt:`Read cost-source 冻结原文。只提交本线 fixed-${line}@1 fact：A 年固定成本90000元，B每小时总成本20元，${index?'1000':'9000'}小时利用率。dimensionIds=[cost]，critical/keyNumber=true，lineIds=[${line}]。准确 e-${line} 引用原文第3至5行包含固定成本、B成本和利用率。不读取电价、不提前出最终推荐；电价由兼容核对后的共享研究完成。`})),
 ...['high','low'].map(line=>({id:`reviewer-${line}`,kind:'session',researchRole:'reviewer',researchLineIds:[line],cache:'none',outputs,depends_on:[`initial-${line}`],prompt:`独立 Read cost-source 原文审查 fixed-${line}@1；准确支持固定成本、B成本和本线利用率。写 issue id=need-price-${line},claimRef fixed-${line}@1,disposition=defer,reason=下一步需要同地区2025含税CNY电价才能计算推荐，canonical任务尚未登记所以不要填写未知followupTaskRef。保留市场和可靠性资料限制。` })),
 {id:'report',kind:'session',researchRole:'reporter',cache:'none',outputs,depends_on:['reviewer-high','reviewer-low'],prompt:'交付 values.research.report：引用所有当前支持的关键事实、共享电价和两份不同推荐。中文解释各自利用率条件、来源、替代解释、未决市场异议与风险未覆盖、什么新增证据可能改变建议。必须有 alternatives/changeEvidence、limitations/unresolved。保留双方不同建议，宿主渲染同一版本。'},
 ]});assert(parsed.success,JSON.stringify(parsed));saveTaskSpec(workspace.rootPath,parsed.data)
 const root=await manager!.createSession(workspace.id,{name:'Selection 3.0 F6',taskSlug:slug,hidden:true,workMode:'PRO',swarmEnabled:true,permissionMode:'safe',thinkingLevel:'low',workingDirectory:directory,model:connection.defaultModel,llmConnection:connection.slug});rootId=root.id
 runId=runner!.run(slug,{orchestratorSessionId:rootId,orchestrateAllowed:true}).runId
 await Promise.race([ready,blocked]);assert.equal(beforeRestart!.questions.length,1);assert.equal(beforeRestart!.claims.find(claim=>claim.id==='price')!.review!.support,'supported')
 snapshots.push({stage:'shared-price-reviewed-before-restart',snapshot:runner!.getRunState(slug,runId)})
 runner!.pause(slug,runId);await manager!.flushAllSessions();manager!.cleanup();restarted=true
 initialize();await manager!.reinitializeAuth();manager!.reloadSessions();assert(await manager!.getSession(rootId));assert.deepEqual(loadTaskResults(workspace.rootPath,slug,runId).research!.records,beforeRestart!.records)
 snapshots.push({stage:'restart-restored-shared-question',research:loadTaskResults(workspace.rootPath,slug,runId).research});runner!.resume(slug,runId)
 terminal=await Promise.race([runner!.waitUntilSettled(slug,runId),blocked])
 }else{rootId=recovered.rootSessionId;runId=recovered.runId;restarted=recovered.restarted;manager!.reloadSessions();assert(await manager!.getSession(rootId));terminal=runner!.getLatestRun(slug);assert.equal(terminal?.runId,runId)
  if(terminal?.resumedFrom){predecessor=loadTaskResults(workspace.rootPath,slug,terminal.resumedFrom);predecessorLog=readRunLog(workspace.rootPath,slug,terminal.resumedFrom)}
 }
 assert.equal(terminal?.status,'completed')
 await new Promise<void>(resolve=>{if(!(manager as any).sessions.get(rootId)?.isProcessing)return resolve();const off=manager!.onSessionComplete(event=>{if(event.sessionId===rootId){off();resolve()}})})
 await manager!.flushAllSessions();const results=loadTaskResults(workspace.rootPath,slug,runId),log=readRunLog(workspace.rootPath,slug,runId),sessions=[]
 for(const id of new Set([rootId,...results.research!.records.map(record=>record.producedBy.sessionId),...[...predecessorLog,...log].flatMap(event=>event.kind==='node-spawned'?[event.sessionId]:[])])){const session=await manager!.getSession(id);sessions.push({id,tokenUsage:session?.tokenUsage,reads:session?.messages.filter(message=>message.toolName==='Read'&&message.toolStatus==='completed'&&!message.isError).map(message=>({input:message.toolInput,resultHash:createHash('sha256').update(message.toolResult??'').digest('hex')})),tools:session?.messages.filter(message=>message.toolName).map(message=>({name:message.toolName,input:message.toolInput,status:message.toolStatus,isError:message.isError}))})}
 const handover=(await manager!.handoverSession(rootId,{type:'create',handoverId:`f6-${recovered?'current-':''}handover-${runId}`,targetMode:'NORM'})).records[0]!,target=await manager!.getSession(handover.targetSessionId!);assert.equal(handover.status,'applied');assert.equal(target!.workMode,'NORM');assert.equal(target!.parentSessionId,undefined)
 const delivered=JSON.parse(handover.snapshot!.originals.find(original=>original.role==='task-result'&&original.id===`${runId}:revision-${terminal!.revision}`)!.text)
 assert.deepEqual(delivered.research.report.claimRefs,results.research!.report!.claimRefs);assert.equal(delivered.research.questions[0].parents.length,2)
 if(predecessor){assert(handover.snapshot!.originals.some(original=>original.role==='task-history'&&original.id.startsWith(`${predecessor!.runId}:`)));assert(!handover.snapshot!.openQuestions.some(question=>question.startsWith('Research high/cost: limited')))}
 assert.equal(results.research!.questions.length,1);assert.equal([...predecessorLog,...log].filter(event=>event.kind==='node-spawned'&&event.nodeId==='price').length,1)
 for(const line of ['high','low']){const claim=results.research!.claims.find(claim=>claim.id===`recommend-${line}`)!;assert.equal(claim.review!.support,'supported');assert.notEqual(claim.producedBy.sessionId,claim.reviewer!.sessionId);assert.deepEqual(claim.lineIds,[line]);assert(claim.inputClaimRefs?.some(ref=>ref.id==='price'&&ref.version===1))}
 assert(results.research!.claims.find(claim=>claim.id==='recommend-high')!.text.replace(/[,，]/g,'').includes('99000'));assert(results.research!.claims.find(claim=>claim.id==='recommend-low')!.text.replace(/[,，]/g,'').includes('91000'));assert.equal(results.research!.coverage.covered,2);assert.equal(results.research!.coverage.uncovered,2);assert.deepEqual(results.research!.blockers,[])
 for(const id of ['market-high','market-low'])assert.equal(results.research!.issues.find(issue=>issue.id===id)!.state,'limited')
 if(predecessor){assert.deepEqual(results.research!.claims.find(claim=>claim.id==='recommend-low')!.reviewer,predecessor.research!.claims.find(claim=>claim.id==='recommend-low')!.reviewer);assert.equal(log.filter(event=>event.kind==='node-spawned'&&['price','final-low','check-low'].includes(event.nodeId)).length,0)}
 const record={case:'F6-a/b/d',slug,runId,rootSessionId:rootId,model:connection.defaultModel,connection:connection.slug,permissionMode:'safe',verificationNote:recovered?`Offline verification of completed actual model run after driver assertion: ${recovered.error}`:repair?`Explicit affected-only successor after model retained an unsupported original fact: ${repair.error}`:undefined,predecessor,predecessorLog,fixtures:['utilization.txt','price.txt'].map(path=>({path,hash:createHash('sha256').update(readFileSync(join(directory,path))).digest('hex')})),restarted,snapshots,usageEvents,sessions,results,log,handover}
 writeFileSync(process.env.F6_RECORD_PATH??'/tmp/selection-version-3.0/456-f6-real.json',JSON.stringify(record,null,2));finished=true;console.log(JSON.stringify({case:'F6',slug,runId,status:terminal!.status,restarted,coverage:results.research!.coverage,handover:target!.id}))
}catch(error){writeFileSync(process.env.F6_RECORD_PATH??'/tmp/selection-version-3.0/456-f6-real.json',JSON.stringify({case:'F6',outcome:'failed',error:String(error),slug,runId,rootSessionId:rootId,restarted,snapshots,usageEvents,snapshot:runner!?.getRunState(slug,runId),log:runId?readRunLog(workspace.rootPath,slug,runId):[]},null,2));throw error}
finally{if(!finished&&runner!&&runId)await runner.stop(slug,runId).catch(()=>{});if(rootId&&manager!)await manager.cancelProcessing(rootId,true).catch(()=>{});if(manager!){await manager.flushAllSessions();manager.cleanup()}setSwarmAgentsEnabled(originalSwarm)}
process.exit(0)
