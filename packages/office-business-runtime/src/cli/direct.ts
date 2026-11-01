import { basename } from 'node:path'

/**
 * 这个文件被 bun 直接执行时为真。
 * 桌面主进程打成 CommonJS 时不能读取模块元信息，所以这里只看启动脚本的文件名。
 */
export function isDirectCli(filename: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const name = basename(entry)
  return name === filename || name === filename.replace(/\.ts$/, '.js')
}
