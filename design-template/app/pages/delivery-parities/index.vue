<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { DeliveryParity } from '~~/shared/types/delivery-parity'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import DeliveryParityForm from '~/components/forms/DeliveryParityForm.vue'

definePageMeta({
  title: "Gestion des Quantiemes d'Accouchement",
  description: "Gerez les quantiemes d'accouchement et leurs traductions",
})
useHead({ title: "Quantiemes d'accouchement - Modèle d’administration" })

const {
  deliveryParities,
  loading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchDeliveryParities,
  getDeliveryParityById,
  createDeliveryParity,
  updateDeliveryParity,
  deleteDeliveryParity,
  bulkDeleteDeliveryParities,
} = useDeliveryParities()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, code...',
    icon: Filter,
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = {}
  const { search } = filtersState.value
  if (search) params.search = search
  return params
}

const performApiSearch = async () => {
  await fetchDeliveryParities({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '' }
  await fetchDeliveryParities({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 20)

const displayItems = computed(() =>
  Array.isArray(deliveryParities.value) ? deliveryParities.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchDeliveryParities({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchDeliveryParities({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const showForm = ref(false)
const selectedItem = ref<DeliveryParity | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: DeliveryParity) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getDeliveryParityById(item.id)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des details' })
      }
      break
    }
    case 'delete': {
      const name = item.translations?.find((t: any) => t.language?.code === 'fr')?.name || item.code
      await confirm({
        title: 'Supprimer le quantieme d\'accouchement',
        description: `Etes-vous sur de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteDeliveryParity(item.id)
          if (!result.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: DeliveryParity[]) => {
  const ids = selected.map((item) => item.id)
  try {
    if (action === 'delete') {
      await confirm({
        title: 'Supprimer les quantiemes',
        description: `Etes-vous sur de vouloir supprimer ${ids.length} quantieme${ids.length > 1 ? 's' : ''} ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await bulkDeleteDeliveryParities(ids)
          if (!result?.success) throw new Error('Certaines suppressions ont echoue')
        },
      })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de l'operation" })
  }
}

const handleFormSubmit = async (data: any) => {
  try {
    let result
    if (selectedItem.value) {
      const { id, ...updateData } = data
      result = await updateDeliveryParity({ ...updateData, id: id ?? selectedItem.value.id })
    } else {
      result = await createDeliveryParity(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(
        selectedItem.value ? "Quantieme d'accouchement modifie avec succes" : "Quantieme d'accouchement cree avec succes",
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

const tableConfig: DataTableConfig<DeliveryParity> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (item) => {
        const fr = item.translations?.find((t: any) => t.language?.code === 'fr')
        return fr?.name || item.name || item.code
      },
    },
    {
      key: 'description',
      label: 'Description',
      sortable: false,
      getValue: (item) => {
        const fr = item.translations?.find((t: any) => t.language?.code === 'fr')
        const desc = fr?.description || item.description || ''
        return desc.length > 60 ? `${desc.substring(0, 60)}...` : desc
      },
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
    loading: "Chargement des quantiemes d'accouchement...",
    empty: "Aucun quantieme d'accouchement trouve",
    selected: (count) =>
      `${count} quantieme${count > 1 ? 's' : ''} selectionne${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'quantiemes-accouchement',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'quantiemes-accouchement',
  })
}

onMounted(() => fetchDeliveryParities({ page: 1, limit: 20 }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Quantiemes d'Accouchement</h1>
        <p class="text-muted-foreground">Gerez les quantiemes d'accouchement et leurs traductions multilingues</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouveau quantieme
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="quantieme"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Quantiemes
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchDeliveryParities({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
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

    <DeliveryParityForm
      :delivery-parity="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
