<script setup lang="ts" generic="T extends Record<string, any>">
import { VueDraggable } from 'vue-draggable-plus'
import type { DataTableConfig, DataTableColumn, BulkAction, RowAction, SortState } from '~~/shared/types/datatable'
import { ArrowUpDown, Users, MoreHorizontal, GripVertical } from 'lucide-vue-next'

interface Props {
  data: T[]
  config: DataTableConfig<T>
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'row-click': [item: T]
  'row-action': [action: string, item: T]
  'bulk-action': [action: string, items: T[]]
  'sort': [sort: SortState]
  'selection-change': [selectedItems: T[]]
  'reorder': [items: T[]]
}>()

const dragItems = ref<T[]>([]) as Ref<T[]>
const isDraggable = computed(() => !!props.config.draggable)

watch(() => props.data, (newData) => {
  if (isDraggable.value) {
    dragItems.value = [...newData]
  }
}, { immediate: true })

const onDragEnd = () => {
  emit('reorder', dragItems.value)
}

// État local
const selectedItems = ref<Set<any>>(new Set())
const sortKey = ref<string>(props.config.defaultSort?.key || '')
const sortOrder = ref<'asc' | 'desc'>(props.config.defaultSort?.order || 'asc')

// Computed pour la sélection
const isAllSelected = computed(() => {
  return props.data.length > 0 && selectedItems.value.size === props.data.length
})

const isSomeSelected = computed(() => {
  return selectedItems.value.size > 0 && selectedItems.value.size < props.data.length
})

const selectedItemsArray = computed(() => {
  return props.data.filter(item => selectedItems.value.has(getItemId(item)))
})

// Données triées
const sortedData = computed(() => {
  if (!sortKey.value) return props.data
  
  const sorted = [...props.data].sort((a, b) => {
    const column = props.config.columns.find(col => col.key === sortKey.value)
    let aVal: any, bVal: any
    
    if (column?.getValue) {
      aVal = column.getValue(a)
      bVal = column.getValue(b)
    } else {
      aVal = getNestedValue(a, sortKey.value)
      bVal = getNestedValue(b, sortKey.value)
    }
    
    // Gestion des valeurs null/undefined
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1
    
    // Conversion pour comparaison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = bVal.toLowerCase()
    }
    
    if (aVal < bVal) return sortOrder.value === 'asc' ? -1 : 1
    if (aVal > bVal) return sortOrder.value === 'asc' ? 1 : -1
    return 0
  })
  
  return sorted
})

// Fonctions utilitaires
const getItemId = (item: T): any => {
  return item.id || JSON.stringify(item)
}

const getNestedValue = (obj: any, path: string): any => {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

const getCellValue = (item: T, column: DataTableColumn<T>): any => {
  if (column.getValue) {
    return column.getValue(item)
  }
  return getNestedValue(item, column.key)
}

const formatCellValue = (value: any, item: T, column: DataTableColumn<T>): string => {
  if (column.formatter) {
    return column.formatter(value, item)
  }
  
  switch (column.render) {
    case 'date':
      return formatDate(value, column.date?.format || 'date', column.date?.emptyText)
    case 'datetime':
      return formatDate(value, 'datetime', column.date?.emptyText)
    case 'price':
      return formatPrice(value, column.price?.currency || 'EUR', column.price?.locale || 'fr-FR')
    default:
      return value?.toString() || ''
  }
}

const formatDate = (dateString: string | null, format: string = 'date', emptyText: string = 'N/A'): string => {
  if (!dateString) return emptyText
  
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return emptyText
  
  const options: Intl.DateTimeFormatOptions = {}
  
  switch (format) {
    case 'datetime':
      options.year = 'numeric'
      options.month = 'short'
      options.day = 'numeric'
      options.hour = '2-digit'
      options.minute = '2-digit'
      break
    case 'time':
      options.hour = '2-digit'
      options.minute = '2-digit'
      break
    default: // 'date'
      options.year = 'numeric'
      options.month = 'short'
      options.day = 'numeric'
  }
  
  return date.toLocaleDateString('fr-FR', options)
}

const formatPrice = (amount: string | number | null, currency: string = 'EUR', locale: string = 'fr-FR'): string => {
  if (amount == null) return 'N/A'
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return 'N/A'
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(numAmount)
}

const getBadgeVariant = (value: string, column: DataTableColumn<T>): string => {
  return column.badge?.variants[value] || 'default'
}

const getBadgeLabel = (value: string, item: T, column: DataTableColumn<T>): string => {
  if (column.badge?.getLabel) {
    return column.badge.getLabel(value, item)
  }
  return value
}

const getCellClass = (item: T, value: any, column: DataTableColumn<T>): string => {
  if (typeof column.cellClass === 'function') {
    return column.cellClass(item, value)
  }
  return column.cellClass || ''
}

const getRowClass = (item: T): string => {
  const baseClass = 'hover:bg-muted/50'
  const selectedClass = selectedItems.value.has(getItemId(item)) ? 'bg-muted/50' : ''
  
  if (typeof props.config.rowClass === 'function') {
    return `${baseClass} ${selectedClass} ${props.config.rowClass(item)}`.trim()
  }
  return `${baseClass} ${selectedClass} ${props.config.rowClass || ''}`.trim()
}

// Gestion du tri
const handleSort = (columnKey: string) => {
  const column = props.config.columns.find(col => col.key === columnKey)
  if (!column?.sortable) return
  
  if (sortKey.value === columnKey) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = columnKey
    sortOrder.value = 'asc'
  }
  
  emit('sort', { key: sortKey.value, order: sortOrder.value })
}

// Gestion de la sélection
const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedItems.value = new Set()
  } else {
    selectedItems.value = new Set(props.data.map(item => getItemId(item)))
  }
  emit('selection-change', selectedItemsArray.value)
}

const toggleItemSelection = (item: T) => {
  const id = getItemId(item)
  const next = new Set(selectedItems.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedItems.value = next
  emit('selection-change', selectedItemsArray.value)
}

const isItemSelected = (item: T): boolean => {
  return selectedItems.value.has(getItemId(item))
}

const clearSelection = () => {
  selectedItems.value = new Set()
  emit('selection-change', [])
}

// Actions
const handleRowClick = (item: T) => {
  emit('row-click', item)
}

const handleRowAction = (action: string, item: T) => {
  emit('row-action', action, item)
}

const handleBulkAction = (actionKey: string) => {
  const action = props.config.bulkActions?.find(a => a.key === actionKey)
  if (action?.confirm) {
    // TODO: Implement confirmation dialog
  }
  emit('bulk-action', actionKey, selectedItemsArray.value)
  clearSelection()
}

// Colonnes visibles
const visibleColumns = computed(() => {
  const columns = [...props.config.columns]

  // Ajouter colonne drag handle si draggable
  if (isDraggable.value) {
    columns.unshift({
      key: '_drag',
      label: '',
      sortable: false,
      width: '40px',
      render: 'custom'
    })
  }

  // Ajouter colonne de sélection si nécessaire
  if (props.config.selectable && !props.config.hideSelectColumn) {
    columns.unshift({
      key: 'select',
      label: '',
      sortable: false,
      render: 'custom'
    })
  }
  
  // Ajouter colonne d'actions si nécessaire
  if (props.config.rowActions && props.config.rowActions.length > 0 && !props.config.hideActionsColumn) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      sortable: false,
      render: 'custom'
    })
  }
  
  return columns
})

const resolveLabel = (label: string | ((item: T) => string), item: T): string =>
  typeof label === 'function' ? label(item) : label

// Actions visibles pour un item
const getVisibleRowActions = (item: T): RowAction<T>[] => {
  return props.config.rowActions?.filter(action =>
    !action.hidden?.(item) && (!action.condition || action.condition(item)),
  ) || []
}

// Actions bulk filtrées
const getEnabledBulkActions = (): BulkAction[] => {
  return props.config.bulkActions?.filter(action => !action.disabled?.(selectedItemsArray.value)) || []
}

const useDropdownActions = computed(() => props.config.actionsDisplay === 'dropdown')

// Messages
const loadingMessage = computed(() => props.config.messages?.loading || 'Chargement...')
const emptyMessage = computed(() => props.config.messages?.empty || 'Aucune donnée disponible')
const selectedMessage = computed(() => {
  const count = selectedItems.value.size
  if (props.config.messages?.selected) {
    return props.config.messages.selected(count)
  }
  return `${count} élément${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`
})

// Nettoyer la sélection quand les données changent
watch(() => props.data, () => {
  selectedItems.value = new Set()
})
</script>

<template>
  <div class="space-y-4">
    <!-- Barre d'actions en lot -->
    <div 
      v-if="config.selectable && selectedItems.size > 0 && config.bulkActions && config.bulkActions.length > 0" 
      class="flex items-center justify-between p-4 bg-muted rounded-lg border border-border"
    >
      <div class="flex items-center space-x-3">
        <div class="flex items-center justify-center w-8 h-8 bg-muted-foreground/20 rounded-full">
          <Users class="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p class="text-sm font-semibold text-foreground">
            {{ selectedMessage }}
          </p>
          <p class="text-xs text-muted-foreground">
            Choisissez une action à appliquer
          </p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <UiButton
          v-for="action in getEnabledBulkActions()"
          :key="action.key"
          :variant="action.variant || 'outline'"
          size="sm"
          @click="handleBulkAction(action.key)"
        >
          <component 
            v-if="action.icon" 
            :is="action.icon" 
            class="mr-2 h-4 w-4" 
          />
          {{ action.label }}
        </UiButton>
        <UiButton 
          variant="ghost" 
          size="sm" 
          class="text-muted-foreground hover:text-foreground ml-2"
          @click="clearSelection"
        >
          Annuler
        </UiButton>
      </div>
    </div>

    <!-- ═══ DESKTOP : Tableau classique ═══ -->
    <div class="hidden md:block">
      <div v-if="isLoading" class="rounded-lg border border-border overflow-x-auto shadow-sm">
        <UiTable>
          <UiTableHeader class="bg-muted/50 [&_tr]:border-b-2 [&_tr]:border-border">
            <UiTableRow class="hover:bg-transparent">
              <UiTableHead
                v-for="col in config.columns" :key="col.key"
                class="h-11 text-xs uppercase tracking-wider font-semibold text-muted-foreground"
              >
                <UiSkeleton class="h-3 w-16" />
              </UiTableHead>
              <UiTableHead v-if="config.rowActions?.length" class="h-11">
                <UiSkeleton class="h-3 w-14" />
              </UiTableHead>
            </UiTableRow>
          </UiTableHeader>
          <UiTableBody>
            <UiTableRow v-for="row in 6" :key="row" class="border-b border-border/50">
              <UiTableCell v-for="(col, colIdx) in config.columns" :key="col.key">
                <UiSkeleton
                  v-if="col.render === 'badge'"
                  class="h-5 w-16 rounded-full"
                />
                <UiSkeleton
                  v-else
                  class="h-4"
                  :class="[
                    colIdx === 0 ? 'w-10' : '',
                    colIdx === 1 ? 'w-32' : '',
                    colIdx > 1 && !col.render ? (row % 3 === 0 ? 'w-20' : row % 3 === 1 ? 'w-28' : 'w-24') : '',
                  ]"
                />
              </UiTableCell>
              <UiTableCell v-if="config.rowActions?.length">
                <div class="flex gap-1">
                  <UiSkeleton v-for="i in Math.min(config.rowActions.length, 3)" :key="i" class="h-7 w-7 rounded-md" />
                </div>
              </UiTableCell>
            </UiTableRow>
          </UiTableBody>
        </UiTable>
      </div>

      <div v-else class="rounded-lg border border-border overflow-x-auto shadow-sm" :class="config.tableClass">
        <UiTable>
          <UiTableHeader :class="['bg-muted/50 [&_tr]:border-b-2 [&_tr]:border-border', config.headerClass]">
            <UiTableRow class="hover:bg-transparent">
              <UiTableHead
                v-for="column in visibleColumns" :key="column.key"
                :class="[
                  'h-11 text-xs uppercase tracking-wider font-semibold text-muted-foreground',
                  column.headerClass,
                  { 'cursor-pointer select-none transition-colors hover:bg-muted hover:text-foreground': column.sortable },
                ]"
                @click="column.sortable ? handleSort(column.key) : null"
              >
                <div v-if="column.key === 'select'" class="flex items-center">
                  <UiCheckbox
                    :checked="isAllSelected ? true : isSomeSelected ? 'indeterminate' : false"
                    @update:checked="toggleSelectAll"
                  />
                </div>
                <div v-else class="flex items-center gap-1.5">
                  <span>{{ column.label }}</span>
                  <ArrowUpDown
                    v-if="column.sortable" class="h-3.5 w-3.5 transition-colors"
                    :class="sortKey === column.key ? 'text-primary' : 'text-muted-foreground/50'"
                  />
                </div>
              </UiTableHead>
            </UiTableRow>
          </UiTableHeader>
          <VueDraggable
            v-if="isDraggable"
            v-model="dragItems"
            tag="tbody"
            handle=".drag-handle"
            :animation="200"
            ghost-class="opacity-30"
            :class="config.bodyClass"
            @end="onDragEnd"
          >
            <tr
              v-if="dragItems.length === 0"
              class="border-b"
            >
              <td :colspan="visibleColumns.length" class="text-center py-8 text-muted-foreground">
                {{ emptyMessage }}
              </td>
            </tr>
            <tr
              v-for="item in dragItems" :key="getItemId(item)"
              :class="getRowClass(item)" class="group border-b transition-colors"
            >
              <td
                v-for="column in visibleColumns" :key="column.key"
                class="p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0.5"
                :class="[column.key !== '_drag' ? getCellClass(item, getCellValue(item, column), column) : '', `text-${column.align || 'left'}`]"
              >
                <template v-if="column.key === '_drag'">
                  <div class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex items-center justify-center">
                    <GripVertical class="h-4 w-4" />
                  </div>
                </template>
                <template v-else-if="column.key === 'select'">
                  <UiCheckbox :checked="isItemSelected(item)" @update:checked="toggleItemSelection(item)" @click.stop />
                </template>
                <template v-else-if="column.key === 'actions'">
                  <div v-if="useDropdownActions" class="flex justify-end" @click.stop>
                    <UiDropdownMenu>
                      <UiDropdownMenuTrigger as-child>
                        <UiButton variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <MoreHorizontal class="h-4 w-4" />
                        </UiButton>
                      </UiDropdownMenuTrigger>
                      <UiDropdownMenuContent align="end" class="w-48">
                        <template v-for="(action, actionIdx) in getVisibleRowActions(item)" :key="action.key">
                          <UiDropdownMenuSeparator v-if="action.separator && actionIdx > 0" />
                          <UiDropdownMenuItem :disabled="action.disabled?.(item)" :class="{ 'text-destructive focus:text-destructive': action.variant === 'destructive' }" @click="handleRowAction(action.key, item)">
                            <component :is="action.icon" v-if="action.icon" class="mr-2 h-4 w-4" />
                            {{ resolveLabel(action.label, item) }}
                          </UiDropdownMenuItem>
                        </template>
                      </UiDropdownMenuContent>
                    </UiDropdownMenu>
                  </div>
                  <div v-else class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <UiTooltipProvider v-for="action in getVisibleRowActions(item)" :key="action.key">
                      <UiTooltip>
                        <UiTooltipTrigger as-child>
                          <UiButton variant="ghost" size="icon" class="h-8 w-8" :class="{ 'text-destructive hover:text-destructive hover:bg-destructive/10': action.variant === 'destructive', 'text-muted-foreground hover:text-foreground hover:bg-muted': action.variant !== 'destructive', 'opacity-50 cursor-not-allowed': action.disabled?.(item) }" :disabled="action.disabled?.(item)" @click.stop="handleRowAction(action.key, item)">
                            <component :is="action.icon" v-if="action.icon" class="h-4 w-4" />
                          </UiButton>
                        </UiTooltipTrigger>
                        <UiTooltipContent side="top">{{ resolveLabel(action.label, item) }}</UiTooltipContent>
                      </UiTooltip>
                    </UiTooltipProvider>
                  </div>
                </template>
                <template v-else-if="column.render === 'custom' && column.customRender">
                  <component :is="column.customRender(getCellValue(item, column), item, column)" />
                </template>
                <template v-else-if="column.render === 'badge' && column.badge">
                  <UiBadge :variant="getBadgeVariant(column.badge.getValue(item), column)">
                    {{ getBadgeLabel(column.badge.getValue(item), item, column) }}
                  </UiBadge>
                </template>
                <template v-else>
                  {{ formatCellValue(getCellValue(item, column), item, column) }}
                </template>
              </td>
            </tr>
          </VueDraggable>
          <UiTableBody v-else :class="config.bodyClass">
            <UiTableRow v-if="sortedData.length === 0">
              <UiTableCell :colspan="visibleColumns.length" class="text-center py-8 text-muted-foreground">
                {{ emptyMessage }}
              </UiTableCell>
            </UiTableRow>
            <UiTableRow
              v-for="item in sortedData" :key="getItemId(item)"
              :class="getRowClass(item)" class="group" @click="handleRowClick(item)"
            >
              <UiTableCell
                v-for="column in visibleColumns" :key="column.key"
                :class="[getCellClass(item, getCellValue(item, column), column), `text-${column.align || 'left'}`]"
              >
                <template v-if="column.key === 'select'">
                  <UiCheckbox
                    :checked="isItemSelected(item)"
                    @update:checked="toggleItemSelection(item)"
                    @click.stop
                  />
                </template>
                <template v-else-if="column.key === 'actions'">
                  <div v-if="useDropdownActions" class="flex justify-end" @click.stop>
                    <UiDropdownMenu>
                      <UiDropdownMenuTrigger as-child>
                        <UiButton variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <MoreHorizontal class="h-4 w-4" />
                        </UiButton>
                      </UiDropdownMenuTrigger>
                      <UiDropdownMenuContent align="end" class="w-48">
                        <template v-for="(action, actionIdx) in getVisibleRowActions(item)" :key="action.key">
                          <UiDropdownMenuSeparator v-if="action.separator && actionIdx > 0" />
                          <UiDropdownMenuItem
                            :disabled="action.disabled?.(item)"
                            :class="{ 'text-destructive focus:text-destructive': action.variant === 'destructive' }"
                            @click="handleRowAction(action.key, item)"
                          >
                            <component :is="action.icon" v-if="action.icon" class="mr-2 h-4 w-4" />
                            {{ resolveLabel(action.label, item) }}
                          </UiDropdownMenuItem>
                        </template>
                      </UiDropdownMenuContent>
                    </UiDropdownMenu>
                  </div>
                  <div v-else class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <UiTooltipProvider v-for="action in getVisibleRowActions(item)" :key="action.key">
                      <UiTooltip>
                        <UiTooltipTrigger as-child>
                          <UiButton
                            variant="ghost" size="icon" class="h-8 w-8"
                            :class="{
                              'text-destructive hover:text-destructive hover:bg-destructive/10': action.variant === 'destructive',
                              'text-muted-foreground hover:text-foreground hover:bg-muted': action.variant !== 'destructive',
                              'opacity-50 cursor-not-allowed': action.disabled?.(item)
                            }"
                            :disabled="action.disabled?.(item)" @click.stop="handleRowAction(action.key, item)"
                          >
                            <component :is="action.icon" v-if="action.icon" class="h-4 w-4" />
                          </UiButton>
                        </UiTooltipTrigger>
                        <UiTooltipContent side="top">{{ resolveLabel(action.label, item) }}</UiTooltipContent>
                      </UiTooltip>
                    </UiTooltipProvider>
                  </div>
                </template>
                <template v-else-if="column.render === 'custom' && column.customRender">
                  <component :is="column.customRender(getCellValue(item, column), item, column)" />
                </template>
                <template v-else-if="column.render === 'badge' && column.badge">
                  <UiBadge :variant="getBadgeVariant(column.badge.getValue(item), column)">
                    {{ getBadgeLabel(column.badge.getValue(item), item, column) }}
                  </UiBadge>
                </template>
                <template v-else>
                  {{ formatCellValue(getCellValue(item, column), item, column) }}
                </template>
              </UiTableCell>
            </UiTableRow>
          </UiTableBody>
        </UiTable>
      </div>
    </div>

    <!-- ═══ MOBILE : Layout en cartes ═══ -->
    <div class="md:hidden space-y-3">
      <template v-if="isLoading">
        <div v-for="i in 4" :key="i" class="rounded-lg border border-border p-4 space-y-3">
          <div class="flex items-center justify-between">
            <UiSkeleton class="h-5 w-36" />
            <div class="flex gap-1">
              <UiSkeleton class="h-7 w-7 rounded-md" />
              <UiSkeleton class="h-7 w-7 rounded-md" />
            </div>
          </div>
          <div class="space-y-2.5 pt-1">
            <div v-for="j in Math.min(config.columns.length - 1, 4)" :key="j" class="flex items-center justify-between">
              <UiSkeleton class="h-3 w-16" />
              <UiSkeleton class="h-3.5" :class="j % 3 === 0 ? 'w-20' : j % 3 === 1 ? 'w-28' : 'w-16'" />
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="sortedData.length === 0" class="rounded-lg border border-border py-8 text-center text-muted-foreground">
        {{ emptyMessage }}
      </div>

      <template v-else>
        <div
          v-for="item in sortedData" :key="getItemId(item)"
          class="rounded-lg border p-4 space-y-3"
          :class="isItemSelected(item) ? 'border-primary/50 bg-primary/5' : 'border-border'"
          @click="handleRowClick(item)"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <UiCheckbox
                v-if="config.selectable"
                :checked="isItemSelected(item)"
                class="shrink-0"
                @update:checked="toggleItemSelection(item)"
                @click.stop
              />
              <span class="font-semibold text-sm truncate">
                {{ formatCellValue(getCellValue(item, config.columns[0]), item, config.columns[0]) }}
              </span>
            </div>
            <div v-if="config.rowActions?.length" class="flex items-center gap-1 shrink-0">
              <template v-for="action in getVisibleRowActions(item)" :key="action.key">
                <UiButton
                  v-if="!action.condition || action.condition(item)"
                  variant="ghost" size="icon" class="h-8 w-8"
                  :class="{
                    'text-destructive hover:text-destructive hover:bg-destructive/10': action.variant === 'destructive',
                    'text-muted-foreground hover:text-foreground hover:bg-muted': action.variant !== 'destructive',
                  }"
                  :disabled="action.disabled?.(item)" @click.stop="handleRowAction(action.key, item)"
                >
                  <component :is="action.icon" v-if="action.icon" class="h-4 w-4" />
                </UiButton>
              </template>
            </div>
          </div>

          <dl class="space-y-2 text-sm">
            <div v-for="column in config.columns.slice(1)" :key="column.key" class="flex items-start justify-between gap-3">
              <dt class="text-muted-foreground shrink-0">{{ column.label }}</dt>
              <dd class="text-right min-w-0">
                <UiBadge
                  v-if="column.render === 'badge' && column.badge"
                  :variant="getBadgeVariant(column.badge.getValue(item), column)"
                  class="text-xs"
                >
                  {{ getBadgeLabel(column.badge.getValue(item), item, column) }}
                </UiBadge>
                <span v-else class="break-words">
                  {{ formatCellValue(getCellValue(item, column), item, column) }}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </template>
    </div>
  </div>
</template>