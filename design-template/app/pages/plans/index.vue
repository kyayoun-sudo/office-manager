<script setup lang="ts">
import { SyncDirection, SyncElement } from '~/types/stripe-sync'
import type { Plan } from '~~/shared/types/subscription-plan'
import type { DataTableConfig } from '~~/shared/types/datatable'
import type { FilterField } from '~/components/ui/filters/UniversalFilters.vue'
import { Plus, Edit, Trash2, CheckCircle2, Zap, Download } from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'

useHead({ title: "Plans d'abonnement - Modèle d’administration" })

const {
  plans, isLoading, error, fetchPlans, reorderPlans,
  deletePlanByCode, togglePlanActive, syncBidirectional,
  getIntervalLabel, formatPrice, getPlanName, getAvailableLanguages,
} = usePlans()

const toast = useToast()
const { confirm } = useConfirm()

const stripeSyncDialogOpen = ref(false)
const isSavingOrder = ref(false)

const selectedLanguage = ref('fr')
const filtersState = ref({ interval: 'all', inactiveOnly: false, language: 'fr' })

const filterFields = computed((): FilterField[] => [
  {
    key: 'interval',
    label: 'Intervalle',
    type: 'select',
    placeholder: 'Tous les intervalles',
    options: [
      { value: 'all', label: 'Tous les intervalles' },
      ...['day', 'week', 'month', 'year', 'quarter', 'semester'].map((i) => ({ value: i, label: getIntervalLabel(i) })),
    ],
  },
  {
    key: 'language',
    label: "Langue d'affichage",
    type: 'select',
    placeholder: 'Français',
    options: getAvailableLanguages().map((lang) => ({ value: lang.code, label: lang.name })),
  },
  {
    key: 'inactiveOnly',
    label: 'Inactifs seulement',
    type: 'checkbox',
    checkboxLabel: 'Afficher uniquement les plans inactifs',
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  return { lang: selectedLanguage.value }
}

const performApiSearch = async () => {
  if (filtersState.value.language) selectedLanguage.value = filtersState.value.language
  await fetchPlans({ page: 1, limit: 100, ...getCurrentFilterParams() })
}

const clearAllFilters = async () => {
  filtersState.value = { interval: 'all', inactiveOnly: false, language: 'fr' }
  selectedLanguage.value = 'fr'
  await fetchPlans({ page: 1, limit: 100, lang: 'fr' })
}

const displayItems = computed(() => {
  let items = Array.isArray(plans.value) ? plans.value.filter(Boolean) : []
  if (filtersState.value.interval && filtersState.value.interval !== 'all') {
    items = items.filter((plan) => plan.billingInterval === filtersState.value.interval)
  }
  return [...items].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
})

const handleReorder = async (reorderedItems: Plan[]) => {
  isSavingOrder.value = true
  const updates = reorderedItems.map((plan, index) => ({
    id: plan.id,
    displayOrder: index + 1,
  }))

  const success = await reorderPlans(updates)
  isSavingOrder.value = false

  if (success) {
    toast.handleApiSuccess("Ordre d'affichage mis à jour")
  } else {
    toast.handleApiError({ success: false, message: "Erreur lors de la sauvegarde de l'ordre" })
    await refreshData()
  }
}

const tableConfig = computed((): DataTableConfig<Plan> => ({
  columns: [
    { key: 'name', label: 'Plan', sortable: false, getValue: (plan) => getPlanName(plan, selectedLanguage.value) },
    { key: 'price', label: 'Prix', sortable: false, getValue: (plan) => formatPrice(plan.price, plan.currency) },
    {
      key: 'promotionalPrice',
      label: 'Prix Promo',
      sortable: false,
      getValue: (plan) => (plan.promotionalPrice ? formatPrice(plan.promotionalPrice, plan.currency) : 'N/A'),
    },
    {
      key: 'promotionalDurationMonths',
      label: 'Durée Promo',
      sortable: false,
      getValue: (plan) => (plan.promotionalDurationMonths ? `${plan.promotionalDurationMonths} mois` : 'N/A'),
    },
    { key: 'vatRate', label: 'TVA', sortable: false, getValue: (plan) => (plan.vatRate ? `${plan.vatRate}%` : 'N/A') },
    {
      key: 'billingInterval',
      label: 'Intervalle',
      sortable: false,
      getValue: (plan) => getIntervalLabel(plan.billingInterval),
    },
    {
      key: 'isActive',
      label: 'Statut',
      sortable: false,
      getValue: (plan) => plan.isActive ? 'Actif' : 'Inactif',
    },
    {
      key: 'stripe',
      label: 'Stripe',
      sortable: false,
      getValue: (plan) => {
        if (plan.stripeProductId && plan.stripePriceId) return 'Produit + Prix'
        if (plan.stripeProductId) return 'Produit'
        if (plan.stripePriceId) return 'Prix'
        return 'Non synchronisé'
      },
    },
  ],
  rowActions: [
    { key: 'edit', label: 'Modifier', icon: Edit },
    { key: 'sync', label: 'Synchroniser avec Stripe', icon: Zap, condition: (plan) => !!plan.stripeProductId },
    { key: 'toggle', label: 'Activer/Désactiver', icon: CheckCircle2, separator: true },
    { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', separator: true },
  ],
  selectable: false,
  draggable: true,
  defaultSort: { key: 'displayOrder', order: 'asc' },
  messages: {
    loading: 'Chargement des plans...',
    empty: 'Aucun plan trouvé',
    selected: (count) => `${count} plan${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
  },
  exportable: true,
  exportFilename: 'plans',
}))

const handleToggleActive = async (plan: Plan) => {
  try {
    const success = await togglePlanActive(plan.code)
    if (success) {
      toast.handleApiSuccess(`Plan ${plan.isActive ? 'désactivé' : 'activé'} avec succès.`)
    } else {
      toast.handleApiError({ success: false, error: 'Impossible de changer le statut' }, 'Erreur')
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message }, 'Erreur')
  }
}

const handleQuickSync = async (plan: Plan) => {
  if (!plan.stripeProductId) return
  try {
    const result = await syncBidirectional({
      direction: SyncDirection.BIDIRECTIONAL,
      elements: [SyncElement.ALL],
      planId: plan.id,
      force: false,
      dryRun: false,
    })
    if (result?.success) {
      toast.handleApiSuccess(`Plan ${plan.code} synchronisé avec succès`)
    } else {
      toast.handleApiSuccess(`Plan ${plan.code} : synchronisation terminée`)
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message }, 'Erreur')
  }
}

const handleRowAction = (action: string, plan: Plan) => {
  switch (action) {
    case 'edit':
      navigateTo(`/plans/${plan.id}/edit`)
      break
    case 'sync':
      handleQuickSync(plan)
      break
    case 'toggle':
      handleToggleActive(plan)
      break
    case 'delete':
      handleDeletePlan(plan)
      break
  }
}

const handleDeletePlan = async (plan: Plan) => {
  const confirmed = await confirm({
    title: 'Supprimer le Plan',
    description: `Êtes-vous sûr de vouloir supprimer le plan "${getPlanName(plan, selectedLanguage.value)}" (${plan.code}) ? Cette action est irréversible et supprimera aussi le produit dans Stripe.`,
    confirmLabel: 'Supprimer',
    confirmLoadingLabel: 'Suppression...',
    icon: Trash2,
    showWarning: !!plan.stripeProductId,
    warningMessage: 'Ce plan est synchronisé avec Stripe.',
    action: async () => {
      const success = await deletePlanByCode(plan.code)
      if (!success) {
        toast.handleApiError({ success: false, error: 'Impossible de supprimer le plan' }, 'Erreur')
        throw new Error('delete failed')
      }
    },
  })
  if (confirmed) toast.handleApiSuccess('Plan supprimé avec succès.')
}

const handleExport = () => {
  exportTableToCsv({
    data: displayItems.value,
    columns: tableConfig.value.columns,
    filename: 'plans',
  })
}

const refreshData = () => fetchPlans({ page: 1, limit: 100, ...getCurrentFilterParams() })

onMounted(() => refreshData())

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Plans d'abonnement</h1>
        <p class="text-muted-foreground">Gérez les plans d'abonnement — glissez les lignes pour réorganiser l'ordre d'affichage</p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
        <UiButton variant="outline" @click="stripeSyncDialogOpen = true">
          <Zap class="mr-2 h-4 w-4" />
          Sync Stripe
        </UiButton>
        <UiButton @click="navigateTo('/plans/new')">
          <Plus class="mr-2 h-4 w-4" />
          Nouveau Plan
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
      result-label="plan"
      :total-count="plans.length"
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
      @reorder="handleReorder"
    />

    <StripeSyncWrapper
      v-model:open="stripeSyncDialogOpen"
      :plans="plans"
      @sync-completed="refreshData"
    />
  </div>
</template>
