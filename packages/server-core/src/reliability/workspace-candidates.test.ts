import { expect,test } from 'bun:test'
import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareIsolatedWorkspace } from './isolated-workspace'
import { collectWorkspaceCandidates } from './workspace-candidates'
test('non-Git candidates retain the declared baseline independently of source and candidate edits',()=>{
  const root=mkdtempSync(join(tmpdir(),'workspace-output-')), source=join(root,'source');mkdirSync(source)
  try {
    writeFileSync(join(source,'a.txt'),'base')
    const state=prepareIsolatedWorkspace(source,join(root,'storage'),['a.txt'])
    writeFileSync(join(source,'a.txt'),'external');writeFileSync(join(state.directory,'a.txt'),'candidate')
    const [output]=collectWorkspaceCandidates(state,[{path:'a.txt'}])
    expect(output!.base!.toString()).toBe('base');expect(output!.candidate!.toString()).toBe('candidate')
    expect(readFileSync(join(source,'a.txt'),'utf8')).toBe('external')
    expect(()=>collectWorkspaceCandidates(state,[{path:'../outside'}])).toThrow()
    expect(()=>collectWorkspaceCandidates(state,[{path:'a.txt'},{path:'./a.txt'}])).toThrow('Duplicate')
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('Git subprojects use the dirty input snapshot and preserve the original checkout',async()=>{
  const {execFileSync}=await import('node:child_process')
  const root=mkdtempSync(join(tmpdir(),'workspace-git-output-')),source=join(root,'repo');mkdirSync(source)
  const git=(...args:string[])=>execFileSync('git',args,{cwd:source,stdio:'pipe'})
  try {
    git('init');git('config','user.email','test@example.com');git('config','user.name','Test');mkdirSync(join(source,'sub'))
    writeFileSync(join(source,'sub','a.txt'),'committed');git('add','.');git('commit','-m','base')
    writeFileSync(join(source,'sub','a.txt'),'dirty input')
    const largeInput = Buffer.alloc(2 * 1024 * 1024, 65)
    writeFileSync(join(source, 'sub', 'large.txt'), largeInput)
    const state=prepareIsolatedWorkspace(join(source,'sub'),join(root,'storage'))
    writeFileSync(join(state.directory,'a.txt'),'candidate')
    const [output]=collectWorkspaceCandidates(state,[{path:'a.txt'}])
    expect(output!.base!.toString()).toBe('dirty input')
    expect(collectWorkspaceCandidates(state, [{ path: 'large.txt' }])[0]!.base).toEqual(largeInput)
    expect(output!.candidate!.toString()).toBe('candidate')
    expect(readFileSync(join(source,'sub','a.txt'),'utf8')).toBe('dirty input')
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('changed, deleted, or injected non-Git baselines cannot participate in a merge', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-baseline-'))
  const source = join(root, 'source'); mkdirSync(source)
  try {
    writeFileSync(join(source, 'a.txt'), 'base')
    const state = prepareIsolatedWorkspace(source, join(root, 'storage'), ['a.txt'])
    const basePath = join(state.baseDirectory!, 'a.txt')
    writeFileSync(basePath, 'changed')
    expect(() => collectWorkspaceCandidates(state, [{ path: './a.txt' }])).toThrow('snapshot changed')
    rmSync(basePath)
    expect(() => collectWorkspaceCandidates(state, [{ path: 'a.txt' }])).toThrow('snapshot changed')
    writeFileSync(join(state.baseDirectory!, 'new.txt'), 'injected')
    expect(() => collectWorkspaceCandidates(state, [{ path: 'new.txt' }])).toThrow('snapshot changed')
    rmSync(join(state.baseDirectory!, 'new.txt'))
    writeFileSync(join(state.directory, 'new.txt'), 'new output')
    expect(collectWorkspaceCandidates(state, [{ path: 'new.txt' }])[0]!.base).toBeNull()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
