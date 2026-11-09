import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('search provider credentials', () => {
  it('keeps keys isolated, encrypted, and compatible with the legacy AnySearch key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-search-credentials-'));
    try {
      const managerPath = join(import.meta.dir, 'manager.ts');
      const program = `
        import { CredentialManager } from ${JSON.stringify(managerPath)};
        const manager = new CredentialManager();
        await manager.setAnySearchApiKey('legacy-key');
        await manager.setSearchProviderApiKey('exa', 'exa-key');
        await manager.setSearchProviderApiKey('tavily', 'tavily-key');
        if (await manager.getSearchProviderApiKey('anysearch') !== 'legacy-key') throw new Error('legacy key missing');
        if (await manager.getSearchProviderApiKey('exa') !== 'exa-key') throw new Error('wrong Exa key');
        await manager.setSearchProviderApiKey('exa', '');
        if (await manager.getSearchProviderApiKey('exa') !== null || await manager.getSearchProviderApiKey('tavily') !== 'tavily-key') throw new Error('keys are not isolated');
      `;
      const result = Bun.spawnSync(['bun', '-e', program], { env: { ...process.env, CRAFT_CONFIG_DIR: dir } });
      expect(result.exitCode).toBe(0);
      const ciphertext = readFileSync(join(dir, 'credentials.enc'));
      expect(ciphertext.includes(Buffer.from('tavily-key'))).toBe(false);
      expect(ciphertext.includes(Buffer.from('legacy-key'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
