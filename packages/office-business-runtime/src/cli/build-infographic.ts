/**
 * 信息图 CLI。默认 stdout 与 build_infographic.py 的状态 JSON 一致。
 * `--native-chart` 额外给出 OfficeCLI 原生图表命令；HTML/SVG 仍会写出，作为补充。
 */
import { InfographicError, readInfographicConfig, renderInfographicFile, type InfographicConfig } from '../infographic.ts'
import { hasFlag, type CliResult } from './args.ts'

export function runInfographicCli(argv: readonly string[], stdin?: string): CliResult {
  const native = hasFlag(argv, '--native-chart')
  const positional = native.rest.filter(token => token !== '-h' && token !== '--help')
  if (positional.includes('-h') || positional.includes('--help') || (positional.length === 0 && stdin === undefined)) {
    return { exitCode: 1, stdout: '', stderr: 'Usage: bun build-infographic.ts <config.json>\n       cat config.json | bun build-infographic.ts\n' }
  }
  let config: InfographicConfig
  try {
    config = positional[0] ? readInfographicConfig(positional[0]) : JSON.parse(stdin ?? '') as InfographicConfig
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missing = message.includes('ENOENT') || message.includes('no such file')
    const body = missing ? { status: 'error', message: `File not found: ${positional[0]}` } : { status: 'error', message: `Invalid JSON: ${message}` }
    return { exitCode: 1, stdout: `${JSON.stringify(body)}\n`, stderr: '' }
  }
  try {
    const result = renderInfographicFile(config, native.present)
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 0).replaceAll(',', ', ').replaceAll(':', ': ')}\n`, stderr: '' }
  } catch (error) {
    if (error instanceof InfographicError) {
      return { exitCode: 1, stdout: `${JSON.stringify({ status: 'error', errors: error.errors })}\n`, stderr: '' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stdout: `${JSON.stringify({ status: 'error', message })}\n`, stderr: '' }
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const stdin = process.stdin.isTTY ? undefined : await new Response(process.stdin).text()
  const result = runInfographicCli(argv, stdin && stdin.trim() ? stdin : undefined)
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
