import { describe, expect, it } from 'bun:test'
import { getActiveTurnPreview, type ActivityItem } from '../turn-utils'

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

  it('完成态和最终回复流式阶段不再使用活动进展标题', () => {
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
