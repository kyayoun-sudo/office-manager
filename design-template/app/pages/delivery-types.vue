<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { DeliveryType } from '~~/shared/types/delivery-type'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import DeliveryTypeForm from '~/components/forms/DeliveryTypeForm.vue'

definePageMeta({
  title: "Types d'accouchement",
  description: "Gérez les types d'accouchement disponibles dans l'application",
})
useHead({ title: "Types d'accouchement - Modèle d’administration" })

const {
  deliveryTypes,
  loading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchDeliveryTypes,
  getDeliveryTypeById,
  createDeliveryType,
  updateDeliveryType,
  deleteDeliveryType,
  bulkDeleteDeliveryTypes,
} = useDeliveryTypes()

const toast = useToast()

const getDeliveryTypeName = (deliveryType: DeliveryType): string => {
  if (deliveryType.name) return deliveryType.name
  const fr = deliveryType.translations?.find(
    (t: any) => t.language?.code === 'fr' || t.languageCode === 'fr',
  )
  const en = deliveryType.translations?.find(
    (t: any) => t.language?.code === 'en' || t.languageCode === 'en',
  )
  return fr?.name || en?.name || deliveryType.translations?.[0]?.name || deliveryType.code
}

const filtersState = ref({ search: '', isActive: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Code, nom...',
    icon: Filter,
  },
  {
    key: 'isActive',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'true', label: 'Actifs' },
      { value: 'false', label: 'Inactifs' },
    ],
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = {}
  const { search, isActive } = filtersState.value
  if (search) params.search = search
  if (isActive !== 'all') params.isActive = isActive === 'true'
  return params
}

const performApiSearch = async () => {
  await fetchDeliveryTypes({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', isActive: 'all' }
  await fetchDeliveryTypes({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 20)

const displayItems = computed(() =>
  Array.isArray(deliveryTypes.value) ? deliveryTypes.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchDeliveryTypes({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchDeliveryTypes({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const showForm = ref(false)
const selectedItem = ref<DeliveryType | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: DeliveryType) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getDeliveryTypeById(item.id)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des détails' })
      }
      break
    }
    case 'delete': {
      const result = await deleteDeliveryType(item.id)
      if (result.success) {
        toast.handleApiSuccess("Type d'accouchement supprimé avec succès")
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la suppression' })
      }
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: DeliveryType[]) => {
  const ids = selected.map((item) => item.id)
  try {
    if (action === 'delete') {
      const result = await bulkDeleteDeliveryTypes(ids)
      if (result?.success) {
        toast.handleApiSuccess(`${ids.length} type(s) d'accouchement supprimé(s)`)
      } else {
        toast.handleApiError({ success: false, message: 'Certaines suppressions ont échoué' })
      }
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de l'opération" })
  }
}

const handleFormSubmit = async (data: any) => {
  try {
    let result
    if (selectedItem.value) {
      const { id, ...updateData } = data
      result = await updateDeliveryType(id ?? selectedItem.value.id, updateData)
    } else {
      result = await createDeliveryType(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(
        selectedItem.value ? "Type d'accouchement modifié avec succès" : "Type d'accouchement créé avec succès",
      )
      showForm.value = false
      selectedItem.value = null
    } else {
      toast.handleApiError({ success: false, message: "Erreur lors de l'enregistrement" })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de l'enregistrement" })
  }
}

const handleFormCancel = () => {
  showForm.value = false
  selectedItem.value = null
}

const tableConfig: DataTableConfig<DeliveryType> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (dt) => getDeliveryTypeName(dt),
    },
    {
      key: 'translations',
      label: 'Traductions',
      getValue: (dt) => {
        const count = dt.translations?.length || 0
        return `${count} langue${count > 1 ? 's' : ''}`
      },
    },
    {
      key: 'isActive',
      label: 'Statut',
      sortable: true,
      getValue: (dt) => dt.isActive ? 'Actif' : 'Inactif',
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'id', order: 'asc' },
  messages: {
    loading: "Chargement des types d'accouchement...",
    empty: "Aucun type d'accouchement trouvé",
    selected: (count) => `${count} type${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'types-accouchement',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'types-accouchement',
  })
}

onMounted(() => fetchDeliveryTypes({ page: 1, limit: 20 }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Types d'accouchement</h1>
        <p class="text-muted-foreground">Gérez les différents types d'accouchement disponibles</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouveau type
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="type"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Types d'accouchement
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchDeliveryTypes({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
        >
          <RotateCcw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Actualiser
        </UiButton>
        <UiButton variant="outline" size="sm" :disabled="loading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
      </div>
    </div>

    <GenericDataTable
      :data="displayItems"
      :config="tableConfig"
      :is-loading="loading"
      @row-action="handleRowAction"
      @bulk-action="handleBulkAction"
    />

    <Pagination
      :current-page="currentPage"
      :total-pages="totalPages"
      :total-items="total"
      :items-per-page="itemsPerPage"
      :items-per-page-options="[10, 20, 50, 100]"
      :pagination-info="paginationInfo"
      :get-visible-pages="getVisiblePages"
      @go-to-page="goToPage"
      @go-to-first="goToPage(1)"
      @go-to-last="goToPage(totalPages)"
      @go-to-previous="goToPage(currentPage - 1)"
      @go-to-next="goToPage(currentPage + 1)"
      @change-items-per-page="changeItemsPerPage"
    />

    <DeliveryTypeForm
      :delivery-type="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
