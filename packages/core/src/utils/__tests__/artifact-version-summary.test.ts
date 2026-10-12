import { expect, test } from 'bun:test';
import { compactArtifactVersionSummary } from '../artifact-version-summary';

test('keeps concise version descriptions complete', () => {
  expect(compactArtifactVersionSummary('hello 改为三段约200字文章')).toBe('hello 改为三段约200字文章');
  const thirty = '文'.repeat(30);
  expect(compactArtifactVersionSummary(thirty)).toBe(thirty);
});

test('keeps the change instead of long parenthetical layout details', () => {
  const summary = '已将正文三段散文替换为七言绝句《山行即事》（标题居中加粗，四句两两分行居中排版），其余结构与格式保持不变，文件校验通过。';
  expect(compactArtifactVersionSummary(summary)).toBe('已将正文三段散文替换为七言绝句《山行即事》');
  expect(compactArtifactVersionSummary('已将正文三段散文替换为七言绝句《山行即事》（标题居中加粗，四句两两分行居中排…'))
    .toBe('已将正文三段散文替换为七言绝句《山行即事》');
});

test('prefers a complete change clause and adds no ellipsis', () => {
  expect(compactArtifactVersionSummary('修复目录分页并统一表格格式，保留其他章节内容，并完成文件格式验证和成果版本保存'))
    .toBe('修复目录分页并统一表格格式');
});

test('enforces the character limit for long unbroken Chinese and emoji titles', () => {
  for (const input of ['文'.repeat(40), '📄'.repeat(40)]) {
    const summary = compactArtifactVersionSummary(input);
    expect(Array.from(summary)).toHaveLength(30);
    expect(summary).not.toContain('…');
    expect(summary).not.toContain('\uFFFD');
  }
});

test('keeps Latin words intact', () => {
  expect(compactArtifactVersionSummary('Update document formatting and pagination throughout the report'))
    .toBe('Update document formatting and');
});
