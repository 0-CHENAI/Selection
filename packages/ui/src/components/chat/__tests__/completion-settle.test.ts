import { expect, it } from 'bun:test'

it('waits for tail fades and retargeted growth, ignores infinite effects and cancels on cleanup', () => {
  const moduleUrl = new URL('../completion-settle.ts', import.meta.url).href
  const harness = String.raw`
    import assert from 'node:assert/strict';
    const { waitForResponseSettled } = await import(MODULE_URL);
    let now = 0, id = 0;
    const frames = new Map();
    globalThis.performance = { now: () => now };
    globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    function tick(time) {
      now = time;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(fn => fn(time));
    }
    function animation(endTime) {
      return { pending: false, playState: 'running', effect: { getComputedTiming: () => ({ endTime }) } };
    }
    let animations = [animation(800), animation(620)];
    const root = { getAnimations(options) { assert.equal(options.subtree, true); return animations; } };
    let ready = false;
    waitForResponseSettled(root, () => ready = true);
    tick(600); assert.equal(ready, false, '600ms is too early for the final line');
    animations[1].playState = 'finished';
    tick(800); assert.equal(ready, false);
    animations[0].playState = 'finished';
    tick(816); tick(900); assert.equal(ready, false, 'leave a visual gap after the tail');
    animations.push(animation(620));
    tick(920); tick(1000); assert.equal(ready, false, 'late growth restarts settling');
    animations[2].playState = 'finished';
    tick(1016); tick(1136); assert.equal(ready, true);

    ready = false; animations = [animation(Infinity)];
    waitForResponseSettled(root, () => ready = true);
    tick(1152); tick(1736); assert.equal(ready, true, 'embedded infinite animations must not block controls');
    ready = false; animations = [];
    const cancel = waitForResponseSettled(root, () => ready = true);
    cancel(); tick(3000); assert.equal(ready, false);
    waitForResponseSettled(null, () => ready = true);
    tick(3016); tick(3600); assert.equal(ready, true, 'no animation API still releases controls');
    ready = false; animations = [animation(10000)];
    waitForResponseSettled(root, () => ready = true);
    tick(6600); assert.equal(ready, true, 'unrelated long effects cannot block forever');
  `
  const result = Bun.spawnSync([process.execPath, '--eval', harness.replace('MODULE_URL', JSON.stringify(moduleUrl))], { stdout: 'pipe', stderr: 'pipe' })
  expect(new TextDecoder().decode(result.stderr)).toBe('')
  expect(result.exitCode).toBe(0)
})
