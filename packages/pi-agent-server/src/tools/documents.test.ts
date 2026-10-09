import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createDocumentTools, indexOriginalDocument } from './documents';
import { freezeResearchSources, readResearchSources } from '../../../shared/src/tasks/research-storage';
import { ResearchConfigSchema } from '../../../shared/src/tasks/research';
import { minimalPdf } from './fixtures/minimal-pdf';
const office = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])));

test('G5 actual PDF pages, DOCX headings and XLSX cells enter frozen research; changed indexes invalidate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selection-documents-'));
  try {
    writeFileSync(join(directory, 'long.md'), '# 前提\n仅为测试\n# 成本\nA 两年成本为100万元\n'.repeat(120));
    writeFileSync(join(directory, 'cost.pdf'), minimalPdf(['TEST ONLY', 'A cost is 1000000 yuan']));
    writeFileSync(join(directory, 'cost.docx'), office({ 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>成本</w:t></w:r></w:p><w:p><w:r><w:t>100万元</w:t></w:r></w:p></w:body></w:document>' }));
    writeFileSync(join(directory, 'cost.xlsx'), office({
      'xl/workbook.xml': '<workbook><sheets><sheet name="成本" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="B2" t="inlineStr"><is><t>100万元</t></is></c></row></sheetData></worksheet>',
    }));
    writeFileSync(join(directory, 'cost.pptx'), office({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId r:id="s2"/><p:sldId r:id="s1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/><Relationship Id="s2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>100万元</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>测试范围</a:t></a:r></a:p></p:sld>',
    }));
    const nativeConfig = ResearchConfigSchema.parse({ line: { id: 'main', question: '核对成本' }, dimensions: [{ id: 'cost', requirement: '实际原文' }], sources: ['cost.pdf', 'cost.docx', 'cost.xlsx', 'cost.pptx'].map((path, index) => ({ id: `native-${index}`, path })) });
    const unindexed = freezeResearchSources(directory, 'task', 'before-index', nativeConfig, directory);
    expect(unindexed.every(source => !!source.unavailableReason)).toBe(true);
    const [indexTool, readTool] = createDocumentTools(() => directory);
    const indexes = await Promise.all(['long.md', 'cost.pdf', 'cost.docx', 'cost.xlsx', 'cost.pptx'].map(path => indexOriginalDocument(directory, path)));
    expect(indexes[0]!.units.length).toBeGreaterThan(200);
    expect(indexes[1]!.units[1]).toMatchObject({ id: 'page-2', kind: 'page', label: '第 2 页' });
    expect(indexes[2]!.units[1]!.label).toContain('成本');
    expect(indexes[3]!.units[0]!.id).toBe('成本!B2');
    const slide = await readTool!.execute('slide', { path: 'cost.pptx', unit_id: 'slide-2', quote: '100万元' }, undefined, undefined, {} as any);
    expect(slide.content[0]).toMatchObject({ text: expect.stringContaining('"quoteMatched":true') });
    expect(indexes[4]!.units[1]).toMatchObject({ id: 'slide-2', kind: 'slide' }); // presentation order, not filename order
    // Fully managed artifact workers keep an isolated cwd but read the host-authorized originals.
    const worker = join(directory, 'worker'); mkdirSync(worker);
    const [workerIndex, workerRead] = createDocumentTools(() => worker, () => directory);
    for (const [index, name] of ['cost.pdf', 'cost.docx', 'cost.xlsx', 'cost.pptx'].entries()) {
      const original = indexes[index + 1]!;
      const path = join(directory, name);
      const navigation = await workerIndex!.execute(`index-${name}`, { path }, undefined, undefined, {} as any);
      expect(navigation.content[0]).toMatchObject({ text: expect.stringContaining(original.version) });
      expect(navigation.details.sourceRead).toBeUndefined();
      const reading = await workerRead!.execute(`read-${name}`, { path, unit_id: original.units.at(-1)!.id }, undefined, undefined, {} as any);
      expect(reading.details.sourceRead).toMatchObject({ path: original.textPath, contentHash: original.textHash });
    }
    writeFileSync(join(worker, 'own.md'), '# Candidate\nWorker output');
    expect((await workerIndex!.execute('own', { path: 'own.md' }, undefined, undefined, {} as any)).content[0])
      .toMatchObject({ text: expect.stringContaining('Candidate') });
    const [unboundIndex] = createDocumentTools(() => worker);
    await expect(unboundIndex!.execute('unbound', { path: join(directory, 'cost.pdf') }, undefined, undefined, {} as any)).rejects.toThrow('authorized');
    const outside = mkdtempSync(join(tmpdir(), 'selection-outside-document-'));
    try {
      const path = join(outside, 'secret.md'); writeFileSync(path, 'Outside the authorized project');
      symlinkSync(path, join(worker, 'escape.md'));
      for (const escaped of [path, join(worker, 'escape.md')]) {
        await expect(workerIndex!.execute('escape', { path: escaped }, undefined, undefined, {} as any)).rejects.toThrow('authorized');
        await expect(workerRead!.execute('escape', { path: escaped, unit_id: 'section-1' }, undefined, undefined, {} as any)).rejects.toThrow('authorized');
      }
    } finally { rmSync(outside, { recursive: true, force: true }); }
    const result = await readTool!.execute('read', { path: 'cost.pdf', unit_id: 'page-2', quote: '1000000' }, undefined, undefined, {} as any);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"quoteMatched":true') });
    expect(result.details.sourceRead).toMatchObject({ path: indexes[1]!.textPath, startLine: 2, endLine: 2 });
    const nav = await indexTool!.execute('nav', { path: 'cost.xlsx', query: 'B2' }, undefined, undefined, {} as any);
    expect(nav.details.sourceRead).toBeUndefined();
    const config = nativeConfig;
    const frozen = freezeResearchSources(directory, 'task', 'run', config, directory);
    expect(frozen.every(source => !source.unavailableReason)).toBe(true);
    expect(frozen.map(source => source.version)).toEqual(indexes.slice(1).map(snapshot => snapshot.version));
    expect(frozen.map(source => source.indexedPath)).toEqual(indexes.slice(1).map(snapshot => snapshot.textPath));
    expect(readResearchSources(directory, 'task', 'before-index')).toEqual(unindexed); // a late index never repairs frozen history
    expect(frozen[0]!.units![1]!.kind).toBe('page');
    expect(readResearchSources(directory, 'task', 'run')[0]!.text).toContain('1000000');
    const snapshotConfig = ResearchConfigSchema.parse({ ...config, sources: indexes.map((snapshot, index) => ({ id: `indexed-${index}`, path: snapshot.textPath })) });
    const fromSnapshots = freezeResearchSources(directory, 'task', 'snapshot-run', snapshotConfig, directory);
    expect(fromSnapshots.map(source => source.version)).toEqual(indexes.map(snapshot => snapshot.version));
    expect(fromSnapshots.map(source => source.indexedPath)).toEqual(indexes.map(snapshot => snapshot.textPath));
    expect(fromSnapshots.map(source => source.units)).toEqual(indexes.map(snapshot => snapshot.units));
    const old = indexes[1]!.version;
    writeFileSync(join(directory, 'cost.pdf'), minimalPdf(['TEST ONLY', 'A cost is 2000000 yuan']));
    expect((await indexOriginalDocument(directory, 'cost.pdf')).version).not.toBe(old);
    expect(freezeResearchSources(directory, 'task', 'changed-original', snapshotConfig, directory)[1]!.unavailableReason).toContain('unavailable or corrupt');
    expect(readResearchSources(directory, 'task', 'snapshot-run')[1]!.version).toBe(old);
    expect(readResearchSources(directory, 'task', 'snapshot-run')[1]!.text).toContain('1000000');
    writeFileSync(indexes[3]!.textPath, 'tampered snapshot');
    expect(freezeResearchSources(directory, 'task', 'corrupt-snapshot', snapshotConfig, directory)[3]!.unavailableReason).toContain('unavailable or corrupt');
    expect(readResearchSources(directory, 'task', 'run')[0]!.text).toContain('1000000'); // frozen, never rewritten
    writeFileSync(join(directory, 'broken.pdf'), 'broken');
    await expect(indexOriginalDocument(directory, 'broken.pdf')).rejects.toThrow();
    expect(readFileSync(fromSnapshots[3]!.snapshotPath!, 'utf8')).toBe('100万元');
    await expect(indexOriginalDocument(directory, '/etc/passwd')).rejects.toThrow('authorized');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
