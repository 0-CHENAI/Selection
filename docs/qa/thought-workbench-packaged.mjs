import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const APP = join(ROOT, 'apps/electron/release/mac-arm64/Selection.app')
const CONTENTS = join(APP, 'Contents')
const RESOURCES = join(CONTENTS, 'Resources')
const OUT = new URL('./thought-workbench-packaged.json', import.meta.url)

function sha256(path) {
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options })
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim().slice(0, 400),
  }
}

const report = {
  startedAt: new Date().toISOString(),
  app: APP,
  exists: existsSync(APP),
}

if (!report.exists) {
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

const sourceMain = join(ROOT, 'apps/electron/dist/main.cjs')
const packagedMain = join(RESOURCES, 'app/dist/main.cjs')
const sourcePi = join(ROOT, 'packages/pi-agent-server/dist/index.js')
const packagedPi = join(RESOURCES, 'app/resources/pi-agent-server/index.js')
const sourceWasm = join(ROOT, 'packages/pi-agent-server/dist/photon_rs_bg.wasm')
const packagedWasm = join(RESOURCES, 'app/resources/pi-agent-server/photon_rs_bg.wasm')
const sourceNotice = join(ROOT, 'packages/shared/src/thought-workbench/THIRD_PARTY.md')
const packagedNotice = join(RESOURCES, 'third-party/ThoughtDAG-NOTICE.txt')
const rendererIndex = join(RESOURCES, 'app/dist/renderer/index.html')
const rendererMain = join(RESOURCES, 'app/dist/renderer/assets')
const bunBin = join(RESOURCES, 'app/vendor/bun/bun')
const rgBin = join(RESOURCES, 'app/node_modules/@vscode/ripgrep/bin/rg')

report.paths = {
  packagedMain: existsSync(packagedMain),
  packagedPi: existsSync(packagedPi),
  packagedWasm: existsSync(packagedWasm),
  packagedNotice: existsSync(packagedNotice),
  rendererIndex: existsSync(rendererIndex),
  bun: existsSync(bunBin),
  ripgrep: existsSync(rgBin),
}

report.sha256 = {
  mainMatch: sha256(sourceMain) === sha256(packagedMain),
  piMatch: sha256(sourcePi) === sha256(packagedPi),
  wasmMatch: sha256(sourceWasm) === sha256(packagedWasm),
  noticeMatch: sha256(sourceNotice) === sha256(packagedNotice),
  main: sha256(packagedMain),
  pi: sha256(packagedPi),
  wasm: sha256(packagedWasm),
}

report.notice = existsSync(packagedNotice)
  ? {
    commit: readFileSync(packagedNotice, 'utf8').includes('ef04210f6106a0dbc30f353cf67b25bee47d769c'),
    mit: readFileSync(packagedNotice, 'utf8').includes('Permission is hereby granted, free of charge'),
  }
  : null

report.bunVersion = existsSync(bunBin) ? run(bunBin, ['--version']) : null
report.piSmoke = existsSync(packagedPi)
  ? run(process.execPath, [packagedPi], { input: '', timeout: 15_000 })
  : null
if (existsSync(rendererMain)) {
  const { readdirSync } = await import('node:fs')
  const files = readdirSync(rendererMain).filter((name) => name.endsWith('.js'))
  report.rendererFlag = {
    indexHtml: existsSync(rendererIndex),
    kanbanBoard: files.some((name) => readFileSync(join(rendererMain, name), 'utf8').includes('kanban.board')),
    thoughtCanvas: files.some((name) => readFileSync(join(rendererMain, name), 'utf8').includes('thought-canvas-split')),
    bakedFlag: files.some((name) => /"1"/.test(readFileSync(join(rendererMain, name), 'utf8')) && readFileSync(join(rendererMain, name), 'utf8').includes('kanban.board')),
  }
}

report.codesign = run('codesign', ['--verify', '--deep', '--strict', APP])
report.finishedAt = new Date().toISOString()
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  exists: report.exists,
  paths: report.paths,
  sha256: { mainMatch: report.sha256.mainMatch, piMatch: report.sha256.piMatch, wasmMatch: report.sha256.wasmMatch, noticeMatch: report.sha256.noticeMatch },
  notice: report.notice,
  bunVersion: report.bunVersion?.stdout,
  piStatus: report.piSmoke?.status,
  rendererFlag: report.rendererFlag,
  codesign: report.codesign.status,
}, null, 2))
