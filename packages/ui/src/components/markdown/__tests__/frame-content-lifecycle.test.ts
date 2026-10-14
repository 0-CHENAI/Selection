import { expect, it } from 'bun:test'

// Run the hook scheduler in a disposable process, without leaking React mocks
// into neighboring real-renderer tests. A render can be discarded before its
// layout effects commit, just as with a suspended concurrent update.
const harness = String.raw`
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
let active, next=0;
const frames=new Map();
globalThis.window={};
globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
function effect(fn,deps){const c=active,i=c.index++,old=c.hooks[i];if(!old||!equal(old.deps,deps)){c.pending.push(()=>{old?.cleanup?.();c.hooks[i]={deps,cleanup:fn()}})}}
mock.module('react',()=>({
 useRef:value=>{const c=active,i=c.index++;return c.hooks[i]??(c.hooks[i]={current:value})},
 useState:value=>{const c=active,i=c.index++;if(!(i in c.hooks))c.hooks[i]=value;return[c.hooks[i],v=>{c.hooks[i]=v;c.dirty=true}]},
 useLayoutEffect:effect,useEffect:effect,
}));
const {useFrameContent}=await import(MODULE_URL);
const c={hooks:[],pending:[],index:0,dirty:false,props:['原文',true,'one']};
function render(props=c.props,commit=true){active=c;c.index=0;c.dirty=false;const result=useFrameContent(...props);if(commit){c.props=props;c.result=result;const jobs=c.pending.splice(0);jobs.forEach(fn=>fn());if(c.dirty)render()}else c.pending=[];return result}
function step(){const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn(16));if(c.dirty)render()}
render();
render(['原文已收到',true,'one']);
assert.equal(c.result,'原文');
assert.equal(frames.size,1);
render(['原文已收到但未提交',true,'one'],false);
step();
assert.equal(c.result,'原文已收到','a pending frame must never publish an abandoned render');
render(['原文已收到新增',true,'one']);
render(['另一条消息',true,'two'],false);
step();
assert.equal(c.result,'原文已收到新增','a speculative identity switch cannot contaminate the committed stream');
render(['原文已收到新增尾部',true,'one']);
render(['最终正文',false,'one']);
assert.equal(c.result,'最终正文');
assert.equal(frames.size,0,'completion cancels pending appends');
render(['新消息',true,'two']);
assert.equal(c.result,'新消息');
render(['新消息追加',true,'two']);
c.hooks.forEach(h=>h?.cleanup?.());
assert.equal(frames.size,0,'unmount cancels the pending frame');
console.log('frame lifecycle passed');
`

it('coalesces committed appends without publishing discarded renders, and flushes completion', () => {
  const url = new URL('../useFrameContent.ts', import.meta.url).href
  const result = Bun.spawnSync([process.execPath, '--eval', harness.replace('MODULE_URL', JSON.stringify(url))], { stdout: 'pipe', stderr: 'pipe' })
  expect(new TextDecoder().decode(result.stderr)).toBe('')
  expect(result.exitCode).toBe(0)
  expect(new TextDecoder().decode(result.stdout)).toContain('frame lifecycle passed')
})
