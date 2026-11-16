<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

interface Props {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  confirmLoadingLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default' | 'outline'
  loading?: boolean
  icon?: Component
  showWarning?: boolean
  warningMessage?: string
}

withDefaults(defineProps<Props>(), {
  confirmLabel: 'Confirmer',
  confirmLoadingLabel: 'En cours...',
  cancelLabel: 'Annuler',
  variant: 'destructive',
  loading: false,
  showWarning: false,
  warningMessage: 'Cette action est irréversible.',
})

defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()
</script>

<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent
      :prevent-outside-click="true"
      class="max-w-[90vw] sm:max-w-[425px] max-h-[90vh] overflow-y-auto"
    >
      <UiDialogHeader>
        <UiDialogTitle :class="{ 'text-destructive': variant === 'destructive' }">
          {{ title }}
        </UiDialogTitle>
        <UiDialogDescription v-if="description">
          {{ description }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="py-4 space-y-4">
        <slot />

        <div
          v-if="showWarning"
          class="p-4 border border-destructive/20 bg-destructive/5 rounded-lg"
        >
          <div class="flex items-center gap-2 text-destructive">
            <AlertTriangle class="h-4 w-4 flex-shrink-0" />
            <span class="font-medium">Attention</span>
          </div>
          <p class="text-sm text-muted-foreground mt-2">
            {{ warningMessage }}
          </p>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton
          variant="outline"
          class="w-full sm:w-auto"
          :disabled="loading"
          @click="$emit('update:open', false)"
        >
          {{ cancelLabel }}
        </UiButton>
        <UiButton
          :variant="variant"
          class="w-full sm:w-auto"
          :disabled="loading"
          @click="$emit('confirm')"
        >
          <template v-if="loading">
            <AppSpinner class="mr-2 h-4 w-4" />
            <span class="truncate">{{ confirmLoadingLabel }}</span>
          </template>
          <template v-else>
            <component
              :is="icon"
              v-if="icon"
              class="mr-2 h-4 w-4 flex-shrink-0"
            />
            <span class="truncate">{{ confirmLabel }}</span>
          </template>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
