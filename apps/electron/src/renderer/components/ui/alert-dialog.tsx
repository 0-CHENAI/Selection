import * as React from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Button } from './button'
import { cn } from '@/lib/utils'

export const AlertDialog = Dialog
export const AlertDialogTrigger = DialogTrigger
export const AlertDialogHeader = DialogHeader
export const AlertDialogFooter = DialogFooter
export const AlertDialogTitle = DialogTitle
export const AlertDialogDescription = DialogDescription

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      role="alertdialog"
      showCloseButton={false}
      className={cn('sm:max-w-[420px]', className)}
      {...props}
    />
  )
}

export function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose asChild>
      <Button variant="outline" className={className} {...props} />
    </DialogClose>
  )
}

export function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button className={className} {...props} />
}
