/**
 * Attachment helpers for displaying file type icons and labels
 *
 * Shared utilities for rendering file attachments in user messages.
 * Used by both Electron app and web viewer.
 */

import { File, FileCode, FileArchive, FileAudio, FileVideo, Image as ImageIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { AttachmentType } from '@craft-agent/core'

// Comprehensive MIME type to human-friendly label mapping
const MIME_TYPE_LABELS: Record<string, string> = {
  // Documents
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/rtf': 'RTF',

  // Text & Markup
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
  'text/css': 'CSS',
  'text/csv': 'CSV',
  'text/xml': 'XML',
  'application/xml': 'XML',
  'application/json': 'JSON',
  'application/x-yaml': 'YAML',
  'text/yaml': 'YAML',

  // Code
  'text/javascript': 'JavaScript',
  'application/javascript': 'JavaScript',
  'text/typescript': 'TypeScript',
  'application/typescript': 'TypeScript',
  'text/x-python': 'Python',
  'text/x-java': 'Java',
  'text/x-c': 'C',
  'text/x-c++': 'C++',
  'text/x-csharp': 'C#',
  'text/x-go': 'Go',
  'text/x-rust': 'Rust',
  'text/x-swift': 'Swift',
  'text/x-kotlin': 'Kotlin',
  'text/x-ruby': 'Ruby',
  'text/x-php': 'PHP',
  'application/x-sh': 'Shell',
  'text/x-shellscript': 'Shell',

  // Images
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',

  // Archives
  'application/zip': 'ZIP',
  'application/x-rar-compressed': 'RAR',
  'application/x-7z-compressed': '7-Zip',
  'application/gzip': 'GZIP',
  'application/x-tar': 'TAR',

  // Media
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
}

// Extension fallback for when MIME type is generic (e.g., application/octet-stream)
const EXTENSION_LABELS: Record<string, string> = {
  // Code
  'js': 'JavaScript',
  'ts': 'TypeScript',
  'tsx': 'React TSX',
  'jsx': 'React JSX',
  'py': 'Python',
  'rb': 'Ruby',
  'go': 'Go',
  'rs': 'Rust',
  'swift': 'Swift',
  'kt': 'Kotlin',
  'java': 'Java',
  'c': 'C',
  'cpp': 'C++',
  'h': 'Header',
  'cs': 'C#',
  'php': 'PHP',
  'sh': 'Shell',
  'bash': 'Bash',
  'zsh': 'Zsh',

  // Config
  'json': 'JSON',
  'yaml': 'YAML',
  'yml': 'YAML',
  'toml': 'TOML',
  'xml': 'XML',
  'ini': 'Config',
  'env': 'Env',

  // Docs
  'md': 'Markdown',
  'txt': 'Text',
  'rtf': 'RTF',
  'pdf': 'PDF',
  'doc': 'Word',
  'docx': 'Word',
  'xls': 'Excel',
  'xlsx': 'Excel',
  'ppt': 'PowerPoint',
  'pptx': 'PowerPoint',
  'csv': 'CSV',
}

/**
 * Get a human-friendly label for a file type
 */
export function getFileTypeLabel(type: AttachmentType, mimeType: string, fileName?: string): string {
  // 1. Check exact MIME type match
  if (MIME_TYPE_LABELS[mimeType]) {
    return MIME_TYPE_LABELS[mimeType]
  }

  // 2. Try to extract from filename extension
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && EXTENSION_LABELS[ext]) {
      return EXTENSION_LABELS[ext]
    }
  }

  // 3. Fallback based on type category
  switch (type) {
    case 'pdf': return 'PDF'
    case 'office': return 'Document'
    case 'text': return 'Text'
    case 'image': return 'Image'
    default: return 'File'
  }
}

export interface FileTypeIconProps {
  type?: AttachmentType
  mimeType?: string
  fileName?: string
  className?: string
}

type FileIconKind = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'markdown' | 'text' | 'image' | 'code' | 'archive' | 'audio' | 'video' | 'file'

const ICON_EXTENSIONS: Partial<Record<FileIconKind, readonly string[]>> = {
  word: ['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'rtf'],
  excel: ['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'ods', 'csv', 'tsv'],
  powerpoint: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'odp'],
  pdf: ['pdf'],
  markdown: ['md', 'markdown', 'mdx'],
  text: ['txt', 'text', 'log'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif'],
  code: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'rb', 'swift', 'kt', 'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'scss', 'less', 'html', 'vue', 'svelte', 'json', 'yaml', 'yml', 'toml', 'xml', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'proto', 'php'],
  archive: ['zip', 'rar', '7z', 'gz', 'tar'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
}

/** Filename first: text/plain and octet-stream often hide a more specific format. */
export function getFileIconKind({ fileName, mimeType = '', type }: FileTypeIconProps): FileIconKind {
  const basename = fileName?.split(/[/\\]/).pop() ?? ''
  const dot = basename.lastIndexOf('.')
  const extension = dot > 0 ? basename.slice(dot + 1).toLowerCase() : ''
  for (const [kind, extensions] of Object.entries(ICON_EXTENSIONS)) {
    if (extensions.includes(extension)) return kind as FileIconKind
  }
  const mime = mimeType.split(';')[0]!.trim().toLowerCase()
  const label = MIME_TYPE_LABELS[mime]
  if (label === 'Word' || label === 'RTF') return 'word'
  if (label === 'Excel' || label === 'CSV') return 'excel'
  if (label === 'PowerPoint') return 'powerpoint'
  if (mime === 'application/pdf' || type === 'pdf') return 'pdf'
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'markdown'
  if (mime.startsWith('image/') || type === 'image') return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (['ZIP', 'RAR', '7-Zip', 'GZIP', 'TAR'].includes(label ?? '')) return 'archive'
  if (isCodeFile(mime)) return 'code'
  if (mime.startsWith('text/') || type === 'text') return 'text'
  return 'file'
}

const DOCUMENT_MARKS = { word: 'W', excel: 'X', powerpoint: 'P', pdf: 'PDF', markdown: 'MD', text: 'TXT' } as const

/** Shared by mentions, attachments and the session file tree. */
export function FileTypeIcon(props: FileTypeIconProps) {
  const kind = getFileIconKind(props)
  const color = kind === 'word' ? 'text-blue-600 dark:text-blue-400'
    : kind === 'powerpoint' ? 'text-orange-600 dark:text-orange-400'
    : kind === 'excel' ? 'text-green-600 dark:text-green-400'
    : kind === 'pdf' ? 'text-destructive'
    : kind === 'code' ? 'text-success'
    : kind === 'image' ? 'text-accent'
    : 'text-muted-foreground'
  const className = cn('h-4 w-4 shrink-0', color, props.className)

  if (kind in DOCUMENT_MARKS) {
    const mark = DOCUMENT_MARKS[kind as keyof typeof DOCUMENT_MARKS]
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" data-file-kind={kind}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <text x="12" y="17" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700" fontSize={mark.length === 1 ? 10 : 6.5}>{mark}</text>
      </svg>
    )
  }
  const Icon = { image: ImageIcon, code: FileCode, archive: FileArchive, audio: FileAudio, video: FileVideo, file: File }[kind as Exclude<FileIconKind, keyof typeof DOCUMENT_MARKS>]
  return <Icon className={className} aria-hidden="true" data-file-kind={kind} />
}

function isCodeFile(mimeType: string): boolean {
  return [
    'application/javascript', 'application/typescript', 'application/json',
    'text/javascript', 'text/typescript', 'text/css', 'text/html',
    'text/xml', 'application/xml', 'text/yaml', 'application/x-yaml',
  ].includes(mimeType) || mimeType.startsWith('text/x-')
}
