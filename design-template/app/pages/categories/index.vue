<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Check, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { Category } from '~~/shared/types/category'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import CategoryForm from '~/components/forms/CategoryForm.vue'

definePageMeta({
  title: 'Gestion des Categories',
  description: 'Gerez les categories et leurs traductions',
})
useHead({ title: 'Categories - Modèle d’administration' })

const {
  categories,
  loading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  bulkActivateCategories,
  bulkDeactivateCategories,
  bulkDeleteCategories,
} = useCategories()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '', isActive: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, code...',
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
  if (isActive !== 'all') params.active = isActive === 'true'
  return params
}

const performApiSearch = async () => {
  await fetchCategories({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', isActive: 'all' }
  await fetchCategories({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 20)

const displayItems = computed(() =>
  Array.isArray(categories.value) ? categories.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchCategories({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchCategories({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const showForm = ref(false)
const selectedItem = ref<Category | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: Category) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getCategoryById(item.id)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des details' })
      }
      break
    }
    case 'toggle': {
      const result = await toggleCategoryStatus(item.id, !item.isActive)
      if (result.success) {
        toast.handleApiSuccess(`Categorie ${item.isActive ? 'desactivee' : 'activee'}`)
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la mise a jour' })
      }
      break
    }
    case 'delete': {
      const name = item.translations?.find((t: any) => t.language?.code === 'fr')?.name || item.code
      await confirm({
        title: 'Supprimer la categorie',
        description: `Etes-vous sur de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteCategory(item.id)
          if (!result.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: Category[]) => {
  const ids = selected.map((item) => item.id)
  try {
    let result: any
    switch (action) {
      case 'activate':
        result = await bulkActivateCategories(ids)
        break
      case 'deactivate':
        result = await bulkDeactivateCategories(ids)
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les categories',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} categorie${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteCategories(ids)
            if (!result?.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result?.success) {
      const labels: Record<string, string> = { activate: 'activee', deactivate: 'desactivee', delete: 'supprimee' }
      toast.handleApiSuccess(`${ids.length} categorie(s) ${labels[action] || action}(s)`)
    } else {
      toast.handleApiError({ success: false, message: 'Certaines operations ont echoue' })
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
      result = await updateCategory({ ...updateData, id: id ?? selectedItem.value.id })
    } else {
      result = await createCategory(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(
        selectedItem.value ? 'Categorie modifiee avec succes' : 'Categorie creee avec succes',
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

const tableConfig: DataTableConfig<Category> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (cat) => {
        const fr = cat.translations?.find((t: any) => t.language?.code === 'fr')
        return fr?.name || cat.name || cat.code
      },
    },
    {
      key: 'isActive',
      label: 'Statut',
      getValue: (cat) => cat.isActive ? 'Actif' : 'Inactif',
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'toggle', label: 'Activer/Desactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'activate', label: 'Activer', icon: Check, variant: 'default' },
    { key: 'deactivate', label: 'Desactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'id', order: 'desc' },
  messages: {
    loading: 'Chargement des categories...',
    empty: 'Aucune categorie trouvee',
    selected: (count) =>
      `${count} categorie${count > 1 ? 's' : ''} selectionnee${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'categories',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'categories',
  })
}

onMounted(() => fetchCategories({ page: 1, limit: 20 }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Categories</h1>
        <p class="text-muted-foreground">Gerez les categories et leurs traductions multilingues</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouvelle categorie
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="categorie"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Categories
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchCategories({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
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

    <CategoryForm
      :category="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
