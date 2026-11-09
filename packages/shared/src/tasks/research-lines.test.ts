import { expect, test } from 'bun:test';
import { ResearchConfigSchema, ResearchPayloadSchema, summarizeResearch, renderResearchReport, validateResearchRecord, type ResearchRecord } from './research.ts';
import { expandResearch, researchTaskContext } from './research-expansion.ts';
import { validateOrchestrationPatch, mergeRunDefinition } from './orchestration-patch.ts';
import { parseTaskSpec } from './schema.ts';

const config = ResearchConfigSchema.parse({line:{id:'high',question:'High utilization',premises:['9000 hours']},lines:[{id:'low',question:'Low utilization',premises:['1000 hours'],parentLineIds:['high']}],dimensions:[{id:'cost',requirement:'Utilization-sensitive cost'}],sources:[{id:'cost',path:'cost.txt'}]});
const sources = [{id:'cost',ref:'fixed cost',version:'v1',acquiredAt:'now',text:'High 90, low 10'}];
const record = (role: ResearchRecord['role'], payload: unknown, sessionId: string = role): ResearchRecord => ({role,payload:ResearchPayloadSchema.parse(payload),producedBy:{runId:'r',nodeId:sessionId,attempt:1,revision:0,artifactVersion:'hash',sessionId}});
const authored = record('researcher',{evidence:[{id:'e',sourceId:'cost',sourceVersion:'v1',locator:{startLine:1,endLine:1},excerpt:'High 90, low 10'}],claims:[{id:'H',version:1,lineIds:['high'],type:'inference',text:'High: choose A',dimensionIds:['cost'],evidenceIds:['e'],critical:true,recommendation:true},{id:'L',version:1,lineIds:['low'],type:'inference',text:'Low: choose B',dimensionIds:['cost'],evidenceIds:['e'],critical:true,recommendation:true}]});
const reviewed = ['H','L'].map((id,i) => record('reviewer',{reviews:[{claimRef:{id,version:1},citationExists:true,support:'supported',finding:'Original and this utilization premise support this recommendation'}],issues:[{id:`limit-${id}`,claimRef:{id,version:1},finding:'Market unknown',disposition:'defer',reason:'Need local demand evidence'}]},`independent-${i}`));
const report = record('reporter',{report:{claimRefs:[{id:'H',version:1},{id:'L',version:1}],limitations:['No market evidence'],unresolved:['Both market objections remain deferred'],alternatives:['Utilization determines the conditional choice; no voting'],changeEvidence:['Measured operating hours or new prices could reverse the choice']}});
const scope = {region:'X',year:'2025',currency:'CNY',tax:'included',basis:'yuan/kWh',requirements:'same tariff and consumption class'};
const parent = (lineId:string) => ({lineId,premises:config.line.id === lineId ? config.line.premises : config.lines![0]!.premises,inputScope:scope,claimRefs:[{id:lineId==='high'?'H':'L',version:1}],evidenceRefs:['e'],issueRefs:[`limit-${lineId==='high'?'H':'L'}`],path:['initial']});
const question = {id:'Q-price',question:'Same regional year electricity price',sharedTaskRef:'price',scope,commonBackground:['shared tariff fact, separate utilization assumptions'],compatibilityReason:'All six scope fields and source inputs checked explicitly',parents:[parent('high'),parent('low')]};

test('F6-a/d conditional recommendations and both unresolved histories survive JSON reload',()=>{
  const summary = summarizeResearch(config,sources,JSON.parse(JSON.stringify([authored,...reviewed,report])));
  expect(summary.blockers).toEqual([]);expect(summary.lines.map(line=>line.claimRefs)).toEqual([[{id:'H',version:1}],[{id:'L',version:1}]]);
  expect(summary.coverage).toEqual({covered:2,limited:0,uncovered:0,total:2});expect(summary.issues.map(issue=>issue.state)).toEqual(['limited','limited']);
  const text = renderResearchReport(summary);for(const value of ['9000 hours','1000 hours','High: choose A','Low: choose B','替代解释','可能改变结论的证据'])expect(text).toContain(value);
  const bad = structuredClone(report);delete bad.payload.report!.alternatives;
  expect(summarizeResearch(config,sources,[authored,...reviewed,bad]).blockers).toContain('Conditional report must describe alternatives and evidence that could change the conclusions');
});

test('F6-b shared question preserves exact multi-parent inputs and canonical task identity',()=>{
  const tasks = new Map([['price',{researchRole:'researcher'}],['initial',{}]]);
  const expanded = expandResearch(config,{questions:[question]},tasks,[authored,...reviewed]);
  expect(expandResearch(expanded,{questions:[question]},tasks,[authored,...reviewed]).questions).toHaveLength(1);
  const summary = summarizeResearch(expanded,sources,[authored,...reviewed]);
  const context = researchTaskContext(summary,'price') as any;
  expect(context.questions[0].parents).toEqual(question.parents);expect(context.lines).toHaveLength(2);
  expect(context.sources[0].text).toBeUndefined();expect(context.sources[0].version).toBe('v1');expect(context.evidence).toHaveLength(1);
  expect(()=>expandResearch(expanded,{questions:[{...question,sharedTaskRef:'price2'}]},new Map([...tasks,['price2',{researchRole:'researcher'}]]),[authored,...reviewed])).toThrow('reuse canonical task price');
});

test('F6-c similar titles with different year or tax never share identity; convergence preserves both parents',()=>{
  const tasks = new Map([['price',{researchRole:'researcher'}],['initial',{}]]);
  for(const altered of [{...scope,year:'2026'},{...scope,tax:'excluded'}])expect(()=>expandResearch(config,{questions:[{...question,parents:[question.parents[0],{...question.parents[1],inputScope:altered}]}]},tasks,[authored,...reviewed])).toThrow('Incompatible');
  expect(()=>expandResearch(config,{questions:[{...question,parents:[{...parent('high'),premises:['changed']}]}]},tasks,[authored])).toThrow('preserve premises');
  const convergent = structuredClone(authored);convergent.payload.claims[1]!.text='Low: choose A';
  const relation = record('researcher',{relations:[{id:'same-outcome',type:'converges',from:{id:'H',version:1},to:{id:'L',version:1},reason:'Only the recommendation converges, retain both independent histories'}]});
  expect(validateResearchRecord(config,sources,[authored],relation)).toEqual([]);
  const summary = summarizeResearch(config,sources,[convergent,...reviewed,relation,report]);expect(summary.lines).toHaveLength(2);expect(summary.records).toHaveLength(5);expect(summary.relations[0]?.current).toBe(true);
});

test('F6-b concurrent registrations use the existing revision fence; duplicate request cannot add a second task',()=>{
  const old=process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE='1';
  try {
    const spec=parseTaskSpec({schema_version:3,id:'task',title:'Research',goal:'conditional',runner:'orchestrate',research:config,nodes:[{id:'initial',prompt:'already done'}]});if(!spec.success)throw new Error(JSON.stringify(spec));
    const ctx={spec:spec.data,revision:0,runId:'r',seenDecisionIds:new Set<string>(),nodeStates:{initial:'done' as const},researchRecords:[authored,...reviewed]};
    const patch={runId:'r',decisionId:'d1',baseRevision:0,rationale:'Explicit compatible common fact',researchExpansion:{questions:[question]},add:[{id:'price',kind:'session' as const,researchRole:'researcher' as const,prompt:'shared price',outputs:[{name:'research',kind:'param' as const,type:'json' as const,required:true}]}]};
    const first=validateOrchestrationPatch(patch,ctx);expect(first.ok).toBe(true);if(!first.ok)return;
    const committed={...ctx,spec:first.spec,revision:1,seenDecisionIds:new Set(['d1'])};
    expect(validateOrchestrationPatch({...patch,decisionId:'d2'},committed)).toMatchObject({ok:false,error:'stale revision'});
    expect(validateOrchestrationPatch({...patch,decisionId:'d3',baseRevision:1,add:[]},committed).ok).toBe(true);
    expect(first.spec.nodes.filter(node=>node.id==='price')).toHaveLength(1);
  } finally {if(old===undefined)delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE;else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE=old;}
});

test('changed shared input invalidates only dependent exact-version reviews, old report remains queryable',()=>{
  const price = record('researcher',{claims:[{id:'price',version:1,lineIds:['high','low'],type:'fact',text:'price',dimensionIds:['cost'],evidenceIds:['e'],critical:true}]},'price');
  const check = record('reviewer',{reviews:[{claimRef:{id:'price',version:1},citationExists:true,support:'supported',finding:'source supports price'}]},'price-review');
  const dependent=structuredClone(authored);dependent.payload.claims[0]!.inputClaimRefs=[{id:'price',version:1}];
  const revised=record('researcher',{claims:[{...price.payload.claims[0],version:2,text:'new price'}]},'price2');
  const summary=summarizeResearch(config,sources,[price,check,dependent,...reviewed,report,revised]);
  expect(summary.claims.find(claim=>claim.id==='H')!.review!.support).toBe('unverified');
  expect(summary.claims.find(claim=>claim.id==='L')!.review!.support).toBe('supported');
  expect(summary.report!.claimRefs).toEqual(report.payload.report!.claimRefs);expect(summary.blockers).toContain('Report cites an outdated or unsupported claim H@1');
});

test('a supported numerical revision does not silently resolve unrelated market objections',()=>{
  const revision=record('researcher',{claims:[{...authored.payload.claims[0],version:2,text:'High: choose A with complete cost citations'}]},'correction');
  const review=record('reviewer',{reviews:[{claimRef:{id:'H',version:2},citationExists:true,support:'supported',finding:'Corrected cost record supported; market demand still unknown'}]},'review2');
  const audit=record('reviewer',{issues:[{id:'audit-H',claimRef:{id:'H',version:1},finding:'Cost citation incomplete',disposition:'defer',reason:'Need a corrected cost record'}]},'audit');
  const records=[authored,...reviewed,audit,revision,review];
  expect(summarizeResearch(config,sources,records).issues.find(issue=>issue.id==='limit-H')!.state).toBe('limited');
  const update=record('researcher',{issues:[{...audit.payload.issues[0],disposition:'correct',reason:'Explicitly associate the citation correction with reviewed H@2',revisedClaimRef:{id:'H',version:2}}]},'issue-update');
  const summary=summarizeResearch(config,sources,[...records,update]);
  expect(summary.issues.find(issue=>issue.id==='audit-H')!.state).toBe('resolved');
  expect(summary.issues.find(issue=>issue.id==='limit-H')!.state).toBe('limited');
});

test('applying a run includes registered shared context and preserves a separately edited future scope',()=>{
  const spec=parseTaskSpec({schema_version:3,id:'task',title:'Research',goal:'conditional',research:config,nodes:[{id:'initial',prompt:'original'}]});if(!spec.success)throw new Error(JSON.stringify(spec));
  const expanded=expandResearch(config,{questions:[question]},new Map([['price',{researchRole:'researcher'}],['initial',{}]]),[authored,...reviewed]);
  const run={...spec.data,research:expanded};
  expect(mergeRunDefinition(spec.data,run).research!.questions).toEqual([question]);
  const future=structuredClone(run);future.research.questions![0]!.scope.tax='excluded';future.research.questions![0]!.parents.forEach(parent=>parent.inputScope.tax='excluded');
  expect(mergeRunDefinition(future,run).research).toEqual(future.research);
});
