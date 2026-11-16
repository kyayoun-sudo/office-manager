<script setup lang="ts">
import type { NotificationHistory, NotificationHistoryFilters } from '~~/shared/types/notification'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import { Send, RotateCcw, Eye, Trash2, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

useHead({ title: 'Notifications - Modèle d’administration' })

const {
  isLoading, error, notificationHistory,
  loadNotificationHistory, deleteNotification, filterHistory,
  getNotificationTypeLabel, getNotificationStatusLabel,
  formatTitle, formatTarget, formatDateTime,
} = useNotifications()

const toast = useToast()
const { confirm } = useConfirm()

const filtersState = ref({ type: 'all', status: 'all' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'type',
    label: 'Type',
    type: 'select',
    placeholder: 'Tous les types',
    options: [
      { value: 'all', label: 'Tous les types' },
      { value: 'single', label: 'Individuelle' },
      { value: 'multiple', label: 'Multiple' },
      { value: 'topic', label: 'Topic' },
    ],
  },
  {
    key: 'status',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'sent', label: 'Envoyée' },
      { value: 'pending', label: 'En cours' },
      { value: 'failed', label: 'Échec' },
    ],
  },
])

const performApiSearch = async () => {
  await loadNotificationHistory()
}

const clearAllFilters = async () => {
  filtersState.value = { type: 'all', status: 'all' }
  await loadNotificationHistory()
}

const filteredHistory = computed(() => {
  const historyFilters: NotificationHistoryFilters = {
    type: filtersState.value.type === 'all' ? undefined : filtersState.value.type || undefined,
    status: filtersState.value.status === 'all' ? undefined : filtersState.value.status || undefined,
  }
  return filterHistory(historyFilters)
})

const tableConfig = computed((): DataTableConfig<NotificationHistory> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '100px', cellClass: 'font-mono text-xs' },
    { key: 'notification', label: 'Notification', sortable: true, getValue: (n) => formatTitle(n.title) },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      getValue: (n) => getNotificationTypeLabel(n.type as 'single' | 'multiple' | 'topic'),
    },
    { key: 'target', label: 'Destinataire(s)', sortable: false, getValue: (n) => formatTarget(n.target, n.type) },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      getValue: (n) => getNotificationStatusLabel(n.status),
    },
    { key: 'sentAt', label: "Date d'envoi", sortable: true, getValue: (n) => formatDateTime(n.sentAt) },
  ],
  rowActions: [
    { key: 'view', label: 'Voir les détails', icon: Eye, variant: 'default' },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  bulkActions: [{ key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true }],
  selectable: true,
  defaultSort: { key: 'sentAt', order: 'desc' },
  messages: {
    loading: 'Chargement des notifications...',
    empty: 'Aucune notification trouvée',
    selected: (count) => `${count} notification${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'notifications',
}))

const handleRowAction = async (action: string, notification: NotificationHistory) => {
  switch (action) {
    case 'view':
      toast.handleApiSuccess(`Affichage des détails de la notification ${notification.id}`)
      break
    case 'delete': {
      const confirmed = await confirm({
        title: 'Supprimer la notification',
        description: `Êtes-vous sûr de vouloir supprimer la notification #${notification.id} ?`,
        confirmLabel: 'Supprimer',
        confirmLoadingLabel: 'Suppression...',
        icon: Trash2,
        action: async () => {
          const success = await deleteNotification(parseInt(notification.id))
          if (!success) {
            toast.handleApiError({ success: false, error: 'Impossible de supprimer la notification' }, 'Erreur')
            throw new Error('delete failed')
          }
        },
      })
      if (confirmed) {
        toast.handleApiSuccess(`Notification ${notification.id} supprimée`)
        await loadNotificationHistory()
      }
      break
    }
  }
}

const handleBulkAction = async (action: string, notifications: NotificationHistory[]) => {
  if (action !== 'delete') return
  const ids = notifications.map((n) => n.id)
  const confirmed = await confirm({
    title: 'Supprimer les notifications',
    description: `Êtes-vous sûr de vouloir supprimer ${ids.length} notification${ids.length > 1 ? 's' : ''} ?`,
    confirmLabel: 'Supprimer',
    confirmLoadingLabel: 'Suppression...',
    icon: Trash2,
    action: async () => {
      let successCount = 0
      for (const id of ids) {
        const success = await deleteNotification(parseInt(id))
        if (success) successCount++
      }
      if (successCount < ids.length) {
        const failedCount = ids.length - successCount
        toast.handleApiError({
          success: false,
          error: `${failedCount} notification${failedCount > 1 ? 's' : ''} n'ont pas pu être supprimée${failedCount > 1 ? 's' : ''}`,
        }, 'Attention')
      }
      if (successCount === 0) throw new Error('delete failed')
    },
  })
  if (confirmed) {
    toast.handleApiSuccess(`Notification${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''} avec succès`)
    await loadNotificationHistory()
  }
}

const handleExport = () => {
  exportTableToCsv({
    data: filteredHistory.value,
    columns: tableConfig.value.columns,
    filename: 'notifications',
  })
}

onMounted(async () => {
  await loadNotificationHistory()
})

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
        <p class="text-muted-foreground">Envoyez des notifications push aux utilisateurs via Firebase Cloud Messaging</p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" :disabled="isLoading" @click="loadNotificationHistory">
          <RotateCcw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
        <UiButton variant="outline" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
        <NuxtLink to="/notifications/send">
          <UiButton>
            <Send class="mr-2 h-4 w-4" />
            Nouvelle notification
          </UiButton>
        </NuxtLink>
      </div>
    </div>

    <UniversalFilters
      title="Historique des Notifications"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="filteredHistory.length"
      result-label="notification"
      :total-count="notificationHistory.length"
      clear-all-text="Réinitialiser les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <GenericDataTable
      :data="filteredHistory || []"
      :config="tableConfig"
      :is-loading="isLoading"
      @row-action="handleRowAction"
      @bulk-action="handleBulkAction"
    />

  </div>
</template>
