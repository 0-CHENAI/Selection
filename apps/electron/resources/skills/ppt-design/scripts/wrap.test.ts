import { describe, expect, test } from 'bun:test';
import { tokenizeHeading, wrapHeading } from './wrap';

describe('Chinese heading wrap', () => {
  test('keeps 街区 together instead of leaving 区 alone', () => {
    const title = '把城市热岛变成清凉街区';
    expect(tokenizeHeading(title)).toContain('街区');
    const wrapped = wrapHeading(title, 8.4, 42);
    expect(wrapped).toContain('\n');
    expect(wrapped.split('\n').some(line => line === '区')).toBe(false);
    expect(wrapped.endsWith('街区') || wrapped.split('\n').some(line => line.includes('街区'))).toBe(true);
  });

  test('does not wrap a short title that already fits', () => {
    expect(wrapHeading('清凉街区', 20, 34)).toBe('清凉街区');
  });

  test('steals a lone last CJK character onto the previous wrap', () => {
    const wrapped = wrapHeading('把诊断变成一条可走的路线', 6.2, 34);
    const last = wrapped.split('\n').at(-1) ?? '';
    expect([...last].length).toBeGreaterThanOrEqual(2);
  });

  test('does not break KEEP compounds when repairing an orphan', () => {
    const wrapped = wrapHeading('Selection · 设计系统例', 9.5, 22);
    expect(wrapped.includes('系\n统') || wrapped.split('\n').some(line => line.startsWith('统'))).toBe(false);
    expect(wrapped.includes('系统') || !wrapped.includes('\n')).toBe(true);
  });
});
