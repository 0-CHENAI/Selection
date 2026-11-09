import * as React from 'react'
export interface MockSlots { leadingAttachments?: React.ReactNode; afterAttachBadge?: React.ReactNode; aboveInput?: React.ReactNode; promptLeading?: React.ReactNode }
export const MockSlotsContext = React.createContext<MockSlots>({})
export const useMockSlots = () => React.useContext(MockSlotsContext)
