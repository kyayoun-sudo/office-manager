<script setup lang="ts">
import type { Payment, PaymentFilters, PaymentStatus } from '~~/shared/types/payment'
import type { DataTableConfig } from '~~/shared/types/datatable'
import { RefreshCw, Download, Eye, XCircle } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({})
useHead({ title: 'Paiements - Modèle d’administration' })

const {
  isLoading, error, payments,
  fetchPayments, fetchPayment, cancelPayment,
  getStatusLabel, formatCurrency, getFailureReasonLabel,
} = usePayments()

const { isAdmin } = useAuth()
const toast = useToast()
const { confirm } = useConfirm()

const viewDialogOpen = ref(false)
const selectedPayment = ref<Payment | null>(null)

const filtersState = ref({ status: 'all', includeRefunded: false })

const filterFields = computed((): FilterField[] => [
  {
    key: 'status',
    label: 'Statut',
    type: 'select',
    placeholder: 'Tous les statuts',
    options: [
      { value: 'all', label: 'Tous les statuts' },
      { value: 'succeeded', label: 'Réussis' },
      { value: 'pending', label: 'En attente' },
      { value: 'failed', label: 'Échoués' },
      { value: 'refunded', label: 'Remboursés' },
      { value: 'canceled', label: 'Annulés' },
    ],
  },
  {
    key: 'includeRefunded',
    label: 'Inclure remboursés',
    type: 'checkbox',
    checkboxLabel: 'Inclure les paiements remboursés',
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = { sortBy: 'paymentDate', sortOrder: 'DESC' }
  const { status, includeRefunded } = filtersState.value
  if (status !== 'all') params.status = status
  if (includeRefunded) params.includeRefunded = true
  return params
}

const currentPage = ref(1)
const itemsPerPage = ref(20)

const performApiSearch = async () => {
  currentPage.value = 1
  await fetchPayments({ page: 1, limit: itemsPerPage.value, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { status: 'all', includeRefunded: false }
  currentPage.value = 1
  await fetchPayments({ page: 1, limit: itemsPerPage.value, sortBy: 'paymentDate', sortOrder: 'DESC' })
}

const displayItems = computed(() =>
  Array.isArray(payments.value) ? payments.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const total = displayItems.value.length
  return { start: total > 0 ? 1 : 0, end: total, total }
})

const tableConfig = computed((): DataTableConfig<Payment> => ({
  columns: [
    { key: 'id', label: 'ID', sortable: true, width: '80px' },
    { key: 'paymentDate', label: 'Date', sortable: true, render: 'datetime' },
    {
      key: 'user',
      label: 'Utilisateur',
      sortable: false,
      getValue: (payment) =>
        `${payment.subscription.user?.firstName ?? ''} ${payment.subscription.user?.lastName ?? ''}`.trim() || 'N/A',
    },
    {
      key: 'amount',
      label: 'Montant',
      sortable: true,
      getValue: (payment) => formatCurrency(payment.amount, payment.currency),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: true,
      getValue: (payment) => getStatusLabel(payment.status as PaymentStatus),
    },
    {
      key: 'paymentMethod',
      label: 'Méthode',
      sortable: false,
      getValue: (payment) => payment.subscription?.paymentMethod || 'N/A',
    },
    {
      key: 'stripePaymentIntentId',
      label: 'Stripe ID',
      sortable: false,
      getValue: (payment) => payment.stripePaymentIntentId ? `${payment.stripePaymentIntentId.substring(0, 12)}...` : 'N/A',
      cellClass: 'font-mono text-xs',
    },
    { key: 'createdAt', label: 'Créé le', sortable: true, render: 'date' },
  ],
  rowActions: [
    { key: 'view', label: 'Voir les details', icon: Eye, variant: 'default' },
    ...(isAdmin.value
      ? [{
          key: 'cancel',
          label: 'Annuler le paiement',
          icon: XCircle,
          variant: 'destructive' as const,
          condition: (payment: Payment) => payment.status === 'pending',
        }]
      : []),
  ],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'paymentDate', order: 'desc' },
  messages: {
    loading: 'Chargement des paiements...',
    empty: 'Aucun paiement trouvé',
    selected: (count) => `${count} paiement${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'paiements',
}))

const handleRowAction = async (action: string, payment: Payment) => {
  if (action === 'view') {
    handleViewPayment(payment)
  } else if (action === 'cancel') {
    await handleCancelPayment(payment)
  }
}

const handleCancelPayment = async (payment: Payment) => {
  const confirmed = await confirm({
    title: 'Annuler le paiement',
    description: `Voulez-vous annuler le paiement #${payment.id} de ${formatCurrency(payment.amount, payment.currency)} ? Cette action est irreversible.`,
    confirmLabel: 'Annuler le paiement',
    cancelLabel: 'Retour',
    variant: 'destructive',
  })

  if (!confirmed) return

  const success = await cancelPayment(payment.id)
  if (success) {
    toast.handleApiSuccess('Paiement annule avec succes')
  } else {
    toast.handleApiError({ success: false, error: 'Echec de l\'annulation' }, 'Erreur')
  }
}

const handleViewPayment = async (payment: Payment) => {
  const full = await fetchPayment(payment.id)
  if (full) {
    selectedPayment.value = full
    viewDialogOpen.value = true
  }
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'paiements',
  })
}

onMounted(() => fetchPayments({ page: 1, limit: itemsPerPage.value, sortBy: 'paymentDate', sortOrder: 'DESC' }))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Paiements</h1>
        <p class="text-muted-foreground">Consultez les paiements et transactions via Stripe</p>
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
      result-label="paiement"
      :total-count="displayItems.length"
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

    <ViewPaymentDialog
      :open="viewDialogOpen"
      :payment="selectedPayment"
      @update:open="viewDialogOpen = $event"
    />
  </div>
</template>
