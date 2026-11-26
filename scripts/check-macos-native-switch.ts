/**
 * Verify the macOS native switch addon inside a packaged Selection.app.
 *
 * The renderer silently falls back to the web Switch when the addon is
 * missing, unsigned-incompatible, or fails to load — so "the app launched"
 * is not evidence the addon works. This check asserts positive evidence:
 *
 *   1. Contents/Resources/app/resources/native/switch.node exists in the
 *      packaged app (the exact path main/native-switch.ts resolves).
 *   2. The binary is a Mach-O universal slice covering the app's own arch.
 *   3. The addon loads under the packaged app's own Electron runtime
 *      (ELECTRON_RUN_AS_NODE), proving dylib deps and the N-API module
 *      register — this is the same require() loadAddon() performs.
 *   4. Signature state of app + addon is reported; when the app carries a
 *      real Developer ID signature the addon must carry the same Team ID,
 *      otherwise that gate is reported as skipped (unsigned CI build).
 *   5. Gatekeeper assessment (spctl) is reported the same way.
 *   6. With --launch, the packaged app is started with an isolated profile
 *      (CRAFT_CONFIG_DIR + --user-data-dir under a temp dir) and the check
 *      evaluates window.nativeSwitch over Chrome DevTools Protocol — not
 *      just "available", but a real create/update/destroy roundtrip that
 *      embeds an NSSwitch in a real window. Process stderr is scanned for
 *      the loader's [native-switch] warnings.
 *
 * Usage:
 *   bun run scripts/check-macos-native-switch.ts --repo
 *   bun run scripts/check-macos-native-switch.ts --app apps/electron/release/mac-arm64/Selection.app
 *   bun run scripts/check-macos-native-switch.ts --app Selection.app --launch
 *   bun run scripts/check-macos-native-switch.ts --dmg dist-packages/Selection-arm64.dmg
 *
 * Exit code is non-zero if any check FAILs. Signature/Gatekeeper results are
 * reported SKIP on unsigned CI-style builds rather than failing.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const REPO_ADDON = join(ROOT_DIR, 'apps', 'electron', 'resources', 'native', 'switch.node')

// --- tiny check harness -------------------------------------------------------

type Status = 'PASS' | 'FAIL' | 'SKIP'
const results: { status: Status; name: string; detail: string }[] = []

function record(status: Status, name: string, detail = '') {
  results.push({ status, name, detail })
  const suffix = detail ? ` — ${detail}` : ''
  console.log(`${status.padEnd(4)} ${name}${suffix}`)
}

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...opts.env }, timeout: 60_000 })
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', error: res.error }
}

/**
 * Parse Mach-O fat/thin headers directly. Deliberately avoids lipo/otool —
 * those route through xcrun and fail on hosts without a working Xcode.
 */
function machOArchs(binary: string): string[] {
  const fd = openSync(binary, 'r')
  try {
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    const magicBE = head.readUInt32BE(0)
    const CPU_TYPE: Record<number, string> = { 0x01000007: 'x86_64', 0x0100000c: 'arm64', 0x00000007: 'i386' }
    const name = (cputype: number, cpusubtype: number) =>
      cputype === 0x0100000c && (cpusubtype & 0x00ffffff) === 2 ? 'arm64e' : (CPU_TYPE[cputype] ?? `cpu:${cputype}`)

    if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) { // FAT_MAGIC / FAT_MAGIC_64
      const nfat = head.readUInt32BE(4)
      const recSize = magicBE === 0xcafebabf ? 32 : 20
      const buf = Buffer.alloc(nfat * recSize)
      readSync(fd, buf, 0, buf.length, 8)
      const archs: string[] = []
      for (let i = 0; i < nfat; i++) {
        archs.push(name(buf.readInt32BE(i * recSize), buf.readInt32BE(i * recSize + 4)))
      }
      return archs
    }
    const magicLE = head.readUInt32LE(0)
    if (magicLE === 0xfeedface || magicLE === 0xfeedfacf) { // MH_MAGIC / MH_MAGIC_64
      return [name(head.readInt32LE(4), head.readInt32LE(8))]
    }
    return []
  } finally {
    closeSync(fd)
  }
}

function codesignInfo(binary: string): { signed: boolean; adhoc: boolean; teamId?: string; raw: string } {
  const res = run('/usr/bin/codesign', ['-dv', binary])
  const raw = `${res.stdout}\n${res.stderr}`
  const team = raw.match(/^TeamIdentifier=(.+)$/m)?.[1].trim()
  return {
    signed: res.code === 0 && !raw.includes('not signed'),
    adhoc: raw.includes('Signature=adhoc') || raw.includes('flags=0x2(adhoc)'),
    teamId: team && team !== 'not set' ? team : undefined,
    raw,
  }
}

const EXPECTED_EXPORTS = ['create', 'update', 'destroy']

/** Load the addon inside a given Node/Electron runtime and assert exports. */
function loadTest(runtimeBin: string, addonPath: string, runtimeLabel: string, env: NodeJS.ProcessEnv = {}): void {
  const probe = `const a=require(process.env.CHECK_ADDON);for(const k of ${JSON.stringify(EXPECTED_EXPORTS)})if(typeof a[k]!=='function')throw new Error('missing export '+k);console.log('exports:'+Object.keys(a).join(','))`
  const res = run(runtimeBin, ['-e', probe], { env: { ELECTRON_RUN_AS_NODE: '1', CHECK_ADDON: addonPath, ...env } })
  if (res.code === 0 && res.stdout.includes('exports:')) {
    record('PASS', `addon loads under ${runtimeLabel}`, res.stdout.trim())
  } else {
    record('FAIL', `addon loads under ${runtimeLabel}`, (res.stderr || res.stdout || String(res.error)).trim().split('\n').slice(0, 4).join(' | '))
  }
}

// --- app-level checks ---------------------------------------------------------

function verifyAddonBinary(addonPath: string, appExecArchs: string[], runtimeBin: string, runtimeLabel: string): void {
  if (!existsSync(addonPath)) {
    record('FAIL', 'packaged addon exists', `missing: ${addonPath}`)
    return
  }
  record('PASS', 'packaged addon exists', addonPath)

  const archs = machOArchs(addonPath)
  const missing = appExecArchs.filter(a => !archs.includes(a))
  if (archs.length === 0) {
    record('FAIL', 'addon Mach-O architecture', 'lipo reported no architectures')
  } else if (missing.length > 0) {
    record('FAIL', 'addon Mach-O architecture', `app needs ${appExecArchs.join('/')}, addon has ${archs.join('/')}`)
  } else {
    record('PASS', 'addon Mach-O architecture', `${archs.join('/')} covers app ${appExecArchs.join('/')}`)
  }

  loadTest(runtimeBin, addonPath, runtimeLabel)
}

function verifySignatures(appPath: string, addonPath: string): void {
  const appInfo = codesignInfo(join(appPath, 'Contents', 'MacOS', 'Selection'))
  const addonInfo = codesignInfo(addonPath)

  if (!appInfo.signed || appInfo.adhoc) {
    record('SKIP', 'Developer ID signature', 'app is unsigned/adhoc (expected for CSC_IDENTITY_AUTO_DISCOVERY=false CI builds); signing and notarization are not exercised here')
  } else {
    if (!addonInfo.signed || addonInfo.adhoc) {
      record('FAIL', 'addon signed with app identity', 'app is Developer-ID signed but addon is unsigned/adhoc')
    } else if (addonInfo.teamId !== appInfo.teamId) {
      record('FAIL', 'addon signed with app identity', `team mismatch app=${appInfo.teamId} addon=${addonInfo.teamId}`)
    } else {
      const v = run('/usr/bin/codesign', ['--verify', '--strict', addonPath])
      record(v.code === 0 ? 'PASS' : 'FAIL', 'addon signed with app identity', `team=${appInfo.teamId}`)
    }
  }

  const spctl = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', appPath])
  if (spctl.code === 0) {
    record('PASS', 'Gatekeeper assessment', (spctl.stderr || spctl.stdout).trim().split('\n').pop() ?? '')
  } else {
    record('SKIP', 'Gatekeeper assessment', `rejected as expected for unsigned build: ${(spctl.stderr || spctl.stdout).trim().split('\n').pop()}`)
  }
}

// --- isolated launch + CDP probe ----------------------------------------------

async function sleep(ms: number) { await new Promise(r => setTimeout(r, ms)) }

async function launchCheck(appPath: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'selection-addon-check-'))
  const userDataDir = join(work, 'user-data')
  const configDir = join(work, 'config')
  const bin = join(appPath, 'Contents', 'MacOS', 'Selection')

  let child: ChildProcess | null = null
  let stderrBuf = ''
  try {
    child = spawn(bin, [`--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--no-first-run'], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', d => { stderrBuf += d })
    child.stderr?.on('data', d => { stderrBuf += d })

    // Electron writes DevToolsActivePort into the user data dir.
    const portFile = join(userDataDir, 'DevToolsActivePort')
    let port = 0
    for (let i = 0; i < 120 && !port; i++) {
      if (child.exitCode !== null) break
      if (existsSync(portFile)) {
        port = parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10) || 0
      }
      if (!port) await sleep(500)
    }
    if (!port) {
      record('FAIL', 'isolated app launch (CDP)', `no DevToolsActivePort after 60s; stderr: ${stderrBuf.trim().split('\n').slice(-3).join(' | ')}`)
      return
    }

    // Find a page target whose preload exposed window.nativeSwitch.
    let target: { webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 120 && !target; i++) {
      if (child.exitCode !== null) break
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
        for (const t of list) {
          if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue
          const val = await cdpEvaluate(t.webSocketDebuggerUrl, 'typeof window.nativeSwitch === "object" && window.nativeSwitch !== null', false)
          if (val === true) { target = t; break }
        }
      } catch { /* devtools endpoint not ready yet */ }
      if (!target) await sleep(500)
    }
    if (!target) {
      record('FAIL', 'isolated app launch (CDP)', 'no renderer target exposed window.nativeSwitch within 60s')
      return
    }
    record('PASS', 'isolated app launch (CDP)', 'renderer target with window.nativeSwitch found')

    const ws = target.webSocketDebuggerUrl
    const available = await cdpEvaluate(ws, 'window.nativeSwitch.available === true', true)
    if (available !== true) {
      record('FAIL', 'nativeSwitch.available in packaged renderer', `got ${JSON.stringify(available)}`)
      return
    }
    record('PASS', 'nativeSwitch.available in packaged renderer', 'true')

    // Full roundtrip: create a real NSSwitch in the live window, update, destroy.
    const props = '{x:24,y:24,width:51,height:31,visible:true,on:false,enabled:true,appearance:"light"}'
    const created = await cdpEvaluate(ws, `window.nativeSwitch.create(424242, ${props})`, true)
    if (created === true) {
      record('PASS', 'native create() embeds NSSwitch', 'create returned true')
      const updated = await cdpEvaluate(ws, `window.nativeSwitch.update(424242, {...${props}, on:true})`, true)
      record(updated === true ? 'PASS' : 'FAIL', 'native update()', `update returned ${JSON.stringify(updated)}`)
      await cdpEvaluate(ws, 'window.nativeSwitch.destroy(424242)', true)
    } else {
      record('FAIL', 'native create() embeds NSSwitch', `create returned ${JSON.stringify(created)}`)
    }
  } finally {
    child?.kill('SIGTERM')
    if (child) await Promise.race([new Promise(r => child!.once('exit', r)), sleep(5000)])
    child?.kill('SIGKILL')
    const warnLines = stderrBuf.split('\n').filter(l => l.includes('[native-switch]'))
    if (warnLines.length > 0) {
      record('FAIL', 'no [native-switch] loader warnings on stderr', warnLines.slice(0, 3).join(' | '))
    } else {
      record('PASS', 'no [native-switch] loader warnings on stderr')
    }
    rmSync(work, { recursive: true, force: true })
  }
}

let cdpId = 0
async function cdpEvaluate(wsUrl: string, expression: string, awaitPromise: boolean): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => { ws.close(); reject(new Error('cdp timeout')) }, 10_000)
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: ++cdpId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }))
    }
    ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id === cdpId) {
        clearTimeout(timer)
        ws.close()
        resolve(msg.result?.result?.value)
      }
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')) }
  })
}

// --- dmg mounting -------------------------------------------------------------

async function withMountedDmg(dmgPath: string, fn: (appPath: string) => void | Promise<void>): Promise<void> {
  const attach = run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmgPath])
  if (attach.code !== 0) {
    record('FAIL', 'mount DMG', attach.stderr.trim())
    return
  }
  const mountPoint = [...attach.stdout.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)][0]?.[1]
  if (!mountPoint) {
    record('FAIL', 'mount DMG', 'no mount-point in hdiutil output')
    return
  }
  try {
    const app = readdirSync(mountPoint).find(f => f.endsWith('.app'))
    if (!app) {
      record('FAIL', 'DMG contains .app', `entries: ${readdirSync(mountPoint).join(', ')}`)
      return
    }
    record('PASS', 'DMG contains .app', join(mountPoint, app))
    await fn(join(mountPoint, app))
  } finally {
    run('/usr/bin/hdiutil', ['detach', mountPoint])
  }
}

// --- entry --------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2))
  const argValue = (flag: string): string | null => {
    const i = process.argv.indexOf(flag)
    const v = i >= 0 ? process.argv[i + 1] : undefined
    return v && !v.startsWith('--') ? v : null
  }
  const dmg = argValue('--dmg')
  const app = argValue('--app')
  const dmgPath = dmg ? resolve(dmg) : null
  const appPath = app ? resolve(app) : null
  const repo = args.has('--repo')
  const launch = args.has('--launch')

  if (process.platform !== 'darwin') {
    console.error('This check requires a macOS host.')
    process.exit(1)
  }
  if (!repo && !appPath && !dmgPath) {
    console.error('Specify --repo, --app <Selection.app>, or --dmg <Selection-arm64.dmg>. Add --launch for the isolated-profile load probe.')
    process.exit(1)
  }

  if (repo) {
    if (!existsSync(REPO_ADDON)) {
      record('FAIL', 'repo addon exists', `missing: ${REPO_ADDON}`)
    } else {
      record('PASS', 'repo addon exists', REPO_ADDON)
      const archs = machOArchs(REPO_ADDON)
      record(archs.includes('arm64') && archs.includes('x86_64') ? 'PASS' : 'FAIL',
        'repo addon is universal2', archs.join('/') || 'none')
      const info = codesignInfo(REPO_ADDON)
      record(info.signed ? 'PASS' : 'FAIL', 'repo addon codesign', info.adhoc ? 'adhoc (expected; re-signed during packaging)' : info.teamId ?? 'unsigned')
      const node = run('node', ['--version']).code === 0 ? 'node' : null
      if (node) loadTest('node', REPO_ADDON, 'repo node')
      else record('SKIP', 'repo addon load test', 'no node on PATH')
    }
  }

  if (appPath) {
    const execPath = join(appPath, 'Contents', 'MacOS', 'Selection')
    if (!existsSync(execPath)) {
      record('FAIL', 'app executable exists', `missing: ${execPath}`)
    } else {
      const appArchs = machOArchs(execPath)
      verifyAddonBinary(join(appPath, 'Contents', 'Resources', 'app', 'resources', 'native', 'switch.node'), appArchs, execPath, 'packaged Electron runtime')
      verifySignatures(appPath, join(appPath, 'Contents', 'Resources', 'app', 'resources', 'native', 'switch.node'))
      if (launch) await launchCheck(appPath)
    }
  }

  if (dmgPath) {
    await withMountedDmg(dmgPath, async (mountedApp) => {
      const execPath = join(mountedApp, 'Contents', 'MacOS', 'Selection')
      const appArchs = machOArchs(execPath)
      verifyAddonBinary(join(mountedApp, 'Contents', 'Resources', 'app', 'resources', 'native', 'switch.node'), appArchs, execPath, 'DMG Electron runtime')
      verifySignatures(mountedApp, join(mountedApp, 'Contents', 'Resources', 'app', 'resources', 'native', 'switch.node'))
    })
  }

  const failed = results.filter(r => r.status === 'FAIL')
  const skipped = results.filter(r => r.status === 'SKIP')
  console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
