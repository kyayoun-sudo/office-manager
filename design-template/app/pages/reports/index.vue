<script setup lang="ts">
import type { Report } from '~~/shared/types/report'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import { Eye, Edit, CheckCircle2, RotateCcw, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({ layout: 'default', middleware: ['auth', 'admin'] })
useHead({ title: 'Signalements - Modèle d’administration' })

const {
  reports, isLoading, error,
  fetchReports,
  getReportTypeLabel, getStatusLabel, getPriorityLabel,
  getStatusVariant, getPriorityVariant,
} = useReports()

const toast = useToast()

const selectedReport = ref<Report | null>(null)
const viewDialogOpen = ref(false)
const updateStatusDialogOpen = ref(false)
const resolveDialogOpen = ref(false)

const filtersState = ref({
  search: '', status: 'all', priority: 'all',
  reportType: 'all', category: 'all', language: 'fr',
})

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Titre, description, nom...',
  },
  {
    key: 'status',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'pending', label: 'En attente' },
      { value: 'in_progress', label: 'En cours' },
      { value: 'resolved', label: 'Résolu' },
      { value: 'rejected', label: 'Rejeté' },
      { value: 'escalated', label: 'Escaladé' },
    ],
  },
  {
    key: 'priority',
    label: 'Priorité',
    type: 'select',
    placeholder: 'Toutes les priorités',
    options: [
      { value: 'all', label: 'Toutes les priorités' },
      { value: 'low', label: 'Faible' },
      { value: 'medium', label: 'Moyenne' },
      { value: 'high', label: 'Élevée' },
      { value: 'critical', label: 'Critique' },
    ],
  },
  {
    key: 'reportType',
    label: 'Type',
    type: 'select',
    placeholder: 'Tous les types',
    options: [
      { value: 'all', label: 'Tous les types' },
      { value: 'inappropriate_behavior', label: 'Comportement' },
      { value: 'harassment', label: 'Harcèlement' },
      { value: 'fraud', label: 'Fraude' },
      { value: 'spam', label: 'Spam' },
      { value: 'fake_profile', label: 'Faux profil' },
      { value: 'safety_concern', label: 'Sécurité' },
      { value: 'technical_issue', label: 'Technique' },
      { value: 'other', label: 'Autre' },
    ],
  },
])

const getReportTitle = (report: Report) => {
  const translation = report.translations?.[0]
  return translation?.title || `Signalement ${report.id}`
}

const calculateDaysOpen = (createdAt: string) => {
  const diffTime = Math.abs(Date.now() - new Date(createdAt).getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

const performApiSearch = async () => {
  await fetchReports()
}

const clearAllFilters = async () => {
  filtersState.value = {
    search: '', status: 'all', priority: 'all',
    reportType: 'all', category: 'all', language: 'fr',
  }
  await fetchReports()
}

const displayItems = computed(() => {
  let items = Array.isArray(reports.value) ? reports.value.filter(Boolean) : []

  if (filtersState.value.search.trim()) {
    const query = filtersState.value.search.toLowerCase()
    items = items.filter(report =>
      report.translations?.some(t =>
        t.title?.toLowerCase().includes(query)
        || t.description?.toLowerCase().includes(query),
      )
      || report.reporterUser?.firstName?.toLowerCase().includes(query)
      || report.reporterUser?.lastName?.toLowerCase().includes(query)
      || report.reportedUser?.firstName?.toLowerCase().includes(query)
      || report.reportedUser?.lastName?.toLowerCase().includes(query),
    )
  }

  if (filtersState.value.status !== 'all')
    items = items.filter(r => r.status === filtersState.value.status)

  if (filtersState.value.priority !== 'all')
    items = items.filter(r => r.priority === filtersState.value.priority)

  if (filtersState.value.reportType !== 'all')
    items = items.filter(r => r.reportType === filtersState.value.reportType)

  if (filtersState.value.category !== 'all')
    items = items.filter(r => r.category === filtersState.value.category)

  return items
})

const tableConfig = computed((): DataTableConfig<Report> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'title', label: 'Signalement', sortable: true, getValue: (r) => getReportTitle(r) },
    {
      key: 'reportType',
      label: 'Type',
      sortable: true,
      getValue: (r) => getReportTypeLabel(r.reportType || 'other'),
    },
    {
      key: 'reporter',
      label: 'Signaleur',
      sortable: false,
      getValue: (r) => `${r.reporterUser?.firstName || 'N/A'} ${r.reporterUser?.lastName || ''}`.trim(),
    },
    {
      key: 'reported',
      label: 'Signalé',
      sortable: false,
      getValue: (r) => `${r.reportedUser?.firstName || 'N/A'} ${r.reportedUser?.lastName || ''}`.trim(),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      getValue: (r) => getStatusLabel(r.status || 'pending'),
    },
    {
      key: 'priority',
      label: 'Priorité',
      sortable: true,
      getValue: (r) => getPriorityLabel(r.priority || 'low'),
    },
    {
      key: 'daysOpen',
      label: 'Jours ouverts',
      sortable: true,
      getValue: (r) => r.createdAt ? `${calculateDaysOpen(r.createdAt)} j` : '0 j',
    },
    { key: 'createdAt', label: 'Date', sortable: true, render: 'datetime' },
  ],
  rowActions: [
    { key: 'view', label: 'Voir les détails', icon: Eye, variant: 'default' },
    { key: 'update-status', label: 'Modifier le statut', icon: Edit, variant: 'default', condition: (r) => r.status !== 'resolved' },
    { key: 'resolve', label: 'Marquer comme résolu', icon: CheckCircle2, variant: 'default', separator: true, condition: (r) => r.status !== 'resolved' },
  ],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'createdAt', order: 'desc' },
  messages: {
    loading: 'Chargement des signalements...',
    empty: 'Aucun signalement trouvé',
    selected: (count) => `${count} signalement${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'signalements',
}))

const handleRowAction = (_action: string, report: Report) => {
  selectedReport.value = report
  switch (_action) {
    case 'view':
      viewDialogOpen.value = true
      break
    case 'update-status':
      updateStatusDialogOpen.value = true
      break
    case 'resolve':
      resolveDialogOpen.value = true
      break
  }
}

const handleUpdateSuccess = () => {
  updateStatusDialogOpen.value = false
  fetchReports()
  toast.handleApiSuccess('Le statut du signalement a été mis à jour avec succès')
}

const handleResolveSuccess = () => {
  resolveDialogOpen.value = false
  fetchReports()
  toast.handleApiSuccess('Le signalement a été marqué comme résolu avec succès')
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'signalements',
  })
}

onMounted(() => fetchReports())

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Signalements</h1>
        <p class="text-muted-foreground">Gérez les signalements et réclamations de votre plateforme Exemple</p>
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
      :result-count="displayItems.length"
      result-label="signalement"
      :total-count="reports.length"
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

    <ViewReportDialog
      v-model:open="viewDialogOpen"
      :report="selectedReport"
      :selected-language="filtersState.language"
    />

    <UpdateReportStatusDialog
      v-model:open="updateStatusDialogOpen"
      :report="selectedReport"
      @success="handleUpdateSuccess"
    />

    <ResolveReportDialog
      v-model:open="resolveDialogOpen"
      :report="selectedReport"
      @success="handleResolveSuccess"
    />
  </div>
</template>
