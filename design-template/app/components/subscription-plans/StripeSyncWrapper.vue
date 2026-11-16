<script setup lang="ts">
import StripeSyncDialog from './StripeSyncDialog.vue'
import type { SyncResultResponse } from '~/types/stripe-sync'
import type { Plan } from '~~/shared/types/subscription-plan'

interface Props {
  open: boolean
  plans: Plan[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'sync-completed': [result: SyncResultResponse]
}>()

// Client-side only loading to avoid hydration issues
const mounted = ref(false)

onMounted(() => {
  mounted.value = true
  console.log('StripeSyncWrapper mounted')
})

// Watch pour débugger
watch(() => props.open, (newValue) => {
  console.log('StripeSyncWrapper - props.open changed:', newValue)
}, { immediate: true })

const handleUpdateOpen = (value: boolean) => {
  emit('update:open', value)
}

const handleSyncCompleted = (result: SyncResultResponse) => {
  emit('sync-completed', result)
}
</script>

<template>
  <ClientOnly>
    <StripeSyncDialog
      v-if="mounted"
      :open="props.open"
      :plans="props.plans"
      @update:open="handleUpdateOpen"
      @sync-completed="handleSyncCompleted"
    />
    <template #fallback>
      <!-- Placeholder pendant le chargement côté client -->
      <div v-if="props.open" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-background p-4 rounded-lg">
          <div class="flex items-center gap-2">
            <div class="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"/>
            Chargement...
          </div>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>