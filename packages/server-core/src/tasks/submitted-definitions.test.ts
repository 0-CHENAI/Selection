import { describe, expect, it } from 'bun:test';
import {
  extractYamlFromModelText,
  rememberSubmittedDefinition,
  resolveGeneratedYaml,
  validateSubmittedDefinition,
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

  it('rejects unknown v2 fields before permissive schema parsing can strip them', () => {
    const invalid = validateSubmittedDefinition({
      id: 'strict',
      title: 'Strict',
      goal: 'g',
      token_buget: 100,
      nodes: [{ id: 'work', prompt: 'work' }],
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) expect(invalid.errors.join('\n')).toContain('token_buget');

    const valid = validateSubmittedDefinition({
      id: 'strict',
      title: 'Strict',
      goal: 'g',
      token_budget: 100,
      nodes: [{ id: 'work', prompt: 'work' }],
    });
    expect(valid.valid).toBe(true);
    if (valid.valid) expect(valid.yaml).toContain('schema_version: 2');
  });
});
