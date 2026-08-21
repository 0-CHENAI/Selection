import { describe, expect, it } from 'bun:test';
import {
  buildMorphCleanAccumulationCommands,
  buildMorphCloneCommands,
  buildMorphGhostCommands,
  checkMorphGhostAccumulation,
  verifyMorphSlide,
} from './office-recipes.ts';

function slide(options: {
  transition?: string;
  shapes?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    type: 'slide',
    format: { transition: options.transition },
    children: options.shapes ?? [],
  };
}

describe('validated Morph TypeScript recipes', () => {
  it('builds clone and ghost operations as atomic batch object strings', () => {
    expect(buildMorphCloneCommands(1, 2).map(command => JSON.parse(command))).toEqual([
      { command: 'add', parent: '/', from: '/slide[1]' },
      { command: 'set', path: '/slide[2]', props: { transition: 'morph' } },
    ]);
    expect(buildMorphGhostCommands(2, [7, 8, 7]).map(command => JSON.parse(command))).toEqual([
      { command: 'set', path: '/slide[2]/shape[7]', props: { x: '36cm' } },
      { command: 'set', path: '/slide[2]/shape[8]', props: { x: '36cm' } },
    ]);
    expect(() => buildMorphGhostCommands(0, [1])).toThrow('positive integer');
  });

  it('detects missing transitions, unghosted actors, and adjacent duplicate content', () => {
    const previous = slide({
      transition: 'morph',
      shapes: [{
        type: 'textbox', path: '/slide[1]/shape[1]', text: 'Repeated content',
        format: { name: '#s1-body', x: '2cm', y: '3cm' },
      }],
    });
    const current = slide({
      shapes: [{
        type: 'textbox', path: '/slide[2]/shape[1]', text: 'Repeated content',
        format: { name: '#s1-body', x: '2cm', y: '3cm' },
      }],
    });
    const result = verifyMorphSlide(current, previous, 1);

    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'missing_morph_transition',
      'unghosted_previous_content',
      'duplicate_adjacent_content',
    ]));
  });

  it('passes a correctly transitioned and ghosted slide', () => {
    const current = slide({
      transition: 'morph',
      shapes: [{
        type: 'textbox', path: '/slide[2]/shape[1]', text: 'Previous actor',
        format: { name: '#s1-body', x: '36cm', y: '3cm' },
      }],
    });
    expect(verifyMorphSlide(current, slide({ transition: 'morph' }), 1)).toEqual({ ok: true, issues: [] });
  });

  it('ignores persistent scene actors but still checks slide-scoped actors for duplicates', () => {
    const previous = slide({
      transition: 'morph',
      shapes: [
        { type: 'textbox', text: 'Persistent label', format: { name: '!!scene-ring', x: '2cm', y: '3cm' } },
        { type: 'textbox', text: 'Slide specific label', format: { name: '!!actor-s1-title', x: '4cm', y: '5cm' } },
      ],
    });
    const current = slide({
      transition: 'morph',
      shapes: [
        { type: 'textbox', text: 'Persistent label', format: { name: '!!scene-ring', x: '2cm', y: '3cm' } },
        { type: 'textbox', path: '/slide[2]/shape[2]', text: 'Slide specific label', format: { name: '!!actor-s1-title', x: '4cm', y: '5cm' } },
      ],
    });

    const result = verifyMorphSlide(current, previous, 1);

    expect(result.issues.filter(issue => issue.code === 'duplicate_adjacent_content')).toEqual([
      expect.objectContaining({ path: '/slide[2]/shape[2]' }),
    ]);
  });

  it('checks and cleans ghost accumulation using exact slide-scoped paths', () => {
    const results = Array.from({ length: 55 }, (_, index) => ({
      path: `/slide[${Math.floor(index / 5) + 1}]/shape[${index + 1}]`,
      format: { id: index + 1 },
    }));
    expect(checkMorphGhostAccumulation({ results }, 5)).toMatchObject({
      ok: false,
      issues: [{ code: 'ghost_accumulation' }],
    });
    const commands = buildMorphCleanAccumulationCommands({
      results: [...results, { path: '/not-slide/shape[99]' }],
    }, 50).map(command => JSON.parse(command));
    expect(commands).toHaveLength(5);
    expect(commands[0]).toEqual({ command: 'remove', path: results[50]?.path });
  });
});
