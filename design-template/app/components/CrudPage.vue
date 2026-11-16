<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type {
  FilterField,
  SearchConfig,
} from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

interface Props {
  title: string
  subtitle?: string
  createLabel?: string
  hideCreateButton?: boolean
  items?: any[]
  totalItems?: any[]
  tableConfig?: DataTableConfig
  isLoading?: boolean
  searchConfig?: SearchConfig
  searchValue?: string
  filterFields?: FilterField[]
  filters?: Record<string, any>
  resultCount?: number
  resultLabel?: string
  totalCount?: number
  mode?: 'immediate' | 'manual'
}

const props = withDefaults(defineProps<Props>(), {
  resultLabel: 'resultat',
  isLoading: false,
  mode: 'immediate',
})

const emit = defineEmits<{
  create: []
  'row-action': [action: string, item: any]
  'bulk-action': [action: string, items: any[]]
  'update:search': [value: string]
  'update:filters': [filters: Record<string, any>]
  'clear-all': []
  search: []
}>()

const slots = defineSlots<{
  'header-actions'?: () => any
  filters?: () => any
  table?: () => any
  'table-footer'?: () => any
  dialogs?: () => any
  form?: () => any
}>()

const showDefaultCreate = computed(
  () =>
    !props.hideCreateButton && props.createLabel && !slots['header-actions'],
)
const showDefaultFilters = computed(() => !slots.filters)
const showDefaultTable = computed(
  () => props.tableConfig && props.items && !slots.table,
)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="text-muted-foreground">{{ subtitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <slot name="header-actions">
          <UiButton
            v-if="showDefaultCreate"
            @click="emit('create')"
          >
            <Plus class="mr-2 h-4 w-4" />
            {{ createLabel }}
          </UiButton>
        </slot>
      </div>
    </div>

    <slot name="filters">
      <UniversalFilters
        v-if="showDefaultFilters"
        title="Filtres"
        :search-config="searchConfig"
        :search-value="searchValue"
        :filter-fields="filterFields"
        :filters="filters"
        :show-summary="true"
        :result-count="resultCount"
        :result-label="resultLabel"
        :total-count="totalCount"
        :mode="mode"
        clear-all-text="Effacer les filtres"
        @update:search="emit('update:search', $event)"
        @update:filters="emit('update:filters', $event)"
        @clear-all="emit('clear-all')"
        @search="emit('search')"
      />
    </slot>

    <slot name="table">
      <GenericDataTable
        v-if="showDefaultTable"
        :data="items!"
        :config="tableConfig!"
        :is-loading="isLoading"
        @row-action="
          (action: string, item: any) => emit('row-action', action, item)
        "
        @bulk-action="
          (action: string, items: any[]) => emit('bulk-action', action, items)
        "
      />
      <slot name="table-footer" />
    </slot>

    <slot name="dialogs">
      <slot name="form" />
    </slot>
  </div>
</template>
