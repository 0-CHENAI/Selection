import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { SessionToolContext } from '../context.ts';
import { OfficecliBatchSchema, OfficecliFinalizeSchema, OfficecliOperationSchema } from '../tool-defs.ts';
import { handleOfficecliBatch } from './officecli-batch.ts';
import { handleOfficecliFinalize } from './officecli-finalize.ts';
import { handleOfficecliQa } from './officecli-qa.ts';
import {
  inspectOfficecliAttribution,
  sanitizeOfficecliAttribution,
  sanitizeOfficecliMetadata,
} from './officecli-metadata.ts';
import { runOfficecli, withOfficecliFileLock } from '../runtime/officecli-runtime.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = join(tmpdir(), `selection-officecli-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeOfficeFixture(file: string, withAttribution = false): void {
  const creator = withAttribution ? 'OfficeCLI' : '';
  writeFileSync(file, zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body/></w:document>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0"?><cp:coreProperties xmlns:cp="urn:cp" xmlns:dc="urn:dc"><dc:creator>${creator}</dc:creator><cp:lastModifiedBy>${creator}</cp:lastModifiedBy></cp:coreProperties>`),
    'docProps/app.xml': strToU8(`<?xml version="1.0"?><ap:Properties xmlns:ap="urn:ap"><ap:Application>${withAttribution ? 'OfficeCLI/1.0.144' : ''}</ap:Application></ap:Properties>`),
    'docProps/custom.xml': strToU8(withAttribution
      ? '<?xml version="1.0"?><op:Properties xmlns:op="urn:op"><op:property name="OfficeCLI.Version"><v>1.0.144</v></op:property></op:Properties>'
      : '<?xml version="1.0"?><op:Properties xmlns:op="urn:op"/>'),
  }));
}

function makeFakeOfficecli(
  dir: string,
  options: {
    renderFails?: boolean;
    issueCount?: number;
    corruptPng?: boolean;
    truncateBatchOutput?: boolean;
    omitRollbackProof?: boolean;
    saveEnvelopeFails?: boolean;
    closeEnvelopeFails?: boolean;
  } = {},
): string {
  const binary = join(dir, 'fake-officecli');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => stdin += c);
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify({ args, stdinBytes: Buffer.byteLength(stdin) }) + '\\n');
  const command = args[0];
  if (command === 'batch') {
    const operations = JSON.parse(stdin);
    const failIndex = operations.findIndex(op => op.props && op.props.fail === true);
    const results = operations.slice(0, failIndex < 0 ? operations.length : failIndex + 1).map((_, index) =>
      index === failIndex ? { index, success: false, error: 'synthetic failure' } : { index, success: true, output: 'ok' }
    );
    const success = failIndex < 0;
    console.log(JSON.stringify({ success, data: { results, summary: { total: operations.length, succeeded: success ? operations.length : failIndex, failed: success ? 0 : 1, ...(${options.omitRollbackProof ? 'true' : 'false'} ? {} : { atomicRolledBack: !success }) } } }));
    if (${options.truncateBatchOutput ? 'true' : 'false'}) process.stdout.write('x'.repeat(5 * 1024 * 1024));
    process.exitCode = success ? 0 : 1;
    return;
  }
  if (command === 'validate') return console.log(JSON.stringify({ success: true, data: 'ok' }));
  if (command === 'get') return console.log(JSON.stringify({ success: true, data: { results: [{ format: { styleId: 'Heading1' }, children: [{ format: { outlineLvl: '0' } }] }, { format: { styleId: 'Heading2' }, children: [{ format: { outlineLvl: '1' } }] }, { format: { styleId: 'Heading3' }, children: [{ format: { outlineLvl: '2' } }] }] } }));
  if (command === 'query') return console.log(JSON.stringify({ success: true, data: { matches: 1, results: [{}] } }));
  if (command === 'view' && args[2] === 'issues') return console.log(JSON.stringify({ success: true, data: { count: ${options.issueCount ?? 0}, issues: ${options.issueCount ? "[{ severity: 3, message: 'synthetic structural issue' }]" : '[]'} } }));
  if (command === 'view' && args[2] === 'outline') return console.log(JSON.stringify({ success: true, data: { headings: [{ text: 'One', level: 1 }] } }));
  if (command === 'view' && args[2] === 'text') return console.log('clean document text');
  if (command === 'view' && args[2] === 'html') return console.log(JSON.stringify({ success: true, data: '<!DOCTYPE html><div class="page"></div>' }));
  if (command === 'view' && args[2] === 'screenshot') {
    if (${options.renderFails ? 'true' : 'false'}) { console.error('render failed'); process.exitCode = 1; return; }
    const out = args[args.indexOf('--out') + 1];
    fs.writeFileSync(out, ${options.corruptPng ? "Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').subarray(0, 24)" : "Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')"});
    return console.log(JSON.stringify({ success: true, data: { path: out } }));
  }
  if (command === 'save') return console.log(JSON.stringify({ success: !${options.saveEnvelopeFails ? 'true' : 'false'} }));
  if (command === 'close') return console.log(JSON.stringify({ success: !${options.closeEnvelopeFails ? 'true' : 'false'} }));
  console.error('unsupported fake command');
  process.exitCode = 1;
});
`;
  writeFileSync(binary, source);
  chmodSync(binary, 0o755);
  return binary;
}

function makeContext(dir: string, binary: string, supportsImages?: boolean): SessionToolContext {
  return {
    sessionId: 'test-session',
    workspacePath: dir,
    get sourcesPath() { return join(dir, 'sources'); },
    get skillsPath() { return join(dir, 'skills'); },
    plansFolderPath: join(dir, 'plans'),
    sessionPath: dir,
    dataPath: join(dir, 'data'),
    workingDirectory: dir,
    callbacks: { onPlanSubmitted() {}, onAuthRequest() {} },
    fs: {} as SessionToolContext['fs'],
    loadSourceConfig: () => null,
    officecli: { binaryPath: binary },
    ...(supportsImages === undefined ? {} : { supportsImages }),
  };
}

describe('OfficeCLI typed schemas', () => {
  it('rejects empty batches, unknown commands and fields, and batches over 50 operations', () => {
    expect(OfficecliBatchSchema.safeParse({ file: 'test.docx', operations: [] }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({ command: 'execute', path: '/' }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({ command: 'add', parent: '/body', raw: true }).success).toBe(false);
    expect(OfficecliBatchSchema.safeParse({
      file: 'test.docx',
      operations: Array.from({ length: 51 }, () => ({ command: 'get', path: '/' })),
    }).success).toBe(false);
  });

  it('rejects command-specific field mistakes before starting OfficeCLI', () => {
    expect(OfficecliOperationSchema.safeParse({ command: 'set', parent: '/', props: { color: 'red' } }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({ command: 'add', parent: '/body', props: { text: 'missing type' } }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({ command: 'query', path: '/' }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({ command: 'swap', path: '/body/p[1]' }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({
      command: 'move', path: '/body/p[1]', to: '/body', before: '/body/p[2]',
    }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({
      command: 'get', path: '/', props: { text: 'ignored' }, selector: 'paragraph',
    }).success).toBe(false);
    expect(OfficecliOperationSchema.safeParse({
      command: 'remove', path: '/body/p[1]', path2: '/body/p[2]',
    }).success).toBe(false);
  });

  it('does not expose attribution policy as model-controlled finalize input', () => {
    expect(OfficecliFinalizeSchema.safeParse({ file: 'test.docx' }).success).toBe(true);
    expect(OfficecliFinalizeSchema.safeParse({
      file: 'test.docx',
      allowVisibleAttribution: true,
    }).success).toBe(false);
  });
});

describe('OfficeCLI attribution inspection', () => {
  it('rejects a ZIP entry whose declared uncompressed size exceeds the safety limit', () => {
    const dir = makeTempDir();
    const hostile = join(dir, 'oversized-entry.docx');
    const archive = Buffer.from(zipSync({
      'word/document.xml': strToU8('<w:document/>'),
    }));
    for (let index = 0; index <= archive.length - 4; index += 1) {
      const signature = archive.readUInt32LE(index);
      if (signature === 0x04034b50) archive.writeUInt32LE(64 * 1024 * 1024 + 1, index + 22);
      if (signature === 0x02014b50) archive.writeUInt32LE(64 * 1024 * 1024 + 1, index + 24);
    }
    writeFileSync(hostile, archive);
    expect(() => inspectOfficecliAttribution(hostile)).toThrow('64MB safety limit');
    expect(() => sanitizeOfficecliAttribution(hostile)).toThrow('64MB safety limit');
  });

  it('rejects a ZIP package whose declared total uncompressed size exceeds the safety limit', () => {
    const dir = makeTempDir();
    const hostile = join(dir, 'oversized-total.docx');
    const archive = Buffer.from(zipSync(Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`word/media/image-${index}.bin`, strToU8('x')]),
    )));
    for (let index = 0; index <= archive.length - 4; index += 1) {
      const signature = archive.readUInt32LE(index);
      if (signature === 0x04034b50) archive.writeUInt32LE(60 * 1024 * 1024, index + 22);
      if (signature === 0x02014b50) archive.writeUInt32LE(60 * 1024 * 1024, index + 24);
    }
    writeFileSync(hostile, archive);
    expect(() => inspectOfficecliAttribution(hostile)).toThrow('256MB total-uncompressed-size safety limit');
  });

  it('allows topical OfficeCLI research in body and metadata', () => {
    const dir = makeTempDir();
    const topical = join(dir, 'topical.docx');
    writeFileSync(topical, zipSync({
      'word/document.xml': strToU8('<w:document>本报告介绍如何使用 OfficeCLI 生成文档</w:document>'),
      'docProps/core.xml': strToU8('<cp:coreProperties><dc:title>OfficeCLI 调研报告</dc:title><dc:creator>Chen</dc:creator></cp:coreProperties>'),
    }));
    expect(inspectOfficecliAttribution(topical)).toEqual({ clean: true, entries: [] });
  });

  it('allows research prose to quote and discuss the exact generator badge', () => {
    const dir = makeTempDir();
    const topical = join(dir, 'quoted-badge-research.docx');
    writeFileSync(topical, zipSync({
      'word/document.xml': strToU8([
        '<w:document><w:body>',
        '<w:p><w:r><w:t>常见异常是“本文档由 OfficeCLI 自动生成”出现在页脚，应在交付前清理。</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>示例原文：“使用OfficeCLI生成”。</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join('')),
    }));
    expect(inspectOfficecliAttribution(topical)).toEqual({ clean: true, entries: [] });
    expect(sanitizeOfficecliAttribution(topical)).toEqual({
      changed: false,
      metadataChanged: false,
      visibleChanged: false,
      removedVisibleBadges: 0,
    });
  });

  it('preserves exact badge samples in Word quote and code paragraph styles', () => {
    const dir = makeTempDir();
    const topical = join(dir, 'styled-badge-samples.docx');
    writeFileSync(topical, zipSync({
      'word/document.xml': strToU8([
        '<w:document><w:body>',
        '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t>使用OfficeCLI生成</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join('')),
    }));
    expect(sanitizeOfficecliAttribution(topical)).toMatchObject({
      changed: true,
      visibleChanged: true,
      removedVisibleBadges: 1,
    });
    const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(topical)))['word/document.xml']!);
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('w:val="CodeBlock"');
    expect(inspectOfficecliAttribution(topical)).toEqual({ clean: true, entries: [] });
  });

  it('does not let quote or code styles bypass header and footer attribution cleanup', () => {
    const dir = makeTempDir();
    const stamped = join(dir, 'styled-footer-badge.docx');
    writeFileSync(stamped, zipSync({
      'word/header1.xml': strToU8('<w:hdr><w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t>使用OfficeCLI生成</w:t></w:r></w:p></w:hdr>'),
      'word/footer1.xml': strToU8('<w:ftr><w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p></w:ftr>'),
    }));
    expect(inspectOfficecliAttribution(stamped)).toEqual({
      clean: false,
      entries: ['word/footer1.xml', 'word/header1.xml'],
    });
    expect(sanitizeOfficecliAttribution(stamped)).toMatchObject({
      changed: true,
      visibleChanged: true,
      removedVisibleBadges: 2,
    });
    expect(inspectOfficecliAttribution(stamped)).toEqual({ clean: true, entries: [] });
  });

  it('deterministically removes an unrequested standalone badge while preserving discussion', () => {
    const dir = makeTempDir();
    const mixed = join(dir, 'mixed-attribution.docx');
    writeFileSync(mixed, zipSync({
      'word/document.xml': strToU8([
        '<w:document><w:body>',
        '<w:p><w:r><w:t>本文档由 </w:t></w:r><w:r><w:t>OfficeCLI 自动生成</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>本节讨论“本文档由 OfficeCLI 自动生成”为什么不应自动出现。</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join('')),
    }));
    expect(sanitizeOfficecliAttribution(mixed)).toEqual({
      changed: true,
      metadataChanged: false,
      visibleChanged: true,
      removedVisibleBadges: 1,
    });
    expect(inspectOfficecliAttribution(mixed)).toEqual({ clean: true, entries: [] });
  });

  it('removes a standalone text-box badge without corrupting nested Word paragraphs', () => {
    const dir = makeTempDir();
    const nested = join(dir, 'nested-text-box-attribution.docx');
    writeFileSync(nested, zipSync({
      'word/document.xml': strToU8([
        '<w:document><w:body>',
        '<w:p><w:r><w:drawing><w:txbxContent>',
        '<w:p><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p>',
        '</w:txbxContent></w:drawing></w:r></w:p>',
        '<w:p><w:r><w:t>研究结论保留。</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join('')),
    }));
    expect(sanitizeOfficecliAttribution(nested).removedVisibleBadges).toBe(1);
    const documentXml = unzipSync(new Uint8Array(readFileSync(nested)))['word/document.xml'];
    expect(documentXml).toBeDefined();
    const xml = strFromU8(documentXml!);
    expect(xml).toContain('<w:p><w:r><w:t>研究结论保留。</w:t></w:r></w:p>');
    expect(xml).not.toContain('OfficeCLI 自动生成');
    expect((xml.match(/<w:p\b/gu) ?? []).length).toBe((xml.match(/<\/w:p>/gu) ?? []).length);
  });

  it('rejects an unrequested body disclosure but permits it under trusted explicit intent', () => {
    const dir = makeTempDir();
    const disclosed = join(dir, 'disclosed.docx');
    writeFileSync(disclosed, zipSync({
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>本文档由 </w:t></w:r><w:r><w:t>OfficeCLI 自动生成</w:t></w:r></w:p></w:body></w:document>'),
    }));
    expect(inspectOfficecliAttribution(disclosed)).toEqual({
      clean: false,
      entries: ['word/document.xml'],
    });
    expect(inspectOfficecliAttribution(disclosed, { allowVisibleAttribution: true })).toEqual({
      clean: true,
      entries: [],
    });
  });

  it('rejects the standalone generator badge from the original regression without blocking topical prose', () => {
    const dir = makeTempDir();
    const stamped = join(dir, 'standalone-visible-attribution.docx');
    writeFileSync(stamped, zipSync({
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>使用OfficeCLI生成</w:t></w:r></w:p></w:body></w:document>'),
      'docProps/core.xml': strToU8('<cp:coreProperties><dc:creator>Analyst</dc:creator></cp:coreProperties>'),
    }));
    expect(inspectOfficecliAttribution(stamped)).toEqual({
      clean: false,
      entries: ['word/document.xml'],
    });
    expect(inspectOfficecliAttribution(stamped, { allowVisibleAttribution: true })).toEqual({
      clean: true,
      entries: [],
    });
  });

  it('checks Word comments for generator badges without blocking topical discussion', () => {
    const dir = makeTempDir();
    const stamped = join(dir, 'comment-attribution.docx');
    writeFileSync(stamped, zipSync({
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>OfficeCLI 调研</w:t></w:r></w:p></w:body></w:document>'),
      'word/comments.xml': strToU8('<w:comments><w:comment><w:p><w:r><w:t>使用OfficeCLI生成</w:t></w:r></w:p></w:comment></w:comments>'),
    }));
    expect(inspectOfficecliAttribution(stamped)).toEqual({
      clean: false,
      entries: ['word/comments.xml'],
    });
    expect(inspectOfficecliAttribution(stamped, { allowVisibleAttribution: true })).toEqual({
      clean: true,
      entries: [],
    });

    const topical = join(dir, 'comment-research.docx');
    writeFileSync(topical, zipSync({
      'word/comments.xml': strToU8('<w:comments><w:comment><w:p><w:r><w:t>本节介绍如何使用 OfficeCLI 生成文档</w:t></w:r></w:p></w:comment></w:comments>'),
    }));
    expect(inspectOfficecliAttribution(topical)).toEqual({ clean: true, entries: [] });
  });

  it('rejects field-level generator metadata and split-run footer watermarks', () => {
    const dir = makeTempDir();
    const stamped = join(dir, 'stamped.docx');
    writeFileSync(stamped, zipSync({
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>OfficeCLI 研究</w:t></w:r></w:p></w:body></w:document>'),
      'word/footer1.xml': strToU8('<w:ftr><w:p><w:r><w:t>本文档由 </w:t></w:r><w:r><w:t>OfficeCLI 自动生成</w:t></w:r></w:p></w:ftr>'),
      'docProps/core.xml': strToU8('<cp:coreProperties><dc:title>OfficeCLI 调研</dc:title><dc:creator>OfficeCLI/1.0</dc:creator></cp:coreProperties>'),
    }));
    expect(inspectOfficecliAttribution(stamped)).toEqual({
      clean: false,
      entries: ['docProps/core.xml', 'word/footer1.xml'],
    });
    expect(inspectOfficecliAttribution(stamped, { allowVisibleAttribution: true })).toEqual({
      clean: false,
      entries: ['docProps/core.xml'],
    });
    expect(inspectOfficecliAttribution(stamped, { allowMetadataAttribution: true })).toEqual({
      clean: false,
      entries: ['word/footer1.xml'],
    });
    expect(inspectOfficecliAttribution(stamped, {
      allowVisibleAttribution: true,
      allowMetadataAttribution: true,
    })).toEqual({ clean: true, entries: [] });
    expect(sanitizeOfficecliMetadata(stamped, { allowMetadataAttribution: true })).toEqual({ changed: false });
    expect(inspectOfficecliAttribution(stamped).entries).toContain('docProps/core.xml');
  });

  it('preserves restrictive document permissions while sanitizing metadata', () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const stamped = join(dir, 'private.docx');
    writeOfficeFixture(stamped, true);
    chmodSync(stamped, 0o600);
    expect(sanitizeOfficecliMetadata(stamped)).toEqual({ changed: true });
    expect(statSync(stamped).mode & 0o777).toBe(0o600);
  });

  it('scopes metadata permission to creator instead of all generator properties', () => {
    const dir = makeTempDir();
    const stamped = join(dir, 'creator-only.docx');
    writeOfficeFixture(stamped, true);
    expect(sanitizeOfficecliMetadata(stamped, { allowMetadataAttribution: true })).toEqual({ changed: true });
    expect(inspectOfficecliAttribution(stamped, { allowMetadataAttribution: true })).toEqual({
      clean: true,
      entries: [],
    });
    expect(inspectOfficecliAttribution(stamped)).toEqual({
      clean: false,
      entries: ['docProps/core.xml'],
    });
  });
});

describe('OfficeCLI per-file execution lock', () => {
  it('serializes work for the same normalized file', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = withOfficecliFileLock('/tmp/report.docx', async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = withOfficecliFileLock('/tmp/report.docx', async () => {
      order.push('second:start');
      order.push('second:end');
    });
    await Bun.sleep(10);
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('serializes hard-link aliases of the same Office file', async () => {
    const dir = makeTempDir();
    const original = join(dir, 'report.docx');
    const alias = join(dir, 'report-alias.docx');
    writeOfficeFixture(original);
    linkSync(original, alias);

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = withOfficecliFileLock(original, async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = withOfficecliFileLock(alias, async () => {
      order.push('second:start');
    });
    await Bun.sleep(10);
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('keeps the stable path locked across an atomic inode replacement', async () => {
    const dir = makeTempDir();
    const file = join(dir, 'report.docx');
    const replacement = join(dir, 'replacement.docx');
    writeOfficeFixture(file);

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = withOfficecliFileLock(file, async () => {
      order.push('first:start');
      writeOfficeFixture(replacement);
      renameSync(replacement, file);
      await firstGate;
      order.push('first:end');
    });
    await Bun.sleep(10);
    const second = withOfficecliFileLock(file, async () => {
      order.push('second:start');
    });
    await Bun.sleep(10);
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });
});

describe('OfficeCLI process runtime', () => {
  it('preserves UTF-8 characters split across stdout chunks', async () => {
    const dir = makeTempDir();
    const binary = join(dir, 'split-utf8');
    writeFileSync(binary, `#!/usr/bin/env node
const bytes = Buffer.from('中文输出', 'utf8');
process.stdout.write(bytes.subarray(0, 1));
setTimeout(() => process.stdout.end(bytes.subarray(1)), 5);
`);
    chmodSync(binary, 0o755);
    const result = await runOfficecli(binary, [], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('中文输出');
    expect(result.outputTruncated).toBe(false);
  });

  it('handles a fast process exit while stdin is still being delivered', async () => {
    const dir = makeTempDir();
    const binary = join(dir, 'fast-exit');
    writeFileSync(binary, '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(binary, 0o755);
    const result = await runOfficecli(binary, [], { cwd: dir, stdin: 'x'.repeat(1024 * 1024) });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    // The kernel may accept the entire payload into the pipe before the child
    // exits, so this race is intentionally not used as EPIPE evidence.
    expect(typeof result.stdinDeliveryFailed).toBe('boolean');
  });

  it('reports EPIPE when the child closes its stdin before request delivery', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const binary = join(dir, 'closed-stdin');
    writeFileSync(binary, '#!/bin/sh\nexec 0<&-\nsleep 0.2\nprintf "ok\\n"\n');
    chmodSync(binary, 0o755);
    const result = await runOfficecli(binary, [], { cwd: dir, stdin: 'x'.repeat(1024 * 1024) });
    expect(result.exitCode).toBe(0);
    expect(result.stdinDeliveryFailed).toBe(true);
    expect(result.stderr).toContain('EPIPE');
  });

  it('terminates the whole POSIX descendant tree on timeout', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const marker = join(dir, 'grandchild-survived');
    const binary = join(dir, 'process-tree');
    writeFileSync(binary, `#!/bin/sh
(sleep 0.4; printf survived > ${JSON.stringify(marker)}) &
sleep 10
`);
    chmodSync(binary, 0o755);
    const result = await runOfficecli(binary, [], { cwd: dir, timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    await Bun.sleep(600);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('handleOfficecliBatch', () => {
  it('blocks direct handler execution in Safe mode before spawning', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(
      { ...makeContext(dir, binary), permissionMode: 'safe' },
      { file: 'test.docx', operations: [{ command: 'get', path: '/' }] },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('blocked in Safe mode');
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });

  it('rejects unknown fields at handler runtime, not only in the published schema', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [{ command: 'get', path: '/', raw: true } as never],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid officecli_batch input');
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });

  it('requires create to run before a typed batch', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'missing.docx',
      operations: [{ command: 'add', parent: '/body', type: 'paragraph' }],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      commitStatus: 'not_started',
      errorType: 'preflight',
    });
    expect(result.content[0].text).toContain('officecli create');
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });

  it('rejects unsupported Office extensions before spawning', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeFileSync(join(dir, 'notes.txt'), 'not an Office document');
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'notes.txt',
      operations: [{ command: 'get', path: '/' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('file must be .docx');
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });

  it('passes JSON on stdin, uses atomic stop-on-error, and reports duration', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, '含 空格.docx'), true);
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: '含 空格.docx',
      operations: [{ command: 'add', parent: '/body', type: 'paragraph', props: { text: 'hello' } }],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      success: true,
      operationCount: 1,
      appliedCount: 1,
      rolledBack: false,
      commitStatus: 'committed',
      metadataSanitized: true,
    });
    expect(typeof result.structuredContent?.durationMs).toBe('number');
    expect(inspectOfficecliAttribution(join(dir, '含 空格.docx'))).toEqual({ clean: true, entries: [] });
    const call = JSON.parse((await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n')[0]!);
    expect(call.args[0]).toBe('batch');
    expect(call.args).toContain('--stop-on-error');
    expect(call.stdinBytes).toBeGreaterThan(0);
  });

  it('removes an unrequested standalone badge immediately after a committed typed batch', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const file = join(dir, 'badge.docx');
    writeFileSync(file, zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p></w:body></w:document>'),
    }));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'badge.docx',
      operations: [{ command: 'get', path: '/' }],
    });
    expect(result.structuredContent).toMatchObject({
      success: true,
      visibleBadgesRemoved: 1,
    });
    expect(inspectOfficecliAttribution(file)).toEqual({ clean: true, entries: [] });
  });

  it('reports atomic rollback and failedIndex', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph' },
        { command: 'set', path: '/body/p[1]', props: { fail: true } },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, appliedCount: 0, rolledBack: true, failedIndex: 1, errorType: 'officecli' });
  });

  it('restores style-preflight changes when OfficeCLI proves the batch rolled back', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const file = join(dir, 'test.docx');
    writeOfficeFixture(file);
    const original = readFileSync(file);
    const ctx = makeContext(dir, binary);
    ctx.officecli!.ensureDocxOutlineStyles = target => {
      writeFileSync(target, 'synthetic preflight mutation');
      return true;
    };
    const result = await handleOfficecliBatch(ctx, {
      file: 'test.docx',
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { style: 'Heading1' } },
        { command: 'set', path: '/missing', props: { fail: true } },
      ],
    });
    expect(result.structuredContent).toMatchObject({
      success: false,
      rolledBack: true,
      commitStatus: 'rolled_back',
    });
    expect(readFileSync(file).equals(original)).toBe(true);
  });

  it('marks a failed batch without rollback proof as commit_unknown', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { omitRollbackProof: true });
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [{ command: 'set', path: '/missing', props: { fail: true } }],
    });
    expect(result.structuredContent).toMatchObject({
      success: false,
      rolledBack: false,
      commitStatus: 'unknown',
      commitUnknown: true,
      errorType: 'commit_unknown',
    });
    expect(result.content[0].text).toContain('Do not retry automatically');
  });

  it('rejects an inconsistent success result count after stdin was delivered', async () => {
    const dir = makeTempDir();
    const binary = join(dir, 'fake-inconsistent-officecli');
    writeFileSync(binary, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ success: true, data: { results: [], summary: { succeeded: 1 } } }));
});
`);
    chmodSync(binary, 0o755);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [{ command: 'get', path: '/' }],
    });
    expect(result.structuredContent).toMatchObject({
      success: false,
      commitStatus: 'unknown',
      commitUnknown: true,
      errorType: 'commit_unknown',
    });
  });

  it('marks truncated batch output as commit_unknown and forbids blind retry', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { truncateBatchOutput: true });
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [{ command: 'add', parent: '/body', type: 'paragraph' }],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      rolledBack: false,
      commitUnknown: true,
      errorType: 'commit_unknown',
    });
    expect(result.content[0].text).toContain('Do not retry automatically');
  });

  it('runs style preflight once and rejects paths outside the working directory', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    let preflights = 0;
    const ctx = makeContext(dir, binary);
    ctx.officecli!.ensureDocxOutlineStyles = () => { preflights++; return true; };
    const result = await handleOfficecliBatch(ctx, {
      file: 'test.docx',
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { style: 'Heading1' } },
        { command: 'add', parent: '/body', type: 'paragraph', props: { style: 'Heading6' } },
        { command: 'add', parent: '/body', type: 'toc' },
      ],
    });
    expect(result.isError).toBe(false);
    expect(preflights).toBe(1);
    const escaped = await handleOfficecliBatch(ctx, { file: '../outside.docx', operations: [{ command: 'get', path: '/' }] });
    expect(escaped.isError).toBe(true);
  });

  it('reports a thrown style preflight as not_started instead of commit_unknown', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const ctx = makeContext(dir, binary);
    ctx.officecli!.ensureDocxOutlineStyles = () => { throw new Error('preflight crashed'); };
    const result = await handleOfficecliBatch(ctx, {
      file: 'test.docx',
      operations: [{ command: 'add', parent: '/body', type: 'paragraph', props: { style: 'Heading1' } }],
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      commitStatus: 'not_started',
      errorType: 'preflight',
    });
    expect(result.structuredContent?.commitUnknown).toBeUndefined();
    const cleanupCalls = (await Bun.file(join(dir, 'calls.jsonl')).text())
      .trim().split('\n').map(line => JSON.parse(line));
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]?.args[0]).toBe('close');
  });

  it('rejects payloads over 256KB before spawning', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliBatch(makeContext(dir, binary), {
      file: 'test.docx',
      operations: [{ command: 'add', parent: '/body', type: 'paragraph', props: { text: 'x'.repeat(257 * 1024) } }],
    });
    expect(result.isError).toBe(true);
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });
});

describe('handleOfficecliQa', () => {
  it('skips rendering and makes no visual claim for unknown image capability', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliQa(makeContext(dir, binary), { file: 'test.docx' });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({ structuralStatus: 'passed', visualStatus: 'skipped_no_vision', requiresHumanVisualReview: true });
    const calls = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(calls.some(call => call.args[2] === 'screenshot')).toBe(false);
  });

  it('returns exactly one image when vision is supported', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliQa(makeContext(dir, binary, true), { file: 'test.docx', mode: 'strict' });
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(result.structuredContent).toMatchObject({ visualStatus: 'checked', mode: 'strict' });
    const calls = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line));
    const screenshot = calls.find(call => call.args[2] === 'screenshot');
    expect(screenshot.args).toContain('--screenshot-width');
    expect(screenshot.args).toContain('2000');
  });

  it('never reports a failed render as visually checked', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { renderFails: true });
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliQa(makeContext(dir, binary, true), { file: 'test.docx' });
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({ visualStatus: 'render_failed', requiresHumanVisualReview: true, errorType: 'render_error' });
  });

  it('fails structural QA when the issues scan reports findings', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { issueCount: 2 });
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliQa(makeContext(dir, binary), { file: 'test.docx' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ structuralStatus: 'failed' });
    expect(result.content[0].text).toContain('2 issue(s) found; 1 high-severity');
  });

  it('does not treat an empty or corrupt screenshot as visually checked', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { corruptPng: true });
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliQa(makeContext(dir, binary, true), { file: 'test.docx' });
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({
      visualStatus: 'render_failed',
      requiresHumanVisualReview: true,
      errorType: 'render_error',
    });
  });

  it('keeps no-vision status truthful when structural QA throws before rendering', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeFileSync(join(dir, 'corrupt.docx'), 'not-an-openxml-package');
    const result = await handleOfficecliQa(makeContext(dir, binary, false), { file: 'corrupt.docx' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      structuralStatus: 'failed',
      visualStatus: 'skipped_no_vision',
      requiresHumanVisualReview: true,
      errorType: 'command_error',
    });
  });
});

describe('handleOfficecliFinalize', () => {
  it('is blocked in Safe mode before save or close starts', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    writeOfficeFixture(join(dir, 'test.docx'));
    const result = await handleOfficecliFinalize(
      { ...makeContext(dir, binary), permissionMode: 'safe' },
      { file: 'test.docx' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('blocked in Safe mode');
    expect(await Bun.file(join(dir, 'calls.jsonl')).exists()).toBe(false);
  });

  it('sanitizes unrequested badges and metadata, then saves and closes once', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const file = join(dir, 'test.docx');
    writeFileSync(file, zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p></w:body></w:document>'),
      'docProps/core.xml': strToU8('<cp:coreProperties><dc:creator>OfficeCLI</dc:creator></cp:coreProperties>'),
    }));
    const result = await handleOfficecliFinalize(makeContext(dir, binary), { file: 'test.docx' });
    expect(result.structuredContent).toMatchObject({
      success: true,
      saved: true,
      closed: true,
      attributionClean: true,
      metadataSanitized: true,
      visibleBadgesRemoved: 1,
    });
    expect(inspectOfficecliAttribution(file)).toEqual({ clean: true, entries: [] });
    const calls = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(call => call.args[0])).toEqual(['save', 'close']);
  });

  it('rejects an exit-zero save whose JSON envelope reports failure', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { saveEnvelopeFails: true });
    writeOfficeFixture(join(dir, 'test.docx'), true);
    const result = await handleOfficecliFinalize(makeContext(dir, binary), { file: 'test.docx' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      saved: false,
      closed: false,
      errorType: 'save',
    });
    const calls = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(call => call.args[0])).toEqual(['save']);
  });

  it('closes before sanitizing and leaves the package untouched when close is unconfirmed', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir, { closeEnvelopeFails: true });
    const file = join(dir, 'test.docx');
    writeOfficeFixture(file, true);
    const result = await handleOfficecliFinalize(makeContext(dir, binary), { file: 'test.docx' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      saved: true,
      closed: false,
      metadataSanitized: false,
      errorType: 'close',
    });
    expect(inspectOfficecliAttribution(file).clean).toBe(false);
    const calls = (await Bun.file(join(dir, 'calls.jsonl')).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(call => call.args[0])).toEqual(['save', 'close']);
  });

  it('preserves explicitly requested visible credit from trusted context only', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const file = join(dir, 'explicit.docx');
    writeFileSync(file, zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>本文档由 OfficeCLI 自动生成</w:t></w:r></w:p></w:body></w:document>'),
    }));
    const result = await handleOfficecliFinalize({
      ...makeContext(dir, binary),
      officecliAttributionPolicy: 'allow-visible',
    }, { file: 'explicit.docx' });
    expect(result.structuredContent).toMatchObject({
      success: true,
      attributionClean: true,
      visibleBadgesRemoved: 0,
    });
    expect(inspectOfficecliAttribution(file, { allowVisibleAttribution: true })).toEqual({ clean: true, entries: [] });
    expect(inspectOfficecliAttribution(file).clean).toBe(false);
  });

  it('preserves only explicitly requested creator metadata and strips other provenance', async () => {
    const dir = makeTempDir();
    const binary = makeFakeOfficecli(dir);
    const file = join(dir, 'explicit-metadata.docx');
    writeOfficeFixture(file, true);
    const result = await handleOfficecliFinalize({
      ...makeContext(dir, binary),
      officecliAttributionPolicy: 'allow-metadata',
    }, { file: 'explicit-metadata.docx' });
    expect(result.structuredContent).toMatchObject({ success: true, attributionClean: true });
    expect(inspectOfficecliAttribution(file, { allowMetadataAttribution: true }))
      .toEqual({ clean: true, entries: [] });
    expect(inspectOfficecliAttribution(file).entries).toEqual(['docProps/core.xml']);
    const archive = unzipSync(new Uint8Array(readFileSync(file)));
    expect(strFromU8(archive['docProps/core.xml']!)).toContain('<dc:creator>OfficeCLI</dc:creator>');
    expect(strFromU8(archive['docProps/core.xml']!)).not.toContain('<cp:lastModifiedBy>OfficeCLI</cp:lastModifiedBy>');
    expect(strFromU8(archive['docProps/app.xml']!)).not.toContain('OfficeCLI');
    expect(strFromU8(archive['docProps/custom.xml']!)).not.toContain('OfficeCLI.Version');
  });
});
