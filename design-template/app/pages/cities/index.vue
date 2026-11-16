<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Check, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { City } from '#shared/types/city'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import CityForm from '~/components/forms/CityForm.vue'

definePageMeta({
  title: 'Gestion des Villes',
  description: 'Gerez les villes et leurs traductions',
})
useHead({ title: 'Villes - Modèle d’administration' })

const {
  cities,
  loading,
  error,
  fetchCities,
  getCityById,
  createCity,
  updateCity,
  deleteCity,
  toggleCityStatus,
  bulkActivateCities,
  bulkDeactivateCities,
  bulkDeleteCities,
} = useCities()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '', isActive: 'all', country: 'all' })

const allCountries = computed(() => {
  const countryMap = new Map<string, string>()
  cities.value.forEach((city) => {
    if (city.country) {
      const frTranslation = city.country.translations?.find((t) => t.language?.code === 'fr')
      countryMap.set(city.country.id.toString(), frTranslation?.name || city.country.code)
    }
  })
  const options = [{ value: 'all', label: 'Tous les pays' }]
  countryMap.forEach((label, value) => {
    options.push({ value, label })
  })
  return options
})

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, code postal...',
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
    key: 'country',
    label: 'Pays',
    type: 'select',
    placeholder: 'Tous les pays',
    options: allCountries.value,
  },
])

const filteredItems = computed(() => {
  if (!Array.isArray(cities.value)) return []

  let items = cities.value.filter(Boolean)
  const { search, isActive, country } = filtersState.value

  if (search) {
    const q = search.toLowerCase()
    items = items.filter((city) => {
      const frName = city.translations?.find((t) => t.language?.code === 'fr')?.name || ''
      const enName = city.translations?.find((t) => t.language?.code === 'en')?.name || ''
      const nlName = city.translations?.find((t) => t.language?.code === 'nl')?.name || ''
      return (
        frName.toLowerCase().includes(q) ||
        enName.toLowerCase().includes(q) ||
        nlName.toLowerCase().includes(q) ||
        (city.postalCode || '').toLowerCase().includes(q)
      )
    })
  }

  if (isActive !== 'all') {
    items = items.filter((city) => city.isActive === (isActive === 'true'))
  }

  if (country !== 'all') {
    items = items.filter((city) => city.country?.id?.toString() === country)
  }

  return items
})

const currentPage = ref(1)
const itemsPerPage = ref(20)

const totalFiltered = computed(() => filteredItems.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / itemsPerPage.value)))

const displayItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value
  return filteredItems.value.slice(start, start + itemsPerPage.value)
})

const paginationInfo = computed(() => {
  const start = totalFiltered.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, totalFiltered.value)
  return { start, end, total: totalFiltered.value }
})

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) currentPage.value = page
}

const changeItemsPerPage = (newSize: number) => {
  itemsPerPage.value = newSize
  currentPage.value = 1
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

watch(filtersState, () => { currentPage.value = 1 }, { deep: true })

const clearAllFilters = () => {
  filtersState.value = { search: '', isActive: 'all', country: 'all' }
}

const showForm = ref(false)
const selectedItem = ref<City | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: City) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getCityById(item.id)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des details' })
      }
      break
    }
    case 'toggle': {
      const result = await toggleCityStatus(item.id, !item.isActive)
      if (result.success) {
        toast.handleApiSuccess(`Ville ${item.isActive ? 'desactivee' : 'activee'}`)
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la mise a jour' })
      }
      break
    }
    case 'delete': {
      const name = item.translations?.find((t: any) => t.language?.code === 'fr')?.name || item.name || item.code
      await confirm({
        title: 'Supprimer la ville',
        description: `Etes-vous sur de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteCity(item.id)
          if (!result.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: City[]) => {
  const ids = selected.map((item) => item.id)
  try {
    let result: any
    switch (action) {
      case 'activate':
        result = await bulkActivateCities(ids)
        break
      case 'deactivate':
        result = await bulkDeactivateCities(ids)
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les villes',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} ville${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteCities(ids)
            if (!result?.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result?.success) {
      const labels: Record<string, string> = { activate: 'activee', deactivate: 'desactivee', delete: 'supprimee' }
      toast.handleApiSuccess(`${ids.length} ville(s) ${labels[action] || action}(s)`)
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
      result = await updateCity({ ...updateData, id: id ?? selectedItem.value.id })
    } else {
      result = await createCity(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(
        selectedItem.value ? 'Ville modifiee avec succes' : 'Ville creee avec succes',
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

const tableConfig: DataTableConfig<City> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'postalCode',
      label: 'Code postal',
      sortable: true,
      width: '140px',
      cellClass: 'font-mono text-sm font-medium',
    },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (city) => {
        const fr = city.translations?.find((t: any) => t.language?.code === 'fr')
        return fr?.name || city.name || '-'
      },
    },
    {
      key: 'country',
      label: 'Pays',
      getValue: (city) => {
        if (!city.country) return '-'
        const fr = city.country.translations?.find((t: any) => t.language?.code === 'fr')
        return fr?.name || city.country.code
      },
    },
    {
      key: 'isActive',
      label: 'Statut',
      getValue: (city) => city.isActive ? 'Active' : 'Inactive',
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
  defaultSort: { key: 'id', order: 'asc' },
  messages: {
    loading: 'Chargement des villes...',
    empty: 'Aucune ville trouvee',
    selected: (count) => `${count} ville${count > 1 ? 's' : ''} selectionnee${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'villes',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'villes',
  })
}

onMounted(() => fetchCities())

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Villes</h1>
        <p class="text-muted-foreground">Gerez les villes et leurs traductions multilingues</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouvelle ville
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="immediate"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="totalFiltered"
      result-label="ville"
      :total-count="cities.length"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Villes
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchCities()"
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
      :total-items="totalFiltered"
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

    <CityForm
      :city="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
