import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

it('exports workbench modules used across package boundaries', () => {
  const root = resolve(import.meta.dir, '../../../..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'packages/shared/package.json'), 'utf8'));
  for (const file of [
    'apps/electron/src/renderer/components/app-shell/kanban/ThoughtCanvas.tsx',
    'packages/server-core/src/handlers/rpc/thought-workbench.ts',
  ]) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const match of source.matchAll(/@craft-agent\/shared\/(thought-workbench\/[a-z-]+)/g)) {
      const exported = manifest.exports[`./${match[1]}`];
      expect(typeof exported).toBe('string');
      expect(readFileSync(resolve(root, 'packages/shared', exported), 'utf8').length).toBeGreaterThan(0);
    }
  }
});

it('ships the pinned MIT notice on every desktop platform', () => {
  const electron = resolve(import.meta.dir, '../../../../apps/electron');
  const config = parse(readFileSync(resolve(electron, 'electron-builder.yml'), 'utf8'));
  for (const platform of ['mac', 'win', 'linux']) {
    const notice = config[platform].extraResources.find((entry: { to: string }) => entry.to === 'third-party/ThoughtDAG-NOTICE.txt');
    expect(notice).toBeDefined();
    const content = readFileSync(resolve(electron, notice.from), 'utf8');
    expect(content).toContain('ef04210f6106a0dbc30f353cf67b25bee47d769c');
    expect(content).toContain('Copyright (c) 2026 Xia Chen');
    expect(content).toContain('Permission is hereby granted, free of charge');
    expect(content).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  }
});
