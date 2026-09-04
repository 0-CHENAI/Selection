/**
 * Captured Swarm delivery failures from #255 (glm-5.3-flash / Laufry).
 * Keep the original field names and tool-call shape; the body is representative
 * rather than the full 6k-character report.
 */
export const ISSUE_255_WRITE_UNDERSCORE_CONTENT = {
  path: '<dataFolderPath>/glm-5.3-research-report.md',
  _content: [
    '# 智谱 AI GLM-5.3 调研报告',
    '',
    'Captured Write arguments used `_content` instead of `content`.',
    'x'.repeat(200),
  ].join('\n'),
} as const;

export const ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL = {
  type: 'toolCall' as const,
  id: 'call-markdown-preview',
  name: 'markdown-preview',
  arguments: {
    src: '<dataFolderPath>/glm-5.3-research-report.md',
    title: '智谱 AI GLM-5.3 调研报告',
  },
};
