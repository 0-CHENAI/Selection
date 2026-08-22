import { describe, expect, it } from 'bun:test'
import { pathToFileURL } from 'node:url'

describe('Photon runtime loading', () => {
  it('restores the exact fs.readFileSync reference after loading Photon', () => {
    const runtimeUrl = pathToFileURL(`${import.meta.dir}/photon-runtime.ts`).href
    const script = `
      const fs = require('node:fs');
      const original = fs.readFileSync;
      const { loadPhoton } = await import(${JSON.stringify(runtimeUrl)});
      await loadPhoton();
      console.log(original === fs.readFileSync ? 'restored' : 'changed');
    `
    const result = Bun.spawnSync({
      cmd: [process.execPath, '-e', script],
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe('restored')
  })
})
