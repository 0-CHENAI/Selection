import { createHash } from 'node:crypto';
import { readSourceSnapshot, sourceIndexPath } from '@craft-agent/shared/source-snapshot';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { committedRunLog, readRunLog, readRunState, readNodeAttempt, listRunIds, runDir } from './storage.ts';
import { readSpecRevision } from './revisions.ts';
import { summarizeResearch, researchReadRangeTexts, ResearchRecordSchema, ResearchPayloadSchema, ResearchReadReceiptSchema, type ResearchConfig, type ResearchSource, type ResearchSummary, type ResearchReadReceipt } from './research.ts';
import { planValueKey } from './plan.ts';

/** A successor may preserve reviewed history only under the same research criteria. */
export function researchInheritanceCompatible(previous: ResearchConfig | undefined, next: ResearchConfig): boolean {
  return !!previous && planValueKey(previous.line) === planValueKey(next.line)
    && planValueKey(previous.dimensions) === planValueKey(next.dimensions)
    && previous.sources.every(source => next.sources.some(item => item.id === source.id && item.ref === source.ref))
    && (previous.lines ?? []).every(line => next.lines?.some(item => planValueKey(item) === planValueKey(line)))
    && (previous.branchDispositions ?? []).every(value => next.branchDispositions?.some(item => planValueKey(item) === planValueKey(value)))
    && (previous.questions ?? []).every(question => next.questions?.some(item => planValueKey({...item,parents:undefined,compatibilityReason:undefined}) === planValueKey({...question,parents:undefined,compatibilityReason:undefined}) && question.parents.every(parent => item.parents.some(next => planValueKey(next) === planValueKey(parent)))));
}

export function freezeResearchSources(root: string, slug: string, runId: string, config: ResearchConfig, directory: string): ResearchSource[] {
  const target = join(runDir(root, slug, runId), 'research'); mkdirSync(target, { recursive: true });
  const sources = config.sources.map((source, index): ResearchSource => {
    const ref = source.ref ?? source.path, acquiredAt = new Date().toISOString();
    try {
      const path = realpathSync(resolve(directory, source.path)), base = realpathSync(directory);
      const rel = relative(base, path);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Source must be inside the authorized task directory');
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const adjacentSnapshot = readSourceSnapshot(join(dirname(path), 'index.json'), base);
      const indexed = adjacentSnapshot?.textPath === path ? adjacentSnapshot : readSourceSnapshot(sourceIndexPath(base, path), base);
      if (indexed) {
        const extracted = readFileSync(indexed.textPath), snapshotPath = join(target, `source-${index}.txt`);
        writeFileSync(snapshotPath, extracted);
        return { id: source.id, ref: source.ref ?? indexed.origin, version: indexed.version, hash: indexed.originalHash,
          textHash: indexed.textHash, acquiredAt: indexed.acquiredAt, originalPath: indexed.originalPath,
          snapshotPath: realpathSync(snapshotPath), indexedPath: indexed.textPath, text: extracted.toString('utf8'),
          units: indexed.units, limitations: indexed.limitations, acquisition: indexed.acquisition };
      }
      if (adjacentSnapshot || basename(path) === 'snapshot.txt' && path.split(sep).includes('.selection-sources')) throw new Error('Original source snapshot is unavailable or corrupt');
      if (bytes.includes(0)) return { id: source.id, ref, version: hash, hash, acquiredAt, unavailableReason: 'Binary source needs a native reader and a locatable text snapshot' };
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const snapshotPath = join(target, `source-${index}.txt`); writeFileSync(snapshotPath, bytes);
      return { id: source.id, ref, version: hash, hash, acquiredAt, originalPath: path, snapshotPath: realpathSync(snapshotPath), text };
    } catch (error) {
      return { id: source.id, ref, version: 'unavailable', acquiredAt, unavailableReason: error instanceof Error ? error.message : String(error) };
    }
  });
  atomicWriteFileSync(join(target, 'sources.json'), JSON.stringify(sources, null, 2)); return sources;
}

export function readResearchSources(root: string, slug: string, runId: string, expectedHash?: string): ResearchSource[] {
  const sources = JSON.parse(readFileSync(join(runDir(root, slug, runId), 'research', 'sources.json'), 'utf8')) as ResearchSource[];
  if (expectedHash && createHash('sha256').update(JSON.stringify(sources)).digest('hex') !== expectedHash) throw new Error('Frozen source manifest version changed');
  return sources.map(source => {
    if (!source.snapshotPath || source.unavailableReason) return source;
    try {
      const directory = realpathSync(join(runDir(root, slug, runId), 'research'));
      const path = realpathSync(source.snapshotPath), rel = relative(directory, path);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Snapshot leaves its owning research run');
      const bytes = readFileSync(path);
      if (createHash('sha256').update(bytes).digest('hex') !== (source.textHash ?? source.hash)) throw new Error('Source snapshot version changed');
      return { ...source, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
    } catch (error) { return { ...source, text: undefined, unavailableReason: String(error) }; }
  });
}

export function loadResearchResults(root: string, slug: string, runId: string, visited = new Set<string>(), eventCount?: number): ResearchSummary | undefined {
  if (visited.has(runId)) throw new Error('Cyclic research predecessor receipt');
  visited.add(runId);
  const state = readRunState(root, slug, runId), durable = committedRunLog(readRunLog(root, slug, runId), state);
  const log = eventCount === undefined ? durable : durable.slice(0, eventCount);
  const revision = (eventCount === undefined ? state?.revision : undefined) ?? log.reduce((latest, entry) => Math.max(latest, entry.revision ?? 0), 0);
  const currentSpec = readSpecRevision(root, slug, runId, revision);
  const config = currentSpec?.research;
  if (!config) return undefined;
  const raw = log.flatMap(entry => entry.kind === 'node-finished' && entry.state === 'done'
    && (entry.researchRecord || currentSpec?.nodes.some(node => node.id === entry.nodeId.split('#')[0] && node.researchRole)) ? [entry] : []);
  const records = raw.flatMap(entry => {
    const parsed = ResearchRecordSchema.safeParse(entry.researchRecord);
    if (!parsed.success) return [];
    const producer = parsed.data.producedBy;
    const spec = readSpecRevision(root, slug, runId, producer.revision);
    const node = spec?.nodes.find(node => node.id === producer.nodeId.split('#')[0]);
    if (producer.runId !== runId || producer.nodeId !== entry.nodeId || producer.sessionId !== entry.sessionId || producer.revision > revision || node?.researchRole !== parsed.data.role) return [];
    const output = readNodeAttempt(root, slug, runId, producer.nodeId, producer.attempt);
    const payload = ResearchPayloadSchema.safeParse(output?.params?.research);
    return output
      && createHash('sha256').update(JSON.stringify(output)).digest('hex') === producer.artifactVersion
      && payload.success && planValueKey(payload.data) === planValueKey(parsed.data.payload) ? [parsed.data] : [];
  });
  if (records.length !== raw.length) { const summary = summarizeResearch(config, [], records); summary.blockers.push('Corrupt research execution receipt requires inspection'); return summary; }
  const started = log.find(entry => entry.kind === 'run-started');
  try {
    if (started?.kind !== 'run-started' || !started.researchSourcesHash) throw new Error('Research source version receipt is unavailable');
    const inheritedReads: ResearchReadReceipt[] = [];
    if (started.researchPredecessor) {
      if (started.resumedFrom !== started.researchPredecessor.runId) throw new Error('Research predecessor is not the canonical successor lineage');
      const predecessorState = readRunState(root,slug,started.researchPredecessor.runId);
      const predecessorSpec = readSpecRevision(root,slug,started.researchPredecessor.runId,predecessorState?.revision ?? 0);
      if (!researchInheritanceCompatible(predecessorSpec?.research,config)) throw new Error('Research predecessor criteria changed');
      const predecessor = loadResearchResults(root,slug,started.researchPredecessor.runId,visited);
      if (!predecessor || predecessor.blockers.some(blocker => blocker.includes('Corrupt') || blocker.includes('Frozen'))
        || createHash('sha256').update(JSON.stringify(predecessor.records)).digest('hex') !== started.researchPredecessor.recordsHash
        || started.researchPredecessor.readsHash && createHash('sha256').update(JSON.stringify(predecessor.reads)).digest('hex') !== started.researchPredecessor.readsHash) throw new Error('Research predecessor records changed or unavailable');
      records.unshift(...predecessor.records);
      inheritedReads.push(...predecessor.reads);
    }
    const sources = readResearchSources(root, slug, runId, started.researchSourcesHash);
    const readEvents = log.filter(entry => entry.kind === 'source-read');
    const spawns = new Map<string, Extract<(typeof log)[number], { kind: 'node-spawned' }>>();
    const retryAttempts = new Map<string, number>();
    const reads = log.flatMap(entry => {
      if (entry.kind === 'node-spawned') spawns.set(entry.nodeId, entry);
      if (entry.kind === 'node-retry') retryAttempts.set(entry.nodeId, entry.attempt + 1);
      if (entry.kind !== 'source-read') return [];
      const parsed = ResearchReadReceiptSchema.safeParse(entry.receipt);
      if (!parsed.success || parsed.data.producedBy.runId !== runId) return [];
      const read = parsed.data, source = sources.find(source => source.id === read.sourceId && source.version === read.sourceVersion);
      if (!source?.text || source.unavailableReason || (source.textHash ?? source.hash) !== read.contentHash || read.startLine > read.endLine
        || read.endLine > source.text.split('\n').length || ![source.snapshotPath, source.originalPath, source.indexedPath].includes(read.path)) return [];
      const returned = researchReadRangeTexts(source, read);
      const spawn = spawns.get(read.producedBy.nodeId);
      return returned.some(text => createHash('sha256').update(text).digest('hex') === read.returnedTextHash)
        && spawn?.kind === 'node-spawned' && spawn.sessionId === read.producedBy.sessionId
        && (spawn.generation ?? 0) === read.producedBy.generation && (spawn.attempt ?? retryAttempts.get(read.producedBy.nodeId) ?? 1) === read.producedBy.attempt
        && (spawn.attemptRevision ?? spawn.revision ?? 0) === read.producedBy.revision ? [read] : [];
    });
    const uniqueReads = new Map([...inheritedReads.filter(read => sources.some(source => source.id === read.sourceId
      && source.version === read.sourceVersion && !source.unavailableReason)), ...reads].map(read => [read.id, read]));
    const summary = summarizeResearch(config, sources, records, [...uniqueReads.values()]);
    if (reads.length !== readEvents.length) summary.blockers.push('Corrupt research read receipt requires inspection');
    return summary;
  }
  catch { const summary = summarizeResearch(config, [], records); summary.blockers.push('Frozen research sources are unavailable; restore and inspect before delivery'); return summary; }
}

/** Read later append-only corrections through canonical lineage; never rewrite a frozen handover. */
export function researchErrataAfter(root: string, slug: string, captured: { runId: string; retainedBy: string; logSequence?: number }, capturedAt: number): Array<{ runId: string; errata: ResearchSummary['errata'] }> {
  const runs = new Map(listRunIds(root, slug).flatMap(runId => {
    const log = committedRunLog(readRunLog(root, slug, runId), readRunState(root, slug, runId));
    const start = log.find(entry => entry.kind === 'run-started');
    return start?.kind === 'run-started' && start.orchestratorSessionId === captured.retainedBy ? [[runId, { start, log }] as const] : [];
  }));
  if (!runs.has(captured.runId)) throw new Error('Retained research history is unavailable');
  const descendsFromCaptured = (runId: string): boolean => {
    const seen = new Set<string>();
    while (!seen.has(runId)) {
      if (runId === captured.runId) return true;
      seen.add(runId);
      const parent = runs.get(runId)?.start.resumedFrom;
      if (!parent) return false;
      runId = parent;
    }
    throw new Error('Cyclic retained research history');
  };
  return [...runs].flatMap(([runId, { log }]) => {
    if (!descendsFromCaptured(runId)) return [];
    const summary = loadResearchResults(root, slug, runId);
    if (!summary) return [];
    if (summary.blockers.some(blocker => blocker.includes('Corrupt') || blocker.includes('Frozen'))) throw new Error('Retained research correction integrity is unavailable');
    const newRecords = log.filter((entry, index) => entry.kind === 'node-finished' && entry.state === 'done'
      && (runId !== captured.runId || (captured.logSequence !== undefined ? (entry.seq ?? index + 1) > captured.logSequence : Date.parse(entry.t) > capturedAt)));
    const errata = summary.errata.filter(value => value.producedBy.runId === runId && newRecords.some(entry => entry.kind === 'node-finished'
      && entry.researchRecord?.producedBy.artifactVersion === value.producedBy.artifactVersion
      && entry.researchRecord.producedBy.nodeId === value.producedBy.nodeId));
    return errata.length ? [{ runId, errata }] : [];
  });
}
