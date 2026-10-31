/**
 * 受限的 OOXML 包读写。条目 ≤ 5000、解压后 ≤ 64 MB、不允许重名条目，与 dsh docx-layout.py 的 package() 一致。
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { parseXml, serializeXml, type XDocument } from './xml-tree.ts'

export const OOXML_MAX_ENTRIES = 5000
export const OOXML_MAX_BYTES = 64 * 1024 * 1024

export type OoxmlParts = Record<string, Uint8Array>

export function readOoxmlPackage(bytes: Uint8Array): OoxmlParts {
  if (bytes.byteLength > OOXML_MAX_BYTES) throw new Error('Office 文件超过 64 MB，已拒绝')
  const names = new Set<string>()
  let declared = 0
  let count = 0
  const parts = unzipSync(bytes, {
    filter(file) {
      count += 1
      if (count > OOXML_MAX_ENTRIES) throw new Error('Office 包条目超过 5000，已拒绝')
      if (names.has(file.name)) throw new Error(`Office 包含重名条目：${file.name}`)
      if (file.name.includes('..') || file.name.startsWith('/') || file.name.includes('\\')) throw new Error(`Office 包条目路径无效：${file.name}`)
      names.add(file.name)
      declared += file.originalSize
      if (declared > OOXML_MAX_BYTES) throw new Error('Office 包解压后超过 64 MB，已拒绝')
      return true
    },
  })
  let actual = 0
  for (const data of Object.values(parts)) actual += data.byteLength
  if (actual > OOXML_MAX_BYTES) throw new Error('Office 包解压后超过 64 MB，已拒绝')
  return parts
}

export function writeOoxmlPackage(parts: OoxmlParts): Uint8Array {
  const zippable: Zippable = {}
  // 大部件（嵌入字体）用快速压缩，避免每次写入都花数秒。
  for (const [name, data] of Object.entries(parts)) zippable[name] = [data, { level: data.byteLength > 1024 * 1024 ? 1 : 6, mtime: new Date(1980, 0, 1, 0, 0, 0) }]
  return zipSync(zippable)
}

export function readXmlPart(parts: OoxmlParts, name: string): XDocument {
  const data = parts[name]
  if (!data) throw new Error(`Office 包缺少 ${name}`)
  return parseXml(strFromU8(data))
}

export function writeXmlPart(parts: OoxmlParts, name: string, doc: XDocument): void {
  parts[name] = strToU8(serializeXml(doc))
}

/** 浅拷贝：部件字节视为不可变，改动时整体替换条目。 */
export function cloneParts(parts: OoxmlParts): OoxmlParts {
  return { ...parts }
}

export function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b || a.byteLength !== b.byteLength) return false
  return Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0
}
