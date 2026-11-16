<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Check, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { Specialty } from '#shared/types/specialty'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import SpecialtyForm from '~/components/forms/SpecialtyForm.vue'

definePageMeta({
  title: 'Gestion des Spécialités',
  description: 'Gérez les spécialités médicales et leurs traductions',
})
useHead({ title: 'Spécialités - Modèle d’administration' })

const {
  specialties,
  loading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchSpecialties,
  getSpecialtyById,
  createSpecialty,
  updateSpecialty,
  deleteSpecialty,
  toggleSpecialtyStatus,
  bulkActivateSpecialties,
  bulkDeactivateSpecialties,
  bulkDeleteSpecialties,
} = useSpecialties()

const {
  categories,
  isLoading: categoriesLoading,
  error: categoriesError,
  fetchCategories,
} = useCategories()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '', isActive: 'all', category: 'all' })

const categoryOptions = computed(() => {
  const options = [{ value: 'all', label: 'Toutes les catégories' }]
  categories.value.forEach((cat) => {
    const fr = cat.translations?.find((t) => t.language?.code === 'fr')
    options.push({ value: cat.code, label: fr?.name || cat.code })
  })
  return options
})

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, code, catégorie...',
    icon: Filter,
  },
  {
    key: 'isActive',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'true', label: 'Actives' },
      { value: 'false', label: 'Inactives' },
    ],
  },
  {
    key: 'category',
    label: 'Catégorie',
    type: 'select',
    placeholder: 'Toutes les catégories',
    loading: categoriesLoading.value,
    options: categoryOptions.value,
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = {}
  const { search, isActive, category } = filtersState.value
  if (search) params.search = search
  if (isActive !== 'all') params.isActive = isActive === 'true'
  if (category !== 'all') params.category = category
  return params
}

const performApiSearch = async () => {
  await fetchSpecialties({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', isActive: 'all', category: 'all' }
  await fetchSpecialties({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 20)

const displayItems = computed(() =>
  Array.isArray(specialties.value) ? specialties.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchSpecialties({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchSpecialties({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const showForm = ref(false)
const selectedItem = ref<Specialty | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: Specialty) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getSpecialtyById(item.id, true)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des détails' })
      }
      break
    }
    case 'toggle': {
      const result = await toggleSpecialtyStatus(item.id, !item.isActive)
      if (result.success) {
        toast.handleApiSuccess(`Spécialité ${item.isActive ? 'désactivée' : 'activée'}`)
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la mise à jour' })
      }
      break
    }
    case 'delete': {
      const name = item.translations?.find((t: any) => t.language?.code === 'fr')?.name || item.code
      await confirm({
        title: 'Supprimer la specialite',
        description: `Etes-vous sur de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteSpecialty(item.id)
          if (!result.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: Specialty[]) => {
  const ids = selected.map((item) => item.id)
  try {
    let result: any
    switch (action) {
      case 'activate':
        result = await bulkActivateSpecialties(ids)
        break
      case 'deactivate':
        result = await bulkDeactivateSpecialties(ids)
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les specialites',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} specialite${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteSpecialties(ids)
            if (!result?.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result?.success) {
      const labels: Record<string, string> = { activate: 'activée', deactivate: 'désactivée', delete: 'supprimée' }
      toast.handleApiSuccess(`${ids.length} spécialité(s) ${labels[action] || action}(s)`)
    } else {
      toast.handleApiError({ success: false, message: 'Certaines opérations ont échoué' })
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
      result = await updateSpecialty({ ...updateData, id: id ?? selectedItem.value.id })
    } else {
      result = await createSpecialty(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(
        selectedItem.value ? 'Spécialité modifiée avec succès' : 'Spécialité créée avec succès',
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

const tableConfig: DataTableConfig<Specialty> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (specialty) => {
        const fr = specialty.translations?.find((t: any) => t.language?.code === 'fr')
        return fr?.name || specialty.name || specialty.code
      },
    },
    {
      key: 'category',
      label: 'Catégorie',
      getValue: (specialty) => specialty.category?.name || 'Non définie',
    },
    {
      key: 'isDefault',
      label: 'Par defaut',
      getValue: (specialty) => specialty.isDefault ? 'Oui' : 'Non',
    },
    {
      key: 'clinicianSetsDate',
      label: 'Planification',
      getValue: (specialty) => specialty.clinicianSetsAppointmentDate ? 'Clinicien' : 'Patient',
    },
    {
      key: 'isActive',
      label: 'Statut',
      getValue: (specialty) => specialty.isActive ? 'Active' : 'Inactive',
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'toggle', label: 'Activer/Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'activate', label: 'Activer', icon: Check, variant: 'default' },
    { key: 'deactivate', label: 'Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'id', order: 'desc' },
  messages: {
    loading: 'Chargement des spécialités...',
    empty: 'Aucune spécialité trouvée',
    selected: (count) => `${count} spécialité${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'specialites',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'specialites',
  })
}

onMounted(async () => {
  await Promise.all([
    fetchSpecialties({ page: 1, limit: 20 }),
    fetchCategories(),
  ])
  if (categoriesError.value) {
    toast.toast({ title: 'Avertissement', description: 'Erreur lors du chargement des catégories' })
  }
})

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Spécialités</h1>
        <p class="text-muted-foreground">Gérez les spécialités médicales et leurs traductions multilingues</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouvelle spécialité
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="spécialité"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Spécialités
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchSpecialties({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
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

    <SpecialtyForm
      :specialty="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
