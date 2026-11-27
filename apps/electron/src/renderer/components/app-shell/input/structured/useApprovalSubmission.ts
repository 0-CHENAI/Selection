import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function useApprovalSubmission() {
  const { t } = useTranslation()
  // Prevent double-submit while parent clears the pending queue asynchronously
  const [responded, setResponded] = useState(false)
  const respondedRef = useRef(false)

  const submit = async (send: () => void | Promise<void>) => {
    if (respondedRef.current) return
    respondedRef.current = true
    setResponded(true)
    try {
      await send()
    } catch (error) {
      respondedRef.current = false
      setResponded(false)
      toast.error(t('common.error'), { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return { responded, submit }
}
