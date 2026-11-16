<script setup lang="ts">
import { Plus, Edit, Trash2, RotateCcw, Check, Filter, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { Language } from '~~/shared/types/language'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import LanguageForm from '~/components/forms/LanguageForm.vue'

definePageMeta({
  title: 'Gestion des Langues',
  description: "Gérez les langues disponibles dans l'application",
})
useHead({ title: 'Langues - Modèle d’administration' })

const {
  languages,
  loading,
  error,
  total,
  fetchLanguages,
  getLanguageById,
  createLanguage,
  updateLanguage,
  toggleLanguage,
  deleteLanguage,
  bulkEnableLanguages,
  bulkDisableLanguages,
  bulkDeleteLanguages,
} = useLanguages()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ search: '', enabled: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Code, nom...',
    icon: Filter,
  },
  {
    key: 'enabled',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'true', label: 'Activées' },
      { value: 'false', label: 'Désactivées' },
    ],
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = { includeAllTranslations: true }
  const { enabled } = filtersState.value
  if (enabled !== 'all') params.enabled = enabled === 'true'
  return params
}

const performApiSearch = async () => {
  await fetchLanguages(getCurrentFilterParams())
}

const clearAllFilters = async () => {
  filtersState.value = { search: '', enabled: 'all' }
  await fetchLanguages({ includeAllTranslations: true })
}

const getLanguageName = (language: Language): string => {
  const fr = language.translations?.find((t: any) => t.targetLanguage?.code === 'fr')
  const en = language.translations?.find((t: any) => t.targetLanguage?.code === 'en')
  return fr?.name || en?.name || language.translations?.[0]?.name || language.code.toUpperCase()
}

const displayItems = computed(() => {
  let items = Array.isArray(languages.value) ? languages.value.filter(Boolean) : []
  const searchQuery = filtersState.value.search?.toLowerCase().trim()
  if (searchQuery) {
    items = items.filter((language) => {
      const translationNames = language.translations?.map((t: any) => t.name?.toLowerCase() || '').join(' ') || ''
      return [language.code, language.flag, translationNames].some((v) => (v || '').toLowerCase().includes(searchQuery))
    })
  }
  return items
})

const showForm = ref(false)
const selectedItem = ref<Language | null>(null)

const openCreateForm = () => {
  selectedItem.value = null
  showForm.value = true
}

const handleRowAction = async (action: string, item: Language) => {
  switch (action) {
    case 'edit': {
      const fullItem = await getLanguageById(item.id, true)
      if (fullItem) {
        selectedItem.value = fullItem
        showForm.value = true
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors du chargement des détails' })
      }
      break
    }
    case 'toggle': {
      const result = await toggleLanguage(item.id)
      if (result?.success) {
        toast.handleApiSuccess(`Langue ${item.enabled ? 'désactivée' : 'activée'}`)
      } else {
        toast.handleApiError({ success: false, message: 'Erreur lors de la mise à jour' })
      }
      break
    }
    case 'delete': {
      const name = item.translations?.find((t: any) => t.targetLanguage?.code === 'fr')?.name || item.code
      await confirm({
        title: 'Supprimer la langue',
        description: `Etes-vous sur de vouloir supprimer "${name}" ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        variant: 'destructive',
        action: async () => {
          const result = await deleteLanguage(item.id)
          if (!result?.success) throw new Error('Erreur lors de la suppression')
        },
      })
      break
    }
  }
}

const handleBulkAction = async (action: string, selected: Language[]) => {
  const ids = selected.map((item) => item.id)
  try {
    let result: any
    switch (action) {
      case 'enable':
        result = await bulkEnableLanguages(ids)
        break
      case 'disable':
        result = await bulkDisableLanguages(ids)
        break
      case 'delete':
        await confirm({
          title: 'Supprimer les langues',
          description: `Etes-vous sur de vouloir supprimer ${ids.length} langue${ids.length > 1 ? 's' : ''} ?`,
          confirmLabel: 'Supprimer',
          confirmLoadingLabel: 'Suppression...',
          icon: Trash2,
          variant: 'destructive',
          action: async () => {
            result = await bulkDeleteLanguages(ids)
            if (!result?.success) throw new Error('Certaines suppressions ont echoue')
          },
        })
        break
    }
    if (result?.success) {
      const labels: Record<string, string> = { enable: 'activée', disable: 'désactivée', delete: 'supprimée' }
      toast.handleApiSuccess(`${ids.length} langue(s) ${labels[action] || action}(s)`)
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
      result = await updateLanguage({ ...data, id: data.id ?? selectedItem.value.id })
    } else {
      result = await createLanguage(data)
    }
    if (result?.success) {
      toast.handleApiSuccess(selectedItem.value ? 'Langue modifiée avec succès' : 'Langue créée avec succès')
      showForm.value = false
      selectedItem.value = null
      await fetchLanguages(getCurrentFilterParams())
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

const tableConfig: DataTableConfig<Language> = {
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'flag',
      label: 'Drapeau',
      sortable: false,
      width: '100px',
      getValue: (language) => language.flag || '',
      cellClass: 'text-2xl text-center',
    },
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (language) => getLanguageName(language),
    },
    {
      key: 'translations',
      label: 'Traductions',
      getValue: (language) => {
        const count = language.translations?.length || 0
        return `${count} traduction${count > 1 ? 's' : ''}`
      },
    },
    {
      key: 'enabled',
      label: 'Statut',
      sortable: true,
      getValue: (language) => language.enabled ? 'Activée' : 'Désactivée',
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit, variant: 'ghost' },
    { key: 'toggle', label: 'Activer/Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'enable', label: 'Activer', icon: Check, variant: 'default' },
    { key: 'disable', label: 'Désactiver', icon: RotateCcw, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
  ],
  selectable: false,
  defaultSort: { key: 'id', order: 'asc' },
  messages: {
    loading: 'Chargement des langues...',
    empty: 'Aucune langue trouvée',
    selected: (count) => `${count} langue${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'langues',
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.columns,
    filename: 'langues',
  })
}

onMounted(() => fetchLanguages({ includeAllTranslations: true }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Langues</h1>
        <p class="text-muted-foreground">Gérez les langues disponibles dans l'application</p>
      </div>
      <UiButton @click="openCreateForm">
        <Plus class="mr-2 h-4 w-4" />
        Nouvelle langue
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="displayItems.length"
      result-label="langue"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Langues
        <span class="text-sm font-normal text-muted-foreground">
          ({{ displayItems.length }} résultat{{ displayItems.length > 1 ? 's' : '' }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="fetchLanguages(getCurrentFilterParams())"
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

    <LanguageForm
      :language="selectedItem"
      :is-open="showForm"
      :is-loading="loading"
      @submit="handleFormSubmit"
      @cancel="handleFormCancel"
    />
  </div>
</template>
