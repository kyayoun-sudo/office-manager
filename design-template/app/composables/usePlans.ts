import type { 
  Plan, 
  CreatePlanRequest,
  UpdatePlanRequest,
  PlansResponse,
  PlanResponse,
  PlansStats,
  PlanFilters,
  ToggleActiveResponse,
  DeletePlanResponse
} from '~~/shared/types/subscription-plan'
import type {
  BidirectionalSyncRequest,
  SyncResultResponse,
  StripeProductsResponse,
  ImportAllFromStripeRequest,
  ImportAllFromStripeResponse
} from '~/types/stripe-sync'

export const usePlans = () => {
  const plans = ref<Plan[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const pagination = ref({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  })
  
  // Fetch all plans with pagination and filters
  const fetchPlans = async (filters?: PlanFilters) => {
    isLoading.value = true
    error.value = null

    try {
      const params: Record<string, any> = {
        page: filters?.page || 1,
        limit: filters?.limit || 10,
        includeAllTranslations: true,
        includeInactive: true
      }

      if (filters?.sortBy) params.sortBy = filters.sortBy
      if (filters?.sortOrder) params.sortOrder = filters.sortOrder

      console.log('Fetching plans with params:', params)
      const response = await api.get<PlansResponse>('/plan', { params })
      console.log('Plans API Response:', JSON.stringify(response, null, 2))

      if (response && response.success) {
        plans.value = response.data || []
        total.value = response.pagination?.total || 0
        pagination.value = response.pagination || pagination.value
        console.log('Plans loaded:', plans.value.length)
      } else {
        throw new Error('Invalid API response structure')
      }

    } catch (err: any) {
      error.value = err.message || 'Error loading plans'
      plans.value = []
      total.value = 0
      console.error('Error fetchPlans:', err)
    } finally {
      isLoading.value = false
    }
  }
  
  // Create plan
  const createPlan = async (planData: CreatePlanRequest): Promise<boolean> => {
    try {
      const withTranslations = planData.translations && planData.translations.length > 0
      const params = withTranslations ? { withTranslations: true } : {}
      
      const response = await api.post('/plan', planData, { params })
      
      if (response.success) {
        await fetchPlans() // Refresh list
        return true
      } else {
        error.value = response.error?.message || 'Error creating plan'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Error creating plan'
      return false
    }
  }
  
  // Get plan by ID
  const getPlanById = async (id: number, includeAllTranslations: boolean = true): Promise<Plan | null> => {
    try {
      const params = { 
        includeAllTranslations,
        lang: includeAllTranslations ? undefined : 'fr'
      }
      
      const response = await api.get<PlanResponse>(`/plan/${id}`, { params })
      
      if (response.success && response.data) {
        return response.data
      } else {
        error.value = response.error?.message || 'Error loading plan'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Error loading plan'
      return null
    }
  }
  
  // Update plan
  const updatePlan = async (id: number, planData: UpdatePlanRequest): Promise<boolean> => {
    try {
      const updateAllTranslations = planData.translations && planData.translations.length > 0
      const params = updateAllTranslations ? { updateAllTranslations: true } : {}
      
      const response = await api.patch(`/plan/${id}`, planData, { params })
      
      if (response.success) {
        // Update local state
        const index = plans.value.findIndex(p => p.id === id)
        if (index !== -1) {
          const updatedPlan = await getPlanById(id)
          if (updatedPlan) {
            plans.value[index] = updatedPlan
          }
        }
        return true
      } else {
        error.value = response.error?.message || 'Error updating plan'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Error updating plan'
      return false
    }
  }
  
  // Delete plan by code
  const deletePlanByCode = async (code: string, syncWithStripe: boolean = true): Promise<boolean> => {
    try {
      const params = { syncWithStripe }
      const response = await api.delete<DeletePlanResponse>(`/plan/${code}`, { params })
      
      if (response.success) {
        // Remove from local state
        plans.value = plans.value.filter(p => p.code !== code)
        total.value = plans.value.length
        return true
      } else {
        error.value = response.error?.message || 'Error deleting plan'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Error deleting plan'
      return false
    }
  }
  
  // Toggle plan active status by code
  const togglePlanActive = async (code: string, syncWithStripe: boolean = true): Promise<boolean> => {
    try {
      const params = { syncWithStripe }
      const response = await api.patch<ToggleActiveResponse>(`/plan/${code}/toggle-active`, {}, { params })
      
      if (response.success && response.data) {
        // Update local state
        const index = plans.value.findIndex(p => p.code === code)
        if (index !== -1) {
          plans.value[index].isActive = response.data.isActive
        }
        return true
      } else {
        error.value = response.error?.message || 'Error toggling plan status'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Error toggling plan status'
      return false
    }
  }
  
  // Filter helpers
  const filterByInterval = (interval: string) => {
    return plans.value.filter(plan => plan.billingInterval === interval)
  }
  
  const filterByActive = (isActive: boolean) => {
    return plans.value.filter(plan => plan.isActive === isActive)
  }
  
  const filterByPublic = (isPublic: boolean) => {
    return plans.value.filter(plan => plan.isPublic === isPublic)
  }
  
  const searchPlans = (query: string) => {
    const searchLower = query.toLowerCase()
    const searchNum = parseFloat(query) || 0
    return plans.value.filter(plan => {
      // Search in basic fields
      if (plan.code.toLowerCase().includes(searchLower)) return true
      if (plan.features.some(feature => feature.toLowerCase().includes(searchLower))) return true

      // Search in new promotional fields
      if (plan.promotionalPrice && plan.promotionalPrice.includes(query)) return true
      if (plan.promotionalDurationMonths !== undefined && plan.promotionalDurationMonths.toString().includes(query)) return true
      if (plan.vatRate !== undefined && plan.vatRate.toString().includes(query)) return true

      // Search in translations
      return plan.translations.some(translation =>
        translation.name.toLowerCase().includes(searchLower) ||
        translation.description.toLowerCase().includes(searchLower)
      )
    })
  }
  
  // Computed properties
  const plansStats = computed((): PlansStats => {
    const activePlans = plans.value.filter(p => p.isActive)
    const byInterval: Record<string, number> = {}
    let totalPrice = 0

    plans.value.forEach(plan => {
      byInterval[plan.billingInterval] = (byInterval[plan.billingInterval] || 0) + 1
      totalPrice += parseFloat(plan.price)
    })

    return {
      total: plans.value.length,
      active: activePlans.length,
      inactive: plans.value.length - activePlans.length,
      byInterval,
      averagePrice: plans.value.length > 0 ? totalPrice / plans.value.length : 0
    }
  })
  
  const activePlans = computed(() => 
    plans.value.filter(plan => plan.isActive)
  )
  
  const inactivePlans = computed(() => 
    plans.value.filter(plan => !plan.isActive)
  )
  
  // Helper functions
  const getIntervalLabel = (interval: string): string => {
    switch (interval) {
      case 'month':
        return 'Mensuel'
      case 'year':
        return 'Annuel'
      default:
        return interval
    }
  }
  
  const getIntervalColor = (interval: string): string => {
    switch (interval) {
      case 'month':
        return 'text-green-600'
      case 'year':
        return 'text-purple-600'
      default:
        return 'text-gray-600'
    }
  }
  
  const formatPrice = (price: string, currency: string): string => {
    const numericPrice = parseFloat(price)
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency
    }).format(numericPrice)
  }
  
  const formatInterval = (interval: string): string => {
    return getIntervalLabel(interval)
  }
  
  const getPlanName = (plan: Plan, lang: string = 'fr'): string => {
    const translation = plan.translations.find(t => t.language.code === lang)
    return translation?.name || plan.code
  }
  
  const getPlanDescription = (plan: Plan, lang: string = 'fr'): string => {
    const translation = plan.translations.find(t => t.language.code === lang)
    return translation?.description || ''
  }
  
  const getAvailableLanguages = () => {
    const languages = new Set<string>()
    plans.value.forEach(plan => {
      plan.translations.forEach(translation => {
        languages.add(translation.language.code)
      })
    })
    return Array.from(languages).map(code => {
      const sample = plans.value
        .flatMap(p => p.translations)
        .find(t => t.language.code === code)
      return {
        code,
        name: sample?.language.name || code,
        id: sample?.language.id || 0
      }
    })
  }

  // ===== NOUVELLES FONCTIONS DE SYNCHRONISATION STRIPE =====

  // Synchronisation bidirectionnelle avec Stripe
  const syncBidirectional = async (syncData: BidirectionalSyncRequest): Promise<SyncResultResponse | null> => {
    try {
      error.value = null
      const response = await api.post<SyncResultResponse>('/plan/sync', syncData)
      
      // Retourner la réponse même si success=false (cas des conflits)
      if (response && (response.success || response.warnings || response.details)) {
        // Refresh plans seulement si vraiment réussi
        if (response.success) {
          await fetchPlans()
        }
        return response.data || response as any
      } else {
        error.value = response.error?.message || 'Erreur lors de la synchronisation'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la synchronisation'
      return null
    }
  }

  // Lister les produits Stripe disponibles
  const listStripeProducts = async (): Promise<StripeProductsResponse | null> => {
    try {
      error.value = null
      const response = await api.get<StripeProductsResponse>('/plan/stripe/products')
      
      if (response.success) {
        return response.data || response as any
      } else {
        error.value = response.error?.message || 'Erreur lors du chargement des produits Stripe'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des produits Stripe'
      return null
    }
  }

  // Importer tous les produits Stripe
  const importAllFromStripe = async (options: ImportAllFromStripeRequest = {}): Promise<ImportAllFromStripeResponse | null> => {
    try {
      error.value = null
      const params = {
        dryRun: options.dryRun || false,
        overwriteExisting: options.overwriteExisting || false,
        includeInactive: options.includeInactive || false
      }
      
      const response = await api.post<ImportAllFromStripeResponse>('/plan/sync/import-all', {}, { params })
      
      if (response.success) {
        // Refresh plans après import pour voir les nouveaux plans
        if (!options.dryRun) {
          await fetchPlans()
        }
        return response
      } else {
        error.value = response.error?.message || 'Erreur lors de l\'import depuis Stripe'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'import depuis Stripe'
      return null
    }
  }
  
  const reorderPlans = async (orderedIds: Array<{ id: number; displayOrder: number }>): Promise<boolean> => {
    try {
      const results = await Promise.allSettled(
        orderedIds.map(({ id, displayOrder }) =>
          api.patch(`/plan/${id}`, { displayOrder }),
        ),
      )

      const allSuccess = results.every(r => r.status === 'fulfilled')

      orderedIds.forEach(({ id, displayOrder }) => {
        const plan = plans.value.find(p => p.id === id)
        if (plan) (plan as any).displayOrder = displayOrder
      })

      return allSuccess
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du réordonnancement'
      return false
    }
  }

  return {
    // State
    plans: readonly(plans),
    isLoading: readonly(isLoading),
    error: readonly(error),
    total: readonly(total),
    pagination: readonly(pagination),
    
    // Methods
    fetchPlans,
    createPlan,
    getPlanById,
    updatePlan,
    deletePlanByCode,
    togglePlanActive,
    reorderPlans,
    filterByInterval,
    filterByActive,
    filterByPublic,
    searchPlans,
    
    // Computed
    plansStats,
    activePlans,
    inactivePlans,
    
    // Helpers
    getIntervalLabel,
    getIntervalColor,
    formatPrice,
    formatInterval,
    getPlanName,
    getPlanDescription,
    getAvailableLanguages,
    
    // Stripe Sync Functions
    syncBidirectional,
    listStripeProducts,
    importAllFromStripe
  }
}