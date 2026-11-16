import type { Component, InjectionKey } from 'vue'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  confirmLoadingLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default' | 'outline'
  icon?: Component
  showWarning?: boolean
  warningMessage?: string
  action?: () => Promise<void>
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

export const confirmInjectionKey: InjectionKey<ConfirmFn> = Symbol('confirm')

export function useConfirm() {
  const confirm = inject(confirmInjectionKey)
  if (!confirm) {
    throw new Error('useConfirm() requires <ConfirmDialogProvider> in a parent component.')
  }
  return { confirm }
}
