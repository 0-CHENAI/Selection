import { describe, expect, it } from 'bun:test';
import {
  extractYamlFromModelText,
  rememberSubmittedDefinition,
  resolveGeneratedYaml,
} from './submitted-definitions.ts';

describe('resolveGeneratedYaml', () => {
  it('prefers a structured submit_task_definition payload over fenced YAML', () => {
    rememberSubmittedDefinition('gen-1', 'id: from-tool\ntitle: T\ngoal: g\nnodes: []\n');
    const yaml = resolveGeneratedYaml(
      'gen-1',
      'Here is a draft:\n```yaml\nid: from-text\n```\n',
    );
    expect(yaml).toContain('from-tool');
    expect(resolveGeneratedYaml('gen-1', '```yaml\nid: leftover\n```')).toContain('leftover');
  });

  it('extracts fenced YAML when nothing was submitted', () => {
    expect(extractYamlFromModelText('```yaml\nid: fenced\n```')).toBe('id: fenced');
    expect(extractYamlFromModelText('id: bare')).toBe('id: bare');
  });
});
