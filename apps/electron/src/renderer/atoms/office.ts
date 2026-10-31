import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { OfficeRequest } from '@craft-agent/shared/protocol'

/** Case picked on the blank Office home. The section route is the mode; this stores the case. */
export const officeComposerAtomFamily = atomFamily((_key: string) => atom<OfficeRequest | null>(null))
