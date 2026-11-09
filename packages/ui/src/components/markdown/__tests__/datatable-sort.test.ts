import { describe, expect, it } from 'bun:test'
import { compareDatatableText, isDatatableColumnSortable } from '../datatable-sort'

const chapters = [
  '一、执行摘要',
  '五、编程与智能体基准对比',
  '四、关键规格对比',
  '十、结论 + 附录',
  '三、Kimi K3 模型概览',
  '七、成本、生态与自部署',
  '六、双方优劣势分析',
  '九、数据可信度与风险提示',
  '封面 + 目录',
  '二、GLM-5.3 模型概览',
  '八、选型建议',
]

describe('datatable Chinese sorting', () => {
  it('orders numbered Chinese chapters numerically', () => {
    const sorted = [...chapters].sort(compareDatatableText)
    expect(sorted).toEqual([
      '一、执行摘要',
      '二、GLM-5.3 模型概览',
      '三、Kimi K3 模型概览',
      '四、关键规格对比',
      '五、编程与智能体基准对比',
      '六、双方优劣势分析',
      '七、成本、生态与自部署',
      '八、选型建议',
      '九、数据可信度与风险提示',
      '十、结论 + 附录',
      '封面 + 目录',
    ])
  })

  it('orders larger Chinese numerals and explicit chapter prefixes', () => {
    const values = ['第十二章', '第二章', '第二十章', '第2章']
    expect([...values].sort(compareDatatableText)).toEqual([
      '第2章',
      '第二章',
      '第十二章',
      '第二十章',
    ])
  })

  it('hides sorting for one row, identical values, and prose columns', () => {
    expect(isDatatableColumnSortable(['只有一行'])).toBe(false)
    expect(isDatatableColumnSortable(['文档', '文档'])).toBe(false)
    expect(isDatatableColumnSortable([
      '这是一段较长的说明文字，用于解释排版要求。',
      '另一段说明文字同样是完整句子，不需要按列排序。',
    ])).toBe(false)
    expect(isDatatableColumnSortable(['一、执行摘要', '二、模型概览'])).toBe(true)
  })

  it('keeps ordinary numeric text ordered by its number', () => {
    expect(['item 10', 'item 2'].sort(compareDatatableText)).toEqual(['item 2', 'item 10'])
  })
})
