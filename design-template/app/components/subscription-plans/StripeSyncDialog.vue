<script setup lang="ts">
import { 
  ArrowLeftRight, 
  ArrowRight, 
  ArrowLeft, 
  Eye, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Download,
  Upload,
  Zap
} from 'lucide-vue-next'
import { 
  SyncDirection, 
  SyncElement,
  type BidirectionalSyncRequest, 
  type SyncResultResponse,
  type SyncChangeItem,
  type StripeProduct,
  type ImportAllFromStripeResponse
} from '~/types/stripe-sync'
import type { Plan } from '~~/shared/types/subscription-plan'

interface Props {
  open: boolean
  plans: Plan[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'sync-completed': [result: SyncResultResponse]
}>()

const { 
  syncBidirectional, 
  listStripeProducts, 
  importAllFromStripe,
  isLoading: plansLoading,
  error: plansError
} = usePlans()

const toast = useToast()

// Removed isClient check as it's handled by wrapper

// État du dialog
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

// État du formulaire
const syncForm = ref<BidirectionalSyncRequest>({
  direction: SyncDirection.LOCAL_TO_STRIPE,
  elements: [SyncElement.ALL],
  planId: undefined,
  stripeProductId: '',
  force: false,
  dryRun: false
})

// État des operations
const isLoading = ref(false)
const syncResult = ref<SyncResultResponse | null>(null)
const stripeProducts = ref<StripeProduct[]>([])
const importResult = ref<ImportAllFromStripeResponse | null>(null)

// Options pour les select
const directionOptions = [
  {
    value: SyncDirection.LOCAL_TO_STRIPE,
    label: 'Local → Stripe',
    description: 'Pousser les données locales vers Stripe',
    icon: Upload,
    color: 'text-green-600'
  },
  {
    value: SyncDirection.STRIPE_TO_LOCAL,
    label: 'Stripe → Local',
    description: 'Importer les données de Stripe vers local',
    icon: Download,
    color: 'text-blue-600'
  },
  {
    value: SyncDirection.BIDIRECTIONAL,
    label: 'Bidirectionnel',
    description: 'Synchronisation intelligente (le plus récent gagne)',
    icon: ArrowLeftRight,
    color: 'text-purple-600'
  }
]

const elementOptions = [
  { value: SyncElement.ALL, label: 'Tout synchroniser', description: 'Synchronise tous les éléments' },
  { value: SyncElement.PRODUCT, label: 'Produit', description: 'Nom, description, statut actif' },
  { value: SyncElement.PRICE, label: 'Prix standard', description: 'Prix principal du plan' },
  { value: SyncElement.PROMOTIONAL_PRICE, label: 'Prix promotionnel', description: 'Prix réduit temporaire' },
  { value: SyncElement.TAX_RATE, label: 'Taux de TVA', description: 'Taux de taxe applicable' }
]

// Plans disponibles pour la sync
const availablePlans = computed(() => 
  props.plans.filter(plan => 
    syncForm.value.direction !== SyncDirection.STRIPE_TO_LOCAL || plan.stripeProductId
  )
)

// Validation
const canSync = computed(() => {
  const form = syncForm.value
  
  // Direction LOCAL_TO_STRIPE ou BIDIRECTIONAL : planId requis
  if ([SyncDirection.LOCAL_TO_STRIPE, SyncDirection.BIDIRECTIONAL].includes(form.direction)) {
    return form.planId !== undefined
  }
  
  // Direction STRIPE_TO_LOCAL : stripeProductId requis
  if (form.direction === SyncDirection.STRIPE_TO_LOCAL) {
    return form.stripeProductId && form.stripeProductId.trim() !== ''
  }
  
  return false
})

// Handlers

const loadStripeProducts = async () => {
  try {
    isLoading.value = true
    const response = await listStripeProducts()
    
    if (response && response.data) {
      stripeProducts.value = response.data
      // Ne pas afficher de message de succès pour éviter le spam
      console.log(`${response.data.length} produits Stripe chargés`)
    } else {
      // Gérer silencieusement l'échec - probablement l'endpoint n'existe pas encore
      stripeProducts.value = []
      console.warn('Impossible de charger les produits Stripe:', plansError.value)
    }
  } catch (err: any) {
    // Gérer silencieusement l'erreur pour éviter les announcement d'erreur
    stripeProducts.value = []
    console.warn('Erreur lors du chargement des produits Stripe:', err.message)
  } finally {
    isLoading.value = false
  }
}

const performSync = async () => {
  if (!canSync.value) return
  
  try {
    isLoading.value = true
    syncResult.value = null
    
    const result = await syncBidirectional(syncForm.value)
    
    if (result) {
      syncResult.value = result
      emit('sync-completed', result)
      
      if (syncForm.value.dryRun) {
        toast.handleApiSuccess('Simulation terminée - Aucun changement appliqué')
      } else {
        toast.handleApiSuccess('Synchronisation terminée avec succès')
      }
    } else {
      toast.handleApiError({ success: false, error: plansError.value }, 'Erreur de synchronisation')
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message }, 'Erreur')
  } finally {
    isLoading.value = false
  }
}

const performImportAll = async () => {
  try {
    isLoading.value = true
    importResult.value = null
    
    const result = await importAllFromStripe({
      dryRun: syncForm.value.dryRun,
      overwriteExisting: syncForm.value.force,
      includeInactive: false
    })
    
    if (result) {
      importResult.value = result
      
      if (syncForm.value.dryRun) {
        toast.handleApiSuccess(`Simulation: ${result.imported} créations, ${result.updated} mises à jour, ${result.skipped} ignorés`)
      } else {
        toast.handleApiSuccess(`Import terminé: ${result.imported} créés, ${result.updated} mis à jour`)
      }
    } else {
      console.warn('Erreur lors de l\'import depuis Stripe:', plansError.value)
    }
  } catch (err: any) {
    console.warn('Erreur lors de l\'import depuis Stripe:', err.message)
  } finally {
    isLoading.value = false
  }
}

// Reset form
const resetForm = () => {
  syncForm.value = {
    direction: SyncDirection.LOCAL_TO_STRIPE,
    elements: [SyncElement.ALL],
    planId: undefined,
    stripeProductId: '',
    force: false,
    dryRun: false
  }
  syncResult.value = null
  importResult.value = null
}

// Watcher pour réinitialiser les champs selon la direction
watch(() => syncForm.value.direction, (newDirection) => {
  if (newDirection === SyncDirection.STRIPE_TO_LOCAL) {
    syncForm.value.planId = undefined
  } else {
    syncForm.value.stripeProductId = ''
  }
  syncResult.value = null
})

// Load Stripe products quand le dialog s'ouvre
watch(isOpen, (opened) => {
  if (opened) {
    loadStripeProducts()
  } else {
    resetForm()
  }
})

// Helpers pour l'affichage
const getDirectionIcon = (direction: SyncDirection) => {
  const option = directionOptions.find(opt => opt.value === direction)
  return option?.icon || ArrowLeftRight
}

const getDirectionColor = (direction: SyncDirection) => {
  const option = directionOptions.find(opt => opt.value === direction)
  return option?.color || 'text-gray-600'
}

const formatSyncChange = (change: SyncChangeItem) => {
  return `${change.field}: ${change.from} → ${change.to}`
}
</script>

<template>
  <UiDialog v-model:open="isOpen">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center gap-2">
          <Zap class="h-5 w-5 text-yellow-500" />
          Synchronisation Stripe
        </UiDialogTitle>
        <UiDialogDescription>
          Synchronisez les données entre votre base locale et Stripe avec contrôle total
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-6">
        <!-- Configuration de la synchronisation -->
        <UiCard>
          <UiCardHeader>
            <UiCardTitle class="text-lg">Configuration</UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <!-- Direction -->
            <div>
              <UiLabel>Direction de synchronisation</UiLabel>
              <UiSelect v-model="syncForm.direction">
                <UiSelectTrigger>
                  <UiSelectValue placeholder="Choisir la direction" />
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem 
                    v-for="option in directionOptions" 
                    :key="option.value" 
                    :value="option.value"
                  >
                    <div class="flex items-center gap-2">
                      <component :is="option.icon" :class="['h-4 w-4', option.color]" />
                      <div>
                        <div class="font-medium">{{ option.label }}</div>
                        <div class="text-xs text-muted-foreground">{{ option.description }}</div>
                      </div>
                    </div>
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Plan local (si direction nécessite planId) -->
              <div v-if="[SyncDirection.LOCAL_TO_STRIPE, SyncDirection.BIDIRECTIONAL].includes(syncForm.direction)">
                <UiLabel>Plan local</UiLabel>
                <UiSelect v-model="syncForm.planId">
                  <UiSelectTrigger>
                    <UiSelectValue placeholder="Sélectionner un plan" />
                  </UiSelectTrigger>
                  <UiSelectContent>
                    <UiSelectItem 
                      v-for="plan in availablePlans" 
                      :key="plan.id" 
                      :value="plan.id"
                    >
                      <div class="flex items-center justify-between w-full">
                        <div>
                          <div class="font-medium">{{ plan.code }}</div>
                          <div class="text-sm text-muted-foreground">{{ plan.price }}€ / {{ plan.billingInterval }}</div>
                        </div>
                        <div v-if="plan.stripeProductId" class="text-xs bg-green-50 text-green-600 px-2 py-1 rounded">
                          Stripe ✓
                        </div>
                      </div>
                    </UiSelectItem>
                  </UiSelectContent>
                </UiSelect>
              </div>

              <!-- Produit Stripe (si direction STRIPE_TO_LOCAL) -->
              <div v-if="syncForm.direction === SyncDirection.STRIPE_TO_LOCAL">
                <UiLabel>Produit Stripe</UiLabel>
                <UiSelect v-model="syncForm.stripeProductId">
                  <UiSelectTrigger>
                    <UiSelectValue placeholder="Sélectionner un produit Stripe" />
                  </UiSelectTrigger>
                  <UiSelectContent>
                    <UiSelectItem 
                      v-for="product in stripeProducts" 
                      :key="product.id" 
                      :value="product.id"
                    >
                      <div>
                        <div class="font-medium">{{ product.name }}</div>
                        <div class="text-xs text-muted-foreground">{{ product.id }}</div>
                        <div class="flex items-center gap-2 mt-1">
                          <UiBadge :variant="product.active ? 'default' : 'secondary'" class="text-xs">
                            {{ product.active ? 'Actif' : 'Inactif' }}
                          </UiBadge>
                        </div>
                      </div>
                    </UiSelectItem>
                  </UiSelectContent>
                </UiSelect>
              </div>
            </div>

            <!-- Éléments à synchroniser -->
            <div>
              <UiLabel>Éléments à synchroniser</UiLabel>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                <UiLabel 
                  v-for="option in elementOptions" 
                  :key="option.value"
                  class="flex items-center space-x-2 border rounded p-3 cursor-pointer hover:bg-muted/50"
                  :class="{ 'bg-primary/10 border-primary': syncForm.elements?.includes(option.value) }"
                >
                  <UiCheckbox
                    :checked="syncForm.elements?.includes(option.value)"
                    @update:checked="(checked) => {
                      if (checked && !syncForm.elements?.includes(option.value)) {
                        syncForm.elements = [...(syncForm.elements || []), option.value]
                      } else if (!checked) {
                        syncForm.elements = syncForm.elements?.filter(e => e !== option.value)
                      }
                    }"
                  />
                  <div class="flex-1">
                    <div class="font-medium text-sm">{{ option.label }}</div>
                    <div class="text-xs text-muted-foreground">{{ option.description }}</div>
                  </div>
                </UiLabel>
              </div>
            </div>

            <!-- Options avancées -->
            <div class="flex flex-wrap gap-4">
              <UiLabel class="flex items-center space-x-2 cursor-pointer">
                <UiCheckbox v-model:checked="syncForm.dryRun" />
                <span>Mode simulation (Dry Run)</span>
              </UiLabel>
              <UiLabel class="flex items-center space-x-2 cursor-pointer">
                <UiCheckbox v-model:checked="syncForm.force" />
                <span>Forcer en cas de conflit</span>
              </UiLabel>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 pt-4 border-t">
              <UiButton 
                :disabled="!canSync || isLoading" 
                class="flex-1"
                @click="performSync"
              >
                <component 
                  :is="getDirectionIcon(syncForm.direction)" 
                  class="h-4 w-4 mr-2" 
                  :class="{ 'animate-spin': isLoading }"
                />
                {{ syncForm.dryRun ? 'Simuler' : 'Synchroniser' }}
              </UiButton>
              
              <UiButton 
                variant="outline" 
                :disabled="isLoading"
                @click="performImportAll"
              >
                <Download class="h-4 w-4 mr-2" />
                {{ syncForm.dryRun ? 'Simuler Import' : 'Importer Tout' }}
              </UiButton>
            </div>
          </UiCardContent>
        </UiCard>

        <!-- Résultat de la synchronisation -->
        <UiCard v-if="syncResult">
          <UiCardHeader>
            <UiCardTitle class="flex items-center gap-2">
              <CheckCircle2 v-if="syncResult.success" class="h-5 w-5 text-green-600" />
              <XCircle v-else class="h-5 w-5 text-red-600" />
              Résultat de la synchronisation
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-sm text-muted-foreground">Direction</div>
                <div class="font-medium">{{ syncResult.direction }}</div>
              </div>
              <div>
                <div class="text-sm text-muted-foreground">Statut</div>
                <UiBadge :variant="syncResult.success ? 'default' : 'destructive'">
                  {{ syncResult.success ? 'Succès' : 'Échec' }}
                </UiBadge>
              </div>
            </div>

            <!-- Changements en simulation -->
            <div v-if="syncResult.pendingChanges && syncResult.pendingChanges.length > 0">
              <div class="text-sm font-medium text-muted-foreground mb-2">Changements à appliquer:</div>
              <div class="space-y-1">
                <div 
                  v-for="(change, index) in syncResult.pendingChanges" 
                  :key="index"
                  class="text-sm bg-blue-50 text-blue-700 p-2 rounded"
                >
                  {{ formatSyncChange(change) }}
                </div>
              </div>
            </div>

            <!-- Détails de la sync -->
            <div v-if="Object.keys(syncResult.details).length > 0">
              <div class="text-sm font-medium text-muted-foreground mb-2">Détails:</div>
              <div class="bg-muted p-3 rounded text-sm">
                <pre>{{ JSON.stringify(syncResult.details, null, 2) }}</pre>
              </div>
            </div>

            <!-- Avertissements -->
            <div v-if="syncResult.warnings && syncResult.warnings.length > 0">
              <div class="text-sm font-medium text-muted-foreground mb-2">Avertissements:</div>
              <div class="space-y-1">
                <div 
                  v-for="(warning, index) in syncResult.warnings" 
                  :key="index"
                  class="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 p-2 rounded"
                >
                  <AlertTriangle class="h-4 w-4" />
                  {{ warning }}
                </div>
              </div>
            </div>
          </UiCardContent>
        </UiCard>

        <!-- Résultat de l'import -->
        <UiCard v-if="importResult">
          <UiCardHeader>
            <UiCardTitle class="flex items-center gap-2">
              <Download class="h-5 w-5 text-blue-600" />
              Résultat de l'import depuis Stripe
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div class="text-center">
                <div class="text-2xl font-bold text-green-600">{{ importResult.imported }}</div>
                <div class="text-sm text-muted-foreground">Créés</div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-blue-600">{{ importResult.updated }}</div>
                <div class="text-sm text-muted-foreground">Mis à jour</div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-gray-600">{{ importResult.skipped }}</div>
                <div class="text-sm text-muted-foreground">Ignorés</div>
              </div>
              <div class="text-center">
                <div class="text-2xl font-bold text-red-600">{{ importResult.errors }}</div>
                <div class="text-sm text-muted-foreground">Erreurs</div>
              </div>
            </div>

            <!-- Détails des plans importés -->
            <div v-if="importResult.details.length > 0" class="space-y-2">
              <div class="text-sm font-medium text-muted-foreground">Détails des plans:</div>
              <div class="max-h-48 overflow-y-auto space-y-1">
                <div 
                  v-for="detail in importResult.details" 
                  :key="detail.stripeProductId"
                  class="flex items-center justify-between p-2 border rounded text-sm"
                >
                  <div>
                    <div class="font-medium">{{ detail.stripeProductName }}</div>
                    <div class="text-muted-foreground">{{ detail.stripeProductId }}</div>
                    <div v-if="detail.planCode" class="text-xs">Code: {{ detail.planCode }}</div>
                  </div>
                  <div class="text-right">
                    <UiBadge
:variant="
                      detail.action === 'created' ? 'default' :
                      detail.action === 'updated' ? 'secondary' :
                      detail.action === 'error' ? 'destructive' : 'outline'
                    ">
                      {{ 
                        detail.action === 'created' ? 'Créé' :
                        detail.action === 'updated' ? 'Mis à jour' :
                        detail.action === 'skipped' ? 'Ignoré' : 'Erreur'
                      }}
                    </UiBadge>
                    <div v-if="detail.price" class="text-xs text-muted-foreground mt-1">
                      {{ detail.price }}€ {{ detail.currency }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UiCardContent>
        </UiCard>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" :disabled="isLoading" @click="isOpen = false">
          Fermer
        </UiButton>
        <UiButton variant="outline" :disabled="isLoading" @click="resetForm">
          <RefreshCw class="h-4 w-4 mr-2" />
          Réinitialiser
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>