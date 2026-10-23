import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDeck } from './export-pptx';
import { buildSwissSignalDeck } from './library/swiss-signal';
import { validateOutputPath } from './paths';

const trash: string[] = [];

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  trash.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('pptx export and path safety', () => {
  test('refuses overwrite and symlink escape after realpath', () => {
    const dir = scratch('ppt-deck-path-');
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'outside'));
    symlinkSync(join(dir, 'outside'), join(dir, 'data', 'escape'));
    expect(() => validateOutputPath(join(dir, 'data'), join(dir, 'data', 'escape', 'deck.pptx'), '.pptx')).toThrow('inside');
    writeFileSync(join(dir, 'data', 'exists.pptx'), 'existing');
    expect(() => validateOutputPath(join(dir, 'data'), join(dir, 'data', 'exists.pptx'), '.pptx')).toThrow('overwrite');
    expect(validateOutputPath(join(dir, 'data'), join(dir, 'data', 'new.pptx'), '.pptx')).toBe(join(dir, 'data', 'new.pptx'));
  });

  test('render refuses a failing deck and writes an editable pptx for a clean one', async () => {
    const dir = scratch('ppt-deck-export-');
    const broken = structuredClone(buildSwissSignalDeck());
    broken.pages[0].elements.push({
      id: 'overflow',
      type: 'text',
      bounds: [2000, 20, 40, 20],
      text: 'overflow',
      textCapacity: { maxLines: 1, maxCharsPerLine: 20 },
    });
    const rejected = await renderDeck(broken, join(dir, 'bad.pptx'), dir);
    expect(rejected.outcome).toBe('needs_revision');

    const ok = await renderDeck(buildSwissSignalDeck(), join(dir, 'deck.pptx'), dir);
    expect(ok.outcome).toBe('GENERATED_UNREVIEWED');
    if (ok.outcome !== 'GENERATED_UNREVIEWED') throw new Error('expected pptx');
    const packed = readFileSync(ok.path).toString('latin1');
    expect(packed.includes('ppt/slides/slide')).toBe(true);
    expect(packed.includes('chart')).toBe(true);
    expect(packed.includes('从投放获客') || packed.includes('a:t')).toBe(true);
  });
});
