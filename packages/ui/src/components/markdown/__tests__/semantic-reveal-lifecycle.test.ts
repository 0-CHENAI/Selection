import { describe, expect, it } from 'bun:test'

// Run module mocks in a disposable Bun process: mocking React in this test
// process would contaminate the real React/SSR tests beside this file.
const hookUrl = new URL('../useSemanticReveal.ts', import.meta.url).href
const harness = String.raw`
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
let refs = [], cursor = 0, layouts = [], effects = [];
mock.module('react', () => ({
  useRef(value) { const index = cursor++; return refs[index] ??= { current: value }; },
  useCallback: fn => fn,
  useLayoutEffect: fn => layouts.push(fn),
  useEffect: fn => effects.push(fn),
}));
const { useSemanticReveal } = await import(HOOK_URL);
function target() {
  const events = new Map();
  return {
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type) { events.get(type)?.forEach(fn => fn()); },
  };
}
const motion = Object.assign(target(), { matches: false });
const win = Object.assign(target(), {
  innerHeight: 800, matchMedia: () => motion, getSelection: () => null,
  getComputedStyle: () => ({ lineHeight: '22px' }),
});
globalThis.window = win;
globalThis.document = target();
let reads = 0, animations = [], operations = [];
function unit(top = 0) {
  return {
    parentElement: null,
    getBoundingClientRect() { reads++; operations.push('read'); return { top, bottom: top + 22, height: 22 }; },
    animate() { operations.push('write'); const animation = { cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; },
  };
}
function mount(identity, { streaming = false, start = Date.now(), count = 1, top = 0 } = {}) {
  refs = []; cursor = 0; layouts = []; effects = [];
  const units = Array.from({ length: count }, () => unit(top));
  const root = { current: Object.assign(target(), { querySelectorAll: () => units, contains: () => false }) };
  useSemanticReveal(root, 'complete source', start, streaming, identity);
  const setups = [...layouts, ...effects];
  let cleanups = setups.map(fn => fn());
  return {
    strictReplay() { cleanups.forEach(fn => fn?.()); cleanups = setups.map(fn => fn()); },
    unmount() { cleanups.forEach(fn => fn?.()); },
  };
}
const first = mount('strict');
assert.equal(animations.length, 1);
first.strictReplay();
assert.equal(animations.length, 2, 'StrictMode setup must restart cosmetic animation');
assert.equal(animations[0].cancelled, true);
assert.equal(animations[1].cancelled, false);
first.unmount();
assert.equal(animations[1].cancelled, true, 'unmount cancels WAAPI');
let before = animations.length;
mount('strict').unmount();
assert.equal(animations.length, before, 'same identity remount must not replay');
mount('history', { start: 1 }).unmount();
assert.equal(animations.length, before, 'historical reply must not animate');
motion.matches = true;
mount('reduced').unmount();
assert.equal(animations.length, before, 'initial reduced motion must not animate');
motion.matches = false;
const changingMotion = mount('motion-change');
motion.matches = true; motion.emit('change');
assert.equal(animations.at(-1).cancelled, true, 'dynamic reduced motion cancels active animation');
changingMotion.unmount(); motion.matches = false;
const navigating = mount('navigation');
win.emit('wheel');
assert.equal(animations.at(-1).cancelled, true, 'manual wheel cancels active animation');
navigating.unmount();
reads = 0; operations = []; before = animations.length;
mount('large', { count: 1000 }).unmount();
assert.ok(reads <= 32, 'geometry reads must be bounded');
assert.ok(animations.length - before <= 32, 'animation fanout must be bounded');
const firstWrite = operations.indexOf('write');
assert.ok(firstWrite >= 0);
assert.equal(operations.slice(firstWrite).includes('read'), false, 'all geometry reads precede animation writes');
before = animations.length;
mount('offscreen', { top: 2000 }).unmount();
assert.equal(animations.length, before, 'offscreen units must not animate');
console.log('lifecycle assertions passed');
`

describe('semantic reveal lifecycle (isolated hook harness)', () => {
  it('preserves replay, cancellation, motion and bounded-layout contracts', () => {
    const result = Bun.spawnSync([process.execPath, '--eval', harness.replace('HOOK_URL', JSON.stringify(hookUrl))], {
      stdout: 'pipe', stderr: 'pipe',
    })
    expect(new TextDecoder().decode(result.stderr)).toBe('')
    expect(result.exitCode).toBe(0)
    expect(new TextDecoder().decode(result.stdout)).toContain('lifecycle assertions passed')
  })
})
