import { expect, it } from 'bun:test';
import { runInNewContext } from 'node:vm';

it('honors the workbench build switch in a browser without process.env', async () => {
  for (const setting of ['1', '0', '']) {
    const result = await Bun.build({ entrypoints: [new URL('../feature-flags.ts', import.meta.url).pathname],
      target: 'browser', format: 'cjs', define: { __CRAFT_THOUGHT_WORKBENCH__: JSON.stringify(setting) } });
    expect(result.success).toBe(true);
    const module = { exports: {} as { isThoughtWorkbenchEnabled(): boolean } };
    runInNewContext(await result.outputs[0]!.text(), { module, exports: module.exports });
    expect(module.exports.isThoughtWorkbenchEnabled()).toBe(setting === '1');
  }
});
