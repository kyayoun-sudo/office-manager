<script setup lang="ts">
import type { SubscriptionResponseDto, SubscriptionFilters, SubscriptionStatus } from '~~/shared/types/subscription'
import type { DataTableConfig } from '~~/shared/types/datatable'
import { Download, RefreshCw, Eye, AlertTriangle } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({})
useHead({ title: 'Abonnements - Modèle d’administration' })

const {
  isLoading, error, subscriptions,
  fetchSubscriptions, fetchSubscription,
  getStatusLabel, getStatusVariant,
  formatCurrency, formatDateOnly,
  expiringSoonCount,
} = useSubscriptions()

const toast = useToast()

const viewDialogOpen = ref(false)
const selectedSubscription = ref<SubscriptionResponseDto | null>(null)

const filtersState = ref({ status: 'all', includeInactive: false })

const filterFields = computed((): FilterField[] => [
  {
    key: 'status',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'active', label: 'Actifs' },
      { value: 'cancelled', label: 'Annulés' },
      { value: 'past_due', label: 'Impayés' },
      { value: 'unpaid', label: 'Non payés' },
      { value: 'incomplete', label: 'Incomplets' },
      { value: 'incomplete_expired', label: 'Expirés incomplets' },
      { value: 'trialing', label: 'En essai' },
      { value: 'expired', label: 'Expirés' },
      { value: 'suspended', label: 'Suspendus' },
    ],
  },
  {
    key: 'includeInactive',
    label: 'Inclure inactifs',
    type: 'checkbox',
    checkboxLabel: 'Inclure les abonnements inactifs',
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = { sortBy: 'createdAt', sortOrder: 'DESC' }
  if (filtersState.value.includeInactive) params.includeInactive = true
  return params
}

const performApiSearch = async () => {
  await fetchSubscriptions({ page: 1, limit: 20, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { status: 'all', includeInactive: false }
  await fetchSubscriptions({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' })
}

const displayItems = computed(() => {
  let items = Array.isArray(subscriptions.value) ? subscriptions.value.filter(Boolean) : []
  if (filtersState.value.status !== 'all') {
    items = items.filter((sub) => sub.status === filtersState.value.status)
  }
  return items
})

const tableConfig = computed((): DataTableConfig<SubscriptionResponseDto> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    {
      key: 'user',
      label: 'Utilisateur',
      sortable: true,
      getValue: (sub) =>
        sub.user?.firstName && sub.user?.lastName
          ? `${sub.user.firstName} ${sub.user.lastName}`
          : `Utilisateur #${sub.user?.id || sub.userId}`,
    },
    {
      key: 'plan',
      label: 'Plan',
      sortable: true,
      getValue: (sub) => sub.plan?.name || sub.plan?.code || 'Plan non défini',
    },
    {
      key: 'price',
      label: 'Prix',
      sortable: true,
      getValue: (sub) => formatCurrency(sub.price, sub.currency),
    },
    {
      key: 'dates',
      label: 'Début',
      sortable: true,
      getValue: (sub) => formatDateOnly(sub.startDate),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      getValue: (sub) => getStatusLabel(sub.status as SubscriptionStatus),
    },
    { key: 'createdAt', label: 'Créé le', sortable: true, render: 'date' },
  ],
  rowActions: [{ key: 'view', label: 'Voir les détails', icon: Eye, variant: 'default' }],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'createdAt', order: 'desc' },
  messages: {
    loading: 'Chargement des abonnements...',
    empty: 'Aucun abonnement trouvé',
    selected: (count) => `${count} abonnement${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'abonnements',
}))

const handleRowAction = async (_action: string, sub: SubscriptionResponseDto) => {
  const full = await fetchSubscription(sub.id)
  if (full) {
    selectedSubscription.value = full
    viewDialogOpen.value = true
  }
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'abonnements',
  })
}

onMounted(() => fetchSubscriptions({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Abonnements</h1>
        <p class="text-muted-foreground">Gérez les abonnements utilisateurs avec synchronisation Stripe</p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
        <UiButton :disabled="isLoading" @click="performApiSearch">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
      </div>
    </div>

    <UniversalFilters
      title="Filtres"
      mode="manual"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="displayItems.length"
      result-label="abonnement"
      :total-count="subscriptions.length"
      clear-all-text="Effacer les filtres"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div v-if="expiringSoonCount > 0" class="mb-4">
      <UiAlert class="border-orange-200 bg-orange-50">
        <AlertTriangle class="h-4 w-4 text-orange-600" />
        <UiAlertTitle class="text-orange-800">Abonnements expirants</UiAlertTitle>
        <UiAlertDescription class="text-orange-700">
          {{ expiringSoonCount }} abonnement{{ expiringSoonCount > 1 ? 's' : '' }} expirent dans les 7 prochains jours
        </UiAlertDescription>
      </UiAlert>
    </div>

    <GenericDataTable
      :data="displayItems"
      :config="tableConfig"
      :is-loading="isLoading"
      @row-action="handleRowAction"
    />

    <ViewSubscriptionDialog
      :open="viewDialogOpen"
      :subscription="selectedSubscription"
      @update:open="viewDialogOpen = $event"
    />
  </div>
</template>
