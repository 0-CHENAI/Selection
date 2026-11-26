import type { Session } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadWorkspaceProjects } from '@craft-agent/shared/projects'

type Choice =
  | { kind: 'group'; label: string; projectId?: string }
  | { kind: 'session'; label: string; id: string; projectId?: string }

interface Menu {
  chat: string
  title: string
  choices: Choice[]
  page: number
}

const PAGE_SIZE = 10

function listProjects(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  return workspace ? loadWorkspaceProjects(workspace.rootPath).map(project => project.config) : []
}

function displayName(name: string) {
  return name.replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function weixinSessionTitle(session: Pick<Session, 'workspaceId' | 'id' | 'name' | 'projectId'>,
  projects: (workspaceId: string) => { id: string; name: string }[] = listProjects): string {
  const project = session.projectId
    ? projects(session.workspaceId).find(p => p.id === session.projectId)?.name || session.projectId
    : '普通会话'
  return `${displayName(project)} / ${displayName(session.name || session.id)}`
}

export function isWeixinConversation(s: Session): boolean {
  const root = s.executionRootSessionId ?? s.orchestrationRootSessionId
  return !s.isArchived && !s.hidden && !s.parentSessionId && !s.taskNodeId &&
    s.orchestrationRole !== 'worker' && s.orchestrationRole !== 'reviewer' && (!root || root === s.id) &&
    !s.ppt && s.office?.mode !== 'word' && s.office?.mode !== 'excel'
}

// One personal WeChat peer per workspace. Numbers refer to the displayed
// snapshot, even if new messages reorder the desktop session list.
export class WeixinSessionPicker {
  private menu?: Menu
  private expiresAt = 0

  constructor(private readonly workspaceId: string, private readonly projects: (id: string) => { id: string; name: string }[] = listProjects) {}

  commandForReply(chat: string, text: string): string | undefined {
    if (this.menu?.chat !== chat) return
    if (Date.now() < this.expiresAt) {
      if (/^\d+$/.test(text)) return '/bind ' + text
      if (text === '下一页') return '/bind next'
      if (text === '上一页') return '/bind prev'
      if (text === '取消') return '/bind cancel'
      if (/^\/bind(?:\s|$)/i.test(text)) return
    }
    this.menu = undefined
  }

  select(chat: string, arg: string, all: Session[]): { text: string } | { session: Session } {
    if (Date.now() >= this.expiresAt) this.menu = undefined
    if (arg === 'cancel') {
      this.menu = undefined
      return { text: '已退出会话选择。' }
    }
    const sessions = all.filter(s => s.workspaceId === this.workspaceId && isWeixinConversation(s))
    if (!arg) {
      const groups = new Map(this.projects(this.workspaceId).map(p => [p.id, p.name]))
      for (const s of sessions) {
        if (s.projectId && !groups.has(s.projectId)) groups.set(s.projectId, s.projectId)
      }
      this.menu = { chat, title: '选择普通会话或项目', page: 0, choices: [
        { kind: 'group', label: '普通会话' },
        ...Array.from(groups, ([projectId, name]): Choice => ({ kind: 'group', projectId, label: '项目 · ' + displayName(name) })),
      ] }
    } else if (arg === 'next' || arg === 'prev' || /^\d+$/.test(arg)) {
      const menu = this.menu
      if (!menu || menu.chat !== chat) return { text: '请先发送 /bind 打开选择列表。' }
      if (arg === 'next' || arg === 'prev') {
        const last = Math.max(0, Math.ceil(menu.choices.length / PAGE_SIZE) - 1)
        this.menu = { ...menu, page: Math.max(0, Math.min(last, menu.page + (arg === 'next' ? 1 : -1))) }
      } else {
        const index = Number(arg) - 1
        const choice = menu.choices[index]
        if (!choice || Math.floor(index / PAGE_SIZE) !== menu.page) return { text: '请使用当前页显示的编号，或发送 /bind 重新选择。' }
        if (choice.kind === 'session') {
          const session = sessions.find(s => s.id === choice.id && (s.projectId || undefined) === choice.projectId)
          if (!session) return { text: '该会话已移出此列表，请发送 /bind 重新选择。' }
          this.menu = undefined
          return { session }
        }
        this.menu = { chat, title: choice.label, page: 0, choices: sessions
          .filter(s => (s.projectId || undefined) === choice.projectId)
          .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
          .map(s => ({ kind: 'session', id: s.id, projectId: choice.projectId, label: displayName(s.name || s.preview || s.id) })) }
      }
    } else {
      const session = sessions.find(s => s.id === arg)
      if (!session) return { text: '找不到该会话，请发送 /bind 重新选择。' }
      this.menu = undefined
      return { session }
    }
    this.expiresAt = Date.now() + 5 * 60_000
    const { title, choices, page } = this.menu
    const start = page * PAGE_SIZE
    const lines = choices.slice(start, start + PAGE_SIZE).map((choice, i) => `${start + i + 1}. ${choice.label}`)
    if (!lines.length) lines.push('暂无可绑定的会话。')
    if (page > 0) lines.push('回复「上一页」翻页')
    if (start + PAGE_SIZE < choices.length) lines.push('回复「下一页」翻页')
    return { text: [title, ...lines, '回复编号选择，回复「取消」退出。发送 /bind 返回首层。'].join('\n') }
  }
}
