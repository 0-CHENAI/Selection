import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { committedRunLog, readRunLog, readRunState, readNodeAttempt, runDir } from './storage.ts';
import { readSpecRevision } from './revisions.ts';
import { summarizeResearch, ResearchRecordSchema, type ResearchConfig, type ResearchSource, type ResearchSummary } from './research.ts';

export function freezeResearchSources(root: string, slug: string, runId: string, config: ResearchConfig, directory: string): ResearchSource[] {
  const target = join(runDir(root, slug, runId), 'research'); mkdirSync(target, { recursive: true });
  const sources = config.sources.map((source, index): ResearchSource => {
    const ref = source.ref ?? source.path, acquiredAt = new Date().toISOString();
    try {
      const path = realpathSync(resolve(directory, source.path)), base = realpathSync(directory);
      const rel = relative(base, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Source must be inside the authorized task directory');
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
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Snapshot leaves its owning research run');
      const bytes = readFileSync(path);
      if (createHash('sha256').update(bytes).digest('hex') !== source.hash) throw new Error('Source snapshot version changed');
      return { ...source, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch (error) { return { ...source, text: undefined, unavailableReason: String(error) }; }
  });
}

export function loadResearchResults(root: string, slug: string, runId: string): ResearchSummary | undefined {
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
    return output
      && createHash('sha256').update(JSON.stringify(output)).digest('hex') === producer.artifactVersion ? [parsed.data] : [];
  });
  if (records.length !== raw.length) { const summary = summarizeResearch(config, [], records); summary.blockers.push('Corrupt research execution receipt requires inspection'); return summary; }
  const started = log.find(entry => entry.kind === 'run-started');
  try {
    if (started?.kind !== 'run-started' || !started.researchSourcesHash) throw new Error('Research source version receipt is unavailable');
    return summarizeResearch(config, readResearchSources(root, slug, runId, started.researchSourcesHash), records);
  }
  catch { const summary = summarizeResearch(config, [], records); summary.blockers.push('Frozen research sources are unavailable; restore and inspect before delivery'); return summary; }
}
