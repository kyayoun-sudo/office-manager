<template>
  <div class="flex items-center gap-3 flex-wrap">
    <UiPopover v-model:open="pickerOpen">
      <UiPopoverTrigger as-child>
        <button
          class="flex h-9 w-48 items-center justify-between rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <span :class="visibleFilterKeys.length > 0 ? 'text-foreground' : 'text-muted-foreground'" class="truncate">
            {{ visibleFilterKeys.length > 0 ? `${visibleFilterKeys.length} filtre${visibleFilterKeys.length > 1 ? 's' : ''}` : 'Filtre de recherche' }}
          </span>
          <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent class="w-48 p-1" align="start">
        <div
          v-for="field in allFilterFields"
          :key="field.key"
          class="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
          @click="toggleFilterVisibility(field.key)"
        >
          {{ field.label }}
          <span class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
            <Check v-if="visibleFilterKeys.includes(field.key)" class="h-4 w-4" />
          </span>
        </div>
      </UiPopoverContent>
    </UiPopover>

    <template v-for="field in visibleFields" :key="field.key">
      <div class="flex items-center gap-1">
        <slot :name="`filter-${field.key}`" :field="field" :value="filters[field.key]" :update="(v: any) => updateField(field.key, v)">
          <UiSelect
            v-if="field.type === 'select'"
            :model-value="getFieldValue(field.key)"
            :disabled="field.loading"
            @update:model-value="updateField(field.key, $event)"
          >
            <UiSelectTrigger class="h-9 min-w-36">
              <UiSelectValue :placeholder="field.placeholder" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem
                v-for="option in field.options"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>

          <UiInput
            v-else-if="field.type === 'input'"
            :model-value="getFieldValue(field.key)"
            :type="field.inputType || 'text'"
            :placeholder="field.placeholder"
            :min="field.min"
            :max="field.max"
            class="h-9 w-44"
            @update:model-value="updateField(field.key, $event)"
            @keyup.enter="mode === 'manual' && emit('search')"
          />

          <UiInput
            v-else-if="field.type === 'date'"
            :model-value="getFieldValue(field.key)"
            type="date"
            :placeholder="field.placeholder"
            class="h-9"
            @update:model-value="updateField(field.key, $event)"
          />

          <div v-else-if="field.type === 'daterange'" class="flex gap-2">
            <UiInput
              :model-value="getFieldValue(field.fromKey!)"
              type="date"
              :placeholder="field.fromPlaceholder || 'Du'"
              class="h-9 flex-1"
              @update:model-value="updateField(field.fromKey!, $event)"
            />
            <UiInput
              :model-value="getFieldValue(field.toKey!)"
              type="date"
              :placeholder="field.toPlaceholder || 'Au'"
              class="h-9 flex-1"
              @update:model-value="updateField(field.toKey!, $event)"
            />
          </div>

          <div v-else-if="field.type === 'checkbox'" class="flex items-center space-x-2">
            <input
              :checked="getFieldValue(field.key)"
              type="checkbox"
              :id="`filter-${field.key}`"
              class="rounded border-border"
              @change="updateField(field.key, ($event.target as HTMLInputElement).checked)"
            >
            <label :for="`filter-${field.key}`" class="text-sm">{{ field.checkboxLabel }}</label>
          </div>
        </slot>

        <button
          class="flex-shrink-0 hover:bg-destructive/10 hover:text-destructive rounded-sm p-1"
          @click="removeFilter(field.key)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </template>

    <UiButton
      v-if="mode === 'manual'"
      size="sm"
      @click="emit('search')"
    >
      <Search class="h-4 w-4 mr-2" />
      Rechercher
    </UiButton>

    <UiButton
      v-if="activeFiltersCount > 0"
      variant="ghost"
      size="sm"
      class="text-muted-foreground"
      @click="clearAllFilters"
    >
      <XCircle class="h-4 w-4 mr-2" />
      Effacer
    </UiButton>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronDown, Search, X, XCircle } from 'lucide-vue-next'

export interface FilterField {
  key: string
  label: string
  type: 'select' | 'input' | 'date' | 'daterange' | 'checkbox'
  placeholder?: string
  checkboxLabel?: string
  inputType?: 'text' | 'number' | 'email'
  options?: Array<{ value: string | number; label: string }>
  loading?: boolean
  min?: number
  max?: number
  fromKey?: string
  toKey?: string
  fromPlaceholder?: string
  toPlaceholder?: string
  icon?: any
  defaultVisible?: boolean
}

export interface SearchConfig {
  label?: string
  placeholder?: string
}

interface Props {
  title?: string
  searchConfig?: SearchConfig
  searchValue?: string
  filterFields?: FilterField[]
  filters: Record<string, any>
  showSummary?: boolean
  resultCount?: number
  resultLabel?: string
  totalCount?: number
  clearAllText?: string
  mode?: 'immediate' | 'manual'
}

const props = withDefaults(defineProps<Props>(), {
  showSummary: true,
  resultLabel: 'résultats',
  mode: 'immediate',
})

const emit = defineEmits<{
  'update:search': [value: string]
  'update:filters': [filters: Record<string, any>]
  'clear-all': []
  'search': []
}>()

const pickerOpen = ref(false)

const allFilterFields = computed(() => props.filterFields ?? [])

const visibleFilterKeys = ref<string[]>(
  (props.filterFields ?? []).filter(f => f.defaultVisible).map(f => f.key),
)

watch(() => props.filterFields, (fields) => {
  if (!fields) return
  const defaultKeys = fields.filter(f => f.defaultVisible).map(f => f.key)
  for (const key of defaultKeys) {
    if (!visibleFilterKeys.value.includes(key)) {
      visibleFilterKeys.value = [...visibleFilterKeys.value, key]
    }
  }
}, { once: true })

const visibleFields = computed(() =>
  allFilterFields.value.filter(f => visibleFilterKeys.value.includes(f.key)),
)

const activeFiltersCount = computed(() => {
  let count = 0
  if (props.searchValue?.trim()) count++

  for (const field of visibleFields.value) {
    const value = props.filters[field.key]
    if (field.type === 'checkbox' && value) count++
    else if (field.type === 'daterange') {
      if (props.filters[field.fromKey!] || props.filters[field.toKey!]) count++
    } else if (value && value !== 'all' && value !== '') count++
  }

  return count
})

const resetFieldValue = (key: string) => {
  const field = allFilterFields.value.find(f => f.key === key)
  if (!field) return
  if (field.type === 'daterange') {
    emit('update:filters', { ...props.filters, [field.fromKey!]: '', [field.toKey!]: '' })
  } else if (field.type === 'checkbox') {
    emit('update:filters', { ...props.filters, [key]: false })
  } else {
    emit('update:filters', { ...props.filters, [key]: '' })
  }
}

const toggleFilterVisibility = (key: string) => {
  const idx = visibleFilterKeys.value.indexOf(key)
  if (idx >= 0) {
    visibleFilterKeys.value = visibleFilterKeys.value.filter(k => k !== key)
    resetFieldValue(key)
  } else {
    visibleFilterKeys.value = [...visibleFilterKeys.value, key]
  }
}

const removeFilter = (key: string) => {
  visibleFilterKeys.value = visibleFilterKeys.value.filter(k => k !== key)
  resetFieldValue(key)
}

const getFieldValue = (key: string) => props.filters[key]

const updateField = (key: string, value: any) => {
  const newFilters = { ...props.filters, [key]: value }
  emit('update:filters', newFilters)
}

const clearAllFilters = () => {
  visibleFilterKeys.value = []
  emit('clear-all')
}
</script>
