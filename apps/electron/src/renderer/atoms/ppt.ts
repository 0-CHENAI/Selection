import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { PptRequest } from '@craft-agent/shared/protocol'
import { sessionAtomFamily } from './sessions'

export type PptComposerRequest = PptRequest | null | undefined

/** One template per composer; null is an explicit removal, undefined inherits saved settings. */
export function replacePptTemplate(request: PptComposerRequest, templateId: string): PptRequest {
  return { ...request, templateId }
}

/** Explicit composer choice. Undefined inherits the saved session; null means the user removed it. */
export const pptComposerOverrideAtomFamily = atomFamily((_key: string) => atom<PptComposerRequest>(undefined))
export const pptComposerAtomFamily = atomFamily((key: string) => atom(
  get => {
    const override = get(pptComposerOverrideAtomFamily(key))
    return override === undefined ? get(sessionAtomFamily(key))?.ppt : override
  },
  (get, set, update: PptComposerRequest | ((previous: PptComposerRequest) => PptComposerRequest)) => {
    const previous = get(pptComposerAtomFamily(key))
    set(pptComposerOverrideAtomFamily(key), typeof update === 'function' ? update(previous) : update)
  },
))
