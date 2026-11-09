import type { Plugin } from 'unified'

/** Keep range notation literal, while retaining GFM tables and task lists. */
export const remarkLiteralTildes: Plugin = function () {
  const data = this.data()
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = [])
  extensions.push({ disable: { null: ['strikethrough'] } })
}
