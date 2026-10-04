import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { committedRunLog, readRunLog, readRunState, readNodeAttempt, runDir } from './storage.ts';
import { readSpecRevision } from './revisions.ts';
import { summarizeResearch, ResearchRecordSchema, ResearchPayloadSchema, type ResearchConfig, type ResearchSource, type ResearchSummary } from './research.ts';
import { planValueKey } from './plan.ts';

/** A successor may preserve reviewed history only under the same research criteria. */
export function researchInheritanceCompatible(previous: ResearchConfig | undefined, next: ResearchConfig): boolean {
  return !!previous && planValueKey(previous.line) === planValueKey(next.line)
    && planValueKey(previous.dimensions) === planValueKey(next.dimensions)
    && previous.sources.every(source => next.sources.some(item => item.id === source.id && item.ref === source.ref))
    && (previous.lines ?? []).every(line => next.lines?.some(item => planValueKey(item) === planValueKey(line)))
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
      if (bytes.includes(0)) return { id: source.id, ref, version: hash, hash, acquiredAt, unavailableReason: 'Binary source needs a native reader and a locatable text snapshot' };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const snapshotPath = join(target, `source-${index}.txt`); writeFileSync(snapshotPath, bytes);
      return { id: source.id, ref, version: hash, hash, acquiredAt, snapshotPath, text };
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
      if (createHash('sha256').update(bytes).digest('hex') !== source.hash) throw new Error('Source snapshot version changed');
      return { ...source, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch (error) { return { ...source, text: undefined, unavailableReason: String(error) }; }
  });
}

export function loadResearchResults(root: string, slug: string, runId: string, visited = new Set<string>()): ResearchSummary | undefined {
  if (visited.has(runId)) throw new Error('Cyclic research predecessor receipt');
  visited.add(runId);
  const state = readRunState(root, slug, runId), log = committedRunLog(readRunLog(root, slug, runId), state);
  const revision = state?.revision ?? log.reduce((latest, entry) => Math.max(latest, entry.revision ?? 0), 0);
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
    if (started.researchPredecessor) {
      if (started.resumedFrom !== started.researchPredecessor.runId) throw new Error('Research predecessor is not the canonical successor lineage');
      const predecessorState = readRunState(root,slug,started.researchPredecessor.runId);
      const predecessorSpec = readSpecRevision(root,slug,started.researchPredecessor.runId,predecessorState?.revision ?? 0);
      if (!researchInheritanceCompatible(predecessorSpec?.research,config)) throw new Error('Research predecessor criteria changed');
      const predecessor = loadResearchResults(root,slug,started.researchPredecessor.runId,visited);
      if (!predecessor || predecessor.blockers.some(blocker => blocker.includes('Corrupt') || blocker.includes('Frozen'))
        || createHash('sha256').update(JSON.stringify(predecessor.records)).digest('hex') !== started.researchPredecessor.recordsHash) throw new Error('Research predecessor records changed or unavailable');
      records.unshift(...predecessor.records);
    }
    return summarizeResearch(config, readResearchSources(root, slug, runId, started.researchSourcesHash), records);
  }
  catch { const summary = summarizeResearch(config, [], records); summary.blockers.push('Frozen research sources are unavailable; restore and inspect before delivery'); return summary; }
}
