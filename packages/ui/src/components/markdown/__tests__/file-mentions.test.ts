import { expect, it } from 'bun:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import { preprocessLinks } from '../linkify'
import { remarkFileMentions } from '../remark-file-mentions'

function links(text: string) {
  const value = preprocessLinks(text)
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFileMentions)
  const tree = processor.runSync(processor.parse(value), { value })
  const urls: string[] = []
  visit(tree, 'link', node => { urls.push(node.url) })
  return urls
}
it('keeps prose filename mentions plain across preprocessing and GFM autolinking', () => {
  expect(links('在 AGENTS.md 里加约束，参考 report.pdf 和 config.json。')).toEqual([])
})
it('preserves explicit file links, paths and real website links', () => {
  expect(links('[交付文件](report.docx) 与 /tmp/report.pdf 和 https://example.com')).toEqual(['report.docx', '/tmp/report.pdf', 'https://example.com'])
})
it('does not rewrite inline code or explicit Markdown links', () => {
  expect(links('`AGENTS.md` [AGENTS.md](AGENTS.md)')).toEqual(['AGENTS.md'])
})
