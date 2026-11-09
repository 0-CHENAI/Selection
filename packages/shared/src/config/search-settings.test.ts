import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('search settings persistence', () => {
  it('keeps existing configuration, persists order and rejects invalid updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-search-settings-'));
    try {
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, sentinel: 'preserved' }));
      const storagePath = join(import.meta.dir, 'storage.ts');
      const program = `
        import { getSearchSettings, setSearchSettings } from ${JSON.stringify(storagePath)};
        if (getSearchSettings() !== null) throw new Error('legacy config must remain unset');
        setSearchSettings({providers:[{id:'exa',enabled:true},{id:'native',enabled:false}]});
        try { setSearchSettings({providers:[{id:'exa',enabled:true},{id:'exa',enabled:false}]}); throw new Error('accepted invalid settings'); }
        catch (error) { if (error.message === 'accepted invalid settings') throw error; }
        if (getSearchSettings()?.providers[0]?.id !== 'exa') throw new Error('order was not persisted');
      `;
      const result = Bun.spawnSync(['bun', '-e', program], { env: { ...process.env, CRAFT_CONFIG_DIR: dir } });
      expect(result.exitCode).toBe(0);
      const saved = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
      expect(saved.sentinel).toBe('preserved');
      expect(saved.searchSettings.providers.slice(0, 2)).toEqual([{ id: 'exa', enabled: true }, { id: 'native', enabled: false }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
