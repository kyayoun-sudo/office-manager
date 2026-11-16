<script setup lang="ts">
import type { ConfirmOptions, ConfirmFn } from '~/composables/useConfirm'
import { confirmInjectionKey } from '~/composables/useConfirm'

const isOpen = ref(false)
const isLoading = ref(false)
const options = shallowRef<ConfirmOptions>({
  title: '',
})

let resolvePromise: ((value: boolean) => void) | null = null

const confirm: ConfirmFn = (opts) => {
  if (resolvePromise) {
    resolvePromise(false)
    resolvePromise = null
  }

  options.value = opts
  isOpen.value = true
  isLoading.value = false

  return new Promise<boolean>((resolve) => {
    resolvePromise = resolve
  })
}

const handleCancel = () => {
  isOpen.value = false
  isLoading.value = false
  if (resolvePromise) {
    resolvePromise(false)
    resolvePromise = null
  }
}

const handleConfirm = async () => {
  if (options.value.action) {
    isLoading.value = true
    try {
      await options.value.action()
      isOpen.value = false
      isLoading.value = false
      if (resolvePromise) {
        resolvePromise(true)
        resolvePromise = null
      }
    } catch {
      isLoading.value = false
    }
  } else {
    isOpen.value = false
    if (resolvePromise) {
      resolvePromise(true)
      resolvePromise = null
    }
  }
}

provide(confirmInjectionKey, confirm)
</script>

<template>
  <slot />
  <ConfirmDialog
    :open="isOpen"
    :title="options.title"
    :description="options.description"
    :confirm-label="options.confirmLabel"
    :confirm-loading-label="options.confirmLoadingLabel"
    :cancel-label="options.cancelLabel"
    :variant="options.variant"
    :icon="options.icon"
    :loading="isLoading"
    :show-warning="options.showWarning"
    :warning-message="options.warningMessage"
    @update:open="handleCancel"
    @confirm="handleConfirm"
  />
</template>
