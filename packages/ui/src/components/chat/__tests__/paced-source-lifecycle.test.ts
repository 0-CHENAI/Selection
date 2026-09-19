import { expect, it } from 'bun:test'

// A disposable hook scheduler verifies timing without process-wide React mocks.
const harness = String.raw`
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
let clock=0, next=0, reduced=false, active, frames=new Map(), listeners=new Set();
globalThis.window={matchMedia:()=>({get matches(){return reduced},addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)})};
globalThis.performance={now:()=>clock};
globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
function effect(fn,deps){const c=active,i=c.index++,old=c.hooks[i];if(!old||!equal(old.deps,deps)){c.pending.push(()=>{old?.cleanup?.();c.hooks[i]={deps,cleanup:fn()}})}}
mock.module('react',()=>({
  useRef:value=>{const c=active,i=c.index++;return c.hooks[i]??(c.hooks[i]={current:value})},
  useState:value=>{const c=active,i=c.index++;if(!(i in c.hooks))c.hooks[i]=typeof value==='function'?value():value;return [c.hooks[i],v=>{const n=typeof v==='function'?v(c.hooks[i]):v;if(!Object.is(n,c.hooks[i])){c.hooks[i]=n;c.dirty=true}}]},
  useMemo:(fn,deps)=>{const c=active,i=c.index++;if(!c.hooks[i]||!equal(c.hooks[i].deps,deps))c.hooks[i]={deps,value:fn()};return c.hooks[i].value},
  useEffect:effect,useLayoutEffect:effect,
}));
const {usePacedSource}=await import(MODULE_URL);
function mount(props){const c={hooks:[],pending:[],index:0,dirty:true,props};c.render=()=>{do{active=c;c.index=0;c.dirty=false;c.result=usePacedSource(...c.props);const jobs=c.pending.splice(0);jobs.forEach(fn=>fn())}while(c.dirty)};c.render();return c}
function step(c,ms=32){clock+=ms;const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn(clock));if(c.dirty)c.render()}
function update(c,props){c.props=props;c.render()}
function unmount(c){c.hooks.forEach(h=>h?.cleanup?.())}
const text='中🙂hello '.repeat(200);
const burst=mount([text,true,undefined,'burst']);
assert.equal(burst.result.text,'');step(burst);
assert.ok(burst.result.text.length>0&&burst.result.text.length<text.length);
const before=burst.result.text;
update(burst,[text,false,Date.now(),'burst']);
assert.equal(burst.result.text,before,'completion cannot flush the visual queue');
for(let i=0;i<80;i++)step(burst);
assert.equal(burst.result.text,text);assert.equal(burst.result.revealing,false);
unmount(burst);
const remount=mount([text,false,Date.now(),'burst']);assert.equal(remount.result.text,text);unmount(remount);
const history=mount([text,false,undefined,'history']);assert.equal(history.result.text,text);unmount(history);
const completedBurst=mount([text,false,Date.now(),'completed-burst']);assert.equal(completedBurst.result.text,'');step(completedBurst);assert.ok(completedBurst.result.text.length>0&&completedBurst.result.text.length<text.length);unmount(completedBurst);
const fast=mount(['a'.repeat(30),true,undefined,'fast']);
for(let i=0;i<20;i++){update(fast,['a'.repeat(30+i*5),true,undefined,'fast']);step(fast,16)}
assert.ok(fast.result.text.length>0,'frequent tokens must not starve the animation frame');
for(let i=0;i<80;i++)step(fast);
const settled=fast.result.text;clock+=10000;
update(fast,[settled+'b'.repeat(1000),true,undefined,'fast']);step(fast);
assert.ok(fast.result.text.length<settled.length+1000,'a burst after an idle gap must still be paced');
update(fast,['corrected',false,Date.now(),'fast']);assert.equal(fast.result.text,'corrected');unmount(fast);
const motion=mount([text,true,undefined,'motion']);step(motion);reduced=true;listeners.forEach(fn=>fn());motion.render();assert.equal(motion.result.text,text);unmount(motion);
const reducedMount=mount([text,true,undefined,'reduced']);assert.equal(reducedMount.result.text,text);unmount(reducedMount);
assert.equal(frames.size,0,'unmount must cancel scheduled frames');
console.log('paced lifecycle passed');
`

it('paces live bursts and fast deltas through completion, preserves history and respects reduced motion', () => {
  const url = new URL('../usePacedSource.ts', import.meta.url).href
  const result = Bun.spawnSync([process.execPath, '--eval', harness.replace('MODULE_URL', JSON.stringify(url))], { stdout: 'pipe', stderr: 'pipe' })
  expect(new TextDecoder().decode(result.stderr)).toBe('')
  expect(result.exitCode).toBe(0)
})
