import * as React from 'react'
import type { Element, ElementContent } from 'hast'
import { MarkdownDatatableBlock } from './MarkdownDatatableBlock'

type TableElement = React.ReactElement<{ node?: Element; children?: React.ReactNode }>

function descendants(children: React.ReactNode, tag: string): TableElement[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ node?: Element; children?: React.ReactNode }>(child)) return []
    if (child.props.node?.tagName === tag || child.type === tag) return [child]
    return descendants(child.props.children, tag)
  })
}

function cellText(node: ElementContent): string {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return ''
  if (node.tagName === 'br') return '\n'
  if (node.tagName === 'img') return String(node.properties.alt ?? '')
  return node.children.map(cellText).join('')
}

/** Keep original inline rendering while using plain values for sorting/export. */
export function NativeMarkdownTable({ children }: { children?: React.ReactNode }) {
  const tableRows = descendants(children, 'tr')
  const headers = descendants(tableRows[0]?.props.children, 'th')
  if (!headers.length) return <div className="my-3 overflow-x-auto"><table>{children}</table></div>
  const cells = tableRows.slice(1).map(row => descendants(row.props.children, 'td'))
  const complex = descendants(children, 'caption').length > 0
    || cells.some(row => row.length !== headers.length)
    || [...headers, ...cells.flat()].some(cell => {
      const props = cell.props.node?.properties
      return (props?.colSpan !== undefined && props.colSpan !== 1)
        || (props?.rowSpan !== undefined && props.rowSpan !== 1)
        || descendants(cell.props.children, 'table').length > 0
    })
  // Data tables require a rectangular grid. Keep richer HTML structure intact.
  if (complex) return <div className="my-3 overflow-x-auto"><table>{children}</table></div>
  const columns = headers.map((header, index) => ({
    key: `column_${index}`,
    label: header.props.node ? cellText(header.props.node) : String(header.props.children ?? ''),
    type: 'text' as const,
    align: header.props.node?.properties.align as 'left' | 'center' | 'right' | undefined,
  }))
  const rows = cells.map((row, index) => Object.fromEntries([
    ['__markdownRow', index],
    ...columns.map((column, col) => [column.key, row[col]?.props.node ? cellText(row[col]!.props.node!) : '']),
  ]))
  return <MarkdownDatatableBlock
    code={JSON.stringify({ columns, rows })}
    className="my-3"
    renderHeader={key => headers[Number(key.slice('column_'.length))]?.props.children}
    renderCell={(row, key) => cells[Number(row.__markdownRow)]?.[Number(key.slice('column_'.length))]?.props.children}
  />
}
