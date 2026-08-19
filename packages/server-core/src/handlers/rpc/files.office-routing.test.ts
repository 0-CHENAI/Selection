import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('Office attachment storage routing', () => {
  const source = readFileSync(new URL('./files.ts', import.meta.url), 'utf8');

  it('stores the original Office file without eagerly generating a Markdown sidecar', () => {
    expect(source).not.toContain("from 'markitdown-js'");
    expect(source).not.toContain('new MarkItDown()');
    expect(source).not.toContain('Converted Office file to markdown');
    expect(source).toContain('agent can invoke markitdown against storedPath on demand');
    expect(source).toContain("if (attachment.type === 'image') {");
    expect(source).toContain('PDFs and Office files use');
  });
});
