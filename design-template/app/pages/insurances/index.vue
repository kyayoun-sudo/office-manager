<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, CheckCircle2, XCircle, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { Insurance } from '~~/shared/types/insurance'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import InsuranceForm from './components/InsuranceForm.vue'

useHead({ title: 'Assurances - Modèle d’administration' })

const {
  insurances,
  isLoading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchInsurances,
  getInsuranceById,
  createInsurance,
  updateInsurance,
  deleteInsurance,
  bulkUpdateInsuranceStatus,
  bulkDeleteInsurances,
  getTypeLabel,
} = useInsurances()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '', type: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Rechercher par libellé ou code...',
    icon: Filter,
  },
  {
    key: 'type',
    label: 'Type',
    type: 'select',
    placeholder: 'Tous les types',
    options: [
      { value: 'all', label: 'Tous les types' },
      { value: 'mutual', label: 'Mutuelle' },
      { value: 'hospital', label: 'Hospitalisation' },
    ],
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = {}
  const { search, type } = filtersState.value
  if (search) params.search = search
  if (type !== 'all') params.type = type
  return params
}

const performApiSearch = async () => {
  await fetchInsurances({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', type: 'all' }
  await fetchInsurances({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 20)

const displayItems = computed(() =>
  Array.isArray(insurances.value) ? insurances.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchInsurances({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchInsurances({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const showForm = ref(false)
const selectedItem = ref<Insurance | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: Insurance) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getInsuranceById(item.id)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des détails' })
      }
      break
    }
    case 'toggle': {
      const result = await updateInsurance(item.id, { isActive: !item.isActive })
      if (result.success) {
        toast.handleApiSuccess(result.message || `Assurance ${item.isActive ? 'désactivée' : 'activée'}`)
        await fetchInsurances({ ...getCurrentFilterParams(), page: currentPage.value, limit: itemsPerPage.value })
      } else {
        toast.handleApiError({ success: false, message: result.error || 'Erreur lors de la mise à jour' })
      }
      break
    }
    case 'delete': {
      await confirm({
        title: 'Supprimer l\'assurance',
        description: `Etes-vous sur de vouloir supprimer l'assurance "${item.translations?.[0]?.name || item.code}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteInsurance(item.id)
          if (!result.success) throw new Error(result.error || 'Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: Insurance[]) => {
  const ids = selected.map((item) => item.id)
  try {
    let result: any
    switch (action) {
      case 'activate':
        result = await bulkUpdateInsuranceStatus(ids, true)
        break
      case 'deactivate':
        result = await bulkUpdateInsuranceStatus(ids, false)
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les assurances',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} assurance${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteInsurances(ids)
            if (!result?.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result?.success && result.results.success > 0) {
      const labels: Record<string, string> = { activate: 'activée', deactivate: 'désactivée', delete: 'supprimée' }
      let message = `${result.results.success} assurance(s) ${labels[action] || action}(s) avec succès.`
      if (result.results.failed > 0) message += ` ${result.results.failed} échec(s).`
      toast.handleApiSuccess(message)
    } else {
      toast.handleApiError({ success: false, message: 'Aucune opération réussie' })
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
      result = await updateInsurance(id ?? selectedItem.value.id, updateData)
    } else {
      result = await createInsurance(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(result.message || (selectedItem.value ? 'Assurance modifiée' : 'Assurance créée'))
      showForm.value = false
      selectedItem.value = null
      await fetchInsurances({ ...getCurrentFilterParams(), page: currentPage.value, limit: itemsPerPage.value })
    } else {
      toast.handleApiError({ success: false, message: result?.error || "Erreur lors de l'enregistrement" })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de l'enregistrement" })
  }
}

const handleFormCancel = () => {
  showForm.value = false
  selectedItem.value = null
}

const tableConfig: DataTableConfig<Insurance> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'libelle', label: 'Libellé', sortable: true },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      getValue: (ins) => getTypeLabel(ins.type),
    },
    {
      key: 'isActive',
      label: 'Statut',
      getValue: (ins) => ins.isActive !== false ? 'Active' : 'Inactive',
    },
    { key: 'createdAt', label: 'Créé le', sortable: true, render: 'date' },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit },
    { key: 'toggle', label: 'Activer/Désactiver', icon: RotateCcw },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'activate', label: 'Activer', icon: CheckCircle2, variant: 'outline' },
    { key: 'deactivate', label: 'Désactiver', icon: XCircle, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'libelle', order: 'asc' },
  messages: {
    loading: 'Chargement des assurances...',
    empty: 'Aucune assurance trouvée',
    selected: (count) => `${count} assurance${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'assurances',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'assurances',
  })
}

onMounted(() => fetchInsurances({ page: 1, limit: 20 }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Assurances</h1>
        <p class="text-muted-foreground">Gérez les assurances et mutuelles</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouvelle Assurance
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="assurance"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Assurances
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="isLoading"
          @click="fetchInsurances({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
        >
          <RotateCcw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
        <UiButton variant="outline" size="sm" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
      </div>
    </div>

    <GenericDataTable
      :data="displayItems"
      :config="tableConfig"
      :is-loading="isLoading"
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

    <InsuranceForm
      :insurance="selectedItem"
      :is-open="showForm"
      :is-loading="isLoading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
