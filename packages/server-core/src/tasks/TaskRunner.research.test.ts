import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunState, readRunLog, runDir, specRevisionPath, type OrchestrationDecision, type TaskNode } from '@craft-agent/shared/tasks';
import { TaskRunner, type ConductorSessionHost } from './TaskRunner';
import type { SessionCompletionEvent } from '../sessions/SessionManager';

const tick = () => new Promise<void>(resolve => setTimeout(resolve,0));
const flag = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;
let root: string, runner: TaskRunner, listeners: Set<(event: SessionCompletionEvent) => void>, sent: Array<{id:string;message:string}>;
const sourceText = 'Title\nA two-year cost is 1,000,000 yuan.\nRisk evidence is missing.';
const node = (id: string, role: TaskNode['researchRole'], deps: string[] = []): TaskNode => ({id,kind:'session',researchRole:role,prompt:id,depends_on:deps,outputs:[{name:'research',kind:'param',type:'json',required:true}]});
function host(): ConductorSessionHost { return {
  async createSession(_ws,options) { return {id:`session-${options?.taskNodeId}`}; },
  async sendMessage(id,message) { sent.push({id,message}); },
  async setSessionStatus() {}, async setKanbanColumn() {}, async setTaskNodeCount() {}, async cancelProcessing() {},
  getSessionFinalText() {return undefined;},getSessionWorkingDirectory(){return root;},
  onSessionComplete(listener) {listeners.add(listener);return ()=>listeners.delete(listener);},
}; }
function decide(extra: Partial<OrchestrationDecision> = {}) {
  const state = readRunState(root,'research','r')!;
  return runner.applyOrchestrationDecisionByRunId('orch',{runId:'r',checkpointId:state.coordinatorGate!.checkpointId,baseRevision:state.revision,decisionId:`d-${state.seq}`,action:'continue',...extra});
}
async function complete(id:string,payload:unknown,text='author text') {
  expect(runner.submitNodeOutput(`session-${id}`,{values:{research:payload},text})).toEqual({ok:true});
  for (const listener of [...listeners]) listener({workspaceId:'ws',sessionId:`session-${id}`,generation:0,reason:'complete',finalText:text});
  await tick();
}
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'research-run-'));process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE='1';listeners=new Set();sent=[];
  writeFileSync(join(root,'source.txt'),sourceText);
  const spec=parseTaskSpec({schema_version:3,id:'research',title:'Research',goal:'cost and risk',runner:'orchestrate',cwd:root,
    research:{line:{id:'main',question:'Cost and risk',premises:['two years']},dimensions:[{id:'cost',requirement:'cost evidence'},{id:'risk',requirement:'risk evidence'}],sources:[{id:'s',path:'source.txt'}]},
    nodes:[node('a','researcher'),node('review','reviewer',['a']),node('report','reporter',['review'])]});
  if(!spec.success)throw new Error(JSON.stringify(spec.error));saveTaskSpec(root,spec.data);runner=new TaskRunner({host:host(),workspaceId:'ws',workspaceRoot:root});
});
afterEach(()=>{rmSync(root,{recursive:true,force:true});if(flag===undefined)delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE=flag;});

async function firstReview() {
  runner.run('research',{runId:'r',orchestratorSessionId:'orch',orchestrateAllowed:true});decide();await tick();
  const version=loadTaskResults(root,'research','r').research!.sources[0]!.version;
  await complete('a',{evidence:[{id:'e1',sourceId:'s',sourceVersion:version,locator:{startLine:2,endLine:2},excerpt:'A two-year cost is 1,000,000 yuan.'}],claims:[{id:'cost',version:1,type:'fact',text:'Cost 100,000 yuan',dimensionIds:['cost'],evidenceIds:['e1'],critical:true,keyNumber:true}]});
  decide();await tick();
  await complete('review',{reviews:[{claimRef:{id:'cost',version:1},citationExists:true,support:'contradicted',finding:'Source says 1,000,000'}],issues:[{id:'wrong-cost',claimRef:{id:'cost',version:1},finding:'Wrong number',disposition:'defer',reason:'Needs canonical correction then fresh review'}]});
}
test('F5-a/d durable business records survive restart, dynamic correction and exact-version review',async()=>{
  await firstReview();
  const before=loadTaskResults(root,'research','r').research!;
  expect(before.claims[0]!.review?.support).toBe('contradicted');
  listeners.clear();runner=new TaskRunner({host:host(),workspaceId:'ws',workspaceRoot:root});runner.scanUnfinished();
  expect(loadTaskResults(root,'research','r').research!.records).toEqual(before.records);
  decide({action:'patch',rationale:'Correction from independent source review',add:[node('fix','researcher',['review']),node('review2','reviewer',['fix'])],update:[{id:'report',depends_on:['review2']}]});await tick();
  const {producedBy: _producer, review: _review, reviewer: _reviewer, ...claim} = before.claims[0]!;
  const {producedBy: _issueProducer, state: _state, ...issue} = before.issues[0]!;
  await complete('fix',{claims:[{...claim,version:2,text:'Cost 1,000,000 yuan'}],issues:[{...issue,disposition:'correct',revisedClaimRef:{id:'cost',version:2},followupTaskRef:'fix'}]});
  expect(loadTaskResults(root,'research','r').research!.claims[0]!.review).toBeUndefined();
  decide();await tick();
  await complete('review2',{reviews:[{claimRef:{id:'cost',version:2},citationExists:true,support:'supported',finding:'Original supports 1,000,000',limitations:['No tax or risk data']}]});decide();await tick();
  expect(runner.submitNodeOutput('session-report',{values:{research:{report:{claimRefs:[{id:'cost',version:1}],limitations:['risk'],unresolved:['risk']}}}}).ok).toBe(false);
  await complete('report',{report:{claimRefs:[{id:'cost',version:2}],limitations:['Risk unavailable'],unresolved:['Need risk material']}},'Misleading old Cost 100,000 yuan');
  decide();runner.submitVerdict('orch',{runId:'r',result:'pass'});
  const results=loadTaskResults(root,'research','r');
  expect(results.runStatus).toBe('completed');expect(results.research!.blockers).toEqual([]);
  expect(results.research!.coverage).toEqual({covered:1,limited:0,uncovered:1,total:2});
  expect(results.research!.issues[0]!.state).toBe('resolved');
  expect(results.nodes.find(node=>node.id==='report')!.output).toContain('Cost 1,000,000 yuan');
  expect(results.nodes.find(node=>node.id==='report')!.output).not.toContain('100,000');
  expect(results.research!.claims[0]!.producedBy).toMatchObject({runId:'r',nodeId:'fix',attempt:1,revision:1,sessionId:'session-fix'});
  expect(sent.filter(send=>send.id==='session-review2')[0]!.message).toContain('[skill:deep-research]');
  expect(sent.filter(send=>send.id==='session-review2')[0]!.message).toContain('source-0.txt');
});

test('F5-c a changed snapshot or forged producer receipt never becomes supported coverage',async()=>{
  await firstReview();
  const research=loadTaskResults(root,'research','r').research!;
  writeFileSync(research.sources[0]!.snapshotPath!,'Tampered cost');
  expect(loadTaskResults(root,'research','r').research!.claims[0]!.review!.support).toBe('unverified');
  const path=join(runDir(root,'research','r'),'run-log.jsonl');
  // Mutate only the completed business receipt, preserving all execution events.
  const log=readRunLog(root,'research','r'); const entry=log.find(entry=>entry.kind==='node-finished'&&entry.researchRecord)!;
  if(entry.kind==='node-finished')entry.researchRecord!.producedBy.runId='wrong-run';
  writeFileSync(path,log.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  expect(loadTaskResults(root,'research','r').research!.blockers).toContain('Corrupt research execution receipt requires inspection');
});

test('ordinary PRO execution keeps one original node and no research source or Skill work',async()=>{
  const parsed=parseTaskSpec({schema_version:3,id:'ordinary',title:'Ordinary',goal:'simple read',execution:{verification:{required:false}},nodes:[{id:'only',prompt:'original simple task'}]});
  if(!parsed.success)throw new Error(JSON.stringify(parsed.error));saveTaskSpec(root,parsed.data);
  runner.run('ordinary',{runId:'plain',orchestratorSessionId:'orch',verifyOnComplete:false});await tick();
  expect(sent.filter(send=>send.id==='session-only')).toHaveLength(1);
  expect(sent.find(send=>send.id==='session-only')!.message).not.toContain('deep-research');
  for(const listener of [...listeners])listener({workspaceId:'ws',sessionId:'session-only',generation:0,reason:'complete',finalText:'simple result'});await tick();
  expect(loadTaskResults(root,'ordinary','plain').research).toBeUndefined();
  expect(loadTaskResults(root,'ordinary','plain').nodes).toHaveLength(1);
  expect(existsSync(join(runDir(root,'ordinary','plain'),'research'))).toBe(false);
});

test('final PASS refuses an unavailable frozen research definition rather than dropping its business gate',async()=>{
  const parsed=parseTaskSpec({schema_version:3,id:'research',title:'Limited research',goal:'disclose evidence gaps',execution:{coordinator_gate:{mode:'off'}},
    research:{line:{id:'main',question:'Cost and risk'},dimensions:[{id:'cost',requirement:'cost evidence'}],sources:[]},nodes:[node('only','reporter')]});
  if(!parsed.success)throw new Error(JSON.stringify(parsed.error));saveTaskSpec(root,parsed.data);
  runner.run('research',{runId:'r',orchestratorSessionId:'orch'});await tick();
  await complete('only',{report:{claimRefs:[],limitations:['No cost evidence available'],unresolved:['Need original cost evidence']}});
  expect(runner.getRunState('research','r')!.status).toBe('verifying');
  writeFileSync(specRevisionPath(root,'research','r',0),'corrupt definition');
  expect(()=>runner.submitVerdict('orch',{runId:'r',result:'pass'})).toThrow('frozen state unavailable');
  expect(runner.getRunState('research','r')!.status).toBe('verifying');
});
