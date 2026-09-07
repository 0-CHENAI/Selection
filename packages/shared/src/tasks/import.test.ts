import { describe, expect, it } from 'bun:test';
import { parseTaskDocument, parseTaskImport } from './document.ts';

const yaml = `schema_version: 3
id: imported
title: Imported task
goal: Answer the question
nodes:
  - id: answer
    prompt: Answer the question
`;

describe('V3 YAML import boundary', () => {
  it('rejects oversized UTF-8 input before parsing', () => {
    const result = parseTaskImport(yaml + '# ' + '中'.repeat(400000));
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('yaml');
  });
  it('accepts V3 and defaults the runner to conduct', () => {
    const result = parseTaskImport(yaml);
    expect(result.valid).toBe(true);
    expect(result.spec?.schema_version).toBe(3);
    expect(result.spec?.runner).toBe('conduct');
  });
  it('rejects missing, legacy, string and unsupported versions', () => {
    for (const version of ['', 'schema_version: 1\n', 'schema_version: 2\n', 'schema_version: "3"\n', 'schema_version: 4\n']) {
      expect(parseTaskImport(version + yaml.split('\n').slice(1).join('\n')).valid).toBe(false);
    }
  });
  it('retains legacy read compatibility', () => {
    expect(parseTaskDocument(yaml.replace('schema_version: 3\n', '')).valid).toBe(true);
    expect(parseTaskDocument(yaml.replace('schema_version: 3', 'schema_version: 2')).valid).toBe(true);
  });
  it('rejects invalid YAML, unknown fields, dependencies and runners', () => {
    for (const invalid of ['[', '[]', 'null', yaml + 'typo: true\n', yaml.replace('    prompt:', '    depends_on: [missing]\n    prompt:'), yaml + 'runner: invalid\n']) {
      expect(parseTaskImport(invalid).valid).toBe(false);
    }
  });
});
