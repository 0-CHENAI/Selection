import { posix, win32 } from 'node:path'

/** Frozen before execution; the runtime never derives outputs from answer text. */
export interface WorkspaceDeliveryContract {
  version: 1
  inputs: string[]
  outputs: Record<string, string>
}

export function workspaceDeliveryContract(inputs: string[], outputs: Record<string, string>): WorkspaceDeliveryContract {
  const normalize = (value: string): string => {
    if (typeof value !== 'string' || !value || value.includes('\0') || posix.isAbsolute(value) || win32.isAbsolute(value) || /^[a-z]:/i.test(value)) {
      throw new Error('Delivery paths must be relative to the project')
    }
    const parts = value.replaceAll('\\', '/').split('/')
    if (parts.some(part => part === '..' || part.toLowerCase() === '.git')) throw new Error('Delivery path escapes the project or targets repository metadata')
    const path = posix.normalize(parts.join('/'))
    if (path === '.' || path.endsWith('/')) throw new Error('Delivery must name a file')
    return path
  }
  const entries = Object.entries(outputs)
  if (!entries.length) throw new Error('File delivery requires declared outputs')
  const names = new Set<string>()
  const normalizedOutputs = entries.map(([key, value]) => {
    if (!key.trim()) throw new Error('Delivery output name is empty')
    const path = normalize(value)
    // Keep a portable contract even when prepared on a case-sensitive host.
    const identity = path.toLowerCase()
    if (names.has(identity)) throw new Error('Delivery outputs contain duplicate paths')
    names.add(identity)
    return [key, path] as const
  })
  return { version: 1, inputs: [...new Set(inputs.map(normalize))], outputs: Object.fromEntries(normalizedOutputs) }
}
