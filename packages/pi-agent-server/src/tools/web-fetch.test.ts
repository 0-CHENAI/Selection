import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWebFetchTool } from './web-fetch';
import { freezeResearchSources, readResearchSources } from '../../../shared/src/tasks/research-storage';
import { ResearchConfigSchema } from '../../../shared/src/tasks/research';
import { minimalPdf } from './fixtures/minimal-pdf';

test('G1 successful web original freezes actual content/version/range; errors and search-like failures have no receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selection-web-')), previous = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('<html><body><nav>noise</nav><article><h1>成本</h1><p>A 两年成本 100万元。</p></article></body></html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const tool = createWebFetchTool(() => join(directory, 'session'), () => directory);
    const result = await tool.execute('native-fetch-1', { url: 'https://1.1.1.1/cost' }, undefined, undefined, {} as any);
    const proof = (result.details as any).sourceRead;
    expect(proof.startLine).toBe(1); expect(proof.endLine).toBeGreaterThan(1);
    expect(readFileSync(proof.path, 'utf8')).toContain('100万元');
    expect(readFileSync(proof.path, 'utf8')).not.toContain('noise');
    const config = ResearchConfigSchema.parse({ line: { id: 'main', question: '核对' }, dimensions: [{ id: 'cost', requirement: '原文' }], sources: [{ id: 'web', path: proof.path }] });
    const sources = freezeResearchSources(directory, 'task', 'run', config, directory);
    expect(sources[0]!.acquisition).toMatchObject({ toolCallId: 'native-fetch-1', finalUrl: 'https://1.1.1.1/cost' });
    expect(sources[0]!.limitations![0]).toContain('JavaScript');
    expect(readResearchSources(directory, 'task', 'run')[0]!.version).toBe(sources[0]!.version);
    globalThis.fetch = (async () => new Response('unavailable', { status: 403 })) as typeof fetch;
    const failure = await tool.execute('native-fetch-2', { url: 'https://1.1.1.1/cost' }, undefined, undefined, {} as any);
    expect(failure.details).toMatchObject({ isError: true }); expect((failure.details as any).sourceRead).toBeUndefined();
    expect(readResearchSources(directory, 'task', 'run')[0]!.text).toContain('100万元');
    let requests = 0;
    globalThis.fetch = (async () => { requests++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); }) as typeof fetch;
    const redirect = await tool.execute('native-fetch-3', { url: 'https://1.1.1.1/cost' }, undefined, undefined, {} as any);
    expect(requests).toBe(1); expect(redirect.details).toMatchObject({ isError: true }); expect((redirect.details as any).sourceRead).toBeUndefined();
    globalThis.fetch = (async () => new Response(minimalPdf(['']), { headers: { 'content-type': 'application/pdf' } })) as typeof fetch;
    const blank = await tool.execute('native-fetch-4', { url: 'https://1.1.1.1/blank.pdf' }, undefined, undefined, {} as any);
    expect(blank.content[0]).toMatchObject({ text: expect.stringContaining('No extractable text') });
    expect((blank.details as any).sourceRead).toBeUndefined();
  } finally { globalThis.fetch = previous; rmSync(directory, { recursive: true, force: true }); }
});
