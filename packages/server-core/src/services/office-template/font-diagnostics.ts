/**
 * 缺字诊断（#711 G4）。列出 Word / Excel 文件用到的字体，与本机字体比对，报告缺失与可能的替换。
 * macOS 读 `system_profiler SPFontsDataType -json`，Windows 读字体注册表，Linux 用 `fc-list`。
 * 只读诊断，不阻止交付；结果写进工具返回值和交付说明。
 */
import { execFile } from 'node:child_process'
import { strFromU8 } from 'fflate'
import { readOoxmlPackage, type OoxmlParts } from './ooxml-package.ts'

export interface FontUse { name: string; embedded: boolean }
export interface FontWarning {
  font: string
  status: 'missing' | 'embedded-only'
  /** 本机实际会用来顶替的字体；未知时为空。 */
  substitute?: string
  message: string
}

/** 常见中文 / 办公字体的别名与预期替换顺序。第一个已安装的候选即报告的替换字体。 */
const FONT_FAMILIES: Array<{ names: string[]; substitutes: string[] }> = [
  { names: ['仿宋_GB2312', 'FangSong_GB2312'], substitutes: ['FangSong', '仿宋', 'STFangsong', '华文仿宋', 'FangS-SC', 'Songti SC'] },
  { names: ['仿宋', 'FangSong'], substitutes: ['STFangsong', '华文仿宋', 'FangS-SC', 'Songti SC'] },
  { names: ['楷体_GB2312', 'KaiTi_GB2312'], substitutes: ['KaiTi', '楷体', 'STKaiti', 'Kaiti SC', 'HYKaiTiJ'] },
  { names: ['楷体', 'KaiTi'], substitutes: ['STKaiti', 'Kaiti SC', 'HYKaiTiJ'] },
  { names: ['方正小标宋简体', 'FZXiaoBiaoSong-B05S', '小标宋'], substitutes: ['ShuS-SC', 'STSong', 'Songti SC', 'SimSun'] },
  { names: ['宋体', 'SimSun'], substitutes: ['STSong', 'Songti SC', 'Noto Serif CJK SC'] },
  { names: ['黑体', 'SimHei'], substitutes: ['STHeiti', 'Heiti SC', 'PingFang SC', 'Noto Sans CJK SC'] },
  { names: ['微软雅黑', 'Microsoft YaHei'], substitutes: ['PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC'] },
  { names: ['等线', 'DengXian'], substitutes: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'] },
  { names: ['Noto Sans CJK SC', 'Noto Sans SC'], substitutes: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC'] },
  { names: ['Hiragino Sans GB', 'Hiragino Sans GB W3'], substitutes: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'] },
  { names: ['PingFang SC'], substitutes: ['Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC'] },
  { names: ['Carlito'], substitutes: ['Calibri', 'Arial', 'Helvetica'] },
  { names: ['Calibri'], substitutes: ['Carlito', 'Arial', 'Helvetica'] },
  { names: ['Caladea'], substitutes: ['Cambria', 'Times New Roman'] },
  { names: ['Cambria'], substitutes: ['Caladea', 'Times New Roman'] },
]

/** OOXML 里不是字体名的占位值。 */
const NON_FONTS = new Set(['', 'en-US', 'zh-CN', '+mn-lt', '+mj-lt', '+mn-ea', '+mj-ea', '+mn-cs', '+mj-cs'])

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function textParts(parts: OoxmlParts, pattern: RegExp): string[] {
  return Object.keys(parts).filter(name => pattern.test(name)).map(name => strFromU8(parts[name]!))
}

/** 文档用到的字体。Word 读 rFonts 与主题字体；Excel 读 styles.xml 的 font/name 与主题字体。 */
export function documentFonts(bytes: Uint8Array): FontUse[] {
  const parts = readOoxmlPackage(bytes)
  const names = new Set<string>()
  const embedded = new Set<string>()
  const add = (value: string | undefined) => {
    const name = (value ?? '').trim()
    if (!NON_FONTS.has(name) && !name.startsWith('+')) names.add(name)
  }
  if (parts['word/document.xml']) {
    for (const xml of textParts(parts, /^word\/(document|styles|header\d*|footer\d*|footnotes|endnotes|numbering)\.xml$/)) {
      for (const match of xml.matchAll(/<w:rFonts\b([^>]*)>/g)) {
        for (const attr of match[1]!.matchAll(/w:(ascii|hAnsi|eastAsia|cs)="([^"]*)"/g)) add(attr[2])
      }
    }
    const table = parts['word/fontTable.xml'] ? strFromU8(parts['word/fontTable.xml']) : ''
    for (const font of table.matchAll(/<w:font\b[^>]*w:name="([^"]+)"[^>]*>([\s\S]*?)<\/w:font>/g)) {
      if (/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b/.test(font[2]!)) embedded.add(font[1]!)
    }
  }
  if (parts['xl/workbook.xml']) {
    for (const xml of textParts(parts, /^xl\/styles\.xml$/)) {
      for (const match of xml.matchAll(/<(?:\w+:)?name\b[^>]*\bval="([^"]+)"/g)) add(match[1])
    }
  }
  for (const xml of textParts(parts, /^(word|xl|ppt)\/theme\/theme\d+\.xml$/)) {
    for (const match of xml.matchAll(/<a:(?:majorFont|minorFont)>([\s\S]*?)<\/a:(?:majorFont|minorFont)>/g)) {
      for (const face of match[1]!.matchAll(/<a:(latin|ea)\b[^>]*typeface="([^"]*)"/g)) add(face[2])
    }
  }
  return [...names].sort().map(name => ({ name, embedded: embedded.has(name) }))
}

export function diagnoseFonts(used: FontUse[], installed: Iterable<string>): FontWarning[] {
  const available = new Map<string, string>()
  for (const name of installed) available.set(normalize(name), name)
  const has = (name: string) => available.has(normalize(name))
  const warnings: FontWarning[] = []
  for (const font of used) {
    const family = FONT_FAMILIES.find(item => item.names.some(name => normalize(name) === normalize(font.name)))
    if (has(font.name) || family?.names.some(has)) continue
    const substitute = family?.substitutes.find(has)
    const resolved = substitute ? available.get(normalize(substitute)) : undefined
    if (font.embedded) {
      warnings.push({ font: font.name, status: 'embedded-only', substitute: resolved, message: `「${font.name}」只嵌在文件里、本机未安装。Word 打开时用嵌入字体；OfficeCLI 预览和其他应用可能${resolved ? `替换为「${resolved}」` : '换成默认字体'}。` })
      continue
    }
    warnings.push({ font: font.name, status: 'missing', substitute: resolved, message: `本机缺少「${font.name}」，${resolved ? `会被替换为「${resolved}」` : '会换成系统默认字体'}，行宽和分页可能变化。` })
  }
  return warnings
}

// ── 系统字体 ──────────────────────────────────────────────────────────────

type Exec = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<string>

const defaultExec: Exec = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { ...options, env: scrubbedEnv(), windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout)))
})

/** 子进程只拿到运行所需的变量，凭据留在宿主进程。 */
export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR']
  return Object.fromEntries(keep.filter(key => env[key] !== undefined).map(key => [key, env[key]]))
}

export function parseMacFonts(json: string): string[] {
  const data = JSON.parse(json) as { SPFontsDataType?: Array<{ typefaces?: Array<{ family?: string; fullname?: string; _name?: string }> ; _name?: string }> }
  const names = new Set<string>()
  for (const file of data.SPFontsDataType ?? []) {
    for (const face of file.typefaces ?? []) {
      for (const value of [face.family, face.fullname, face._name]) if (value) names.add(value)
    }
  }
  return [...names]
}

export function parseWindowsFontRegistry(output: string): string[] {
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+/.exec(line)
    if (!match) continue
    for (const part of match[1]!.replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '').split('&')) {
      const name = part.trim()
      if (name) names.add(name)
    }
  }
  return [...names]
}

export function parseFcList(output: string): string[] {
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) for (const part of line.split(',')) if (part.trim()) names.add(part.trim())
  return [...names]
}

let cached: { platform: string; at: number; fonts: string[] } | undefined

export async function listSystemFonts(platform: NodeJS.Platform = process.platform, exec: Exec = defaultExec): Promise<string[]> {
  if (cached && cached.platform === platform && Date.now() - cached.at < 10 * 60_000) return cached.fonts
  let fonts: string[] = []
  const options = { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }
  try {
    if (platform === 'darwin') fonts = parseMacFonts(await exec('/usr/sbin/system_profiler', ['SPFontsDataType', '-json', '-detailLevel', 'mini'], options))
    else if (platform === 'win32') {
      const keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']
      for (const key of keys) {
        try { fonts.push(...parseWindowsFontRegistry(await exec('reg', ['query', key], options))) } catch { /* HKCU 可能不存在 */ }
      }
    } else fonts = parseFcList(await exec('fc-list', [':', 'family'], options))
  } catch {
    return []
  }
  cached = { platform, at: Date.now(), fonts }
  return fonts
}

/** 一次完成「列字体 → 比对」。本机字体读不到时返回空清单，不阻止交付。 */
export async function fontWarningsFor(bytes: Uint8Array, installed?: string[]): Promise<FontWarning[]> {
  const fonts = installed ?? await listSystemFonts()
  if (!fonts.length) return []
  return diagnoseFonts(documentFonts(bytes), fonts)
}
