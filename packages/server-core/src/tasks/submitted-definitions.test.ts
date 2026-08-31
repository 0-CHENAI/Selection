import { describe, expect, it } from 'bun:test';
import {
  extractYamlFromModelText,
  rememberSubmittedDefinition,
  resolveGeneratedYaml,
  validateSubmittedDefinition,
} from './submitted-definitions.ts';

describe('resolveGeneratedYaml', () => {
  it('prefers a structured submit_task_definition payload over fenced YAML', () => {
    rememberSubmittedDefinition('gen-1', 7, 'id: from-tool\ntitle: T\ngoal: g\nnodes: []\n');
    const yaml = resolveGeneratedYaml(
      'gen-1',
      7,
      'Here is a draft:\n```yaml\nschema_version: 2\nid: from-text\n```\n',
    );
    expect(yaml).toContain('from-tool');
    expect(() => resolveGeneratedYaml('gen-1', 8, '```yaml\nid: legacy-leftover\n```')).toThrow('current generation');
  });

  it('keeps final-text YAML fallback for v1 and historical definitions only', () => {
    expect(extractYamlFromModelText('```yaml\nid: fenced\n```')).toBe('id: fenced');
    expect(extractYamlFromModelText('id: bare')).toBe('id: bare');
    expect(resolveGeneratedYaml('legacy-fenced', 1, '```yaml\nid: fenced\n```', { allowLegacyFallback: true })).toBe('id: fenced');
    expect(resolveGeneratedYaml('legacy-v1', 1, 'schema_version: 1\nid: old', { allowLegacyFallback: true })).toContain('schema_version: 1');
    expect(() => resolveGeneratedYaml('new-v1', 1, 'schema_version: 1\nid: old')).toThrow('current generation');
  });

  it('rejects a v2 definition found only in final text', () => {
    expect(() => resolveGeneratedYaml(
      'text-v2',
      1,
      '```yaml\nschema_version: 2\nid: pasted\ntitle: Pasted\ngoal: g\nnodes:\n  - id: work\n    prompt: work\n```',
      { allowLegacyFallback: true },
    )).toThrow('must be submitted with submit_task_definition');
  });

  it('binds pending definitions to one session generation', () => {
    rememberSubmittedDefinition('generation-bound', 3, 'schema_version: 2\nid: old');
    expect(() => resolveGeneratedYaml('generation-bound', 4, '')).toThrow('current generation');
    expect(resolveGeneratedYaml('generation-bound', 3, '')).toContain('id: old');
  });

  it('rejects unknown v2 fields before permissive schema parsing can strip them', () => {
    const invalid = validateSubmittedDefinition({
      schema_version: 2,
      id: 'strict',
      title: 'Strict',
      goal: 'g',
      token_buget: 100,
      nodes: [{ id: 'work', prompt: 'work' }],
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) expect(invalid.errors.join('\n')).toContain('token_buget');

    const valid = validateSubmittedDefinition({
      schema_version: 2,
      id: 'strict',
      title: 'Strict',
      goal: 'g',
      token_budget: 100,
      nodes: [{ id: 'work', prompt: 'work' }],
    });
    expect(valid.valid).toBe(true);
    if (valid.valid) expect(valid.yaml).toContain('schema_version: 2');
  });

  it('requires an explicit numeric schema_version 2 in structured submissions', () => {
    const base = { id: 'strict', title: 'Strict', goal: 'g', nodes: [{ id: 'work', prompt: 'work' }] };
    expect(validateSubmittedDefinition(base).valid).toBe(false);
    expect(validateSubmittedDefinition({ ...base, schema_version: 1 }).valid).toBe(false);
    expect(validateSubmittedDefinition({ ...base, schema_version: '2' }).valid).toBe(false);
    expect(validateSubmittedDefinition({ ...base, schema_version: 2 }).valid).toBe(true);
  });

  it('rejects the legacy type alias in v2 even when kind is also present', () => {
    const result = validateSubmittedDefinition({
      schema_version: 2,
      id: 'kind-conflict',
      title: 'Kind conflict',
      goal: 'g',
      nodes: [{ id: 'work', kind: 'session', type: 'approval', prompt: 'work' }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join('\n')).toContain('type');
  });
});
