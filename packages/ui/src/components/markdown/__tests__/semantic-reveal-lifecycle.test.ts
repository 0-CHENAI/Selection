import { describe, expect, it } from 'bun:test'

const moduleUrl = new URL('../semantic-reveal.ts', import.meta.url).href
// DOM/controller tests run in a disposable process so browser globals cannot
// contaminate the neighboring real React/SSR tests.
const harness = String.raw`
import assert from 'node:assert/strict';
const { createSemanticReveal, appendedRevealInset, SEMANTIC_REVEAL_MAX_MS, SEMANTIC_REVEAL_MS, SEMANTIC_REVEAL_EASING, semanticRevealFrames } = await import(MODULE_URL);
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { listeners.get(type)?.forEach(fn => fn()); },
  };
}
const motion = Object.assign(events(), {matches:false});
globalThis.window = Object.assign(events(), {innerHeight:800, matchMedia:()=>motion, getSelection:()=>null});
globalThis.document = events();
globalThis.getComputedStyle = () => ({overflowY:'visible',getPropertyValue:()=>''});
let reads=0, animations=[], operations=[];
function unit(text='first', height=22) {
  const el = {textContent:text, height, top:0, width:600, parentElement:null, style:{clipPath:''},
    classList: { add() {}, remove() {} },
    getBoundingClientRect() { reads++; operations.push('read'); return {top:this.top,bottom:this.top+this.height,height:this.height,width:this.width}; },
    animate(frames, options) { operations.push('write'); const a={frames, options, cancelled:false,cancel(){this.cancelled=true}}; animations.push(a); return a; },
  };return el;
}
let units=[unit()];
const root=Object.assign(events(), {parentElement:null,querySelectorAll:()=>units,contains:el=>units.includes(el)});
const c=createSemanticReveal(root,true);
c.update(true,true);
assert.equal(animations.length,1);
const first=units[0];
first.textContent+=' tail';
c.update(true,true);
assert.equal(animations.length,1,'growth within a line must not fade the old line');
first.textContent+=' next line'; first.height=44;
c.update(true,true);
assert.equal(animations.length,1,'growing paragraphs must not animate again');
window.emit('keydown');
units.push(unit('new paragraph'));
c.update(true,true);
assert.equal(animations.length,2,'ordinary keys cannot disable future paragraphs');
assert.deepEqual(animations[1].frames, semanticRevealFrames());
assert.equal(animations[1].options.duration, SEMANTIC_REVEAL_MS);
assert.equal(animations[1].options.easing, SEMANTIC_REVEAL_EASING);
assert.ok(!('transform' in animations[1].frames[0]), 'new paragraphs fade in place; they must not lift');
assert.ok(!('filter' in animations[1].frames[0]), 'default fades must not create filter layers');
assert.equal(semanticRevealFrames('1px')[0].filter, 'blur(1px)', 'blur remains opt-in');
reads=0;
first.textContent+=' third line'; first.height=66;
c.update(true,true);
assert.equal(reads,1,'unchanged completed blocks do not require layout reads');
const count=animations.length;
first.width=400; first.textContent+=' resize'; first.height=100;
c.update(true,true);
assert.equal(animations.length,count,'reflow must not replay old lines');
motion.matches=true;motion.emit('change');
assert.ok(animations.every(a=>a.cancelled));
units.push(unit('reduced'));c.update(true,true);
assert.equal(animations.length,count);
c.dispose();motion.matches=false;
units=[unit('history')];
let historyScans=0;const historyQuery=root.querySelectorAll;root.querySelectorAll=()=>{historyScans++;return units};
const history=createSemanticReveal(root,false);history.update(false,false);
assert.equal(historyScans,0,'restored history does not scan paragraphs');root.querySelectorAll=historyQuery;
assert.equal(animations.length,count,'history is immediate');
history.update(true,true);
assert.equal(animations.length,count,'resuming a cached reply must not replay its existing paragraphs');history.dispose();
units=[unit('burst completion without a streaming frame')];
const burst=createSemanticReveal(root,true);burst.update(false,true);
assert.equal(animations.length,count+1,'a live committed burst still fades on first mount');
burst.update(false,true);
assert.equal(animations.length,count+1,'the completed body must not replay on an update');
burst.dispose();
units=Array.from({length:1000},(_,i)=>unit('unit'+i));
reads=0; operations=[];
const large=createSemanticReveal(root,true);large.update(true,true);
assert.equal(reads,32);
assert.equal(animations.slice(-32)[0].options.delay, 0);
assert.ok(animations.slice(-32).every(a => a.options.delay === 0), 'received text must not wait in a stagger queue');
const firstWrite=operations.indexOf('write');
assert.ok(firstWrite>=0);assert.ok(!operations.slice(firstWrite).includes('read'));
large.update(false,true);
assert.equal(animations.at(-1).cancelled, false, 'completion must not cut off the last paragraph');
await new Promise(resolve=>setTimeout(resolve,SEMANTIC_REVEAL_MAX_MS + 20));
assert.equal(animations.at(-1).cancelled, false, 'completion deadline must not truncate active tail animations');
large.dispose();
units=[];
const arrivals=createSemanticReveal(root,true);
for(let i=0;i<40;i++) { units.push(unit('arrival'+i)); arrivals.update(true,true); }
assert.ok(animations.slice(-40).every(a=>!a.cancelled), 'new arrivals must not cut short earlier fades');
assert.ok(animations.slice(-40).every(a=>a.options.duration===SEMANTIC_REVEAL_MS && a.options.delay===0));
arrivals.dispose();
// A completed Markdown delimiter changes the tree without adding visible text.
const ranged=(text,start,end)=>Object.assign(unit(text),{getAttribute:n=>n==='data-stream-start'?String(start):n==='data-stream-end'?String(end):null});
units=[ranged('**old',0,5)];
const syntax=createSemanticReveal(root,true);syntax.update(true,true,'**old');
const syntaxCount=animations.length;
units=[ranged('old',2,5),ranged(' new',7,11)];
syntax.update(true,true,'**old** new');
assert.equal(animations.length,syntaxCount+1,'only appended source fades after a DOM replacement');
units=[ranged('old',2,5),ranged(' new',7,11)];
syntax.update(true,true,'**old** new');
assert.equal(animations.length,syntaxCount+1,'an async re-mount with the same source must not replay');
units=[ranged('replacement',0,11)];syntax.update(true,true,'replacement');
assert.equal(animations.length,syntaxCount+1,'edits and preprocessing changes show immediately');
syntax.dispose();
// An offscreen unit may already exist in the DOM when an edit replaces its
// source. It must stop waiting for IntersectionObserver and become visible.
globalThis.IntersectionObserver=class {observe(){}unobserve(){}disconnect(){}};
const offscreen=ranged('original',0,8);offscreen.top=900;units=[offscreen];
const edited=createSemanticReveal(root,true);edited.update(true,true,'original');
assert.equal(offscreen.style.clipPath,'inset(0 0 100% 0)');
offscreen.textContent='replacement';edited.update(true,true,'replacement');
assert.equal(offscreen.style.clipPath,'','replacing a pending offscreen unit must expose it immediately');
edited.dispose();
assert.equal(appendedRevealInset(60,80),25);
assert.equal(appendedRevealInset(80,80),0);
assert.equal(appendedRevealInset(80,40),0);
console.log('lifecycle assertions passed');
`

describe('incremental semantic reveal lifecycle (#328)', () => {
  it('fades new paragraphs once, preserves old text and bounds work/completion', () => {
    const result = Bun.spawnSync([process.execPath, '--eval', harness.replace('MODULE_URL', JSON.stringify(moduleUrl))], { stdout: 'pipe', stderr: 'pipe' })
    expect(new TextDecoder().decode(result.stderr)).toBe('')
    expect(result.exitCode).toBe(0)
    expect(new TextDecoder().decode(result.stdout)).toContain('lifecycle assertions passed')
  }, 10000)
})
