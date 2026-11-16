<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { RejectionReason } from '~~/shared/types/rejection-reason'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({})
useHead({ title: 'Motifs de rejet - Modèle d’administration' })

const {
  rejectionReasons,
  loading,
  error,
  total,
  fetchRejectionReasons,
  toggleRejectionReason,
  deleteRejectionReason,
  bulkDeleteRejectionReasons,
} = useRejectionReasons()

const toast = useToast()
const { confirm } = useConfirm()

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

const clearAllFilters = async () => {
  filtersState.value = { search: '', isActive: 'all' }
  await fetchRejectionReasons()
}

const getReasonName = (reason: RejectionReason): string => {
  const fr = reason.translations?.find(t => t.languageCode === 'fr')
  const en = reason.translations?.find(t => t.languageCode === 'en')
  return fr?.name || en?.name || reason.translations?.[0]?.name || reason.code
}

const getTranslationsCount = (reason: RejectionReason): string => {
  const count = reason.translations?.length || 0
  return `${count} langue${count > 1 ? 's' : ''}`
}

const displayItems = computed(() => {
  let items = Array.isArray(rejectionReasons.value) ? rejectionReasons.value.filter(Boolean) : []
  const searchQuery = filtersState.value.search?.toLowerCase().trim()
  if (searchQuery) {
    items = items.filter((reason) => {
      const names = reason.translations?.map(t => t.name?.toLowerCase() || '').join(' ') || ''
      return [reason.code, names].some(v => (v || '').toLowerCase().includes(searchQuery))
    })
  }
  const { isActive } = filtersState.value
  if (isActive !== 'all') {
    items = items.filter(r => r.isActive === (isActive === 'true'))
  }
  return items
})

const handleRowAction = async (action: string, item: RejectionReason) => {
  switch (action) {
    case 'edit':
      navigateTo(`/rejection-reasons/${item.id}/edit`)
      break
    case 'toggle': {
      const result = await toggleRejectionReason(item.id)
      if (result?.success) {
        toast.handleApiSuccess(`Motif ${item.isActive ? 'désactivé' : 'activé'}`)
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la mise à jour' })
      }
      break
    }
    case 'delete': {
      const name = getReasonName(item)
      await confirm({
        title: 'Supprimer le motif de rejet',
        description: `Êtes-vous sûr de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteRejectionReason(item.id)
          if (!result?.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: RejectionReason[]) => {
  const ids = selected.map(item => item.id)
  if (action === 'delete') {
    await confirm({
      title: 'Supprimer les motifs',
      description: `Êtes-vous sûr de vouloir supprimer ${ids.length} motif${ids.length > 1 ? 's' : ''} ?`,
      confirmLabel: 'Supprimer',
      confirmLoadingLabel: 'Suppression...',
      icon: Trash2,
      variant: 'destructive',
      action: async () => {
        const result = await bulkDeleteRejectionReasons(ids)
        if (!result?.success) throw new Error('Certaines suppressions ont échoué')
        toast.handleApiSuccess(`${ids.length} motif(s) supprimé(s)`)
      },
    })
  }
}

const tableConfig: DataTableConfig<RejectionReason> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'code', label: 'Code', sortable: true, getValue: r => r.code },
    { key: 'name', label: 'Nom (FR)', sortable: true, getValue: r => getReasonName(r) },
    { key: 'translations', label: 'Traductions', getValue: r => getTranslationsCount(r) },
    {
      key: 'isActive',
      label: 'Statut',
      sortable: true,
      getValue: r => r.isActive ? 'Actif' : 'Inactif',
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'toggle', label: 'Activer/Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'id', order: 'asc' },
  messages: {
    loading: 'Chargement des motifs de rejet...',
    empty: 'Aucun motif de rejet trouvé',
    selected: count => `${count} motif${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'motifs-rejet',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'motifs-rejet',
  })
}

onMounted(() => fetchRejectionReasons())

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Motifs de rejet</h1>
        <p class="text-muted-foreground">Gérez les motifs de rejet des dossiers sage-femme</p>
      </div>
      <UiButton @click="navigateTo('/rejection-reasons/new')">
        <Plus class="mr-2 h-4 w-4" />
        Nouveau motif
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="displayItems.length"
      result-label="motif"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="fetchRejectionReasons()"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Motifs
        <span class="text-sm font-normal text-muted-foreground">
          ({{ displayItems.length }} résultat{{ displayItems.length > 1 ? 's' : '' }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline" size="sm"
          :disabled="loading"
          @click="fetchRejectionReasons()"
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
  </div>
</template>
