import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTaskSpec, saveTaskSpec, loadTaskResults, readRunState, readRunLog, runDir, specRevisionPath, freezeResearchSources, ResearchConfigSchema, type OrchestrationDecision, type TaskNode } from '@craft-agent/shared/tasks';
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
  expect(runner.getRunState('research','r')!.nodes.find(node=>node.id==='review')!.role).toBe('reviewer');
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
  expect(sent.filter(send=>send.id==='session-review2')[0]!.message).not.toContain('Research business state and delivery requirements:');
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

test('research recovery rejects payloads that disagree with the hashed attempt output',async()=>{
  await firstReview();
  const path=join(runDir(root,'research','r'),'run-log.jsonl');
  const log=readRunLog(root,'research','r');
  const entry=log.find(entry=>entry.kind==='node-finished'&&entry.researchRecord?.role==='reviewer')!;
  if(entry.kind==='node-finished') {
    entry.researchRecord!.payload.reviews[0]!.support='supported';
    entry.researchRecord!.payload.reviews[0]!.finding='Forged approval, not the persisted reviewer output';
  }
  writeFileSync(path,log.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  const summary=loadTaskResults(root,'research','r').research!;
  expect(summary.blockers).toContain('Corrupt research execution receipt requires inspection');
  expect(summary.claims[0]!.review?.support).not.toBe('supported');
  expect(summary.coverage.covered).toBe(0);
});

test('frozen research sources accept dot-prefixed file names while rejecting directory escapes',()=>{
  const directory=join(root,'authorized');mkdirSync(directory);
  writeFileSync(join(directory,'..notes.txt'),'authorized cost evidence');
  symlinkSync(join(root,'source.txt'),join(directory,'escape.txt'));
  const config=ResearchConfigSchema.parse({line:{id:'main',question:'cost'},dimensions:[{id:'cost',requirement:'cost evidence'}],sources:[
    {id:'valid',path:'..notes.txt'},{id:'outside',path:'../source.txt'},{id:'symlink',path:'escape.txt'},
  ]});
  const sources=freezeResearchSources(root,'paths','r',config,directory);
  expect(sources[0]!.text).toBe('authorized cost evidence');
  for(const source of sources.slice(1))expect(source.unavailableReason).toContain('inside the authorized task directory');
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

test('F6-d successor preserves unaffected independent review and immutable old report, source revision needs new review',async()=>{
  writeFileSync(join(root,'risk.txt'),'Verified risk fact');
  const sharedScope={region:'X',year:'2025',currency:'CNY',tax:'included',basis:'cost',requirements:'same inputs'};
  const research={line:{id:'main',question:'Cost and risk',premises:['two years']},dimensions:[{id:'cost',requirement:'cost evidence'},{id:'risk',requirement:'risk evidence'}],sources:[{id:'s',path:'source.txt'},{id:'risk-source',path:'risk.txt'}],questions:[{id:'Q-cost',question:'Canonical cost fact',sharedTaskRef:'initial',scope:sharedScope,commonBackground:['frozen original cost'],compatibilityReason:'same scope',parents:[{lineId:'main',premises:['two years'],inputScope:sharedScope,claimRefs:[],evidenceRefs:[],issueRefs:[],path:[]}]}]};
  function save(nodes:TaskNode[]) {
    const spec=parseTaskSpec({schema_version:3,id:'research',title:'Research',goal:'cost and risk',cwd:root,execution:{coordinator_gate:{mode:'off'},verification:{required:false}},research,nodes});
    if(!spec.success)throw new Error(JSON.stringify(spec));saveTaskSpec(root,spec.data);
  }
  save([node('initial','researcher'),node('initial-review','reviewer',['initial']),node('initial-report','reporter',['initial-review'])]);
  runner.run('research',{runId:'run-1',orchestratorSessionId:'orch',verifyOnComplete:false});await tick();
  const initial=loadTaskResults(root,'research','run-1').research!, source=initial.sources[0]!,risk=initial.sources[1]!;
  await complete('initial',{evidence:[{id:'cost-old',sourceId:'s',sourceVersion:source.version,locator:{startLine:2,endLine:2},excerpt:'A two-year cost is 1,000,000 yuan.'},{id:'risk-e',sourceId:risk.id,sourceVersion:risk.version,locator:{startLine:1,endLine:1},excerpt:'Verified risk fact'}],claims:[{id:'cost',version:1,type:'fact',text:'Cost 1,000,000 yuan',dimensionIds:['cost'],evidenceIds:['cost-old'],critical:true},{id:'risk',version:1,type:'fact',text:'Verified risk',dimensionIds:['risk'],evidenceIds:['risk-e'],critical:true}]});
  await complete('initial-review',{reviews:['cost','risk'].map(id=>({claimRef:{id,version:1},citationExists:true,support:'supported',finding:'Independent original support'}))});
  await complete('initial-report',{report:{claimRefs:[{id:'cost',version:1},{id:'risk',version:1}],limitations:[],unresolved:[]}});
  const old=loadTaskResults(root,'research','run-1');expect(old.runStatus).toBe('completed');
  writeFileSync(join(root,'source.txt'),'Title\nA two-year cost is 1,200,000 yuan.');
  save([node('fix','researcher'),node('new-review','reviewer',['fix']),node('new-report','reporter',['new-review'])]);
  runner.run('research',{runId:'run-2',orchestratorSessionId:'orch',resumedFrom:'run-1',verifyOnComplete:false});await tick();
  const inherited=loadTaskResults(root,'research','run-2').research!;
  expect(inherited.records).toEqual(old.research!.records);expect(inherited.claims.find(claim=>claim.id==='cost')!.review!.support).toBe('unverified');
  expect(inherited.questions).toEqual(old.research!.questions);
  expect(inherited.claims.find(claim=>claim.id==='risk')!.reviewer).toEqual(old.research!.claims.find(claim=>claim.id==='risk')!.reviewer);
  const currentSource=inherited.sources[0]!;
  await complete('fix',{evidence:[{id:'cost-new',sourceId:'s',sourceVersion:currentSource.version,locator:{startLine:2,endLine:2},excerpt:'A two-year cost is 1,200,000 yuan.'}],claims:[{id:'cost',version:2,type:'fact',text:'Cost 1,200,000 yuan',dimensionIds:['cost'],evidenceIds:['cost-new'],critical:true}]});
  expect(loadTaskResults(root,'research','run-2').research!.claims.find(claim=>claim.id==='cost')!.review).toBeUndefined();
  await complete('new-review',{reviews:[{claimRef:{id:'cost',version:2},citationExists:true,support:'supported',finding:'New original supports revised cost'}]});
  await complete('new-report',{report:{claimRefs:[{id:'cost',version:2},{id:'risk',version:1}],limitations:[],unresolved:[]}});
  const latest=loadTaskResults(root,'research');expect(latest.runStatus).toBe('completed');expect(latest.research!.blockers).toEqual([]);
  expect(latest.research!.claims.find(claim=>claim.id==='risk')!.reviewer!.runId).toBe('run-1');
  expect(latest.research!.report!.claimRefs).toEqual([{id:'cost',version:2},{id:'risk',version:1}]);
  expect(loadTaskResults(root,'research','run-1').research).toEqual(old.research);
  listeners.clear();runner=new TaskRunner({host:host(),workspaceId:'ws',workspaceRoot:root});
  expect(runner.getLatestRun('research')!.research).toEqual(latest.research);
});

test('F6-b shared question and its task commit once, with rollback and exact restart identity',async()=>{
  await firstReview();
  const before=loadTaskResults(root,'research','r').research!;
  const scope={region:'X',year:'2025',currency:'CNY',tax:'included',basis:'yuan/kWh',requirements:'same tariff'};
  const expansion={questions:[{id:'Q-price',question:'price',sharedTaskRef:'price',scope,commonBackground:['same factual gap'],compatibilityReason:'Scope and actual inputs explicitly checked',parents:[{lineId:'main',premises:['two years'],inputScope:scope,claimRefs:[{id:'cost',version:1}],evidenceRefs:['e1'],issueRefs:['wrong-cost'],path:['a','review']}]}]};
  const patch={action:'patch' as const,rationale:'Register one shared task with its business context',researchExpansion:expansion,add:[node('price','researcher',['review'])],update:[{id:'report',depends_on:['price']}]};
  const checkpoint=readRunState(root,'research','r')!,path=join(runDir(root,'research','r'),'run-state.json'),old=readFileSync(path,'utf8');
  unlinkSync(path);mkdirSync(path);expect(()=>decide(patch)).toThrow();rmSync(path,{recursive:true});writeFileSync(path,old);
  expect(loadTaskResults(root,'research','r').research!.questions).toEqual([]);
  expect(runner.getRunState('research','r')!.revision).toBe(checkpoint.revision);
  decide(patch);await tick();expect(loadTaskResults(root,'research','r').research!.questions).toEqual(expansion.questions);
  expect(sent.filter(send=>send.id==='session-price')).toHaveLength(1);
  expect(sent.find(send=>send.id==='session-price')!.message).toContain('Q-price');
  expect(sent.find(send=>send.id==='session-price')!.message).toContain('wrong-cost');
  listeners.clear();runner=new TaskRunner({host:host(),workspaceId:'ws',workspaceRoot:root});runner.scanUnfinished();
  expect(loadTaskResults(root,'research','r').research!.records).toEqual(before.records);
  expect(loadTaskResults(root,'research','r').research!.questions).toEqual(expansion.questions);
  expect(readRunLog(root,'research','r').filter(event=>event.kind==='node-spawned'&&event.nodeId==='price')).toHaveLength(1);
});

test('verification repair recovery never restores the rejected frontier as completed',async()=>{
  const spec=parseTaskSpec({schema_version:3,id:'research',title:'Repair recovery',goal:'current outcome',execution:{coordinator_gate:{mode:'off'}},nodes:[{id:'a',prompt:'a'},{id:'b',prompt:'b',depends_on:['a']}]});
  if(!spec.success)throw new Error(JSON.stringify(spec));saveTaskSpec(root,spec.data);
  runner.run('research',{runId:'r',orchestratorSessionId:'orch'});await tick();
  for(const id of ['a','b']){for(const listener of [...listeners])listener({workspaceId:'ws',sessionId:`session-${id}`,generation:0,reason:'complete',finalText:`old ${id}`});await tick();}
  expect(runner.getRunState('research','r')!.status).toBe('verifying');
  runner.submitVerdict('orch',{runId:'r',result:'fail',nodes:['a'],reason:'Need corrected current result'});
  const result=loadTaskResults(root,'research','r');
  expect(result.nodes.find(node=>node.id==='b')!).toMatchObject({state:'pending'});
  expect(result.nodes.every(node=>node.output===undefined)).toBe(true);
  expect(result.verdict).toBeUndefined();expect(result.verdicts![0]!.result).toBe('fail');
  listeners.clear();runner=new TaskRunner({host:host(),workspaceId:'ws',workspaceRoot:root});
  expect(runner.getLatestRun('research')!.nodes.find(node=>node.id==='b')!.state).toBe('pending');
});
