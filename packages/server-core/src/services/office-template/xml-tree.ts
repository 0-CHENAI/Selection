/**
 * 受限 XML 树。只处理 OOXML 部件：拒绝 DOCTYPE / 实体声明，不解析外部实体，不访问网络。
 * 只解码五个预定义实体与数字字符引用。命名空间按作用域展开，用于与 dsh lxml 相同的规范化比较。
 */

export const XML_NS = 'http://www.w3.org/XML/1998/namespace'

export interface XText { type: 'text'; value: string; cdata?: boolean }
export interface XOther { type: 'other'; raw: string }
export interface XElement {
  type: 'element'
  name: string
  attrs: Array<[string, string]>
  children: XNode[]
  parent?: XElement
  /** 作用域内的前缀 → 命名空间。'' 是默认命名空间。 */
  ns: Map<string, string>
}
export type XNode = XElement | XText | XOther

export interface XDocument { root: XElement }

const MAX_DEPTH = 512

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_all, ref: string) => {
    if (ref === 'lt') return '<'
    if (ref === 'gt') return '>'
    if (ref === 'amp') return '&'
    if (ref === 'quot') return '"'
    if (ref === 'apos') return "'"
    const code = ref.startsWith('#x') ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new Error('XML 字符引用无效')
    return String.fromCodePoint(code)
  })
}

function assertNoUnknownEntity(value: string): void {
  const unknown = /&(?!#x[0-9a-fA-F]+;|#\d+;|lt;|gt;|amp;|quot;|apos;)/.exec(value)
  if (unknown) throw new Error('XML 含未声明的实体引用，已拒绝')
}

export function parseXml(source: string): XDocument {
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) throw new Error('XML 含 DOCTYPE 或实体声明，已拒绝（禁止外部实体）')
  let index = 0
  const length = source.length
  const top: XElement = { type: 'element', name: '#document', attrs: [], children: [], ns: new Map([['xml', XML_NS]]) }
  let current = top
  let depth = 0
  while (index < length) {
    const lt = source.indexOf('<', index)
    if (lt < 0) {
      pushText(current, source.slice(index))
      break
    }
    if (lt > index) pushText(current, source.slice(index, lt))
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt)
      if (end < 0) throw new Error('XML 处理指令未闭合')
      if (current !== top) current.children.push({ type: 'other', raw: source.slice(lt, end + 2) })
      index = end + 2
      continue
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      if (end < 0) throw new Error('XML 注释未闭合')
      if (current !== top) current.children.push({ type: 'other', raw: source.slice(lt, end + 3) })
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt)
      if (end < 0) throw new Error('XML CDATA 未闭合')
      current.children.push({ type: 'text', value: source.slice(lt + 9, end), cdata: true })
      index = end + 3
      continue
    }
    if (source.startsWith('<!', lt)) throw new Error('XML 含不支持的声明，已拒绝')
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt)
      if (end < 0) throw new Error('XML 结束标签未闭合')
      const name = source.slice(lt + 2, end).trim()
      if (name !== current.name) throw new Error(`XML 标签不匹配：${name}`)
      current = current.parent ?? top
      depth -= 1
      index = end + 1
      continue
    }
    // start tag
    let cursor = lt + 1
    let quote: string | null = null
    while (cursor < length) {
      const char = source[cursor]
      if (quote) { if (char === quote) quote = null }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      cursor += 1
    }
    if (cursor >= length) throw new Error('XML 开始标签未闭合')
    let body = source.slice(lt + 1, cursor)
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1)
    const nameMatch = /^([^\s/>]+)/.exec(body)
    if (!nameMatch) throw new Error('XML 标签名无效')
    const name = nameMatch[1]!
    const attrs: Array<[string, string]> = []
    const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    const rest = body.slice(name.length)
    let match: RegExpExecArray | null
    while ((match = attrPattern.exec(rest))) {
      const raw = match[3] ?? match[4] ?? ''
      assertNoUnknownEntity(raw)
      attrs.push([match[1]!, decode(raw)])
    }
    let ns = current.ns
    for (const [key, value] of attrs) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) {
        if (ns === current.ns) ns = new Map(current.ns)
        ns.set(key === 'xmlns' ? '' : key.slice(6), value)
      }
    }
    const element: XElement = { type: 'element', name, attrs, children: [], parent: current === top ? undefined : current, ns }
    current.children.push(element)
    if (!selfClosing) {
      depth += 1
      if (depth > MAX_DEPTH) throw new Error('XML 嵌套过深')
      current = element
    }
    index = cursor + 1
  }
  if (current !== top) throw new Error('XML 元素未闭合')
  const roots = top.children.filter((node): node is XElement => node.type === 'element')
  if (roots.length !== 1) throw new Error('XML 必须只有一个根元素')
  return { root: roots[0]! }
}

function pushText(parent: XElement, raw: string): void {
  if (!raw) return
  assertNoUnknownEntity(raw)
  if (parent.name === '#document') {
    if (raw.trim()) throw new Error('XML 根元素外有文本')
    return
  }
  parent.children.push({ type: 'text', value: decode(raw) })
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll('\n', '&#10;').replaceAll('\r', '&#13;').replaceAll('\t', '&#9;')
}

export function serializeNode(node: XNode): string {
  if (node.type === 'text') return node.cdata ? `<![CDATA[${node.value}]]>` : escapeText(node.value)
  if (node.type === 'other') return node.raw
  const attrs = node.attrs.map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('')
  if (!node.children.length) return `<${node.name}${attrs}/>`
  return `<${node.name}${attrs}>${node.children.map(serializeNode).join('')}</${node.name}>`
}

export function serializeXml(doc: XDocument): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${serializeNode(doc.root)}`
}

/** 元素的展开名 `{ns}local`。 */
export function expandedName(element: XElement): string {
  const colon = element.name.indexOf(':')
  const prefix = colon < 0 ? '' : element.name.slice(0, colon)
  const local = colon < 0 ? element.name : element.name.slice(colon + 1)
  const uri = element.ns.get(prefix)
  return uri ? `{${uri}}${local}` : local
}

export function attrExpanded(element: XElement, key: string): string | undefined {
  const colon = key.indexOf(':')
  if (colon < 0) return key
  const prefix = key.slice(0, colon)
  if (prefix === 'xmlns') return undefined
  const uri = element.ns.get(prefix)
  return uri ? `{${uri}}${key.slice(colon + 1)}` : key
}

export function is(node: XNode | undefined, ns: string, local: string): node is XElement {
  return !!node && node.type === 'element' && expandedName(node) === `{${ns}}${local}`
}

/** 与 is() 相同但不收窄类型，便于在循环里沿父链查找。 */
export function named(node: XElement, ns: string, local: string): boolean {
  return expandedName(node) === `{${ns}}${local}`
}

export function elementChildren(element: XElement): XElement[] {
  return element.children.filter((node): node is XElement => node.type === 'element')
}

export function childrenNamed(element: XElement, ns: string, local: string): XElement[] {
  return element.children.filter((node): node is XElement => is(node, ns, local))
}

export function firstChild(element: XElement, ns: string, local: string): XElement | undefined {
  return element.children.find((node): node is XElement => is(node, ns, local))
}

/** 后代元素（不含自身），文档顺序。 */
export function descendants(element: XElement, ns?: string, local?: string): XElement[] {
  const found: XElement[] = []
  const stack: XElement[] = [...elementChildren(element)].reverse()
  while (stack.length) {
    const next = stack.pop()!
    if (!ns || is(next, ns, local!)) found.push(next)
    const kids = elementChildren(next)
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]!)
  }
  return found
}

/** 读取命名空间属性，例如 getAttr(el, W, 'val')。 */
export function getAttr(element: XElement, ns: string | null, local: string): string | undefined {
  for (const [key, value] of element.attrs) {
    const expanded = attrExpanded(element, key)
    if (ns === null ? expanded === local : expanded === `{${ns}}${local}`) return value
  }
  return undefined
}

export function setAttr(element: XElement, ns: string, local: string, value: string): void {
  for (const pair of element.attrs) {
    if (attrExpanded(element, pair[0]) === `{${ns}}${local}`) { pair[1] = value; return }
  }
  element.attrs.push([`${prefixFor(element, ns)}${local}`, value])
}

export function prefixFor(element: XElement, ns: string): string {
  if (ns === XML_NS) return 'xml:'
  for (const [prefix, uri] of element.ns) if (uri === ns) return prefix ? `${prefix}:` : ''
  throw new Error(`命名空间未声明：${ns}`)
}

export function createElement(parent: XElement, ns: string, local: string): XElement {
  return { type: 'element', name: `${prefixFor(parent, ns)}${local}`, attrs: [], children: [], parent, ns: parent.ns }
}

export function appendChild(parent: XElement, child: XElement): XElement {
  child.parent = parent
  parent.children.push(child)
  return child
}

export function subElement(parent: XElement, ns: string, local: string): XElement {
  return appendChild(parent, createElement(parent, ns, local))
}

export function removeNode(node: XElement): void {
  const parent = node.parent
  if (!parent) throw new Error('不能删除根元素')
  parent.children = parent.children.filter(child => child !== node)
  node.parent = undefined
}

export function insertAfter(anchor: XElement, node: XElement): void {
  const parent = anchor.parent
  if (!parent) throw new Error('锚点没有父元素')
  const position = parent.children.indexOf(anchor)
  parent.children.splice(position + 1, 0, node)
  node.parent = parent
}

export function insertBefore(anchor: XElement, node: XElement): void {
  const parent = anchor.parent
  if (!parent) throw new Error('锚点没有父元素')
  parent.children.splice(parent.children.indexOf(anchor), 0, node)
  node.parent = parent
}

export function cloneElement(element: XElement, parent?: XElement): XElement {
  const copy: XElement = { type: 'element', name: element.name, attrs: element.attrs.map(([k, v]) => [k, v]), children: [], parent, ns: element.ns }
  copy.children = element.children.map(child => child.type === 'element' ? cloneElement(child, copy) : { ...child })
  return copy
}

/** lxml element.text：第一个子元素之前的文本。 */
function leadingText(element: XElement): string {
  let text = ''
  for (const child of element.children) {
    if (child.type === 'element') break
    if (child.type === 'text') text += child.value
  }
  return text
}

/**
 * 与 dsh `canonical()` 相同：展开名、排序后的属性（不含 xmlns 声明）、去空白的前导文本、子元素。
 * 序列化器改前缀不算变化。
 */
export function canonical(element: XElement | undefined): string {
  return JSON.stringify(canonicalTuple(element))
}

function canonicalTuple(element: XElement | undefined): unknown {
  if (!element) return ['inherited']
  const attrs = element.attrs
    .map(([key, value]) => [attrExpanded(element, key), value] as const)
    .filter((pair): pair is readonly [string, string] => pair[0] !== undefined && pair[0] !== 'xmlns')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return [expandedName(element), attrs, leadingText(element).trim(), elementChildren(element).map(canonicalTuple)]
}
