<script setup lang="ts">
import type { Patient } from '~~/shared/types/patient'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import { Eye, RotateCcw, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Patients - Modèle d’administration' })

const {
  patients, isLoading, error, total,
  fetchPatients, getFullName, getChildrenDisplayText,
} = usePatients()

const toast = useToast()

const viewDialogOpen = ref(false)
const selectedPatient = ref<Patient | null>(null)

const currentPage = ref(1)
const itemsPerPage = ref(20)
const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / itemsPerPage.value)))

const filtersState = ref({ search: '', numberOfChildren: 'all', bio: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, email, téléphone...',
  },
  {
    key: 'numberOfChildren',
    label: "Nombre d'enfants",
    type: 'select',
    placeholder: 'Tous',
    options: [
      { value: 'all', label: 'Tous' },
      { value: '0', label: 'Aucun enfant' },
      { value: '1', label: '1 enfant' },
      { value: '2', label: '2 enfants' },
      { value: '3+', label: '3 enfants ou plus' },
    ],
  },
  {
    key: 'bio',
    label: 'Bio',
    type: 'select',
    placeholder: 'Tous',
    options: [
      { value: 'all', label: 'Tous' },
      { value: 'with', label: 'Avec bio' },
      { value: 'without', label: 'Sans bio' },
    ],
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = { sortBy: 'createdAt', sortOrder: 'DESC' }
  const { search, numberOfChildren } = filtersState.value
  if (search) params.search = search
  if (numberOfChildren !== 'all' && numberOfChildren !== '3+') {
    params.numberOfChildren = parseInt(numberOfChildren)
  }
  return params
}

const performApiSearch = async () => {
  currentPage.value = 1
  await fetchPatients({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', numberOfChildren: 'all', bio: 'all' }
  currentPage.value = 1
  await fetchPatients({ page: 1, limit: itemsPerPage.value, sortBy: 'createdAt', sortOrder: 'DESC' })
}

const displayItems = computed(() => {
  let items = Array.isArray(patients.value) ? patients.value.filter(Boolean) : []

  if (filtersState.value.numberOfChildren === '3+') {
    items = items.filter(p => (p.numberOfChildren || 0) >= 3)
  }

  if (filtersState.value.bio === 'with') {
    items = items.filter(p => p.bio && p.bio.trim() !== '')
  } else if (filtersState.value.bio === 'without') {
    items = items.filter(p => !p.bio || p.bio.trim() === '')
  }

  return items
})

const paginationInfo = computed(() => {
  const t = total.value || displayItems.value.length
  const start = t > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, t)
  return { start, end, total: t }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    currentPage.value = page
    await fetchPatients({ page, limit: itemsPerPage.value, ...getCurrentFilterParams() })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  itemsPerPage.value = newSize
  currentPage.value = 1
  await fetchPatients({ page: 1, limit: newSize, ...getCurrentFilterParams() })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const truncateText = (text: string, maxLength = 50) =>
  text.length > maxLength ? `${text.substring(0, maxLength)}...` : text

const tableConfig = computed((): DataTableConfig<Patient> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'name', label: 'Nom', sortable: true, getValue: (p) => getFullName(p) },
    { key: 'email', label: 'Email', sortable: true, getValue: (p) => p.user.email },
    { key: 'phone', label: 'Téléphone', sortable: false, getValue: (p) => p.user.phone || 'N/A' },
    { key: 'bio', label: 'Bio', sortable: false, getValue: (p) => p.bio ? truncateText(p.bio) : 'Pas de bio' },
    { key: 'numberOfChildren', label: 'Enfants', sortable: true, getValue: (p) => getChildrenDisplayText(p.numberOfChildren || 0) },
    { key: 'allergies', label: 'Allergies', sortable: false, getValue: (p) => p.allergies ? truncateText(p.allergies, 40) : 'Aucune' },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      getValue: (p) => p.user.isActive ? 'Actif' : 'Inactif',
    },
  ],
  rowActions: [
    { key: 'view', label: 'Voir le profil', icon: Eye, variant: 'default' },
  ],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'id', order: 'desc' },
  messages: {
    loading: 'Chargement des patients...',
    empty: 'Aucun patient trouvé',
    selected: (count) => `${count} patient${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'patients',
}))

const handleRowAction = (_action: string, patient: Patient) => {
  selectedPatient.value = patient
  viewDialogOpen.value = true
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'patients',
  })
}

onMounted(() => fetchPatients({ page: 1, limit: itemsPerPage.value, sortBy: 'createdAt', sortOrder: 'DESC' }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Patients</h1>
        <p class="text-muted-foreground">Gérez les patients de votre plateforme Exemple</p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" :disabled="isLoading" @click="performApiSearch">
          <RotateCcw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
        <UiButton variant="outline" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
      </div>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="paginationInfo.total"
      result-label="patient"
      :total-count="paginationInfo.total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <GenericDataTable
      :data="displayItems"
      :config="tableConfig"
      :is-loading="isLoading"
      @row-action="handleRowAction"
    />

    <Pagination
      :current-page="currentPage"
      :total-pages="totalPages"
      :total-items="paginationInfo.total"
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

    <ViewPatientDialog
      v-model:open="viewDialogOpen"
      :patient="selectedPatient"
    />
  </div>
</template>
