import { defaultUrlTransform, type UrlTransform } from 'react-markdown'
import { isPreservedMarkdownImageSrc } from './markdown-image-source'

export const markdownUrlTransform: UrlTransform = (value, key, node) => {
  const tagName = typeof node === 'object' && node && 'tagName' in node
    ? String((node as { tagName?: unknown }).tagName)
    : ''

  // ReactMarkdown's default transform strips file:/javascript:/data: before
  // custom components receive props. For anchors, preserve the original target
  // so our custom <a> can route normal clicks through onFileClick/onUrlClick
  // while still writing a separately sanitized DOM href.
  if (key === 'href' && tagName === 'a') return value

  // Images use the same preserve-then-load path: local/file/data sources must
  // reach MarkdownImage. javascript:/vbscript:/blob: stay stripped.
  if (key === 'src' && (tagName === 'img' || tagName === '')) {
    return isPreservedMarkdownImageSrc(value) ? value : ''
  }

  return defaultUrlTransform(value)
}
