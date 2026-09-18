import { describe, expect, it } from 'bun:test'
import { getActiveTurnPreview, countWorkRecords, type ActivityItem } from '../turn-utils'

function createActivity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'activity',
    type: 'tool',
    status: 'completed',
    timestamp: 1,
    ...overrides,
  }
}

describe('getActiveTurnPreview', () => {
  it('没有意图的搜索调用在等待下一步时保留查询摘要', () => {
    const activities = [createActivity({
      toolName: 'WebSearch', displayName: '搜索网页',
      toolInput: { query: 'AnySearch\n使用方法', count: 5 },
    })]
    for (const phase of ['tool_active', 'awaiting', 'streaming'] as const) {
      expect(getActiveTurnPreview(activities, phase)).toBe('搜索网页 · AnySearch 使用方法')
    }
  })

  it('新的无意图工具覆盖旧摘要，且不会展示原始结果或任意参数', () => {
    const activities = [
      createActivity({ intent: '旧步骤', timestamp: 1 }),
      createActivity({ toolName: 'Read', displayName: '读取文件',
        toolInput: { file_path: '/tmp/report.md' }, timestamp: 2 }),
    ]
    expect(getActiveTurnPreview(activities, 'awaiting')).toBe('读取文件 · /tmp/report.md')
    activities.push(createActivity({ toolName: 'custom_tool', displayName: '检查状态',
      toolInput: { token: 'secret' }, content: '原始结果', timestamp: 3 }))
    expect(getActiveTurnPreview(activities, 'awaiting')).toBe('检查状态')
  })

  it('keeps the latest step title when native answer streaming begins', () => {
    const activities = [
      createActivity({ intent: '列出知识库', timestamp: 1 }),
      createActivity({ intent: '查看设计规范文件夹', timestamp: 2 }),
    ]
    expect(getActiveTurnPreview(activities, 'streaming'))
      .toBe(getActiveTurnPreview(activities, 'tool_active'))
    expect(getActiveTurnPreview(activities, 'streaming')).toBe('查看设计规范文件夹')
  })
  it('过程正文不会覆盖该轮已有的语义标题（#141）', () => {
    const activities = [
      createActivity({
        intent: '确认 OfficeCLI 运行时可用，准备读取招标文件',
        timestamp: 1,
      }),
      createActivity({
        type: 'intermediate',
        content: '已读取前 60% 内容，继续读取剩余章节',
        timestamp: 2,
      }),
    ]

    expect(getActiveTurnPreview(activities, 'tool_active'))
      .toBe('确认 OfficeCLI 运行时可用，准备读取招标文件')
  })

  it('选择最新工具意图覆盖该轮最初的意图', () => {
    const activities = [
      createActivity({ intent: '读取文件', timestamp: 1 }),
      createActivity({ intent: '定位第五章和第六章', timestamp: 3 }),
    ]

    expect(getActiveTurnPreview(activities, 'tool_active'))
      .toBe('定位第五章和第六章')
  })

  it('根据时间戳选择最新工具意图，不依赖活动数组的暂时顺序', () => {
    const activities = [
      createActivity({
        intent: '最新工具意图',
        timestamp: 5,
      }),
      createActivity({
        intent: '较早工具意图',
        timestamp: 2,
      }),
    ]

    expect(getActiveTurnPreview(activities, 'awaiting'))
      .toBe('最新工具意图')
  })

  it('新工具阶段仍会更新标题，不回归旧标题停滞问题（#34）', () => {
    const activities = [
      createActivity({ intent: '准备读取文件', timestamp: 1 }),
      createActivity({
        type: 'intermediate',
        content: '已读取文件，准备定位章节',
        timestamp: 2,
      }),
      createActivity({ intent: '定位第五章和第六章', timestamp: 3 }),
    ]

    expect(getActiveTurnPreview(activities, 'awaiting'))
      .toBe('定位第五章和第六章')
  })

  it('使用最新状态消息作为当前进展', () => {
    const activities = [
      createActivity({ intent: '分析上下文', timestamp: 1 }),
      createActivity({
        type: 'status',
        content: '正在压缩上下文',
        timestamp: 2,
      }),
    ]

    expect(getActiveTurnPreview(activities, 'awaiting'))
      .toBe('正在压缩上下文')
  })

  it('does not use raw commentary as the streaming step title', () => {
    const activities = [
      createActivity({
        type: 'intermediate',
        content: '最后一条思考内容',
        timestamp: 2,
      }),
    ]

    expect(getActiveTurnPreview(activities, 'complete')).toBeUndefined()
    expect(getActiveTurnPreview(activities, 'streaming')).toBeUndefined()
  })

  it('忽略工具结果、思考和过程正文的原始内容及非工具 intent', () => {
    const activities = [
      createActivity({ content: '工具原始输出', timestamp: 2 }),
      createActivity({ type: 'thinking', content: '内部思考内容', intent: '内部思考标题', timestamp: 3 }),
      createActivity({ type: 'intermediate', content: '最后一段过程正文', intent: '过程正文标题', timestamp: 4 }),
    ]

    expect(getActiveTurnPreview(activities, 'awaiting')).toBeUndefined()
  })
})


it('记录总数包含过程说明，忽略空占位并对工具更新去重', () => {
  const tools = Array.from({ length: 2 }, (_, i) => createActivity({ id: `tool-${i}`, toolUseId: `call-${i}` }))
  const notes = Array.from({ length: 3 }, (_, i) => createActivity({ id: `note-${i}`, type: 'intermediate', content: `过程说明${i}` }))
  expect(countWorkRecords([...tools, ...notes])).toBe(5)
  expect(countWorkRecords([...tools, ...notes, createActivity({ id: 'empty', type: 'intermediate', content: '\n', status: 'running' })])).toBe(5)
  expect(countWorkRecords([...tools, ...notes.map(note => ({ ...note, status: 'completed' as const }))])).toBe(5)
  expect(countWorkRecords([...tools, ...notes, { ...tools[0]!, id: 'updated', status: 'completed' }])).toBe(5)
})
