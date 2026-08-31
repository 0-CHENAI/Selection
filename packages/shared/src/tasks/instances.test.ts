import { describe, expect, it } from 'bun:test';
import { definitionId, instanceId, instanceIndex, interpolateLocals, parseForEach } from './instances.ts';

describe('task instances', () => {
  it('builds stable instance ids', () => {
    expect(instanceId('fan', 2)).toBe('fan#2');
    expect(definitionId('fan#2')).toBe('fan');
    expect(instanceIndex('fan#2')).toBe(2);
    expect(definitionId('plain')).toBe('plain');
  });

  it('interpolates map/loop locals', () => {
    expect(interpolateLocals('do ${item} #${index} was ${prev}', { item: 'x', index: 1, prev: 'p' })).toBe(
      'do x #1 was p',
    );
  });

  it('parses for_each JSON, newline lists, and scalars', () => {
    expect(parseForEach('["a","b"]')).toEqual(['a', 'b']);
    expect(parseForEach('a\nb')).toEqual(['a', 'b']);
    expect(parseForEach('solo')).toEqual(['solo']);
    expect(parseForEach('')).toEqual([]);
  });
});
