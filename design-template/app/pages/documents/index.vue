<script setup lang="ts">
import { Plus, Eye, Edit, Trash2, RotateCcw, Check, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { Document } from '~~/shared/types/document'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({
  title: 'Gestion des Documents',
  description: 'Gérez les documents légaux et leurs traductions',
})
useHead({ title: 'Documents - Modèle d’administration' })

const { toast } = useToast()
const { confirm } = useConfirm()
const {
  documents, loading: isLoading, error,
  total, currentPage: apiCurrentPage, totalPages: apiTotalPages, itemsPerPage: apiItemsPerPage,
  fetchDocuments, deleteDocument,
  toggleDocumentStatus, bulkActivateDocuments, bulkDeactivateDocuments, bulkDeleteDocuments,
} = useDocuments()

const showViewDialog = ref(false)
const viewingDocument = ref<Document | null>(null)

const documentTypes = [
  { value: 'terms', label: "Conditions Generales d'Utilisation" },
  { value: 'privacy', label: 'Politique de Confidentialite' },
  { value: 'sales_conditions', label: 'Conditions Generales de Vente' },
]

const filtersState = ref({ search: '', type: 'all', isActive: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Nom, contenu, type...',
    icon: Filter,
  },
  {
    key: 'type',
    label: 'Type de document',
    type: 'select',
    placeholder: 'Tous les types',
    options: [
      { value: 'all', label: 'Tous les types' },
      ...documentTypes.map((type) => ({ value: type.value, label: type.label })),
    ],
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
  const params: Record<string, any> = { lang: 'fr' }
  const { search, type, isActive } = filtersState.value
  if (search) params.search = search
  if (type !== 'all') params.type = type
  if (isActive !== 'all') params.isActive = isActive === 'true'
  return params
}

const currentPage = computed(() => apiCurrentPage?.value || 1)
const totalPages = computed(() => apiTotalPages?.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage?.value || 20)

const performApiSearch = async () => {
  await fetchDocuments({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', type: 'all', isActive: 'all' }
  await fetchDocuments({ page: 1, limit: itemsPerPage.value, lang: 'fr' })
}

const displayItems = computed(() =>
  Array.isArray(documents.value) ? documents.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const t = total?.value || displayItems.value.length
  const start = t > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayItems.value.length - 1, t)
  return { start, end, total: t }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchDocuments({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchDocuments({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages: number[] = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const openCreateForm = () => {
  navigateTo('/documents/create')
}

const handleRowAction = async (action: string, document: Document) => {
  switch (action) {
    case 'view':
      viewingDocument.value = document
      showViewDialog.value = true
      break
    case 'edit':
      navigateTo(`/documents/${document.id}/edit`)
      break
    case 'toggle': {
      const response = await toggleDocumentStatus(document.id, !document.isActive)
      if (response.success) {
        toast({ title: 'Succès', description: `Document ${document.isActive ? 'désactivé' : 'activé'}` })
      } else {
        toast({ title: 'Erreur', description: 'Erreur lors de la mise à jour', variant: 'destructive' })
      }
      break
    }
    case 'delete': {
      await confirm({
        title: 'Supprimer le document',
        description: `Etes-vous sur de vouloir supprimer le document #${document.id} ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const response = await deleteDocument(document.id)
          if (!response.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selectedDocuments: Document[]) => {
  const ids = selectedDocuments.map((d) => d.id)
  try {
    let result
    switch (action) {
      case 'activate':
        result = await bulkActivateDocuments(ids)
        if (result.success) toast({ title: 'Succès', description: `${ids.length} document${ids.length > 1 ? 's' : ''} activé${ids.length > 1 ? 's' : ''}` })
        break
      case 'deactivate':
        result = await bulkDeactivateDocuments(ids)
        if (result.success) toast({ title: 'Succès', description: `${ids.length} document${ids.length > 1 ? 's' : ''} désactivé${ids.length > 1 ? 's' : ''}` })
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les documents',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} document${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteDocuments(ids)
            if (!result.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result && !result.success) {
      toast({ title: 'Erreur partielle', description: 'Certaines opérations ont échoué', variant: 'destructive' })
    }
  } catch (err: any) {
    toast({ title: 'Erreur', description: err.message || "Erreur lors de l'opération", variant: 'destructive' })
  }
}

const tableConfig: DataTableConfig<Document> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'documentType',
      label: 'Type',
      sortable: true,
      width: '150px',
      getValue: (document) => {
        const typeInfo = documentTypes.find((t) => t.value === document.documentType)
        return typeInfo?.label || document.documentType
      },
    },
    {
      key: 'title',
      label: 'Titre',
      sortable: true,
      getValue: (document) => {
        const frTranslation = document.translations?.find((t) => t.language?.code === 'fr')
        return frTranslation?.title || document.documentType
      },
    },
    {
      key: 'translations',
      label: 'Langues',
      getValue: (document) => {
        const count = document.translations?.length || 0
        return `${count} langue${count > 1 ? 's' : ''}`
      },
    },
    {
      key: 'isActive',
      label: 'Statut',
      getValue: (document) => document.isActive ? 'Actif' : 'Inactif',
    },
    { key: 'updatedAt', label: 'Mis à jour', sortable: true, render: 'datetime' },
  ],
  rowActions: [
    { key: 'view', label: 'Voir les détails', icon: Eye, variant: 'ghost' },
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'toggle', label: 'Activer/Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'activate', label: 'Activer', icon: Check, variant: 'default' },
    { key: 'deactivate', label: 'Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: true,
  defaultSort: { key: 'id', order: 'desc' },
  messages: {
    loading: 'Chargement des documents...',
    empty: 'Aucun document trouvé',
    selected: (count) => `${count} document${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'documents',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'documents',
  })
}

onMounted(() => fetchDocuments({ page: 1, limit: 20, lang: 'fr' }))

watch(error, (newError) => {
  if (newError) toast({ title: 'Erreur', description: newError || 'Erreur lors du chargement', variant: 'destructive' })
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Documents</h1>
        <p class="text-muted-foreground">Gérez les documents légaux et leurs traductions multilingues</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouveau document
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="paginationInfo.total"
      result-label="document"
      :total-count="paginationInfo.total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Documents
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="isLoading"
          @click="fetchDocuments({ ...getCurrentFilterParams(), page: currentPage, limit: itemsPerPage })"
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

    <ViewDocumentDialog
      :open="showViewDialog"
      :document="viewingDocument"
      @update:open="(value: boolean) => { showViewDialog = value; if (!value) viewingDocument = null }"
    />
  </div>
</template>
