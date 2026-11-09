/** Package Windows normally, with a local fallback for accounts without symlink privileges. */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'apps', 'electron')
const builderCli = join(root, 'node_modules', 'electron-builder', 'cli.js')
const builderArgs = ['--config', 'electron-builder.yml']

function run(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    const forward = (data: Buffer, target: NodeJS.WriteStream) => {
      target.write(data)
      output = (output + data.toString()).slice(-16000)
    }
    child.stdout.on('data', data => forward(data, process.stdout))
    child.stderr.on('data', data => forward(data, process.stderr))
    child.once('error', rejectRun)
    child.once('close', code => resolveRun({ code: code ?? 1, output }))
  })
}

function build(args: string[]) {
  // electron-builder's CLI relies on Node to set the exit code on an async failure.
  return run('node', [builderCli, ...builderArgs, ...args], electronDir)
}

const standard = await build(['--win'])
if (standard.code === 0) process.exit(0)

// electron-builder's winCodeSign archive contains macOS symlinks. Extracting it
// fails on Windows accounts without the Create symbolic links privilege.
if (process.platform !== 'win32' || !/Cannot create symbolic link|A required privilege is not held by the client/i.test(standard.output)) {
  process.exit(standard.code)
}

console.log('Windows symlink privilege unavailable; applying the app icon with rcedit before packaging.')
const unpacked = await build(['--win', '--dir', '--config.win.signAndEditExecutable=false'])
if (unpacked.code !== 0) process.exit(unpacked.code)

const exe = join(electronDir, 'release', 'win-unpacked', 'Selection.exe')
const icon = join(electronDir, 'resources', 'icon.ico')
const rcedit = join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
for (const file of [exe, icon, rcedit]) {
  if (!existsSync(file)) throw new Error(`Windows package resource is missing: ${file}`)
}

const { version } = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8')) as { version: string }
const edited = await run(rcedit, [
  exe,
  '--set-icon', icon,
  '--set-version-string', 'FileDescription', 'Selection',
  '--set-version-string', 'ProductName', 'Selection',
  '--set-file-version', version,
  '--set-product-version', version,
], electronDir)
if (edited.code !== 0) process.exit(edited.code)

const installer = await build([
  '--prepackaged', 'release/win-unpacked',
  '--win',
  '--config.win.signAndEditExecutable=false',
])
if (installer.code !== 0) process.exit(installer.code)
console.log('Windows installer packaged with the Selection icon.')
