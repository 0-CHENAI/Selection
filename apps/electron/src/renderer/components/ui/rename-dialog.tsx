import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useRegisterModal } from "@/context/ModalContext"

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void | Promise<void>
  placeholder?: string
  description?: string
  allowEmpty?: boolean
  maxLength?: number
}

export function RenameDialog({
  open,
  onOpenChange,
  title,
  value,
  onValueChange,
  onSubmit,
  placeholder,
  description,
  allowEmpty = false,
  maxLength,
}: RenameDialogProps) {
  const { t } = useTranslation()
  const effectivePlaceholder = placeholder ?? t("common.enterName")
  const inputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Register with modal context so X button / Cmd+W closes this dialog first
  useRegisterModal(open, () => onOpenChange(false))

  // Focus input after dialog opens (avoids Radix Dialog focus race condition)
  useEffect(() => {
    if (open) {
      setIsSubmitting(false)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const canSubmit = allowEmpty || Boolean(value.trim())

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={effectivePlaceholder}
            maxLength={maxLength}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSubmit()
              }
            }}
          />
          {description && (
            <p className="mt-2 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
