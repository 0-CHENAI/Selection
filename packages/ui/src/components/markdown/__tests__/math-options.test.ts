import { describe, it, expect } from 'bun:test'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { MARKDOWN_MATH_OPTIONS, protectCurrencyDollars } from '../math-options'

type MdNode = {
  type: string
  value?: string
  children?: MdNode[]
}

function parseMarkdown(input: string): MdNode {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, MARKDOWN_MATH_OPTIONS)
  return processor.runSync(processor.parse(protectCurrencyDollars(input))) as MdNode
}

function collectMathValues(node: MdNode, type: 'inlineMath' | 'math'): string[] {
  const values: string[] = []
  const walk = (current: MdNode) => {
    if (current.type === type && typeof current.value === 'string') {
      values.push(current.value)
    }
    for (const child of current.children ?? []) {
      walk(child)
    }
  }
  walk(node)
  return values
}

describe('protectCurrencyDollars', () => {
  it('escapes currency amounts and ranges but leaves paired math alone', () => {
    expect(protectCurrencyDollars('$100, $2M–$4M ARR/employee, $12.5')).toBe(
      '\\$100, \\$2M–\\$4M ARR/employee, \\$12.5'
    )
    expect(protectCurrencyDollars('$A$ $E=mc^2$')).toBe('$A$ $E=mc^2$')
    expect(protectCurrencyDollars('already \\$100')).toBe('already \\$100')
  })

  it('does not rewrite dollars inside code or display math', () => {
    expect(protectCurrencyDollars('use `$100` in prose')).toBe('use `$100` in prose')
    expect(protectCurrencyDollars('```\n$100\n```')).toBe('```\n$100\n```')
    expect(protectCurrencyDollars('The formula is $$E=mc^2$$.')).toBe('The formula is $$E=mc^2$$.')
    expect(protectCurrencyDollars('$$100 + x$$')).toBe('$$100 + x$$')
  })

  it('keeps an unclosed display-math opener intact for streaming', () => {
    expect(protectCurrencyDollars('$$100 + x')).toBe('$$100 + x')
  })
})

describe('MARKDOWN_MATH_OPTIONS', () => {
  it('renders paired single-dollar math next to Chinese punctuation', () => {
    const tree = parseMarkdown('三扇门编号为 $A$（你最初选的门）、$B$、$C$')
    expect(collectMathValues(tree, 'inlineMath')).toEqual(['A', 'B', 'C'])
  })

  it('renders $E=mc^2$ inline and keeps $$E=mc^2$$ working', () => {
    expect(collectMathValues(parseMarkdown('The formula is $E=mc^2$.'), 'inlineMath')).toEqual([
      'E=mc^2',
    ])
    expect(collectMathValues(parseMarkdown('The formula is $$E=mc^2$$.'), 'inlineMath')).toEqual([
      'E=mc^2',
    ])
  })

  it('does not treat currency-like single-dollar text as inline math', () => {
    expect(collectMathValues(parseMarkdown('**$2M–$4M ARR/employee**'), 'inlineMath')).toEqual([])
    expect(collectMathValues(parseMarkdown('Price is $100 and $12.5.'), 'inlineMath')).toEqual([])
  })

  it('does not let a currency amount steal a later math closer', () => {
    const tree = parseMarkdown('costs $100 and formula $E=mc^2$')
    expect(collectMathValues(tree, 'inlineMath')).toEqual(['E=mc^2'])
  })

  it('still supports explicit $$ math delimiters', () => {
    const tree = parseMarkdown('The formula is $$E=mc^2$$.')
    expect(collectMathValues(tree, 'inlineMath')).toEqual(['E=mc^2'])
  })

  it('keeps probability formulas with \\mid, subscripts, and complements as inline math', () => {
    const tree = parseMarkdown(
      String.raw`后验 $P(H_3\mid A_1)$ 和 $P(H_3\mid A_1^c)$`,
    )
    expect(collectMathValues(tree, 'inlineMath')).toEqual([
      String.raw`P(H_3\mid A_1)`,
      String.raw`P(H_3\mid A_1^c)`,
    ])
  })
})
