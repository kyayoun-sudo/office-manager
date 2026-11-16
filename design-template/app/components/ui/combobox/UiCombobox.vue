<template>
  <UiPopover v-model:open="open">
    <UiPopoverTrigger as-child>
      <UiButton
        variant="outline"
        role="combobox"
        :aria-expanded="open"
        :class="cn(
          'w-full justify-between',
          !value && 'text-muted-foreground',
          triggerClass
        )"
      >
        <slot name="trigger" :value="value" :displayValue="displayValue">
          {{ displayValue || placeholder }}
        </slot>
        <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </UiButton>
    </UiPopoverTrigger>
    <UiPopoverContent :class="cn('w-full p-0', contentClass)" :style="{ width: triggerWidth }">
      <UiCommand>
        <UiCommandInput
          :placeholder="searchPlaceholder"
          :model-value="searchValue"
          @update:model-value="$emit('update:search', $event)"
        />
        <UiCommandEmpty>{{ emptyText }}</UiCommandEmpty>
        <UiCommandList>
          <UiCommandGroup>
            <slot name="options" :close="() => open = false" />
          </UiCommandGroup>
        </UiCommandList>
      </UiCommand>
    </UiPopoverContent>
  </UiPopover>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { ChevronsUpDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

interface Props {
  modelValue?: any
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  triggerClass?: string
  contentClass?: string
  disabled?: boolean
  getDisplayValue?: (value: any) => string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Sélectionner une option...',
  searchPlaceholder: 'Rechercher...',
  emptyText: 'Aucun élément trouvé.',
  getDisplayValue: (value: any) => value?.toString() || ''
})

const emit = defineEmits<{
  'update:modelValue': [value: any]
  'update:search': [value: string]
}>()

// État
const open = ref(false)
const searchValue = ref('')
const triggerWidth = ref('auto')

// Computed
const value = computed({
  get: () => props.modelValue,
  set: (newValue) => emit('update:modelValue', newValue)
})

const displayValue = computed(() => {
  if (!value.value) return ''
  return props.getDisplayValue(value.value)
})

// Méthodes
const updateTriggerWidth = async () => {
  await nextTick()
  const trigger = document.querySelector('[role="combobox"]') as HTMLElement
  if (trigger) {
    triggerWidth.value = `${trigger.offsetWidth}px`
  }
}

onMounted(() => {
  updateTriggerWidth()
  window.addEventListener('resize', updateTriggerWidth)
})
</script>