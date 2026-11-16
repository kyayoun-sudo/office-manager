<script setup lang="ts">
import type { AnnouncementMessage } from '~~/shared/types/announcement-message'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import { Plus, RotateCcw, Trash2, Send, ToggleLeft, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({ layout: 'default', middleware: ['auth', 'admin'] })
useHead({ title: 'Messages d\'annonce - Modèle d’administration' })

const {
  messages, isLoading, error,
  fetchMessages, sendMessage, bulkAction,
  toggleMessageStatus, deleteMessage,
} = useAnnouncementMessages()

const toast = useToast()
const { confirm } = useConfirm()

const createDialogOpen = ref(false)
const bulkActionDialogOpen = ref(false)
const bulkActionType = ref<'activate' | 'deactivate' | 'delete' | 'send'>('activate')
const selectedMessagesForBulkAction = ref<AnnouncementMessage[]>([])

const filtersState = ref({
  search: '', targetType: 'all', priority: 'all',
  status: 'all', type: 'all', language: 'fr',
})

const filterFields = computed((): FilterField[] => [
  {
    key: 'search',
    label: 'Recherche',
    type: 'input',
    placeholder: 'Titre, contenu ou résumé...',
  },
  {
    key: 'language',
    label: "Langue d'affichage",
    type: 'select',
    placeholder: 'Français',
    options: SUPPORTED_LANGUAGES.map(lang => ({ value: lang.code, label: lang.name })),
  },
  {
    key: 'priority',
    label: 'Priorité',
    type: 'select',
    placeholder: 'Toutes les priorités',
    options: [
      { value: 'all', label: 'Toutes les priorités' },
      { value: 'info', label: 'Information' },
      { value: 'normal', label: 'Normale' },
      { value: 'medium', label: 'Moyenne' },
      { value: 'high', label: 'Haute' },
      { value: 'urgent', label: 'Urgent' },
    ],
  },
  {
    key: 'targetType',
    label: 'Destinataires',
    type: 'select',
    placeholder: 'Tous',
    options: [
      { value: 'all', label: 'Tous' },
      { value: 'provider', label: 'Prestataires' },
      { value: 'clinician', label: 'Cliniciens' },
      { value: 'midwives', label: 'Sages-femmes' },
      { value: 'patients', label: 'Patients' },
      { value: 'patient', label: 'Patient' },
    ],
  },
])

const getTranslation = (message: AnnouncementMessage, languageCode: string = filtersState.value.language) => {
  return message.translations?.find(t => t.language.code === languageCode) || message.translations?.[0]
}

const getMessageTitle = (message: AnnouncementMessage, languageCode?: string) => {
  return getTranslation(message, languageCode)?.title || `Message ${message.id}`
}

const getPriorityLabel = (priority: string): string => {
  const labels: Record<string, string> = {
    info: 'Information', normal: 'Normale', medium: 'Moyenne', high: 'Haute', urgent: 'Urgent',
  }
  return labels[priority] || priority
}

const getTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    feature: 'Fonctionnalité', maintenance: 'Maintenance', security: 'Sécurité',
    billing_system: 'Facturation', general: 'Général', promotion: 'Promotion', update: 'Mise à jour',
  }
  return labels[type] || type
}

const getTargetTypeLabel = (targetType: string): string => {
  const labels: Record<string, string> = {
    provider: 'Prestataires', clinician: 'Cliniciens', midwives: 'Sages-femmes',
    patients: 'Patients', patient: 'Patient', all: 'Tous',
  }
  return labels[targetType] || targetType
}

const performApiSearch = async () => {
  await refreshMessages()
}

const clearAllFilters = async () => {
  filtersState.value = {
    search: '', targetType: 'all', priority: 'all',
    status: 'all', type: 'all', language: 'fr',
  }
  await refreshMessages()
}

const displayItems = computed(() => {
  let result = messages.value || []

  if (filtersState.value.search.trim()) {
    const query = filtersState.value.search.toLowerCase()
    result = result.filter(message =>
      message.translations?.some(t =>
        t.title.toLowerCase().includes(query)
        || t.content.toLowerCase().includes(query)
        || t.summary?.toLowerCase().includes(query),
      ),
    )
  }

  if (filtersState.value.targetType !== 'all')
    result = result.filter(m => m.targetType === filtersState.value.targetType)

  if (filtersState.value.priority !== 'all')
    result = result.filter(m => m.priority === filtersState.value.priority)

  if (filtersState.value.type !== 'all')
    result = result.filter(m => m.type === filtersState.value.type)

  if (filtersState.value.status !== 'all') {
    if (filtersState.value.status === 'sent') result = result.filter(m => m.isSent)
    else if (filtersState.value.status === 'pending') result = result.filter(m => !m.isSent)
    else if (filtersState.value.status === 'active') result = result.filter(m => m.isActive)
    else if (filtersState.value.status === 'inactive') result = result.filter(m => !m.isActive)
  }

  return result
})

const tableConfig = computed((): DataTableConfig<AnnouncementMessage> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'title', label: 'Titre', sortable: true, getValue: (message) => getMessageTitle(message) },
    {
      key: 'type', label: 'Type', sortable: true,
      getValue: (message) => getTypeLabel(message.type),
    },
    {
      key: 'priority', label: 'Priorité', sortable: true,
      getValue: (message) => getPriorityLabel(message.priority),
    },
    { key: 'targetType', label: 'Destinataires', sortable: true, getValue: (message) => getTargetTypeLabel(message.targetType) },
    {
      key: 'status', label: 'Statut', sortable: false,
      getValue: (message) => message.isActive ? 'Actif' : 'Inactif',
    },
    {
      key: 'isSent', label: 'Envoi', sortable: false,
      getValue: (message) => message.isSent ? 'Envoyé' : 'En attente',
    },
    { key: 'createdAt', label: 'Créé le', sortable: true, render: 'datetime' },
  ],
  rowActions: [
    { key: 'send', label: 'Envoyer', icon: Send, variant: 'default', condition: (m) => !m.isSent },
    { key: 'toggle', label: 'Activer/Désactiver', icon: ToggleLeft, variant: 'outline' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [
    { key: 'activate', label: 'Activer', variant: 'outline' },
    { key: 'deactivate', label: 'Désactiver', variant: 'outline' },
    { key: 'send', label: 'Envoyer', icon: Send, variant: 'default' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive' },
  ],
  selectable: true,
  defaultSort: { key: 'createdAt', order: 'desc' },
  messages: {
    loading: 'Chargement des messages...',
    empty: 'Aucun message trouvé',
    selected: (count) => `${count} message${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'messages-annonces',
}))

const handleRowAction = async (action: string, message: AnnouncementMessage) => {
  if (action === 'send') await handleSendMessage(message)
  else if (action === 'toggle') await handleToggleStatus(message.id, !message.isActive)
  else if (action === 'delete') await handleDeleteMessage(message)
}

const handleBulkAction = (action: string, selected: AnnouncementMessage[]) => {
  selectedMessagesForBulkAction.value = selected
  bulkActionType.value = action as 'activate' | 'deactivate' | 'delete' | 'send'
  bulkActionDialogOpen.value = true
}

const refreshMessages = async () => {
  try {
    await fetchMessages()
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Impossible de charger les messages' }, 'Erreur')
  }
}

const handleSendMessage = async (message: AnnouncementMessage) => {
  try {
    await sendMessage(message.id)
    toast.handleApiSuccess('Le message a été envoyé avec succès')
    await refreshMessages()
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Impossible d\'envoyer le message' }, 'Erreur')
  }
}

const handleDeleteMessage = async (message: AnnouncementMessage) => {
  const confirmed = await confirm({
    title: 'Supprimer le message',
    description: `Êtes-vous sûr de vouloir supprimer "${getMessageTitle(message)}" ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer définitivement',
    confirmLoadingLabel: 'Suppression...',
    icon: Trash2,
    showWarning: message.isSent,
    warningMessage: 'Ce message a déjà été envoyé aux utilisateurs.',
    action: async () => {
      const response = await deleteMessage(message.id)
      if (!response.success) {
        toast.handleApiError(response, 'Erreur lors de la suppression')
        throw new Error('delete failed')
      }
    },
  })
  if (confirmed) {
    toast.handleApiSuccess('Message supprimé avec succès')
    await refreshMessages()
  }
}

const handleCreateSuccess = () => {
  createDialogOpen.value = false
  refreshMessages()
  toast.handleApiSuccess('Le message a été créé avec succès')
}

const confirmBulkAction = async () => {
  try {
    const messageIds = selectedMessagesForBulkAction.value.map(m => m.id)
    await bulkAction({ messageIds, action: bulkActionType.value })
    const actionLabel = { activate: 'activés', deactivate: 'désactivés', delete: 'supprimés', send: 'envoyés' }[bulkActionType.value]
    toast.handleApiSuccess(`${selectedMessagesForBulkAction.value.length} message${selectedMessagesForBulkAction.value.length > 1 ? 's ont été' : ' a été'} ${actionLabel} avec succès.`)
    bulkActionDialogOpen.value = false
    selectedMessagesForBulkAction.value = []
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Erreur lors de l\'action groupée' }, 'Erreur')
  }
}

const handleToggleStatus = async (id: number, isActive: boolean) => {
  try {
    await toggleMessageStatus(id, isActive)
    toast.handleApiSuccess(`Message ${isActive ? 'activé' : 'désactivé'} avec succès`)
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Erreur lors du changement de statut' }, 'Erreur')
  }
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'messages-annonces',
  })
}

onMounted(() => refreshMessages())

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Messages d'annonce</h1>
        <p class="text-muted-foreground">Gérez les messages d'annonce de votre plateforme Exemple</p>
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
        <UiButton @click="createDialogOpen = true">
          <Plus class="mr-2 h-4 w-4" />
          Nouveau message
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
      result-label="message"
      :total-count="messages.length"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <GenericDataTable
      :data="(displayItems as AnnouncementMessage[])"
      :config="tableConfig"
      :is-loading="isLoading"
      @row-action="handleRowAction"
      @bulk-action="handleBulkAction"
    />

    <CreateAnnouncementMessageDialog
      v-model:open="createDialogOpen"
      @success="handleCreateSuccess"
    />

    <BulkActionsAnnouncementMessagesDialog
      v-model:open="bulkActionDialogOpen"
      :action="bulkActionType"
      :messages="selectedMessagesForBulkAction"
      :selected-language="filtersState.language"
      :get-message-title="getMessageTitle"
      @confirm="confirmBulkAction"
    />
  </div>
</template>
